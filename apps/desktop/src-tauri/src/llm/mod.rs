mod dashscope;
mod gemini;

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
