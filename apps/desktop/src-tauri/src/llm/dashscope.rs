use reqwest::StatusCode;
use serde_json::{json, Value};

use super::{
    parse_json_from_model_text, strip_provider_prefix, GenerateJsonRequest, GenerateJsonResponse,
    ModelConfig,
};

const DEFAULT_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";

pub async fn generate_json(
    config: &ModelConfig,
    request: GenerateJsonRequest,
) -> Result<GenerateJsonResponse, String> {
    let base = config
        .api_base
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_BASE_URL)
        .trim_end_matches('/');
    let model = strip_provider_prefix(&config.model, "dashscope/");
    let url = chat_completions_url(base);

    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": request.system },
            { "role": "user", "content": request.user.to_string() }
        ],
        "temperature": request.temperature,
        "response_format": { "type": "json_object" }
    });

    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(config.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("连接 DashScope 失败: {err}"))?;

    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|err| format!("读取 DashScope 响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format_dashscope_error(status, &value));
    }

    let content =
        extract_message_text(&value).ok_or_else(|| format!("DashScope 响应缺少正文: {value}"))?;

    Ok(GenerateJsonResponse {
        value: parse_json_from_model_text(&content)?,
    })
}

fn chat_completions_url(base: &str) -> String {
    let base = base.trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        return base.to_string();
    }

    let compatible_base = base
        .strip_suffix("/api/v1")
        .map(|prefix| format!("{prefix}/compatible-mode/v1"))
        .unwrap_or_else(|| base.to_string());
    format!("{}/chat/completions", compatible_base.trim_end_matches('/'))
}

fn extract_message_text(value: &Value) -> Option<String> {
    if let Some(content) = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
    {
        return Some(content.to_string());
    }

    if let Some(content) = value.pointer("/output/choices/0/message/content") {
        if let Some(text) = content.as_str() {
            return Some(text.to_string());
        }

        if let Some(text) = content
            .as_array()
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .filter(|text| !text.trim().is_empty())
        {
            return Some(text);
        }
    }

    value
        .pointer("/output/text")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn format_dashscope_error(status: StatusCode, value: &Value) -> String {
    let code = value
        .get("code")
        .or_else(|| value.pointer("/error/code"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let message = value
        .get("message")
        .or_else(|| value.pointer("/error/message"))
        .and_then(Value::as_str)
        .unwrap_or("DashScope 请求失败");
    format!("DashScope 请求失败（HTTP {status}, {code}）：{message}")
}

#[cfg(test)]
mod tests {
    use super::chat_completions_url;

    #[test]
    fn accepts_compatible_base() {
        assert_eq!(
            chat_completions_url("https://dashscope.aliyuncs.com/compatible-mode/v1"),
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        );
    }

    #[test]
    fn converts_native_dashscope_base() {
        assert_eq!(
            chat_completions_url("https://dashscope-intl.aliyuncs.com/api/v1/"),
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
        );
    }

    #[test]
    fn leaves_full_chat_url_unchanged() {
        assert_eq!(
            chat_completions_url(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
            ),
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        );
    }
}
