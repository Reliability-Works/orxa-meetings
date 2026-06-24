use std::num::NonZeroU32;
use std::path::PathBuf;
use std::pin::pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

use crate::protocol::SamplingConfig;
use crate::vram::get_default_gpu_layers;

pub(crate) struct ModelState {
    backend: LlamaBackend,
    model: Option<LlamaModel>,
    model_path: Option<PathBuf>,
    context_size: u32,
    last_activity: Arc<AtomicU64>,
}

impl ModelState {
    pub(crate) fn new() -> Result<Self> {
        let backend = LlamaBackend::init().context("Failed to init LlamaBackend")?;
        Ok(Self {
            backend,
            model: None,
            model_path: None,
            context_size: 2048,
            last_activity: Arc::new(AtomicU64::new(Self::current_timestamp())),
        })
    }

    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    pub(crate) fn update_activity(&self) {
        self.last_activity
            .store(Self::current_timestamp(), Ordering::SeqCst);
    }

    pub(crate) fn seconds_since_activity(&self) -> u64 {
        Self::current_timestamp() - self.last_activity.load(Ordering::SeqCst)
    }

    pub(crate) fn load_model_if_needed(
        &mut self,
        model_path: PathBuf,
        context_size: u32,
    ) -> Result<()> {
        if let Some(ref loaded_path) = self.model_path {
            if loaded_path == &model_path && self.context_size == context_size {
                eprintln!("✓ Model already loaded");
                self.update_activity();
                return Ok(());
            }
        }

        eprintln!("📥 Loading model: {}", model_path.display());

        let gpu_layers = get_default_gpu_layers(&model_path, context_size);
        let model_params = LlamaModelParams::default().with_n_gpu_layers(gpu_layers);
        let model_params = pin!(model_params);

        let model = LlamaModel::load_from_file(&self.backend, model_path.clone(), &model_params)
            .with_context(|| format!("unable to load model at {:?}", model_path))?;

        self.model = Some(model);
        self.model_path = Some(model_path);
        self.context_size = context_size;
        self.update_activity();

        eprintln!("✅ Model loaded successfully");
        Ok(())
    }

    pub(crate) fn generate(
        &mut self,
        prompt: String,
        max_tokens: i32,
        sampling: SamplingConfig,
        stop_tokens: Vec<String>,
    ) -> Result<String> {
        let start_time = Instant::now();
        let model = self.model.as_ref().context("Model not loaded")?;
        let threads = generation_thread_count();

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(
                NonZeroU32::new(self.context_size).context("Invalid ctx size")?,
            ))
            .with_n_batch(self.context_size)
            .with_n_threads(threads)
            .with_n_threads_batch(threads);

        let mut ctx = model
            .new_context(&self.backend, ctx_params)
            .context("unable to create the llama_context")?;

        let tokens_list = model
            .str_to_token(&prompt, AddBos::Always)
            .with_context(|| "failed to tokenize prompt")?;

        eprintln!("📝 Tokenized prompt: {} tokens", tokens_list.len());

        let mut batch = LlamaBatch::new(self.context_size as usize, 1);
        let last_index = (tokens_list.len() - 1) as i32;
        for (i, token) in (0_i32..).zip(tokens_list) {
            batch
                .add(token, i, &[0], i == last_index)
                .context("Failed to add token to batch")?;
        }

        ctx.decode(&mut batch).context("llama_decode() failed")?;
        let prompt_time = start_time.elapsed();
        let n_prompt_tokens = batch.n_tokens();
        let mut n_cur = n_prompt_tokens;
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut output = String::new();
        let mut sampler = pin!(build_sampler(sampling));

        eprintln!("🔄 Starting generation (max_tokens: {})", max_tokens);

        loop {
            if (n_cur - n_prompt_tokens) >= max_tokens {
                eprintln!("✓ Reached max_tokens limit");
                break;
            }

            let token = sampler.as_mut().sample(&ctx, batch.n_tokens() - 1);
            sampler.as_mut().accept(token);

            if model.is_eog_token(token) {
                eprintln!(
                    "✓ End-of-generation token reached (generated {} chars)",
                    output.len()
                );
                break;
            }

            let output_bytes = token_to_bytes(model, token)?;
            let mut token_text = String::with_capacity(32);
            let _ = decoder.decode_to_string(&output_bytes, &mut token_text, false);
            output.push_str(&token_text);

            if remove_stop_token(&mut output, &stop_tokens) {
                break;
            }

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .context("Failed to add generated token to batch")?;
            n_cur += 1;
            ctx.decode(&mut batch).context("failed to eval")?;
        }

