use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use anyhow::Result;

use crate::model_state::ModelState;
use crate::protocol::{Request, Response, SamplingConfig};

pub(crate) fn run() -> Result<()> {
    let idle_timeout_secs = std::env::var("LLAMA_IDLE_TIMEOUT")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(300);

    eprintln!(
        "🦙 llama-helper starting (idle timeout: {}s)",
        idle_timeout_secs
    );

    let mut state = ModelState::new()?;
    let stdin = io::stdin();
    let mut stdin_lock = stdin.lock();
    let mut buffer = String::new();

    loop {
        if state.seconds_since_activity() > idle_timeout_secs {
            eprintln!("💤 Idle timeout reached, shutting down");
            send_response(&Response::Goodbye)?;
            break;
        }

        buffer.clear();
        match stdin_lock.read_line(&mut buffer) {
            Ok(0) => {
                eprintln!("📪 EOF received, shutting down");
                break;
            }
            Ok(_) => {
                let line = buffer.trim();
                if line.is_empty() {
                    continue;
                }

                if !handle_line(line, &mut state)? {
                    break;
                }
            }
            Err(e) => {
                eprintln!("❌ Error reading stdin: {}", e);
                break;
            }
        }
    }

    eprintln!("👋 llama-helper exiting");
    Ok(())
}

fn send_response(response: &Response) -> Result<()> {
    let json = serde_json::to_string(response)?;
    println!("{}", json);
    io::stdout().flush()?;
    Ok(())
}

fn handle_line(line: &str, state: &mut ModelState) -> Result<bool> {
    match serde_json::from_str::<Request>(line) {
        Ok(request) => handle_request(request, state),
        Err(e) => {
            eprintln!("❌ Failed to parse request: {}", e);
            send_response(&Response::Error {
                message: format!("Invalid request: {}", e),
            })?;
            Ok(true)
        }
    }
}

fn handle_request(request: Request, state: &mut ModelState) -> Result<bool> {
    match request {
        Request::Generate {
            prompt,
            max_tokens,
            context_size,
            model_path,
            temperature,
            top_k,
            top_p,
            presence_penalty,
            frequency_penalty,
            repeat_penalty,
            penalty_last_n,
            stop_tokens,
        } => {
            let sampling = SamplingConfig::from_request(
                temperature,
                top_k,
                top_p,
                presence_penalty,
                frequency_penalty,
                repeat_penalty,
                penalty_last_n,
            );
            handle_generate(
                state,
                GenerateArgs {
                    prompt,
                    max_tokens: max_tokens.unwrap_or(512),
                    context_size: context_size.unwrap_or(2048),
                    model_path,
                    sampling,
                    stop_tokens: stop_tokens.unwrap_or_else(Vec::new),
                },
            )?;
            Ok(true)
        }
        Request::Ping => {
            state.update_activity();
            send_response(&Response::Pong)?;
            Ok(true)
        }
        Request::Shutdown => {
            eprintln!("🛑 Shutdown requested");
            send_response(&Response::Goodbye)?;
            Ok(false)
        }
    }
}

struct GenerateArgs {
    prompt: String,
    max_tokens: i32,
    context_size: u32,
    model_path: Option<String>,
    sampling: SamplingConfig,
    stop_tokens: Vec<String>,
}

fn handle_generate(state: &mut ModelState, args: GenerateArgs) -> Result<()> {
    if let Some(path_str) = args.model_path {
        let path = PathBuf::from(path_str);
        if let Err(e) = state.load_model_if_needed(path, args.context_size) {
            send_response(&Response::GenerateResult {
                text: String::new(),
                error: Some(format!("Failed to load model: {}", e)),
            })?;
            return Ok(());
        }
    }

    match state.generate(
        args.prompt,
        args.max_tokens,
        args.sampling,
        args.stop_tokens,
    ) {
        Ok(text) => send_response(&Response::GenerateResult { text, error: None }),
        Err(e) => send_response(&Response::GenerateResult {
            text: String::new(),
            error: Some(format!("Generation failed: {}", e)),
        }),
    }
}
