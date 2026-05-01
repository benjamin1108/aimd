use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocuTourAnchorDTO {
    pub id: String,
    pub kind: String,
    pub text: String,
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
    pub narration: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocuTourScriptDTO {
    pub version: u8,
    pub title: Option<String>,
    pub steps: Vec<DocuTourStepDTO>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteLLMDepsStatus {
    pub python3_found: bool,
    pub litellm_found: bool,
    pub python3_version: Option<String>,
    pub install_hint: String,
}

// ─── LiteLLM 依赖检测 ──────────────────────────────────────────────────────────

fn probe_python3_version() -> Option<String> {
    let out = Command::new("python3")
        .arg("--version")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let text = if text.is_empty() {
        String::from_utf8_lossy(&out.stderr).trim().to_string()
    } else {
        text
    };
    if text.is_empty() { None } else { Some(text) }
}

fn probe_litellm() -> bool {
    Command::new("python3")
        .args(["-c", "import litellm"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn check_litellm_deps() -> LiteLLMDepsStatus {
    let python3_version = probe_python3_version();
    let python3_found = python3_version.is_some();
    let litellm_found = if python3_found { probe_litellm() } else { false };
    LiteLLMDepsStatus {
        python3_found,
        litellm_found,
        python3_version,
        install_hint: "pip install litellm".to_string(),
    }
}

// ─── generate_docu_tour ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_docu_tour(
    markdown: String,
    anchors: Vec<DocuTourAnchorDTO>,
    config: DocuTourModelConfigDTO,
) -> Result<DocuTourScriptDTO, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if config.api_key.trim().is_empty() {
            return Err("缺少模型 API Key".to_string());
        }
        if anchors.is_empty() {
            return Err("缺少导览锚点".to_string());
        }

        if !probe_litellm() {
            let py_hint = if probe_python3_version().is_some() {
                "请先运行：pip install litellm"
            } else {
                "未检测到 python3，请先安装 Python 3 并运行：pip install litellm"
            };
            return Err(format!(
                "缺少 LiteLLM 依赖，导览生成功能不可用。\n\n{py_hint}\n\n安装完成后重启应用即可使用。"
            ));
        }

        let payload = serde_json::json!({
            "markdown": markdown,
            "anchors": anchors,
            "config": config,
        });
        let script = include_str!("../python/docutour_litellm.py");
        let mut child = Command::new("python3")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 Python/LiteLLM 失败: {e}"))?;

        let mut stdin_write_error: Option<String> = None;
        if let Some(stdin) = child.stdin.as_mut() {
            if let Err(err) = stdin.write_all(payload.to_string().as_bytes()) {
                stdin_write_error = Some(err.to_string());
            }
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("等待 LiteLLM 响应失败: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        if stdout.is_empty() {
            return Err(if stderr.is_empty() {
                if let Some(err) = stdin_write_error {
                    format!("LiteLLM 进程提前退出: {err}")
                } else {
                    "LiteLLM 没有返回内容".to_string()
                }
            } else if stderr.contains("No module named") {
                format!(
                    "缺少 LiteLLM 依赖，请运行：pip install litellm\n\n详细错误：{stderr}"
                )
            } else {
                format!("LiteLLM 没有返回内容: {stderr}")
            });
        }

        let value: Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("解析 LiteLLM 输出失败: {e}; 输出: {stdout}"))?;
        if let Some(err) = value.get("error").and_then(|v| v.as_str()) {
            return Err(err.to_string());
        }
        let script: DocuTourScriptDTO =
            serde_json::from_value(value).map_err(|e| format!("导览 JSON 结构无效: {e}"))?;
        if script.version != 1 || script.steps.is_empty() {
            return Err("模型没有返回可用导览步骤".to_string());
        }
        Ok(script)
    })
    .await
    .map_err(|e| format!("导览生成任务失败: {e}"))?
}
