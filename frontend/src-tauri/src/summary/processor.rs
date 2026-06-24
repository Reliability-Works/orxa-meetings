use crate::summary::llm_client::{generate_summary, LLMProvider};
use crate::summary::templates::Template;
use reqwest::Client;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

mod language;
mod prompts;
mod text;

pub(crate) use language::language_name_from_code;
use language::{
    english_markdown_after_normalization_result, normalize_markdown_to_english,
    resolve_cached_english, resolve_final_language_action, translate_markdown, FinalLanguageAction,
};
use prompts::*;
pub use text::{
    chunk_text, clean_llm_markdown_output, extract_meeting_name_from_markdown, rough_token_count,
};

struct SummaryGenerationRequest<'a> {
    client: &'a Client,
    provider: &'a LLMProvider,
    model_name: &'a str,
    api_key: &'a str,
    text: &'a str,
    custom_prompt: &'a str,
    template_id: &'a str,
    template: &'a Template,
    token_threshold: usize,
    ollama_endpoint: Option<&'a str>,
    custom_openai_endpoint: Option<&'a str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&'a PathBuf>,
    cancellation_token: Option<&'a CancellationToken>,
    summary_language: Option<&'a str>,
    detected_transcript_language: Option<&'a str>,
    cached_english: Option<&'a str>,
}

impl SummaryGenerationRequest<'_> {
    async fn generate(&self, system_prompt: &str, user_prompt: &str) -> Result<String, String> {
        generate_summary(
            self.client,
            self.provider,
            self.model_name,
            self.api_key,
            system_prompt,
            user_prompt,
            self.ollama_endpoint,
            self.custom_openai_endpoint,
            self.max_tokens,
            self.temperature,
            self.top_p,
            self.app_data_dir,
            self.cancellation_token,
        )
        .await
    }
}

fn check_summary_cancelled(cancellation_token: Option<&CancellationToken>) -> Result<(), String> {
    if cancellation_token.is_some_and(CancellationToken::is_cancelled) {
        Err("Summary generation was cancelled".to_string())
    } else {
        Ok(())
    }
}

/// Generates a complete meeting summary with conditional chunking strategy
///
/// # Arguments
/// * `client` - Reqwest HTTP client
/// * `provider` - LLM provider to use
/// * `model_name` - Specific model name
/// * `api_key` - API key for the provider
/// * `text` - Full transcript text to summarize
/// * `custom_prompt` - Optional user-provided context
/// * `template_id` - Template identifier (e.g., "daily_standup", "standard_meeting")
/// * `token_threshold` - Token limit for single-pass processing (default 4000)
/// * `ollama_endpoint` - Optional custom Ollama endpoint
/// * `custom_openai_endpoint` - Optional custom OpenAI-compatible endpoint
/// * `max_tokens` - Optional max tokens for completion (CustomOpenAI provider)
/// * `temperature` - Optional temperature (CustomOpenAI provider)
/// * `top_p` - Optional top_p (CustomOpenAI provider)
/// * `app_data_dir` - Optional app data directory (BuiltInAI provider)
/// * `cancellation_token` - Optional cancellation token to stop processing
/// * `summary_language` - Optional BCP-47 tag (e.g. "en-GB") to force summary output language
/// * `detected_transcript_language` - Optional detected transcript language BCP-47 tag
/// * `cached_english` - Optional previously-generated English summary to skip pass 1 when translating
///
/// # Returns
/// Tuple of (final_summary_markdown, english_summary_markdown, number_of_chunks_processed)
/// where english_summary_markdown is the canonical AI-generated English summary
/// (equals final_summary_markdown when target language is English)
#[expect(
    clippy::too_many_arguments,
    reason = "Summary generation carries transcript, template, provider, language, and cache context"
)]
pub async fn generate_meeting_summary(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    text: &str,
    custom_prompt: &str,
    template_id: &str,
    template: &Template,
    token_threshold: usize,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
    summary_language: Option<&str>,
    detected_transcript_language: Option<&str>,
    cached_english: Option<&str>,
) -> Result<(String, String, i64), String> {
    let request = SummaryGenerationRequest {
        client,
        provider,
        model_name,
        api_key,
        text,
        custom_prompt,
        template_id,
        template,
        token_threshold,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        cancellation_token,
        summary_language,
        detected_transcript_language,
        cached_english,
    };

    check_summary_cancelled(request.cancellation_token)?;
    info!(
        "Starting summary generation with provider: {:?}, model: {}",
        request.provider, request.model_name
    );

    let total_tokens = rough_token_count(request.text);
    info!("Transcript length: {} tokens", total_tokens);

    let (mut english_markdown, successful_chunk_count) =
        generate_english_markdown(&request, total_tokens).await?;
    let final_markdown = apply_final_language(&request, &mut english_markdown).await?;

    info!("Summary generation completed successfully");
    Ok((final_markdown, english_markdown, successful_chunk_count))
}

