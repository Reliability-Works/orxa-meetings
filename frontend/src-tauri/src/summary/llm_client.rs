use reqwest::{header, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::info;

const REQUEST_TIMEOUT_DURATION: Duration = Duration::from_secs(300);

// Generic structure for OpenAI-compatible API chat messages
#[derive(Debug, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// Generic structure for OpenAI-compatible API chat requests
#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
}

// Generic structure for OpenAI-compatible API chat responses
#[derive(Deserialize, Debug)]
pub struct ChatResponse {
    pub choices: Vec<Choice>,
}

#[derive(Deserialize, Debug)]
pub struct Choice {
    pub message: MessageContent,
}

#[derive(Deserialize, Debug)]
pub struct MessageContent {
    pub content: String,
}

// Claude-specific request structure
#[derive(Debug, Serialize)]
pub struct ClaudeRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

// Claude-specific response structure
#[derive(Deserialize, Debug)]
pub struct ClaudeChatResponse {
    pub content: Vec<ClaudeChatContent>,
}

#[derive(Deserialize, Debug)]
pub struct ClaudeChatContent {
    pub text: String,
}

/// LLM Provider enumeration for multi-provider support
#[derive(Debug, Clone, PartialEq)]
pub enum LLMProvider {
    OpenAI,
    Claude,
    Groq,
    Ollama,
    OpenRouter,
    BuiltInAI,
    CustomOpenAI,
}

struct SummaryRequest<'a> {
    client: &'a Client,
    provider: &'a LLMProvider,
    model_name: &'a str,
    api_key: &'a str,
    system_prompt: &'a str,
    user_prompt: &'a str,
    ollama_endpoint: Option<&'a str>,
    custom_openai_endpoint: Option<&'a str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&'a PathBuf>,
    cancellation_token: Option<&'a CancellationToken>,
}

impl SummaryRequest<'_> {
    fn check_cancelled(&self) -> Result<(), String> {
        if self
            .cancellation_token
            .is_some_and(CancellationToken::is_cancelled)
        {
            return Err("Summary generation was cancelled".to_string());
        }
        Ok(())
    }

    fn custom_openai_sampling(&self) -> (Option<u32>, Option<f32>, Option<f32>) {
        if self.provider == &LLMProvider::CustomOpenAI {
            (self.max_tokens, self.temperature, self.top_p)
        } else {
            (None, None, None)
        }
    }
}

impl std::str::FromStr for LLMProvider {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "openai" => Ok(Self::OpenAI),
            "claude" => Ok(Self::Claude),
            "groq" => Ok(Self::Groq),
            "ollama" => Ok(Self::Ollama),
            "openrouter" => Ok(Self::OpenRouter),
            "builtin-ai" | "local-llama" | "localllama" => Ok(Self::BuiltInAI),
            "custom-openai" => Ok(Self::CustomOpenAI),
            _ => Err(format!("Unsupported LLM provider: {}", s)),
        }
    }
}

/// Generates a summary using the specified LLM provider
///
/// # Arguments
/// * `client` - Reqwest HTTP client (reused for performance)
/// * `provider` - The LLM provider to use
/// * `model_name` - The specific model to use (e.g., "gpt-4", "claude-3-opus")
/// * `api_key` - API key for the provider (not needed for Ollama)
/// * `system_prompt` - System instructions for the LLM
/// * `user_prompt` - User query/content to process
/// * `ollama_endpoint` - Optional custom Ollama endpoint (defaults to localhost:11434)
/// * `custom_openai_endpoint` - Optional custom OpenAI-compatible endpoint
/// * `max_tokens` - Optional max tokens (for CustomOpenAI provider)
/// * `temperature` - Optional temperature (for CustomOpenAI provider)
/// * `top_p` - Optional top_p (for CustomOpenAI provider)
/// * `app_data_dir` - Optional app data directory (for BuiltInAI provider)
/// * `cancellation_token` - Optional token to cancel the request
///
/// # Returns
/// The generated summary text or an error message
#[expect(
    clippy::too_many_arguments,
    reason = "LLM calls require provider, prompt, endpoint, sampling, and cancellation context"
)]
pub async fn generate_summary(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    let request = SummaryRequest {
        client,
        provider,
        model_name,
        api_key,
        system_prompt,
        user_prompt,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        cancellation_token,
    };
    request.check_cancelled()?;

    if request.provider == &LLMProvider::BuiltInAI {
        return generate_builtin_summary(&request).await;
    }

    let (api_url, headers) = build_http_request_parts(&request)?;
    let request_body = build_request_body(&request);

    info!(
        "🐞 LLM Request to {}: model={}",
        provider_name(request.provider),
        request.model_name
    );

    let response = send_llm_request(&request, api_url, headers, request_body).await?;
    parse_llm_response(response, request.provider).await
}

