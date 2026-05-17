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
        user: format_user_prompt(&markdown),
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
        "如果输出 YAML frontmatter，formattedBy 必须使用以下代码侧元信息:\nprovider: {provider}\nmodel: {model}\nat: {}",
        Utc::now().to_rfc3339()
    );
    format!(
        "{}\n\n{}\n\n{}",
        FORMAT_MARKDOWN_SYSTEM_PROMPT.trim(),
        policy.trim(),
        meta
    )
}

fn format_user_prompt(markdown: &str) -> String {
    format!(
        "请按系统规则评估并格式化下面这份文档。只读诊断用于帮助判断最低必要干预级别，不得原样输出。\n\n只读诊断:\n{}\n\n<document_markdown>\n{}\n</document_markdown>",
        format_markdown_diagnostics(markdown),
        markdown
    )
}

fn format_markdown_diagnostics(markdown: &str) -> String {
    let non_empty_lines = markdown
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    [
        format!("- 非空行数: {non_empty_lines}"),
        format!("- H1 数量: {}", count_h1_headings(markdown)),
        format!(
            "- YAML frontmatter: {}",
            yes_no(has_yaml_frontmatter(markdown))
        ),
        format!(
            "- 应用默认占位标题: {}",
            yes_no(has_default_placeholder_title(markdown))
        ),
        format!(
            "- 疑似断裂列表或段落: {}",
            yes_no(has_suspected_broken_list_or_paragraph(markdown))
        ),
        format!(
            "- 连续三个以上空行: {}",
            yes_no(has_three_or_more_blank_lines(markdown))
        ),
    ]
    .join("\n")
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "是"
    } else {
        "否"
    }
}

fn has_yaml_frontmatter(markdown: &str) -> bool {
    let trimmed = markdown.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with("---\n") || trimmed.starts_with("---\r\n")
}

fn count_h1_headings(markdown: &str) -> usize {
    markdown
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            trimmed.starts_with("# ") || trimmed == "#"
        })
        .count()
}

fn has_default_placeholder_title(markdown: &str) -> bool {
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed == "---" {
            continue;
        }
        if !trimmed.starts_with('#') {
            return false;
        }
        let title = trimmed.trim_start_matches('#').trim();
        return matches!(
            normalize_placeholder_title(title).as_str(),
            "未命名文档" | "untitled" | "untitled document" | "new document"
        );
    }
    false
}

fn normalize_placeholder_title(title: &str) -> String {
    title
        .trim_matches(|c| matches!(c, '"' | '\'' | '“' | '”' | '‘' | '’'))
        .trim()
        .to_lowercase()
}

fn has_three_or_more_blank_lines(markdown: &str) -> bool {
    let mut blank_count = 0;
    for line in markdown.lines() {
        if line.trim().is_empty() {
            blank_count += 1;
            if blank_count >= 3 {
                return true;
            }
        } else {
            blank_count = 0;
        }
    }
    false
}

fn has_suspected_broken_list_or_paragraph(markdown: &str) -> bool {
    let mut in_fence = false;
    let mut last_list_line_without_terminal = false;
    let mut blank_after_suspicious_list = false;

    for raw_line in markdown.lines() {
        let trimmed = raw_line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if is_list_marker_line(trimmed) {
            last_list_line_without_terminal = !ends_with_terminal_punctuation(trimmed);
            blank_after_suspicious_list = false;
            continue;
        }
        if trimmed.is_empty() {
            if last_list_line_without_terminal {
                blank_after_suspicious_list = true;
            }
            continue;
        }
        if blank_after_suspicious_list
            && !is_list_marker_line(trimmed)
            && !trimmed.starts_with('#')
            && !raw_line.starts_with(' ')
            && !raw_line.starts_with('\t')
        {
            return true;
        }
        last_list_line_without_terminal = false;
        blank_after_suspicious_list = false;
    }

    false
}

fn is_list_marker_line(trimmed: &str) -> bool {
    trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("+ ")
        || is_ordered_list_marker_line(trimmed)
}

fn is_ordered_list_marker_line(trimmed: &str) -> bool {
    let bytes = trimmed.as_bytes();
    let mut index = 0;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    if index == 0 || index > 4 || index >= bytes.len() {
        return false;
    }
    let rest = &trimmed[index..];
    rest.starts_with(". ") || rest.starts_with(") ") || rest.starts_with("、")
}

fn ends_with_terminal_punctuation(text: &str) -> bool {
    let normalized = text
        .trim_end_matches(|c| matches!(c, '"' | '\'' | '”' | '’' | ')' | '）' | ']' | '】' | '》'));
    normalized.chars().last().is_some_and(|c| {
        matches!(
            c,
            '。' | '！' | '？' | '.' | '!' | '?' | '；' | ';' | '：' | ':'
        )
    })
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
        assert!(prompt.contains("YAML frontmatter 是可选增强"));
        assert!(prompt.contains("目标输出语言：English。"));
        assert!(prompt.contains("provider: dashscope"));
        assert!(prompt.contains("model: qwen-x"));
    }

    #[test]
    fn prompt_requires_needed_quality_judgement() {
        let prompt = format_system_prompt("zh-CN", "dashscope", "qwen-x");
        assert!(prompt.contains("\"needed\""));
        assert!(prompt.contains("最低必要干预"));
        assert!(prompt.contains("轻度修复"));
        assert!(prompt.contains("断裂列表"));
        assert!(prompt.contains("needed=false"));
        assert!(!prompt.contains("exactly one H1"));
    }

    #[test]
    fn user_prompt_marks_placeholder_title_and_broken_list() {
        let prompt = format_user_prompt(
            "# 未命名文档\n\n1. 需求不足。\n\n4. 核心矛盾在于业务模型缺乏超大 Token 消耗场景且\n\n高频用户不足，建议重新评估。",
        );
        assert!(prompt.contains("- 应用默认占位标题: 是"));
        assert!(prompt.contains("- 疑似断裂列表或段落: 是"));
        assert!(prompt.contains("<document_markdown>"));
        assert!(prompt.contains("</document_markdown>"));
    }

    #[test]
    fn diagnostics_do_not_mark_clean_short_list_as_broken() {
        let prompt = format_user_prompt("# 计划\n\n1. 完成实现。\n2. 运行验证。\n");
        assert!(prompt.contains("- 应用默认占位标题: 否"));
        assert!(prompt.contains("- 疑似断裂列表或段落: 否"));
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
