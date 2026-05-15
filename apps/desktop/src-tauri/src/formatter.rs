use crate::llm::{generate_text_with_retries, GenerateTextRequest, ModelConfig};
use crate::settings::{
    load_settings, normalize_model_retry_count, normalize_model_timeout_seconds,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;

const FORMAT_MARKDOWN_SYSTEM_PROMPT: &str = include_str!("prompts/format_markdown_system.md");
const FORMAT_MARKDOWN_LANGUAGE_POLICY_PROMPT: &str =
    include_str!("prompts/format_markdown_language_policy.md");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FormatMarkdownResult {
    pub needed: bool,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelFormatMarkdownResult {
    needed: bool,
    #[serde(default)]
    reason: String,
    markdown: Option<String>,
}

#[tauri::command]
pub async fn format_markdown(
    app: AppHandle,
    markdown: String,
    provider: String,
    model: String,
    output_language: Option<String>,
    model_timeout_seconds: Option<u64>,
    model_retry_count: Option<u32>,
) -> Result<FormatMarkdownResult, String> {
    if markdown.trim().is_empty() {
        return Err("当前文档为空，无法格式化".to_string());
    }

    let settings = load_settings(app)?;
    let provider = normalize_provider(&provider);
    let cred = match provider {
        "gemini" => settings.ai.providers.gemini,
        _ => settings.ai.providers.dashscope,
    };
    let model = if model.trim().is_empty() {
        settings.format.model
    } else {
        model.trim().to_string()
    };
    let output_language = output_language
        .as_deref()
        .unwrap_or(settings.format.output_language.as_str());
    let timeout_seconds = normalize_model_timeout_seconds(
        model_timeout_seconds.unwrap_or(settings.format.model_timeout_seconds),
        settings.format.model_timeout_seconds,
    );
    let retry_count =
        normalize_model_retry_count(model_retry_count.unwrap_or(settings.format.model_retry_count));

    let config = ModelConfig {
        provider: provider.to_string(),
        model: model.clone(),
        api_key: cred.api_key,
        api_base: Some(cred.api_base).filter(|s| !s.is_empty()),
    };

    let request = GenerateTextRequest {
        system: format_system_prompt(normalize_output_language(output_language), provider, &model),
        user: markdown,
        temperature: 0.1,
    };

    let response = generate_text_with_retries(
        &config,
        request,
        Duration::from_secs(timeout_seconds),
        retry_count,
        "文档格式化超时",
    )
    .await?;
    parse_format_markdown_result(&response.text)
}

fn normalize_provider(value: &str) -> &'static str {
    if value == "gemini" {
        "gemini"
    } else {
        "dashscope"
    }
}

fn normalize_output_language(value: &str) -> &'static str {
    if value == "en" {
        "en"
    } else {
        "zh-CN"
    }
}

fn language_name(value: &str) -> &'static str {
    if value == "en" {
        "English"
    } else {
        "Simplified Chinese"
    }
}

fn format_system_prompt(output_language: &str, provider: &str, model: &str) -> String {
    let policy = FORMAT_MARKDOWN_LANGUAGE_POLICY_PROMPT
        .replace("{target_language}", language_name(output_language))
        .replace("{language_code}", output_language);
    let meta = format!(
        "Code-side metadata to include under formattedBy:\nprovider: {provider}\nmodel: {model}\nat: {}",
        Utc::now().to_rfc3339()
    );
    format!(
        "{}\n\n{}\n\n{}",
        FORMAT_MARKDOWN_SYSTEM_PROMPT.trim(),
        policy.trim(),
        meta
    )
}

fn strip_markdown_fence(text: &str) -> &str {
    let mut cleaned = text.trim();
    if let Some(rest) = cleaned.strip_prefix("```markdown") {
        cleaned = rest.trim();
    } else if let Some(rest) = cleaned.strip_prefix("```") {
        cleaned = rest.trim();
    }
    if let Some(rest) = cleaned.strip_suffix("```") {
        cleaned = rest.trim();
    }
    cleaned
}

fn strip_json_fence(text: &str) -> &str {
    let mut cleaned = text.trim();
    if let Some(rest) = cleaned.strip_prefix("```json") {
        cleaned = rest.trim();
    } else if let Some(rest) = cleaned.strip_prefix("```") {
        cleaned = rest.trim();
    }
    if let Some(rest) = cleaned.strip_suffix("```") {
        cleaned = rest.trim();
    }
    cleaned
}

