use chrono::{DateTime, Utc};
use regex::Regex;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(super) fn extract_text(path: &Path, raw: &str) -> String {
    if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
        let lines = raw
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter_map(|value| extract_json_text(&value))
            .collect::<Vec<_>>();
        if !lines.is_empty() {
            return lines.join("\n");
        }
    }

    if matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("json")
    ) {
        if let Ok(value) = serde_json::from_str::<Value>(raw) {
            if let Some(text) = extract_json_text(&value) {
                return text;
            }
        }
    }

    raw.to_string()
}

fn extract_json_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(extract_json_text)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.trim().is_empty()).then_some(text)
        }
        Value::Object(map) => {
            let mut parts = Vec::new();
            for key in [
                "cwd",
                "objective",
                "summary",
                "content",
                "message",
                "text",
                "title",
                "cmd",
                "output",
            ] {
                if let Some(value) = map.get(key).and_then(extract_json_text) {
                    parts.push(format!("{key}: {value}"));
                }
            }
            for key in ["payload", "turn_context", "response_item"] {
                if let Some(value) = map.get(key).and_then(extract_json_text) {
                    parts.push(value);
                }
            }
            let text = parts.join("\n");
            (!text.trim().is_empty()).then_some(text)
        }
        _ => None,
    }
}

pub(super) fn extract_title(path: &Path, content: &str) -> String {
    for line in content.lines().take(30) {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            return trimmed.trim_start_matches("# ").trim().to_string();
        }
        if let Some(rest) = trimmed.strip_prefix("title:") {
            let value = rest.trim();
            if !value.is_empty() {
                return truncate_chars(value, 100);
            }
        }
    }

    path.file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.replace(['_', '-'], " "))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Agent session".to_string())
}

pub(super) fn extract_project_path(content: &str) -> Option<String> {
    let patterns = [
        r#"cwd[=:]\s*"?([^"\n,]+)"?"#,
        r#"/Users/[^ \n"']+/Repos/[^ \n"']+"#,
        r#"/Users/[^ \n"']+/Documents/Codex/[^ \n"']+"#,
    ];

    for pattern in patterns {
        let Ok(regex) = Regex::new(pattern) else {
            continue;
        };
        if let Some(captures) = regex.captures(content) {
            let value = captures
                .get(1)
                .or_else(|| captures.get(0))
                .map(|match_| match_.as_str().trim_matches('"').trim().to_string());
            if let Some(value) = value.filter(|value| value.starts_with("/")) {
                return Some(value);
            }
        }
    }

    None
}

pub(super) fn extract_session_date(path: &Path, content: &str) -> Option<String> {
    let source = format!(
        "{} {}",
        path.to_string_lossy(),
        content.lines().take(8).collect::<Vec<_>>().join(" ")
    );
    let regex =
        Regex::new(r#"(20\d\d)[-/](\d\d)[-/](\d\d)[T_ -](\d\d)[:\-](\d\d)[:\-](\d\d)"#).ok()?;
    let captures = regex.captures(&source)?;
    let normalized = format!(
        "{}-{}-{}T{}:{}:{}Z",
        captures.get(1)?.as_str(),
        captures.get(2)?.as_str(),
        captures.get(3)?.as_str(),
        captures.get(4)?.as_str(),
        captures.get(5)?.as_str(),
        captures.get(6)?.as_str(),
    );
    DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|date| date.with_timezone(&Utc).to_rfc3339())
}

pub(super) fn expand_path(value: &str) -> PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

pub(super) fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value.chars().take(max_chars).collect::<String>()
}

pub(super) fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
