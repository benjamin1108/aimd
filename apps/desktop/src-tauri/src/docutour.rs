use crate::llm::{self, GenerateJsonRequest, ModelConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const DOCUTOUR_SYSTEM_PROMPT: &str = include_str!("prompts/docutour_system.md");
const DOCUTOUR_USER_PROMPT: &str = include_str!("prompts/docutour_user.md");

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocuTourAnchorDTO {
    pub id: String,
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub path: Vec<String>,
    #[serde(default)]
    pub nearby_text: String,
    #[serde(default)]
    pub position: usize,
    #[serde(default)]
    pub signals: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocuTourModelConfigDTO {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub api_base: Option<String>,
    pub max_steps: usize,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocuTourStepDTO {
    pub target_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub why: String,
    #[serde(default)]
    pub insight: String,
    #[serde(default)]
    pub next: String,
    #[serde(default)]
    pub narration: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocuTourScriptDTO {
    pub version: u8,
    pub title: Option<String>,
    #[serde(default)]
    pub document_type: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub reading_strategy: String,
    pub steps: Vec<DocuTourStepDTO>,
}

// ─── generate_docu_tour ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_docu_tour(
    markdown: String,
    anchors: Vec<DocuTourAnchorDTO>,
    config: DocuTourModelConfigDTO,
) -> Result<DocuTourScriptDTO, String> {
    if anchors.is_empty() {
        return Err("缺少导览锚点".to_string());
    }

    let requested_steps = config.max_steps.clamp(3, 12);
    let target_steps = requested_steps.min(anchors.len());
    let anchor_ids: HashSet<String> = anchors.iter().map(|anchor| anchor.id.clone()).collect();
    let anchors_json =
        serde_json::to_string_pretty(&anchors).map_err(|e| format!("序列化导览锚点失败: {e}"))?;
    let markdown = markdown.chars().take(40000).collect::<String>();
    let user = DOCUTOUR_USER_PROMPT
        .replace("{{target_steps}}", &target_steps.to_string())
        .replace("{{anchor_count}}", &anchors.len().to_string())
        .replace("{{anchors_json}}", &anchors_json)
        .replace("{{markdown}}", &markdown);
    let model_config = ModelConfig {
        provider: config.provider,
        model: config.model,
        api_key: config.api_key,
        api_base: config.api_base,
    };

    let response = llm::generate_json(
        &model_config,
        GenerateJsonRequest {
            system: DOCUTOUR_SYSTEM_PROMPT.to_string(),
            user: serde_json::json!({ "prompt": user }),
            temperature: 0.2,
        },
    )
    .await?;
    let mut script: DocuTourScriptDTO =
        serde_json::from_value(response.value).map_err(|e| format!("导览 JSON 结构无效: {e}"))?;
    if script.version != 2 || script.steps.is_empty() {
        return Err("模型没有返回可用导览步骤".to_string());
    }
    script.steps.retain(|step| {
        anchor_ids.contains(&step.target_id)
            && (!step.insight.trim().is_empty() || !step.narration.trim().is_empty())
    });
    let mut seen = HashSet::new();
    script
        .steps
        .retain(|step| seen.insert(step.target_id.clone()));
    if script.steps.len() < target_steps {
        return Err(format!(
            "模型返回的导览步数不足：需要 {target_steps} 步，实际可用 {} 步。请重新生成。",
            script.steps.len()
        ));
    }
    script.steps.truncate(target_steps);
    Ok(script)
}
