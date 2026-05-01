// 应用级设置（导览模型 + 偏好）持久化。
//
// 之前 docu-tour 配置只存在每个 WebView 的 localStorage 里：设置窗写完，主窗口
// 读不到，导致用户切换选项后"记不住"。这里把它统一到 Tauri 的 app config dir，
// 主窗口和设置窗口都通过 invoke load_settings / save_settings 读写同一份 JSON。
//
// 存储模型 v2：apiKey / apiBase / model 改成 per-provider，避免切 provider 时
// 串台。老格式（顶层 provider/apiKey/apiBase/model）在 load_settings 里就地迁移。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";

fn default_provider() -> String {
    "dashscope".to_string()
}

fn default_max_steps() -> u32 {
    6
}

fn default_language() -> String {
    "zh-CN".to_string()
}

fn default_dashscope_model() -> String {
    "qwen3.6-plus".to_string()
}

fn default_gemini_model() -> String {
    "gemini-3.1-flash-lite-preview".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialSettings {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_base: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersBag {
    #[serde(default = "default_dashscope_cred")]
    pub dashscope: ProviderCredentialSettings,
    #[serde(default = "default_gemini_cred")]
    pub gemini: ProviderCredentialSettings,
}

fn default_dashscope_cred() -> ProviderCredentialSettings {
    ProviderCredentialSettings {
        model: default_dashscope_model(),
        api_key: String::new(),
        api_base: String::new(),
    }
}

fn default_gemini_cred() -> ProviderCredentialSettings {
    ProviderCredentialSettings {
        model: default_gemini_model(),
        api_key: String::new(),
        api_base: String::new(),
    }
}

impl Default for ProvidersBag {
    fn default() -> Self {
        Self {
            dashscope: default_dashscope_cred(),
            gemini: default_gemini_cred(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocuTourSettings {
    #[serde(default = "default_provider")]
    pub active_provider: String,
    #[serde(default)]
    pub providers: ProvidersBag,
    #[serde(default = "default_max_steps")]
    pub max_steps: u32,
    #[serde(default = "default_language")]
    pub language: String,
}

impl Default for DocuTourSettings {
    fn default() -> Self {
        Self {
            active_provider: default_provider(),
            providers: ProvidersBag::default(),
            max_steps: default_max_steps(),
            language: default_language(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub docutour: DocuTourSettings,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("config dir 不可用: {err}"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|err| format!("创建 config dir 失败: {err}"))?;
    }
    Ok(dir.join(SETTINGS_FILE))
}

/// 老格式 → 新格式迁移：如果 docutour 里同时有 apiKey/provider/model 这种顶层字段
/// 而没有 providers 字段，就把它们搬进 providers[provider] 那一格。仅在内存中迁移；
/// 写回磁盘由 save_settings 完成。
fn migrate_legacy_inplace(value: &mut Value) {
    let Some(root) = value.as_object_mut() else {
        return;
    };
    let Some(docutour) = root.get_mut("docutour").and_then(|v| v.as_object_mut()) else {
        return;
    };

    let already_new = docutour.contains_key("providers");
    let has_legacy = docutour.contains_key("apiKey")
        || docutour.contains_key("provider")
        || docutour.contains_key("apiBase")
        || docutour.contains_key("model");
    if already_new || !has_legacy {
        return;
    }

    let provider_str = docutour
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("dashscope");
    let provider = if provider_str == "gemini" {
        "gemini"
    } else {
        "dashscope"
    };

    let model = docutour
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let api_key = docutour
        .get("apiKey")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let api_base = docutour
        .get("apiBase")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let mut moved_cred = serde_json::Map::new();
    moved_cred.insert(
        "model".into(),
        Value::String(if model.is_empty() {
            if provider == "gemini" {
                default_gemini_model()
            } else {
                default_dashscope_model()
            }
        } else {
            model
        }),
    );
    moved_cred.insert("apiKey".into(), Value::String(api_key));
    moved_cred.insert("apiBase".into(), Value::String(api_base));

    let mut dashscope = serde_json::Map::new();
    dashscope.insert("model".into(), Value::String(default_dashscope_model()));
    dashscope.insert("apiKey".into(), Value::String(String::new()));
    dashscope.insert("apiBase".into(), Value::String(String::new()));
    let mut gemini = serde_json::Map::new();
    gemini.insert("model".into(), Value::String(default_gemini_model()));
    gemini.insert("apiKey".into(), Value::String(String::new()));
    gemini.insert("apiBase".into(), Value::String(String::new()));

    if provider == "gemini" {
        gemini = moved_cred;
    } else {
        dashscope = moved_cred;
    }

    let mut providers = serde_json::Map::new();
    providers.insert("dashscope".into(), Value::Object(dashscope));
    providers.insert("gemini".into(), Value::Object(gemini));

    docutour.remove("apiKey");
    docutour.remove("apiBase");
    docutour.remove("model");
    docutour.remove("provider");
    docutour.insert("activeProvider".into(), Value::String(provider.to_string()));
    docutour.insert("providers".into(), Value::Object(providers));
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let bytes = fs::read(&path).map_err(|err| format!("读取设置失败: {err}"))?;
    let mut value: Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::Object(Default::default()));
    if !value.is_object() {
        value = Value::Object(Default::default());
    }
    migrate_legacy_inplace(&mut value);
    let settings: AppSettings = serde_json::from_value(value).unwrap_or_default();
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let mut normalized = settings;
    // 防御性 clamp，避免前端把 maxSteps 写成 0 或离谱值
    if normalized.docutour.max_steps < 3 {
        normalized.docutour.max_steps = 3;
    }
    if normalized.docutour.max_steps > 12 {
        normalized.docutour.max_steps = 12;
    }
    if normalized.docutour.language.trim().is_empty() {
        normalized.docutour.language = "zh-CN".to_string();
    }
    if normalized.docutour.active_provider != "dashscope"
        && normalized.docutour.active_provider != "gemini"
    {
        normalized.docutour.active_provider = "dashscope".to_string();
    }
    let body =
        serde_json::to_vec_pretty(&normalized).map_err(|err| format!("序列化设置失败: {err}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &body).map_err(|err| format!("写入设置失败: {err}"))?;
    fs::rename(&tmp, &path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        format!("保存设置失败: {err}")
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_legacy_dashscope_to_per_provider() {
        let mut v = serde_json::json!({
            "docutour": {
                "provider": "dashscope",
                "model": "qwen3.6-plus",
                "apiKey": "sk-legacy-dashscope",
                "apiBase": "",
                "maxSteps": 6,
                "language": "zh-CN"
            }
        });
        migrate_legacy_inplace(&mut v);
        let dt = v.get("docutour").unwrap().as_object().unwrap();
        assert_eq!(dt.get("activeProvider").unwrap(), "dashscope");
        assert!(dt.get("provider").is_none());
        assert!(dt.get("apiKey").is_none());
        let providers = dt.get("providers").unwrap().as_object().unwrap();
        assert_eq!(
            providers.get("dashscope").unwrap().get("apiKey").unwrap(),
            "sk-legacy-dashscope"
        );
        // gemini 那格应当为空，而不是继承 dashscope 的 key
        assert_eq!(providers.get("gemini").unwrap().get("apiKey").unwrap(), "");
    }

    #[test]
    fn migrate_legacy_gemini_to_per_provider() {
        let mut v = serde_json::json!({
            "docutour": {
                "provider": "gemini",
                "apiKey": "g-legacy",
                "model": "gemini-3-pro-preview"
            }
        });
        migrate_legacy_inplace(&mut v);
        let providers = v
            .pointer("/docutour/providers")
            .and_then(|v| v.as_object())
            .unwrap();
        assert_eq!(
            providers.get("gemini").unwrap().get("apiKey").unwrap(),
            "g-legacy"
        );
        assert_eq!(
            providers.get("dashscope").unwrap().get("apiKey").unwrap(),
            ""
        );
    }

    #[test]
    fn migrate_no_op_when_already_new_shape() {
        let mut v = serde_json::json!({
            "docutour": {
                "activeProvider": "gemini",
                "providers": {
                    "dashscope": { "model": "x", "apiKey": "kA", "apiBase": "" },
                    "gemini": { "model": "y", "apiKey": "kB", "apiBase": "" }
                },
                "maxSteps": 6,
                "language": "zh-CN"
            }
        });
        let before = v.clone();
        migrate_legacy_inplace(&mut v);
        assert_eq!(before, v);
    }
}
