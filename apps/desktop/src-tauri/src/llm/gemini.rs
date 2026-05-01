use reqwest::StatusCode;
use serde_json::{json, Value};

use super::{
    parse_json_from_model_text, strip_provider_prefix, GenerateJsonRequest, GenerateJsonResponse,
    ModelConfig,
};

const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

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
    let model = strip_provider_prefix(&config.model, "gemini/");
    let url = format!(
        "{base}/models/{model}:generateContent?key={}",
        config.api_key.trim()
    );

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": request.system }]
        },
        "contents": [{
            "role": "user",
            "parts": [{ "text": request.user.to_string() }]
        }],
        "generationConfig": {
            "temperature": request.temperature,
            "responseMimeType": "application/json"
        }
    });

    let response = reqwest::Client::new()
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("连接 Gemini 失败: {err}"))?;

    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|err| format!("读取 Gemini 响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format_gemini_error(status, &value));
    }

    let content = value
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Gemini 响应缺少正文: {value}"))?;

    Ok(GenerateJsonResponse {
        value: parse_json_from_model_text(content)?,
    })
}

fn format_gemini_error(status: StatusCode, value: &Value) -> String {
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Gemini 请求失败");
    format!("Gemini 请求失败（HTTP {status}）：{message}")
}
