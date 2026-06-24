use super::*;
use crate::summary::templates::Template;

#[test]
fn test_strip_leading_title_with_body() {
    let input = "# Meeting Title\nThis is the body.\nMore content.";
    let result = strip_leading_title(input);
    assert_eq!(result, "This is the body.\nMore content.");
}

#[test]
fn test_strip_leading_title_only() {
    let input = "# Meeting Title";
    let result = strip_leading_title(input);
    assert_eq!(result, "");
}

#[test]
fn test_strip_leading_title_no_heading() {
    let input = "No heading here.\nJust body.";
    let result = strip_leading_title(input);
    assert_eq!(result, "");
}

#[test]
fn test_strip_leading_title_multiline_body() {
    let input = "# Title\n## Subheading\nParagraph 1\n\nParagraph 2";
    let result = strip_leading_title(input);
    assert_eq!(result, "## Subheading\nParagraph 1\n\nParagraph 2");
}

#[test]
fn test_strip_leading_title_empty_after_heading() {
    let input = "# Title\n";
    let result = strip_leading_title(input);
    assert_eq!(result, "");
}

#[test]
fn test_strip_leading_title_whitespace_after_heading() {
    let input = "# Title\n   \n Body with leading spaces";
    let result = strip_leading_title(input);
    assert_eq!(result, "Body with leading spaces");
}

#[test]
fn test_strip_title_if_present_preserves_already_stripped() {
    assert_eq!(
        strip_title_if_present("## Action Items\nfoo"),
        "## Action Items\nfoo"
    );
}

#[test]
fn test_strip_title_if_present_strips_leading_h1() {
    assert_eq!(
        strip_title_if_present("# Meeting Title\n## Action Items\nfoo"),
        "## Action Items\nfoo"
    );
}

#[test]
fn test_strip_title_if_present_no_heading_preserved() {
    // Distinct from strip_leading_title which returns "" - this preserves input.
    assert_eq!(strip_title_if_present("Just body text"), "Just body text");
}

#[test]
fn test_strip_title_if_present_hash_no_space_preserved() {
    // `#NoSpace` is not a markdown H1 - preserve.
    assert_eq!(strip_title_if_present("#NoSpace\nbody"), "#NoSpace\nbody");
}

#[test]
fn test_strip_title_if_present_mid_document_h1_preserved() {
    let input = "Some paragraph\n\n# H1 on line 3\n## Section\nbody";
    assert_eq!(strip_title_if_present(input), input);
}

#[test]
fn test_strip_title_if_present_leading_whitespace_h1_stripped() {
    assert_eq!(
        strip_title_if_present("  # Title\n## Section\nbody"),
        "## Section\nbody"
    );
}

fn sample_cache_source() -> SummaryCacheSource {
    let template_fingerprint = stable_text_fingerprint("standard template prompt");
    build_summary_cache_source(
        "transcript body",
        "custom prompt",
        "standard_meeting",
        &template_fingerprint,
        3700,
        "ollama",
        "gemma3:1b",
        Some("http://localhost:11434"),
        None,
        None,
        None,
        None,
    )
}

fn test_template(section_title: &str) -> Template {
    Template {
        name: "Test".to_string(),
        description: "Test template".to_string(),
        sections: vec![crate::summary::templates::TemplateSection {
            title: section_title.to_string(),
            instruction: "Summarize this section".to_string(),
            format: "paragraph".to_string(),
            item_format: None,
            example_item_format: None,
        }],
    }
}

#[test]
fn test_template_cache_fingerprint_changes_with_rendered_template() {
    assert_ne!(
        template_cache_fingerprint(&test_template("Summary")),
        template_cache_fingerprint(&test_template("Decisions"))
    );
}

#[test]
fn test_legacy_english_markdown_field_is_cache_miss() {
    let raw = serde_json::json!({
        "markdown": "translated",
        "english_markdown": "# Old English\nBody"
    })
    .to_string();

    assert_eq!(
        extract_cached_english_markdown(&raw, &sample_cache_source(), Some("de")).unwrap(),
        None
    );
}

#[test]
fn test_matching_source_changed_translation_target_reuses_cache() {
    let source = sample_cache_source();
    let raw = build_summary_result_json(
        "# Reunion\n## Points\nBonjour",
        "# Meeting\n## Points\nHello",
        source.clone(),
        Some("fr"),
    )
    .to_string();

    assert_eq!(
        extract_cached_english_markdown(&raw, &source, Some("de")).unwrap(),
        Some("# Meeting\n## Points\nHello".to_string())
    );
}

