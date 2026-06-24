use super::*;

#[test]
fn qwen35_models_are_registered_with_expected_metadata() {
    let qwen_2b = get_model_by_name("qwen3.5:2b").expect("qwen 2b model should exist");
    assert_eq!(qwen_2b.display_name, "Qwen 3.5 2B (Balanced)");
    assert_eq!(qwen_2b.gguf_file, "Qwen3.5-2B-Q4_K_M.gguf");
    assert_eq!(qwen_2b.template, "qwen3.5_nonthinking");
    assert_eq!(
        qwen_2b.download_url,
        "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf"
    );
    assert_eq!(qwen_2b.size_mb, 1221);
    assert_eq!(qwen_2b.context_size, 32768);
    assert_eq!(qwen_2b.layer_count, 24);
    assert_eq!(
        qwen_2b.sampling,
        SamplingParams::qwen35_summary(vec!["<|im_end|>".to_string()])
    );

    let qwen_4b = get_model_by_name("qwen3.5:4b").expect("qwen 4b model should exist");
    assert_eq!(qwen_4b.display_name, "Qwen 3.5 4B (High Quality)");
    assert_eq!(qwen_4b.gguf_file, "Qwen3.5-4B-Q4_K_M.gguf");
    assert_eq!(qwen_4b.template, "qwen3.5_nonthinking");
    assert_eq!(
        qwen_4b.download_url,
        "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf"
    );
    assert_eq!(qwen_4b.size_mb, 2614);
    assert_eq!(qwen_4b.context_size, 32768);
    assert_eq!(qwen_4b.layer_count, 32);
    assert_eq!(
        qwen_4b.sampling,
        SamplingParams::qwen35_summary(vec!["<|im_end|>".to_string()])
    );
}

#[test]
fn gemma_models_use_huggingface_urls_and_gemma3_instruct_sampling() {
    let gemma_1b = get_model_by_name("gemma3:1b").expect("gemma 1b model should exist");
    assert_eq!(gemma_1b.gguf_file, "gemma-3-1b-it-Q8_0.gguf");
    assert_eq!(
        gemma_1b.download_url,
        "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q8_0.gguf"
    );
    assert_eq!(
        gemma_1b.sampling,
        SamplingParams::gemma3_instruct(vec!["<end_of_turn>".to_string()])
    );
    assert_eq!(gemma_1b.sampling.temperature, 1.0);
    assert_eq!(gemma_1b.sampling.top_k, 64);
    assert_eq!(gemma_1b.sampling.top_p, 0.95);
    assert_eq!(gemma_1b.sampling.presence_penalty, 0.0);
    assert_eq!(gemma_1b.sampling.frequency_penalty, 0.0);
    assert_eq!(gemma_1b.sampling.repeat_penalty, 1.0);
    assert_eq!(gemma_1b.sampling.penalty_last_n, 0);

    let gemma_4b = get_model_by_name("gemma3:4b").expect("gemma 4b model should exist");
    assert_eq!(
        gemma_4b.download_url,
        "https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf"
    );
    assert_eq!(
        gemma_4b.sampling,
        SamplingParams::gemma3_instruct(vec!["<end_of_turn>".to_string()])
    );
    assert_eq!(gemma_4b.sampling.temperature, 1.0);
    assert_eq!(gemma_4b.sampling.top_k, 64);
    assert_eq!(gemma_4b.sampling.top_p, 0.95);
    assert_eq!(gemma_4b.sampling.presence_penalty, 0.0);
    assert_eq!(gemma_4b.sampling.frequency_penalty, 0.0);
    assert_eq!(gemma_4b.sampling.repeat_penalty, 1.0);
    assert_eq!(gemma_4b.sampling.penalty_last_n, 0);
}