        log_generation_statistics(start_time, prompt_time, n_cur, n_prompt_tokens);
        self.update_activity();
        Ok(output)
    }
}

fn generation_thread_count() -> i32 {
    std::thread::available_parallelism()
        .map(|n| {
            let cores = n.get() as i32;
            ((cores / 2) + 2).max(1)
        })
        .unwrap_or(2)
}

fn build_sampler(sampling: SamplingConfig) -> LlamaSampler {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u32;

    if sampling.temperature <= 0.0 {
        if sampling.uses_penalties() {
            LlamaSampler::chain_simple([
                LlamaSampler::penalties(
                    sampling.penalty_last_n,
                    sampling.repeat_penalty,
                    sampling.frequency_penalty,
                    sampling.presence_penalty,
                ),
                LlamaSampler::greedy(),
            ])
        } else {
            LlamaSampler::chain_simple([LlamaSampler::greedy()])
        }
    } else if sampling.uses_penalties() {
        LlamaSampler::chain_simple([
            LlamaSampler::penalties(
                sampling.penalty_last_n,
                sampling.repeat_penalty,
                sampling.frequency_penalty,
                sampling.presence_penalty,
            ),
            LlamaSampler::top_k(sampling.top_k),
            LlamaSampler::top_p(sampling.top_p, 1),
            LlamaSampler::temp(sampling.temperature),
            LlamaSampler::dist(seed),
        ])
    } else {
        LlamaSampler::chain_simple([
            LlamaSampler::top_k(sampling.top_k),
            LlamaSampler::top_p(sampling.top_p, 1),
            LlamaSampler::temp(sampling.temperature),
            LlamaSampler::dist(seed),
        ])
    }
}

fn token_to_bytes(model: &LlamaModel, token: llama_cpp_2::token::LlamaToken) -> Result<Vec<u8>> {
    match model.token_to_piece_bytes(token, 32, true, None) {
        Err(llama_cpp_2::TokenToStringError::InsufficientBufferSpace(size)) => {
            let required_size: usize = size
                .checked_neg()
                .context("Invalid token piece buffer size")?
                .try_into()
                .context("Invalid token piece buffer size")?;
            model.token_to_piece_bytes(token, required_size, true, None)
        }
        result => result,
    }
    .context("Failed to convert token to bytes")
}

fn remove_stop_token(output: &mut String, stop_tokens: &[String]) -> bool {
    for stop_token in stop_tokens {
        if output.contains(stop_token) {
            eprintln!(
                "✓ Stop token '{}' detected (generated {} chars)",
                stop_token,
                output.len()
            );
            *output = output.replace(stop_token, "").trim_end().to_string();
            return true;
        }
    }

    false
}

fn log_generation_statistics(
    start_time: Instant,
    prompt_time: std::time::Duration,
    n_cur: i32,
    n_prompt_tokens: i32,
) {
    let total_time = start_time.elapsed();
    let gen_time = total_time.saturating_sub(prompt_time);
    let output_tokens = (n_cur - n_prompt_tokens) as u64;
    let prompt_tokens = n_prompt_tokens as u64;

    let tokens_per_sec = if gen_time.as_secs_f64() > 0.0 {
        output_tokens as f64 / gen_time.as_secs_f64()
    } else {
        0.0
    };

    eprintln!("📊 Generation Statistics:");
    eprintln!("   • Prompt tokens: {}", prompt_tokens);
    eprintln!("   • Output tokens: {}", output_tokens);
    eprintln!("   • Prompt processing: {:.2}s", prompt_time.as_secs_f64());
    eprintln!("   • Generation time: {:.2}s", gen_time.as_secs_f64());
    eprintln!("   • Total time: {:.2}s", total_time.as_secs_f64());
    eprintln!("   • Speed: {:.2} tokens/sec", tokens_per_sec);
}