async fn generate_builtin_summary(request: &SummaryRequest<'_>) -> Result<String, String> {
    let app_data_dir = request
        .app_data_dir
        .ok_or_else(|| "app_data_dir is required for BuiltInAI provider".to_string())?;

    crate::summary::summary_engine::generate_with_builtin(
        app_data_dir,
        request.model_name,
        request.system_prompt,
        request.user_prompt,
        request.cancellation_token,
    )
    .await
    .map_err(|e| e.to_string())
}

fn build_http_request_parts(
    request: &SummaryRequest<'_>,
) -> Result<(String, header::HeaderMap), String> {
    let (api_url, mut headers) = provider_api_url_and_headers(request)?;
    add_common_headers(request, &mut headers)?;
    Ok((api_url, headers))
}

fn provider_api_url_and_headers(
    request: &SummaryRequest<'_>,
) -> Result<(String, header::HeaderMap), String> {
    match request.provider {
        LLMProvider::OpenAI => {
            openai_compatible_parts("https://api.openai.com/v1/chat/completions")
        }
        LLMProvider::Groq => {
            openai_compatible_parts("https://api.groq.com/openai/v1/chat/completions")
        }
        LLMProvider::OpenRouter => {
            openai_compatible_parts("https://openrouter.ai/api/v1/chat/completions")
        }
        LLMProvider::Ollama => ollama_parts(request.ollama_endpoint),
        LLMProvider::CustomOpenAI => custom_openai_parts(request.custom_openai_endpoint),
        LLMProvider::Claude => claude_parts(request.api_key),
        LLMProvider::BuiltInAI => unreachable!("BuiltInAI is handled before HTTP request setup"),
    }
}

fn openai_compatible_parts(url: &str) -> Result<(String, header::HeaderMap), String> {
    Ok((url.to_string(), header::HeaderMap::new()))
}

fn ollama_parts(endpoint: Option<&str>) -> Result<(String, header::HeaderMap), String> {
    let host = endpoint.unwrap_or("http://localhost:11434");
    Ok((
        format!("{}/v1/chat/completions", host),
        header::HeaderMap::new(),
    ))
}

fn custom_openai_parts(endpoint: Option<&str>) -> Result<(String, header::HeaderMap), String> {
    let endpoint = endpoint.ok_or_else(|| "Custom OpenAI endpoint not configured".to_string())?;
    Ok((
        format!("{}/chat/completions", endpoint.trim_end_matches('/')),
        header::HeaderMap::new(),
    ))
}

fn claude_parts(api_key: &str) -> Result<(String, header::HeaderMap), String> {
    let mut header_map = header::HeaderMap::new();
    header_map.insert(
        "x-api-key",
        api_key
            .parse()
            .map_err(|_| "Invalid API key format".to_string())?,
    );
    header_map.insert(
        "anthropic-version",
        "2023-06-01"
            .parse()
            .map_err(|_| "Invalid anthropic version".to_string())?,
    );
    Ok((
        "https://api.anthropic.com/v1/messages".to_string(),
        header_map,
    ))
}