async fn generate_english_markdown(
    request: &SummaryGenerationRequest<'_>,
    total_tokens: usize,
) -> Result<(String, i64), String> {
    if let Some(cached) = resolve_cached_english(request.cached_english, request.summary_language) {
        info!(
            "✓ Using cached English summary ({} chars), skipping pass 1",
            cached.len()
        );
        return Ok((cached.to_string(), 1));
    }

    let (content_to_summarize, successful_chunk_count) =
        source_text_for_final_report(request, total_tokens).await?;
    let english_markdown = generate_final_report(request, &content_to_summarize).await?;
    Ok((english_markdown, successful_chunk_count))
}

async fn source_text_for_final_report(
    request: &SummaryGenerationRequest<'_>,
    total_tokens: usize,
) -> Result<(String, i64), String> {
    if should_use_single_pass(request, total_tokens) {
        info!(
            "Using single-pass summarization (tokens: {}, threshold: {})",
            total_tokens, request.token_threshold
        );
        return Ok((request.text.to_string(), 1));
    }

    info!(
        "Using multi-level summarization (tokens: {} exceeds threshold: {})",
        total_tokens, request.token_threshold
    );
    let chunks = chunk_text(request.text, request.token_threshold - 300, 100);
    let num_chunks = chunks.len();
    info!("Split transcript into {} chunks", num_chunks);

    let chunk_summaries = summarize_chunks(request, &chunks).await?;
    let successful_chunk_count = chunk_summaries.len() as i64;
    info!(
        "Successfully processed {} out of {} chunks",
        successful_chunk_count, num_chunks
    );

    combine_chunk_summaries(request, chunk_summaries)
        .await
        .map(|content| (content, successful_chunk_count))
}

fn should_use_single_pass(request: &SummaryGenerationRequest<'_>, total_tokens: usize) -> bool {
    (request.provider != &LLMProvider::Ollama && request.provider != &LLMProvider::BuiltInAI)
        || total_tokens < request.token_threshold
}

async fn summarize_chunks(
    request: &SummaryGenerationRequest<'_>,
    chunks: &[String],
) -> Result<Vec<String>, String> {
    let mut chunk_summaries = Vec::new();
    let num_chunks = chunks.len();

    for (i, chunk) in chunks.iter().enumerate() {
        if let Err(e) = check_summary_cancelled(request.cancellation_token) {
            info!(
                "Summary generation cancelled during chunk {}/{}",
                i + 1,
                num_chunks
            );
            return Err(e);
        }

        info!("Processing chunk {}/{}", i + 1, num_chunks);
        let user_prompt = build_chunk_summary_user_prompt(chunk);
        match request
            .generate("You are an expert meeting summarizer.", &user_prompt)
            .await
        {
            Ok(summary) => {
                chunk_summaries.push(summary);
                info!("✓ Chunk {}/{} processed successfully", i + 1, num_chunks);
            }
            Err(e) if e.contains("cancelled") => return Err(e),
            Err(e) => error!("Failed processing chunk {}/{}: {}", i + 1, num_chunks, e),
        }
    }

    if chunk_summaries.is_empty() {
        Err("Multi-level summarization failed: No chunks were processed successfully.".to_string())
    } else {
        Ok(chunk_summaries)
    }
}

