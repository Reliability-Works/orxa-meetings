use super::{
    build_summary_cache_source, build_summary_result_json, extract_cached_english_markdown,
    template_cache_fingerprint, SummaryCacheSource, SummaryService, METADATA_CACHE,
};
use crate::database::repositories::{
    meeting::MeetingsRepository, setting::SettingsRepository, summary::SummaryProcessesRepository,
};
use crate::summary::llm_client::LLMProvider;
use crate::summary::processor::{extract_meeting_name_from_markdown, generate_meeting_summary};
use crate::summary::templates;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

struct BackgroundSummaryRequest {
    meeting_id: String,
    text: String,
    model_provider: String,
    model_name: String,
    custom_prompt: String,
    template_id: String,
    summary_language: Option<String>,
}

struct ProviderSettings {
    provider: LLMProvider,
    final_api_key: String,
    ollama_endpoint: Option<String>,
    custom_openai_endpoint: Option<String>,
    custom_openai_max_tokens: Option<u32>,
    custom_openai_temperature: Option<f32>,
    custom_openai_top_p: Option<f32>,
}

struct SummaryJobOutput {
    final_markdown: String,
    english_markdown: String,
    num_chunks: i64,
    cache_source: SummaryCacheSource,
}

impl SummaryService {
    /// Processes transcript in the background and generates summary.
    #[expect(
        clippy::too_many_arguments,
        reason = "Background job receives the full summary request captured before spawn"
    )]
    pub async fn process_transcript_background<R: tauri::Runtime>(
        app: AppHandle<R>,
        pool: SqlitePool,
        meeting_id: String,
        text: String,
        model_provider: String,
        model_name: String,
        custom_prompt: String,
        template_id: String,
        summary_language: Option<String>,
    ) {
        let start_time = Instant::now();
        info!(
            "Starting background processing for meeting_id: {}",
            meeting_id
        );

        let request = BackgroundSummaryRequest {
            meeting_id,
            text,
            model_provider,
            model_name,
            custom_prompt,
            template_id,
            summary_language,
        };
        let cancellation_token = Self::register_cancellation_token(&request.meeting_id);
        let app_data_dir = app.path().app_data_dir().ok();

        let result =
            Self::run_summary_job(&pool, &request, app_data_dir.as_ref(), &cancellation_token)
                .await;
        let duration = start_time.elapsed().as_secs_f64();

        Self::cleanup_cancellation_token(&request.meeting_id);
        Self::persist_summary_job_result(&pool, &request, result, duration).await;
    }

    async fn run_summary_job(
        pool: &SqlitePool,
        request: &BackgroundSummaryRequest,
        app_data_dir: Option<&PathBuf>,
        cancellation_token: &CancellationToken,
    ) -> Result<SummaryJobOutput, String> {
        let provider_settings = Self::load_provider_settings(pool, request).await?;
        let token_threshold = Self::resolve_token_threshold(&provider_settings, request).await;
        let detected_summary_language =
            Self::resolve_detected_summary_language(pool, request).await;
        let template = templates::get_template(&request.template_id)
            .map_err(|e| format!("Failed to load template '{}': {}", request.template_id, e))?;
        let template_fingerprint = template_cache_fingerprint(&template);
        let cache_source = Self::build_cache_source(
            request,
            &provider_settings,
            token_threshold,
            &template_fingerprint,
        );
        let cached_english = Self::load_cached_english(pool, request, &cache_source).await;

        let client = reqwest::Client::new();
        let (final_markdown, english_markdown, num_chunks) = generate_meeting_summary(
            &client,
            &provider_settings.provider,
            &request.model_name,
            &provider_settings.final_api_key,
            &request.text,
            &request.custom_prompt,
            &request.template_id,
            &template,
            token_threshold,
            provider_settings.ollama_endpoint.as_deref(),
            provider_settings.custom_openai_endpoint.as_deref(),
            provider_settings.custom_openai_max_tokens,
            provider_settings.custom_openai_temperature,
            provider_settings.custom_openai_top_p,
            app_data_dir,
            Some(cancellation_token),
            request.summary_language.as_deref(),
            detected_summary_language.as_deref(),
            cached_english.as_deref(),
        )
        .await?;

        Ok(SummaryJobOutput {
            final_markdown,
            english_markdown,
            num_chunks,
            cache_source,
        })
    }

    async fn load_provider_settings(
        pool: &SqlitePool,
        request: &BackgroundSummaryRequest,
    ) -> Result<ProviderSettings, String> {
        let provider = request.model_provider.parse::<LLMProvider>()?;
        let api_key = Self::load_api_key(pool, &provider, &request.model_provider).await?;
        let ollama_endpoint = Self::load_ollama_endpoint(pool, &provider).await;
        let custom = Self::load_custom_openai_settings(pool, &provider).await?;
        let final_api_key = if provider == LLMProvider::CustomOpenAI {
            custom.api_key.unwrap_or_default()
        } else {
            api_key
        };

        Ok(ProviderSettings {
            provider,
            final_api_key,
            ollama_endpoint,
            custom_openai_endpoint: custom.endpoint,
            custom_openai_max_tokens: custom.max_tokens,
            custom_openai_temperature: custom.temperature,
            custom_openai_top_p: custom.top_p,
        })
    }

    async fn load_api_key(
        pool: &SqlitePool,
        provider: &LLMProvider,
        model_provider: &str,
    ) -> Result<String, String> {
        if matches!(
            provider,
            LLMProvider::Ollama | LLMProvider::BuiltInAI | LLMProvider::CustomOpenAI
        ) {
            return Ok(String::new());
        }

        match SettingsRepository::get_api_key(pool, model_provider).await {
            Ok(Some(key)) if !key.is_empty() => Ok(key),
            Ok(None) | Ok(Some(_)) => Err(format!("API key not found for {}", model_provider)),
            Err(e) => Err(format!(
                "Failed to retrieve API key for {}: {}",
                model_provider, e
            )),
        }
    }

    async fn load_ollama_endpoint(pool: &SqlitePool, provider: &LLMProvider) -> Option<String> {
        if provider != &LLMProvider::Ollama {
            return None;
        }

        match SettingsRepository::get_model_config(pool).await {
            Ok(Some(config)) => config.ollama_endpoint,
            Ok(None) => None,
            Err(e) => {
                info!("Failed to retrieve Ollama endpoint: {}, using default", e);
                None
            }
        }
    }

    async fn load_custom_openai_settings(
        pool: &SqlitePool,
        provider: &LLMProvider,
    ) -> Result<CustomOpenAiSettings, String> {
        if provider != &LLMProvider::CustomOpenAI {
            return Ok(CustomOpenAiSettings::default());
        }

        match SettingsRepository::get_custom_openai_config(pool).await {
            Ok(Some(config)) => {
                info!("✓ Using custom OpenAI endpoint: {}", config.endpoint);
                Ok(CustomOpenAiSettings {
                    endpoint: Some(config.endpoint),
                    api_key: config.api_key,
                    max_tokens: config.max_tokens.map(|t| t as u32),
                    temperature: config.temperature,
                    top_p: config.top_p,
                })
            }
            Ok(None) => {
                Err("Custom OpenAI provider selected but no configuration found".to_string())
            }
            Err(e) => Err(format!("Failed to retrieve custom OpenAI config: {}", e)),
        }
    }

    async fn resolve_token_threshold(
        settings: &ProviderSettings,
        request: &BackgroundSummaryRequest,
    ) -> usize {
        if settings.provider == LLMProvider::Ollama {
            Self::ollama_token_threshold(request, settings.ollama_endpoint.as_deref()).await
        } else if settings.provider == LLMProvider::BuiltInAI {
            Self::builtin_ai_token_threshold(&request.model_name)
        } else {
            100000
        }
    }

    async fn ollama_token_threshold(
        request: &BackgroundSummaryRequest,
        ollama_endpoint: Option<&str>,
    ) -> usize {
        match METADATA_CACHE
            .get_or_fetch(&request.model_name, ollama_endpoint)
            .await
        {
            Ok(metadata) => {
                let optimal = metadata.context_size.saturating_sub(300);
                info!(
                    "✓ Using dynamic context for {}: {} tokens (chunk size: {})",
                    request.model_name, metadata.context_size, optimal
                );
                optimal
            }
            Err(e) => {
                warn!(
                    "Failed to fetch context for {}: {}. Using default 4000",
                    request.model_name, e
                );
                4000
            }
        }
    }

    fn builtin_ai_token_threshold(model_name: &str) -> usize {
        use crate::summary::summary_engine::models;

        match models::get_model_by_name(model_name) {
            Some(model_def) => {
                let optimal = model_def.context_size.saturating_sub(300) as usize;
                info!(
                    "✓ Using BuiltInAI context size: {} tokens (chunk size: {})",
                    model_def.context_size, optimal
                );
                optimal
            }
            None => {
                warn!("Unknown model: {}, using default 2048", model_name);
                1748
            }
        }
    }

    async fn resolve_detected_summary_language(
        pool: &SqlitePool,
        request: &BackgroundSummaryRequest,
    ) -> Option<String> {
        if let Some(code) = &request.summary_language {
            info!("📝 Summary language preference: {}", code);
        }

        let detected = Self::read_detected_summary_language(pool, &request.meeting_id)
            .await
            .or_else(|| Self::detect_summary_language_from_text(&request.text));

        if let Some(code) = &detected {
            info!("📝 Detected transcript summary language: {}", code);
        }
        detected
    }

    fn build_cache_source(
        request: &BackgroundSummaryRequest,
        settings: &ProviderSettings,
        token_threshold: usize,
        template_fingerprint: &str,
    ) -> SummaryCacheSource {
        build_summary_cache_source(
            &request.text,
            &request.custom_prompt,
            &request.template_id,
            template_fingerprint,
            token_threshold,
            &request.model_provider,
            &request.model_name,
            settings.ollama_endpoint.as_deref(),
            settings.custom_openai_endpoint.as_deref(),
            settings.custom_openai_max_tokens,
            settings.custom_openai_temperature,
            settings.custom_openai_top_p,
        )
    }

    async fn load_cached_english(
        pool: &SqlitePool,
        request: &BackgroundSummaryRequest,
        cache_source: &SummaryCacheSource,
    ) -> Option<String> {
        match SummaryProcessesRepository::get_summary_data(pool, &request.meeting_id).await {
            Err(e) => {
                warn!(
                    "Failed to load prior summary row for cache lookup (meeting_id={}): {}. Falling back to full pass-1 generation.",
                    request.meeting_id, e
                );
                None
            }
            Ok(None) => None,
            Ok(Some(process)) => process.result.and_then(|raw| {
                match extract_cached_english_markdown(
                    &raw,
                    cache_source,
                    request.summary_language.as_deref(),
                ) {
                    Ok(opt) => opt,
                    Err(e) => {
                        warn!(
                            "Cached summary result for meeting_id={} is not valid JSON ({}); ignoring cache.",
                            request.meeting_id, e
                        );
                        None
                    }
                }
            }),
        }
    }

    async fn persist_summary_job_result(
        pool: &SqlitePool,
        request: &BackgroundSummaryRequest,
        result: Result<SummaryJobOutput, String>,
        duration: f64,
    ) {
        match result {
            Ok(output) => Self::persist_success(pool, request, output, duration).await,
            Err(e) if e.contains("cancelled") => {
                info!(
                    "Summary generation was cancelled for meeting_id: {}",
                    request.meeting_id
                );
                if let Err(db_err) =
                    SummaryProcessesRepository::update_process_cancelled(pool, &request.meeting_id)
                        .await
                {
                    error!(
                        "Failed to update DB status to cancelled for {}: {}",
                        request.meeting_id, db_err
                    );
                }
            }
            Err(e) => Self::update_process_failed(pool, &request.meeting_id, &e).await,
        }
    }

    async fn persist_success(
        pool: &SqlitePool,
        request: &BackgroundSummaryRequest,
        output: SummaryJobOutput,
        duration: f64,
    ) {
        info!(
            "✓ Successfully processed {} chunks for meeting_id: {}. Duration: {:.2}s",
            output.num_chunks, request.meeting_id, duration
        );
        info!(
            "Final markdown generated ({} chars)",
            output.final_markdown.len()
        );
        Self::update_meeting_name_from_summary(pool, &request.meeting_id, &output.final_markdown)
            .await;

        let result_json = build_summary_result_json(
            &output.final_markdown,
            &output.english_markdown,
            output.cache_source,
            request.summary_language.as_deref(),
        );

        if let Err(e) = SummaryProcessesRepository::update_process_completed(
            pool,
            &request.meeting_id,
            result_json,
            output.num_chunks,
            duration,
        )
        .await
        {
            error!(
                "Failed to save completed process for {}: {}",
                request.meeting_id, e
            );
        } else {
            info!(
                "Summary saved successfully for meeting_id: {}",
                request.meeting_id
            );
        }
    }

    async fn update_meeting_name_from_summary(
        pool: &SqlitePool,
        meeting_id: &str,
        final_markdown: &str,
    ) {
        let Some(name) =
            extract_meeting_name_from_markdown(final_markdown).filter(|n| !n.is_empty())
        else {
            return;
        };

        info!("Extracted meeting name from summary: '{}'", name);
        if let Err(e) = MeetingsRepository::update_meeting_name(pool, meeting_id, &name).await {
            error!("Failed to update meeting name for {}: {}", meeting_id, e);
        } else {
            info!("Successfully updated meeting name for {}", meeting_id);
        }
    }
}

#[derive(Default)]
struct CustomOpenAiSettings {
    endpoint: Option<String>,
    api_key: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
}