fn add_common_headers(
    request: &SummaryRequest<'_>,
    headers: &mut header::HeaderMap,
) -> Result<(), String> {
    if request.provider != &LLMProvider::Claude {
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", request.api_key)
                .parse()
                .map_err(|_| "Invalid authorization header".to_string())?,
        );
    }
    headers.insert(
        header::CONTENT_TYPE,
        "application/json"
            .parse()
            .map_err(|_| "Invalid content type".to_string())?,
    );
    Ok(())
}

fn build_request_body(request: &SummaryRequest<'_>) -> Value {
    if request.provider == &LLMProvider::Claude {
        build_claude_request_body(request)
    } else {
        build_openai_request_body(request)
    }
}

fn build_openai_request_body(request: &SummaryRequest<'_>) -> Value {
    let (max_tokens, temperature, top_p) = request.custom_openai_sampling();

    serde_json::json!(ChatRequest {
        model: request.model_name.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: request.system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: request.user_prompt.to_string(),
            }
        ],
        max_tokens,
        temperature,
        top_p,
    })
}

fn build_claude_request_body(request: &SummaryRequest<'_>) -> Value {
    serde_json::json!(ClaudeRequest {
        system: request.system_prompt.to_string(),
        model: request.model_name.to_string(),
        max_tokens: request.max_tokens.unwrap_or(8192),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: request.user_prompt.to_string(),
        }]
    })
}

async fn send_llm_request(
    request: &SummaryRequest<'_>,
    api_url: String,
    headers: header::HeaderMap,
    request_body: Value,
) -> Result<Response, String> {
    let request_future = request
        .client
        .post(api_url)
        .headers(headers)
        .json(&request_body)
        .timeout(REQUEST_TIMEOUT_DURATION)
        .send();

    let response = match request.cancellation_token {
        Some(token) => {
            tokio::select! {
                result = request_future => result.map_err(request_error_message)?,
                _ = token.cancelled() => {
                    return Err("Summary generation was cancelled".to_string());
                }
            }
        }
        None => request_future.await.map_err(request_error_message)?,
    };

    ensure_successful_response(response).await
}

fn request_error_message(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "LLM request timed out after 60 seconds".to_string()
    } else {
        format!("Failed to send request to LLM: {}", error)
    }
}

async fn ensure_successful_response(response: Response) -> Result<Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }

    let error_body = response
        .text()
        .await
        .unwrap_or_else(|_| "Unknown error".to_string());
    Err(format!("LLM API request failed: {}", error_body))
}

async fn parse_llm_response(response: Response, provider: &LLMProvider) -> Result<String, String> {
    if provider == &LLMProvider::Claude {
        parse_claude_response(response).await
    } else {
        parse_openai_response(response, provider).await
    }
}

async fn parse_claude_response(response: Response) -> Result<String, String> {
    let chat_response = response
        .json::<ClaudeChatResponse>()
        .await
        .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

    info!("🐞 LLM Response received from Claude");
    chat_response
        .content
        .first()
        .map(|content| content.text.trim().to_string())
        .ok_or_else(|| "No content in LLM response".to_string())
}

async fn parse_openai_response(
    response: Response,
    provider: &LLMProvider,
) -> Result<String, String> {
    let chat_response = response
        .json::<ChatResponse>()
        .await
        .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

    info!("🐞 LLM Response received from {}", provider_name(provider));
    chat_response
        .choices
        .first()
        .map(|choice| choice.message.content.trim().to_string())
        .ok_or_else(|| "No content in LLM response".to_string())
}

/// Helper function to get provider name for logging
fn provider_name(provider: &LLMProvider) -> &str {
    match provider {
        LLMProvider::OpenAI => "OpenAI",
        LLMProvider::Claude => "Claude",
        LLMProvider::Groq => "Groq",
        LLMProvider::Ollama => "Ollama",
        LLMProvider::BuiltInAI => "Built-in AI",
        LLMProvider::OpenRouter => "OpenRouter",
        LLMProvider::CustomOpenAI => "Custom OpenAI",
    }
}
