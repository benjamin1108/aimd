#![allow(dead_code)]
mod dashscope;
mod gemini;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub api_base: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GenerateJsonRequest {
    pub system: String,
    pub user: Value,
    pub temperature: f32,
}

#[derive(Debug, Clone)]
pub struct GenerateJsonResponse {
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct GenerateTextRequest {
    pub system: String,
    pub user: String,
    pub temperature: f32,
}

#[derive(Debug, Clone)]
pub struct GenerateTextResponse {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub message: String,
}

#[tauri::command]
pub async fn test_model_connection(
    config: ModelConfig,
) -> Result<ModelConnectionTestResult, String> {
    let started = Instant::now();
    let result = generate_text(
        &config,
        GenerateTextRequest {
            system: "You are a connection health check. Reply with OK only.".to_string(),
            user: "OK".to_string(),
            temperature: 0.0,
        },
    )
    .await;
    let latency_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;

    Ok(match result {
        Ok(response) if !response.text.trim().is_empty() => ModelConnectionTestResult {
            ok: true,
            latency_ms,
            message: "连接正常".to_string(),
        },
        Ok(_) => ModelConnectionTestResult {
            ok: false,
            latency_ms,
            message: "模型返回空内容".to_string(),
        },
        Err(err) => ModelConnectionTestResult {
            ok: false,
            latency_ms,
            message: err,
        },
    })
}

pub async fn generate_json(
    config: &ModelConfig,
    request: GenerateJsonRequest,
) -> Result<GenerateJsonResponse, String> {
    if config.api_key.trim().is_empty() {
        return Err("缺少模型 API Key".to_string());
    }

    match config.provider.as_str() {
        "dashscope" => dashscope::generate_json(config, request).await,
        "gemini" => gemini::generate_json(config, request).await,
        _ => Err(format!("暂不支持的模型 Provider：{}", config.provider)),
    }
}

pub async fn generate_text(
    config: &ModelConfig,
    request: GenerateTextRequest,
) -> Result<GenerateTextResponse, String> {
    if config.api_key.trim().is_empty() {
        return Err("缺少模型 API Key".to_string());
    }

    match config.provider.as_str() {
        "dashscope" => dashscope::generate_text(config, request).await,
        "gemini" => gemini::generate_text(config, request).await,
        _ => Err(format!("暂不支持的模型 Provider：{}", config.provider)),
    }
}

pub async fn generate_text_with_retries(
    config: &ModelConfig,
    request: GenerateTextRequest,
    timeout: Duration,
    retry_count: u32,
    timeout_message: &str,
) -> Result<GenerateTextResponse, String> {
    let max_attempts = retry_count.saturating_add(1);
    let mut last_error = None;

    for attempt in 1..=max_attempts {
        let result = tokio::time::timeout(timeout, generate_text(config, request.clone())).await;
        match result {
            Ok(Ok(response)) => return Ok(response),
            Ok(Err(err)) => last_error = Some(err),
            Err(_) => last_error = Some(timeout_message.to_string()),
        }

        if attempt < max_attempts {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    Err(last_error.unwrap_or_else(|| timeout_message.to_string()))
}

fn strip_provider_prefix<'a>(model: &'a str, prefix: &str) -> &'a str {
    model.strip_prefix(prefix).unwrap_or(model).trim()
}

fn parse_json_from_model_text(text: &str) -> Result<Value, String> {
    let mut cleaned = text.trim();
    if let Some(rest) = cleaned.strip_prefix("```json") {
        cleaned = rest.trim();
    } else if let Some(rest) = cleaned.strip_prefix("```") {
        cleaned = rest.trim();
    }
    if let Some(rest) = cleaned.strip_suffix("```") {
        cleaned = rest.trim();
    }

    if let Ok(value) = serde_json::from_str::<Value>(cleaned) {
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
    serde_json::from_str(&cleaned[start..=end]).map_err(|err| format!("解析模型 JSON 失败: {err}"))
}
