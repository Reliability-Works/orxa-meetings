use log::{error as log_error, info as log_info, warn as log_warn};
use tauri::{AppHandle, Runtime};

use crate::{
    database::repositories::setting::SettingsRepository, state::AppState,
    summary::CustomOpenAIConfig,
};

#[expect(
    clippy::too_many_arguments,
    reason = "Tauri IPC command preserves the custom OpenAI configuration payload"
)]
pub(super) async fn api_save_custom_openai_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_custom_openai_config called: endpoint='{}', model='{}'",
        &endpoint,
        &model
    );

    validate_custom_openai_config(&endpoint, &model, max_tokens, temperature, top_p)?;

    let config = CustomOpenAIConfig {
        endpoint: endpoint.trim().to_string(),
        api_key: api_key.filter(|k| !k.trim().is_empty()),
        model: model.trim().to_string(),
        max_tokens,
        temperature,
        top_p,
    };

    let pool = state.db_manager.pool();
    match SettingsRepository::save_custom_openai_config(pool, &config).await {
        Ok(()) => {
            log_info!(
                "Successfully saved custom OpenAI config for endpoint: {}",
                config.endpoint
            );
            Ok(serde_json::json!({
                "status": "success",
                "message": "Custom OpenAI configuration saved successfully"
            }))
        }
        Err(e) => {
            log_error!("Failed to save custom OpenAI config: {}", e);
            Err(format!("Failed to save custom OpenAI configuration: {}", e))
        }
    }
}

pub(super) async fn api_get_custom_openai_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<CustomOpenAIConfig>, String> {
    log_info!("api_get_custom_openai_config called");
    let pool = state.db_manager.pool();

    match SettingsRepository::get_custom_openai_config(pool).await {
        Ok(config) => {
            if let Some(ref c) = config {
                log_info!(
                    "Found custom OpenAI config: endpoint='{}', model='{}'",
                    c.endpoint,
                    c.model
                );
            } else {
                log_info!("No custom OpenAI config found");
            }
            Ok(config)
        }
        Err(e) => {
            log_error!("Failed to get custom OpenAI config: {}", e);
            Err(format!("Failed to get custom OpenAI configuration: {}", e))
        }
    }
}

pub(super) async fn api_test_custom_openai_connection<R: Runtime>(
    _app: AppHandle<R>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_test_custom_openai_connection called: endpoint='{}', model='{}'",
        &endpoint,
        &model
    );

    if !is_valid_endpoint(&endpoint) {
        return Err("Endpoint must start with http:// or https://".to_string());
    }

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    let test_request = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Hi"
            }
        ],
        "max_tokens": 5
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&test_request);

    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        request = request.header("Authorization", format!("Bearer {}", key));
    }

    match request.send().await {
        Ok(response) => validate_custom_openai_response(response).await,
        Err(e) => {
            log_error!("Custom OpenAI connection test failed: {}", e);
            if e.is_timeout() {
                Err("Connection timed out. Please check the endpoint URL.".to_string())
            } else if e.is_connect() {
                Err("Could not connect to endpoint. Please verify the URL is correct and the server is running.".to_string())
            } else {
                Err(format!("Connection failed: {}", e))
            }
        }
    }
}

fn validate_custom_openai_config(
    endpoint: &str,
    model: &str,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> Result<(), String> {
    if endpoint.trim().is_empty() {
        return Err("Endpoint URL is required".to_string());
    }
    if model.trim().is_empty() {
        return Err("Model name is required".to_string());
    }
    if !is_valid_endpoint(endpoint) {
        return Err("Endpoint must start with http:// or https://".to_string());
    }
    if let Some(temp) = temperature {
        if !(0.0..=2.0).contains(&temp) {
            return Err("Temperature must be between 0.0 and 2.0".to_string());
        }
    }
    if let Some(top) = top_p {
        if !(0.0..=1.0).contains(&top) {
            return Err("Top P must be between 0.0 and 1.0".to_string());
        }
    }
    if let Some(tokens) = max_tokens {
        if tokens < 1 {
            return Err("Max tokens must be at least 1".to_string());
        }
    }
    Ok(())
}

fn is_valid_endpoint(endpoint: &str) -> bool {
    endpoint.starts_with("http://") || endpoint.starts_with("https://")
}

async fn validate_custom_openai_response(
    response: reqwest::Response,
) -> Result<serde_json::Value, String> {
    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        log_warn!(
            "Custom OpenAI connection test failed with status {}: {}",
            status,
            response_text
        );
        return Err(format!(
            "Connection failed with status {}: {}",
            status, response_text
        ));
    }

    let json = serde_json::from_str::<serde_json::Value>(&response_text).map_err(|e| {
        log_warn!(
            "Endpoint returned 200 but response is not valid JSON: {}",
            e
        );
        format!(
            "Endpoint is reachable but returned invalid JSON: {}. Response: {}",
            e, response_text
        )
    })?;

    if has_openai_message_structure(&json) {
        log_info!("Custom OpenAI connection test successful - response validated");
        Ok(serde_json::json!({
            "status": "success",
            "message": "Connection successful and response validated",
            "http_status": status.as_u16()
        }))
    } else {
        log_warn!(
            "Endpoint returned 200 but response doesn't match OpenAI format: {}",
            response_text
        );
        Err("Endpoint is reachable but doesn't appear to be OpenAI-compatible. Response is missing 'choices' array or 'message.content' / 'message.reasoning_content' field.".to_string())
    }
}

fn has_openai_message_structure(json: &serde_json::Value) -> bool {
    let Some(choices) = json.get("choices").and_then(|choices| choices.as_array()) else {
        return false;
    };
    let Some(first_choice) = choices.first() else {
        return false;
    };

    first_choice
        .get("message")
        .and_then(|message| {
            message
                .get("content")
                .or_else(|| message.get("reasoning_content"))
        })
        .is_some()
}