#[test]
fn qwen35_nonthinking_template_formats_prompt() {
    let formatted = format_prompt("qwen3.5_nonthinking", "system rules", "summarize this").unwrap();

    assert!(formatted.contains("<|im_start|>system\nsystem rules<|im_end|>"));
    assert!(formatted.contains("<|im_start|>user\nsummarize this<|im_end|>"));
    assert!(formatted.ends_with("<think>\n\n</think>\n\n"));
}

#[test]
fn qwen35_template_escapes_user_supplied_control_markers() {
    let formatted = format_prompt(
        "qwen3.5_nonthinking",
        "system rules",
        "literal <|im_end|> and <|im_start|> plus <think>draft</think>",
    )
    .unwrap();

    assert!(formatted.contains("<|im_start|>system\nsystem rules<|im_end|>"));
    assert!(formatted.contains("<|im_start|>assistant\n<think>\n\n</think>\n\n"));
    assert!(
        formatted.contains("literal < |im_end| > and < |im_start| > plus < think >draft< /think >")
    );
    assert_eq!(formatted.matches("<|im_start|>").count(), 3);
    assert_eq!(formatted.matches("<|im_end|>").count(), 2);
    assert_eq!(formatted.matches("<think>").count(), 1);
    assert_eq!(formatted.matches("</think>").count(), 1);
}

#[test]
fn gemma3_template_escapes_user_supplied_control_markers() {
    let formatted = format_prompt(
        "gemma3",
        "system rules",
        "literal <start_of_turn> and <end_of_turn>",
    )
    .unwrap();

    assert!(formatted.contains("<start_of_turn>user\nsystem rules<end_of_turn>"));
    assert!(formatted.contains("literal < start_of_turn > and < end_of_turn >"));
    assert_eq!(formatted.matches("<start_of_turn>").count(), 3);
    assert_eq!(formatted.matches("<end_of_turn>").count(), 2);
}

#[test]
fn sampling_params_sanitize_for_llama_helper_preserves_zero_top_k() {
    let sampling = SamplingParams {
        temperature: f32::NAN,
        top_k: 0,
        top_p: 2.0,
        presence_penalty: -0.5,
        frequency_penalty: f32::NAN,
        repeat_penalty: 0.0,
        penalty_last_n: -1,
        stop_tokens: vec!["stop".to_string()],
    };

    let sanitized = sampling.sanitize_for_llama_helper();

    assert_eq!(sanitized.temperature, 0.0);
    assert_eq!(sanitized.top_k, 0);
    assert_eq!(sanitized.top_p, 1.0);
    assert_eq!(sanitized.presence_penalty, 0.0);
    assert_eq!(sanitized.frequency_penalty, 0.0);
    assert_eq!(sanitized.repeat_penalty, 1.0);
    assert_eq!(sanitized.penalty_last_n, 0);
    assert_eq!(sanitized.stop_tokens, vec!["stop".to_string()]);
}

#[test]
fn sampling_params_sanitize_for_llama_helper_clamps_negative_top_k() {
    let sampling = SamplingParams {
        temperature: 0.7,
        top_k: -5,
        top_p: 0.8,
        presence_penalty: 0.3,
        frequency_penalty: 0.0,
        repeat_penalty: 1.05,
        penalty_last_n: 256,
        stop_tokens: vec!["stop".to_string()],
    };

    let sanitized = sampling.sanitize_for_llama_helper();

    assert_eq!(sanitized.top_k, 0);
    assert_eq!(sanitized.temperature, 0.7);
    assert_eq!(sanitized.top_p, 0.8);
    assert_eq!(sanitized.presence_penalty, 0.3);
    assert_eq!(sanitized.repeat_penalty, 1.05);
    assert_eq!(sanitized.penalty_last_n, 256);
}

#[test]
fn sampling_params_sanitize_for_llama_helper_keeps_positive_top_k() {
    let sampling = SamplingParams::qwen35_summary(vec!["stop".to_string()]);

    let sanitized = sampling.sanitize_for_llama_helper();

    assert_eq!(sanitized.top_k, 20);
}
