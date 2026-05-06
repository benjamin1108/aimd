use crate::dev_log;
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::time::Instant;

use super::{
    parse_json_from_model_text, strip_provider_prefix, GenerateJsonRequest, GenerateJsonResponse,
    GenerateTextRequest, GenerateTextResponse, ModelConfig,
};

const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

pub async fn generate_text(
    config: &ModelConfig,
    request: GenerateTextRequest,
) -> Result<GenerateTextResponse, String> {
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
            "parts": [{ "text": request.user }]
        }],
        "generationConfig": {
            "temperature": request.temperature
        }
    });
    let body_bytes =
        serde_json::to_vec(&body).map_err(|err| format!("序列化 Gemini 请求失败: {err}"))?;
    let started = Instant::now();
    println!(
        "[llm:gemini] generate_text request model={} userChars={} systemChars={} bodyBytes={}",
        model,
        request.user.chars().count(),
        request.system.chars().count(),
        body_bytes.len()
    );
    dev_log::llm("gemini.generate_text.request", || {
        json!({
            "provider": "gemini",
            "model": model,
            "url": redact_url_key(&url),
            "requestBody": body.clone(),
        })
    });

    let response = match reqwest::Client::new()
        .post(url.clone())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body_bytes)
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            let message = format!("连接 Gemini 失败: {}", format_reqwest_error(&err));
            dev_log::llm("gemini.generate_text.transport_error", || {
                json!({
                    "provider": "gemini",
                    "model": model,
                    "url": redact_url_key(&url),
                    "elapsedMs": started.elapsed().as_millis(),
                    "error": message,
                })
            });
            return Err(message);
        }
    };

    let status = response.status();
    println!(
        "[llm:gemini] generate_text response status={} elapsedMs={}",
        status,
        started.elapsed().as_millis()
    );
    let response_text = response
        .text()
        .await
        .map_err(|err| format!("读取 Gemini 响应失败: {err}"))?;
    dev_log::llm("gemini.generate_text.response", || {
        json!({
            "provider": "gemini",
            "model": model,
            "url": redact_url_key(&url),
            "status": status.as_u16(),
            "elapsedMs": started.elapsed().as_millis(),
            "responseBody": response_text,
        })
    });
    let value = serde_json::from_str::<Value>(&response_text)
        .map_err(|err| format!("解析 Gemini 响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format_gemini_error(status, &value));
    }

    let content = value
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Gemini 响应缺少正文: {value}"))?;
    dev_log::llm("gemini.generate_text.parsed", || {
        json!({
            "provider": "gemini",
            "model": model,
            "text": content,
        })
    });

    Ok(GenerateTextResponse {
        text: content.to_string(),
    })
}

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
    let body_bytes =
        serde_json::to_vec(&body).map_err(|err| format!("序列化 Gemini 请求失败: {err}"))?;
    let started = Instant::now();
    println!(
        "[llm:gemini] generate_json request model={} bodyBytes={}",
        model,
        body_bytes.len()
    );
    dev_log::llm("gemini.generate_json.request", || {
        json!({
            "provider": "gemini",
            "model": model,
            "url": redact_url_key(&url),
            "requestBody": body.clone(),
        })
    });

    let response = match reqwest::Client::new()
        .post(url.clone())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body_bytes)
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            let message = format!("连接 Gemini 失败: {}", format_reqwest_error(&err));
            dev_log::llm("gemini.generate_json.transport_error", || {
                json!({
                    "provider": "gemini",
                    "model": model,
                    "url": redact_url_key(&url),
                    "elapsedMs": started.elapsed().as_millis(),
                    "error": message,
                })
            });
            return Err(message);
        }
    };

    let status = response.status();
    println!(
        "[llm:gemini] generate_json response status={} elapsedMs={}",
        status,
        started.elapsed().as_millis()
    );
    let response_text = response
        .text()
        .await
        .map_err(|err| format!("读取 Gemini 响应失败: {err}"))?;
    dev_log::llm("gemini.generate_json.response", || {
        json!({
            "provider": "gemini",
            "model": model,
            "url": redact_url_key(&url),
            "status": status.as_u16(),
            "elapsedMs": started.elapsed().as_millis(),
            "responseBody": response_text,
        })
    });
    let value = serde_json::from_str::<Value>(&response_text)
        .map_err(|err| format!("解析 Gemini 响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format_gemini_error(status, &value));
    }

    let content = value
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Gemini 响应缺少正文: {value}"))?;
    let parsed = parse_json_from_model_text(content)?;
    dev_log::llm("gemini.generate_json.parsed", || {
        json!({
            "provider": "gemini",
            "model": model,
            "text": content,
            "json": parsed.clone(),
        })
    });

    Ok(GenerateJsonResponse { value: parsed })
}

fn format_gemini_error(status: StatusCode, value: &Value) -> String {
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Gemini 请求失败");
    format!("Gemini 请求失败（HTTP {status}）：{message}")
}

fn format_reqwest_error(err: &reqwest::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = std::error::Error::source(err);
    while let Some(next) = source {
        parts.push(next.to_string());
        source = next.source();
    }
    redact_url_key(&parts.join(" | caused by: "))
}

fn redact_url_key(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(idx) = rest.find("key=") {
        out.push_str(&rest[..idx + 4]);
        out.push_str("[REDACTED]");
        let tail = &rest[idx + 4..];
        let end = tail
            .find(|ch: char| ch == '&' || ch == ')' || ch.is_whitespace())
            .unwrap_or(tail.len());
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}
