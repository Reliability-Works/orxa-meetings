use super::*;

#[test]
fn chunk_summary_prompt_forces_english_base_output() {
    let prompt = build_chunk_summary_user_prompt("会議の内容");

    assert!(prompt.contains(ENGLISH_BASE_SUMMARY_INSTRUCTION));
    assert!(prompt.contains("<transcript_chunk>"));
}

#[test]
fn combine_summary_prompt_forces_english_base_output() {
    let prompt = build_combine_summary_user_prompt("chunk one\n---\nchunk two");

    assert!(prompt.contains(ENGLISH_BASE_SUMMARY_INSTRUCTION));
    assert!(prompt.contains("<summaries>"));
}

#[test]
fn final_report_prompt_forces_english_base_output() {
    let prompt = build_final_report_system_prompt("Fill the section", "# <Add Title here>");

    assert!(prompt.contains(ENGLISH_BASE_SUMMARY_INSTRUCTION));
    assert!(prompt.contains("SECTION-SPECIFIC INSTRUCTIONS"));
}

#[test]
fn final_report_prompt_requires_concrete_action_items() {
    let prompt = build_final_report_system_prompt("Fill the section", "# <Add Title here>");

    assert!(prompt.contains(ACTION_ITEMS_SUMMARY_INSTRUCTION));
    assert!(prompt.contains("Unknown for missing owners"));
    assert!(prompt.contains("TBD for missing due dates"));
}

#[test]
fn summary_prompts_prioritize_comprehensive_detail_retention() {
    let chunk_prompt = build_chunk_summary_user_prompt("timeline detail");
    let combine_prompt = build_combine_summary_user_prompt("chunk one\n---\nchunk two");
    let final_prompt = build_final_report_system_prompt("Fill the section", "# <Add Title here>");

    assert!(chunk_prompt.contains(COMPREHENSIVE_SUMMARY_INSTRUCTION));
    assert!(combine_prompt.contains(COMPREHENSIVE_SUMMARY_INSTRUCTION));
    assert!(final_prompt.contains(COMPREHENSIVE_SUMMARY_INSTRUCTION));
    assert!(final_prompt.contains("not only the highest-level themes"));
}

#[test]
fn english_base_instruction_marks_non_english_prose_invalid_without_bloat() {
    assert!(ENGLISH_BASE_SUMMARY_INSTRUCTION.contains("non-English prose is invalid"));
    assert!(ENGLISH_BASE_SUMMARY_INSTRUCTION.len() <= 120);
}

#[test]
fn english_target_with_english_transcript_skips_normalization() {
    assert_eq!(
        resolve_final_language_action(Some("en"), Some("en")),
        FinalLanguageAction::ReturnEnglish
    );
}

#[test]
fn english_target_with_non_english_transcript_normalizes_to_english() {
    assert_eq!(
        resolve_final_language_action(Some("en"), Some("ja")),
        FinalLanguageAction::NormalizeEnglish
    );
}

#[test]
fn english_target_with_unknown_transcript_normalizes_to_english() {
    assert_eq!(
        resolve_final_language_action(Some("en"), None),
        FinalLanguageAction::NormalizeEnglish
    );
}

#[test]
fn non_english_target_uses_translation_flow() {
    assert_eq!(
        resolve_final_language_action(Some("fr"), Some("ja")),
        FinalLanguageAction::Translate("French")
    );
}

#[test]
fn failed_english_normalization_falls_back_to_original_markdown() {
    assert_eq!(
        english_markdown_after_normalization_result(
            "# Original",
            Err("normalization failed".to_string())
        )
        .unwrap(),
        "# Original"
    );
}

#[test]
fn cancelled_english_normalization_is_not_swallowed() {
    assert!(english_markdown_after_normalization_result(
        "# Original",
        Err("Summary generation was cancelled".to_string())
    )
    .is_err());
}

// resolve_cached_english matrix -------------------------------------------

#[test]
fn no_cache_no_language_returns_none() {
    assert_eq!(resolve_cached_english(None, None), None);
}

#[test]
fn empty_cache_with_translation_target_returns_none() {
    assert_eq!(resolve_cached_english(Some(""), Some("fr")), None);
}

#[test]
fn whitespace_only_cache_returns_none() {
    assert_eq!(resolve_cached_english(Some("   \n"), Some("fr")), None);
}

#[test]
fn valid_cache_no_language_returns_none() {
    assert_eq!(resolve_cached_english(Some("body"), None), None);
}

#[test]
fn valid_cache_english_target_returns_none() {
    assert_eq!(resolve_cached_english(Some("body"), Some("en")), None);
}

#[test]
fn valid_cache_english_variant_returns_none() {
    // "en-GB" normalises to English - cache should not be used (re-run pass 1)
    assert_eq!(resolve_cached_english(Some("body"), Some("en-GB")), None);
}

#[test]
fn valid_cache_french_target_returns_cache() {
    assert_eq!(
        resolve_cached_english(Some("body"), Some("fr")),
        Some("body")
    );
}

#[test]
fn valid_cache_unknown_language_returns_none() {
    // Unknown code -> language_name_from_code returns None -> not a translation
    assert_eq!(
        resolve_cached_english(Some("body"), Some("zz-unknown")),
        None
    );
}

#[test]
fn uppercase_translation_code_returns_cache() {
    assert_eq!(
        resolve_cached_english(Some("body"), Some("FR")),
        Some("body")
    );
}

#[test]
fn uppercase_english_code_returns_none() {
    assert_eq!(resolve_cached_english(Some("body"), Some("EN")), None);
}

#[test]
fn underscore_locale_variant_returns_none() {
    // OS locale APIs (notably macOS) may emit "en_GB" with underscore.
    assert_eq!(resolve_cached_english(Some("body"), Some("en_GB")), None);
}