#[test]
fn test_same_language_regeneration_rejects_cache() {
    let source = sample_cache_source();
    let raw = build_summary_result_json(
        "# Reunion\n## Points\nBonjour",
        "# Meeting\n## Points\nHello",
        source.clone(),
        Some("fr"),
    )
    .to_string();

    assert_eq!(
        extract_cached_english_markdown(&raw, &source, Some("fr")).unwrap(),
        None
    );
}

#[test]
fn test_changed_summary_inputs_reject_cache() {
    let source = sample_cache_source();
    let template_fingerprint = source.template_fingerprint.clone();
    let raw = build_summary_result_json(
        "# Reunion\n## Points\nBonjour",
        "# Meeting\n## Points\nHello",
        source,
        Some("fr"),
    )
    .to_string();

    let changed_sources = [
        build_summary_cache_source(
            "changed transcript",
            "custom prompt",
            "standard_meeting",
            &template_fingerprint,
            3700,
            "ollama",
            "gemma3:1b",
            Some("http://localhost:11434"),
            None,
            None,
            None,
            None,
        ),
        build_summary_cache_source(
            "transcript body",
            "changed prompt",
            "standard_meeting",
            &template_fingerprint,
            3700,
            "ollama",
            "gemma3:1b",
            Some("http://localhost:11434"),
            None,
            None,
            None,
            None,
        ),
        build_summary_cache_source(
            "transcript body",
            "custom prompt",
            "daily_standup",
            &template_fingerprint,
            3700,
            "ollama",
            "gemma3:1b",
            Some("http://localhost:11434"),
            None,
            None,
            None,
            None,
        ),
        build_summary_cache_source(
            "transcript body",
            "custom prompt",
            "standard_meeting",
            &template_fingerprint,
            3700,
            "openai",
            "gemma3:1b",
            Some("http://localhost:11434"),
            None,
            None,
            None,
            None,
        ),
        build_summary_cache_source(
            "transcript body",
            "custom prompt",
            "standard_meeting",
            &template_fingerprint,
            3700,
            "ollama",
            "qwen2.5:3b",
            Some("http://localhost:11434"),
            None,
            None,
            None,
            None,
        ),
        build_summary_cache_source(
            "transcript body",
            "custom prompt",
            "standard_meeting",
            &template_fingerprint,
            3700,
            "ollama",
            "gemma3:1b",
            Some("http://localhost:11500"),
            None,
            None,
            None,
            None,
        ),
        build_summary_cache_source(
            "transcript body",
            "custom prompt",
            "standard_meeting",
            &template_fingerprint,
            3700,
            "ollama",
            "gemma3:1b",
            Some("http://localhost:11434"),
            Some("https://custom.example/v1"),
            Some(2048),
            Some(0.2),
            Some(0.9),
        ),
    ];

    for changed_source in changed_sources {
        assert_eq!(
            extract_cached_english_markdown(&raw, &changed_source, Some("de")).unwrap(),
            None
        );
    }
}

#[test]
fn test_changed_template_content_rejects_cache() {
    let source = sample_cache_source();
    let raw = build_summary_result_json(
        "# Reunion\n## Points\nBonjour",
        "# Meeting\n## Points\nHello",
        source.clone(),
        Some("fr"),
    )
    .to_string();

    let changed_template = SummaryCacheSource {
        template_fingerprint: stable_text_fingerprint("changed template prompt"),
        ..source
    };

    assert_eq!(
        extract_cached_english_markdown(&raw, &changed_template, Some("de")).unwrap(),
        None
    );
}

#[test]
fn test_changed_token_threshold_rejects_cache() {
    let source = sample_cache_source();
    let raw = build_summary_result_json(
        "# Reunion\n## Points\nBonjour",
        "# Meeting\n## Points\nHello",
        source.clone(),
        Some("fr"),
    )
    .to_string();

    let changed_threshold = SummaryCacheSource {
        token_threshold: 8192,
        ..source
    };

    assert_eq!(
        extract_cached_english_markdown(&raw, &changed_threshold, Some("de")).unwrap(),
        None
    );
}

#[test]
fn test_result_json_strips_display_markdown_but_keeps_cache_title() {
    let result = build_summary_result_json(
        "# Translated Title\n## Decisions\nDone",
        "# English Title\n## Decisions\nDone",
        sample_cache_source(),
        Some("fr"),
    );

    assert_eq!(result["markdown"], "## Decisions\nDone");
    assert_eq!(
        result["english_cache"]["markdown"],
        "# English Title\n## Decisions\nDone"
    );
}

#[test]
fn test_extract_cached_english_from_malformed_json_errors() {
    let raw = r#"{ not valid json"#;
    assert!(extract_cached_english_markdown(raw, &sample_cache_source(), Some("de")).is_err());
}
