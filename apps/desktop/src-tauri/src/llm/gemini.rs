use crate::dev_log;
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

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

    let response =
        send_generate_content("generate_text", &url, &body_bytes, model, started).await?;

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

    let response =
        send_generate_content("generate_json", &url, &body_bytes, model, started).await?;

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

async fn send_generate_content(
    operation: &str,
    url: &str,
    body_bytes: &[u8],
    model: &str,
    started: Instant,
) -> Result<reqwest::Response, String> {
    const MAX_ATTEMPTS: usize = 2;

    for attempt in 1..=MAX_ATTEMPTS {
        let client = reqwest::Client::builder()
            .http1_only()
            .pool_max_idle_per_host(0)
            .build()
            .map_err(|err| format!("初始化 Gemini HTTP 客户端失败: {err}"))?;
        let response = client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body_bytes.to_vec())
            .send()
            .await;

        match response {
            Ok(response) => return Ok(response),
            Err(err) => {
                let message = format!("连接 Gemini 失败: {}", format_reqwest_error(&err));
                dev_log::llm(&format!("gemini.{operation}.transport_error"), || {
                    json!({
                        "provider": "gemini",
                        "model": model,
                        "url": redact_url_key(url),
                        "attempt": attempt,
                        "maxAttempts": MAX_ATTEMPTS,
                        "elapsedMs": started.elapsed().as_millis(),
                        "error": message,
                    })
                });
                if attempt == MAX_ATTEMPTS {
                    return Err(message);
                }
                println!(
                    "[llm:gemini] {operation} transport error attempt={attempt}/{MAX_ATTEMPTS}; retrying"
                );
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
    }

    Err("连接 Gemini 失败: exhausted transport retries".to_string())
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