async fn combine_chunk_summaries(
    request: &SummaryGenerationRequest<'_>,
    mut chunk_summaries: Vec<String>,
) -> Result<String, String> {
    if chunk_summaries.len() == 1 {
        return Ok(chunk_summaries.remove(0));
    }

    info!(
        "Combining {} chunk summaries into cohesive summary",
        chunk_summaries.len()
    );
    let combined_text = chunk_summaries.join("\n---\n");
    let user_prompt = build_combine_summary_user_prompt(&combined_text);
    request
        .generate(
            "You are an expert at synthesizing meeting summaries.",
            &user_prompt,
        )
        .await
}

async fn generate_final_report(
    request: &SummaryGenerationRequest<'_>,
    content_to_summarize: &str,
) -> Result<String, String> {
    info!(
        "Generating final markdown report with template: {}",
        request.template_id
    );

    let clean_template_markdown = request.template.to_markdown_structure();
    let section_instructions = request.template.to_section_instructions();
    let final_system_prompt =
        build_final_report_system_prompt(&section_instructions, &clean_template_markdown);
    let final_user_prompt =
        build_final_report_user_prompt(content_to_summarize, request.custom_prompt);

    if let Err(e) = check_summary_cancelled(request.cancellation_token) {
        info!("Summary generation cancelled before final summary");
        return Err(e);
    }

    let raw_markdown = request
        .generate(&final_system_prompt, &final_user_prompt)
        .await?;
    let english_markdown = clean_llm_markdown_output(&raw_markdown);
    info!("Summary pass completed ({} chars)", english_markdown.len());
    Ok(english_markdown)
}

fn build_final_report_user_prompt(content_to_summarize: &str, custom_prompt: &str) -> String {
    let mut final_user_prompt =
        format!("<transcript_chunks>\n{content_to_summarize}\n</transcript_chunks>\n");

    if !custom_prompt.is_empty() {
        final_user_prompt.push_str("\n\nUser Provided Context:\n\n<user_context>\n");
        final_user_prompt.push_str(custom_prompt);
        final_user_prompt.push_str("\n</user_context>");
    }

    final_user_prompt
}

async fn apply_final_language(
    request: &SummaryGenerationRequest<'_>,
    english_markdown: &mut String,
) -> Result<String, String> {
    match resolve_final_language_action(
        request.summary_language,
        request.detected_transcript_language,
    ) {
        FinalLanguageAction::Translate(name) => translate_markdown(
            request.client,
            request.provider,
            request.model_name,
            request.api_key,
            english_markdown,
            name,
            request.ollama_endpoint,
            request.custom_openai_endpoint,
            request.max_tokens,
            request.temperature,
            request.top_p,
            request.app_data_dir,
            request.cancellation_token,
        )
        .await
        .map_err(|e| format!("Translation to {} failed: {}", name, e)),
        FinalLanguageAction::NormalizeEnglish => {
            info!(
                "English target with detected transcript language {:?}; running soft English normalization",
                request.detected_transcript_language
            );
            let normalized = english_markdown_after_normalization_result(
                english_markdown,
                normalize_markdown_to_english(
                    request.client,
                    request.provider,
                    request.model_name,
                    request.api_key,
                    english_markdown,
                    request.ollama_endpoint,
                    request.custom_openai_endpoint,
                    request.max_tokens,
                    request.temperature,
                    request.top_p,
                    request.app_data_dir,
                    request.cancellation_token,
                )
                .await,
            )?;
            *english_markdown = normalized.clone();
            Ok(normalized)
        }
        FinalLanguageAction::ReturnEnglish => Ok(english_markdown.clone()),
    }
}

#[cfg(test)]
mod tests;