fn parse_json_from_model_text(text: &str) -> Result<ModelFormatMarkdownResult, String> {
    let cleaned = strip_json_fence(text);
    if let Ok(value) = serde_json::from_str::<ModelFormatMarkdownResult>(cleaned) {
        return Ok(value);
    }

    let start = cleaned
        .find('{')
        .ok_or_else(|| "模型没有返回 JSON 对象".to_string())?;
    let end = cleaned
        .rfind('}')
        .ok_or_else(|| "模型没有返回完整 JSON 对象".to_string())?;
    if end <= start {
        return Err("模型返回的 JSON 对象无效".to_string());
    }
    serde_json::from_str(&cleaned[start..=end]).map_err(|err| format!("解析格式化结果失败: {err}"))
}

fn markdown_body_is_empty(markdown: &str) -> bool {
    let trimmed = markdown.trim();
    if !trimmed.starts_with("---") {
        return trimmed.is_empty();
    }
    let mut lines = trimmed.lines();
    let Some(first) = lines.next() else {
        return true;
    };
    if first.trim() != "---" {
        return trimmed.is_empty();
    }
    for line in lines.by_ref() {
        if line.trim() == "---" {
            return lines.collect::<Vec<_>>().join("\n").trim().is_empty();
        }
    }
    trimmed.is_empty()
}

fn parse_format_markdown_result(text: &str) -> Result<FormatMarkdownResult, String> {
    let parsed = parse_json_from_model_text(text)?;
    let reason = parsed.reason.trim().to_string();
    if !parsed.needed {
        return Ok(FormatMarkdownResult {
            needed: false,
            reason,
            markdown: None,
        });
    }

    let markdown = parsed
        .markdown
        .ok_or_else(|| "模型判定需要格式化，但没有返回 markdown".to_string())?;
    let markdown = strip_markdown_fence(&markdown).to_string();
    if markdown_body_is_empty(&markdown) {
        return Err("格式化结果正文为空".to_string());
    }
    Ok(FormatMarkdownResult {
        needed: true,
        reason,
        markdown: Some(markdown),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_markdown_fence() {
        assert_eq!(strip_markdown_fence("```markdown\n# A\n```"), "# A");
    }

    #[test]
    fn prompt_contains_frontmatter_contract_and_language() {
        let prompt = format_system_prompt("en", "dashscope", "qwen-x");
        assert!(prompt.contains("YAML frontmatter"));
        assert!(prompt.contains("Target output language: English."));
        assert!(prompt.contains("provider: dashscope"));
        assert!(prompt.contains("model: qwen-x"));
    }

    #[test]
    fn prompt_requires_needed_quality_judgement() {
        let prompt = format_system_prompt("zh-CN", "dashscope", "qwen-x");
        assert!(prompt.contains("\"needed\""));
        assert!(prompt.contains("already clean enough"));
        assert!(prompt.contains("needed=false"));
        assert!(!prompt.contains("exactly one H1"));
    }

    #[test]
    fn parses_needed_false_json() {
        let result =
            parse_format_markdown_result(r#"{"needed":false,"reason":"文档已经比较工整"}"#)
                .unwrap();
        assert!(!result.needed);
        assert_eq!(result.reason, "文档已经比较工整");
        assert_eq!(result.markdown, None);
    }

    #[test]
    fn parses_needed_true_json_markdown() {
        let result = parse_format_markdown_result(
            r#"{"needed":true,"reason":"有噪声","markdown":"---\ntitle: A\n---\n\n清理后的正文"}"#,
        )
        .unwrap();
        assert!(result.needed);
        assert_eq!(
            result.markdown.unwrap(),
            "---\ntitle: A\n---\n\n清理后的正文"
        );
    }

    #[test]
    fn strips_markdown_fence_inside_json_markdown() {
        let result = parse_format_markdown_result(
            r#"{"needed":true,"reason":"有噪声","markdown":"```markdown\n# A\n\nBody\n```"}"#,
        )
        .unwrap();
        assert_eq!(result.markdown.unwrap(), "# A\n\nBody");
    }

    #[test]
    fn json_parse_failure_is_error() {
        let err = parse_format_markdown_result("not markdown and not json").unwrap_err();
        assert!(err.contains("JSON"));
    }

    #[test]
    fn needed_true_without_markdown_is_error() {
        let err = parse_format_markdown_result(r#"{"needed":true,"reason":"有噪声"}"#).unwrap_err();
        assert!(err.contains("没有返回 markdown"));
    }
}
