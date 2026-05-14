// 应用级设置持久化。

use crate::menu;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

const SETTINGS_FILE: &str = "settings.json";

fn default_provider() -> String {
    "dashscope".to_string()
}

fn default_web_clip_output_language() -> String {
    "zh-CN".to_string()
}

fn default_format_output_language() -> String {
    "zh-CN".to_string()
}

fn default_dashscope_model() -> String {
    "qwen3.6-plus".to_string()
}

fn default_gemini_model() -> String {
    "gemini-3.1-flash-lite-preview".to_string()
}

pub fn default_model_for_provider(provider: &str) -> String {
    if provider == "gemini" {
        default_gemini_model()
    } else {
        default_dashscope_model()
    }
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
pub struct AiSettings {
    #[serde(default = "default_provider")]
    pub active_provider: String,
    #[serde(default)]
    pub providers: ProvidersBag,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            active_provider: default_provider(),
            providers: ProvidersBag::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebClipSettings {
    #[serde(default)]
    pub llm_enabled: bool,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_web_clip_output_language")]
    pub output_language: String,
}

impl Default for WebClipSettings {
    fn default() -> Self {
        Self {
            llm_enabled: false,
            provider: default_provider(),
            model: default_dashscope_model(),
            output_language: default_web_clip_output_language(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatSettings {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_dashscope_model")]
    pub model: String,
    #[serde(default = "default_format_output_language")]
    pub output_language: String,
}

impl Default for FormatSettings {
    fn default() -> Self {
        Self {
            provider: default_provider(),
            model: default_dashscope_model(),
            output_language: default_format_output_language(),
        }
    }
}

fn default_false() -> bool {
    false
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    #[serde(default)]
    pub show_asset_panel: bool,
    #[serde(default = "default_false")]
    pub debug_mode: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub ai: AiSettings,
    #[serde(default)]
    pub web_clip: WebClipSettings,
    #[serde(default)]
    pub format: FormatSettings,
    #[serde(default)]
    pub ui: UiSettings,
}

fn provider_cred_model(settings: &AppSettings, provider: &str) -> String {
    let model = if provider == "gemini" {
        settings.ai.providers.gemini.model.trim()
    } else {
        settings.ai.providers.dashscope.model.trim()
    };
    if model.is_empty() {
        default_model_for_provider(provider)
    } else {
        model.to_string()
    }
}

fn normalize_app_settings(settings: &mut AppSettings) {
    if settings.ai.active_provider != "dashscope" && settings.ai.active_provider != "gemini" {
        settings.ai.active_provider = default_provider();
    }
    if settings.ai.providers.dashscope.model.trim().is_empty() {
        settings.ai.providers.dashscope.model = default_dashscope_model();
    }
    if settings.ai.providers.gemini.model.trim().is_empty() {
        settings.ai.providers.gemini.model = default_gemini_model();
    }
    if settings.web_clip.provider != "dashscope" && settings.web_clip.provider != "gemini" {
        settings.web_clip.provider = default_provider();
    }
    if settings.web_clip.model.trim().is_empty() {
        settings.web_clip.model = provider_cred_model(settings, &settings.web_clip.provider);
    }
    if settings.web_clip.output_language != "en" {
        settings.web_clip.output_language = default_web_clip_output_language();
    }
    if settings.format.provider != "dashscope" && settings.format.provider != "gemini" {
        settings.format.provider = default_provider();
    }
    if settings.format.model.trim().is_empty() {
        settings.format.model = default_model_for_provider(&settings.format.provider);
    }
    if settings.format.output_language != "en" {
        settings.format.output_language = default_format_output_language();
    }
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

/// 老格式 (docutour) -> 新格式 (ai) 迁移
fn migrate_legacy_inplace(value: &mut Value) {
    let Some(root) = value.as_object_mut() else {
        return;
    };

    // 如果存在 docutour，把内容迁移到 ai 并删除 docutour
    if root.contains_key("docutour") {
        if let Some(docutour) = root.remove("docutour") {
            if !root.contains_key("ai") {
                root.insert("ai".into(), docutour);
            }
        }
    }

    let Some(ai) = root.get_mut("ai").and_then(|v| v.as_object_mut()) else {
        return;
    };

    let already_new = ai.contains_key("providers");
    let has_legacy = ai.contains_key("apiKey")
        || ai.contains_key("provider")
        || ai.contains_key("apiBase")
        || ai.contains_key("model");
    if already_new && !has_legacy {
        return;
    }

    let provider_str = ai
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("dashscope");
    let provider = if provider_str == "gemini" {
        "gemini"
    } else {
        "dashscope"
    };

    let model = ai
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let api_key = ai
        .get("apiKey")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let api_base = ai
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

    ai.remove("apiKey");
    ai.remove("apiBase");
    ai.remove("model");
    ai.remove("provider");
    ai.remove("maxSteps"); // 清理残留
    ai.remove("language"); // 清理残留

    // 只有在没设置 activeProvider 时才覆盖
    if !ai.contains_key("activeProvider") {
        ai.insert("activeProvider".into(), Value::String(provider.to_string()));
    }

    // 如果没有 providers 节点则写入
    if !ai.contains_key("providers") {
        ai.insert("providers".into(), Value::Object(providers));
    }
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let bytes = fs::read(&path).map_err(|err| format!("读取设置失败: {err}"))?;
    let mut value: Value =
        serde_json::from_slice(&bytes).map_err(|err| format!("设置文件格式无效: {err}"))?;
    if !value.is_object() {
        value = Value::Object(Default::default());
    }
    migrate_legacy_inplace(&mut value);
    let mut settings: AppSettings = serde_json::from_value(value).unwrap_or_default();
    normalize_app_settings(&mut settings);
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let mut normalized = settings;
    normalize_app_settings(&mut normalized);
    let body =
        serde_json::to_vec_pretty(&normalized).map_err(|err| format!("序列化设置失败: {err}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &body).map_err(|err| format!("写入设置失败: {err}"))?;
    fs::rename(&tmp, &path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        format!("保存设置失败: {err}")
    })?;
    menu::set_debug_menu_enabled(&app, normalized.ui.debug_mode);
    let _ = app.emit("aimd-settings-updated", &normalized);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_legacy_docutour_to_ai() {
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
        assert!(v.get("docutour").is_none());
        let ai = v.get("ai").unwrap().as_object().unwrap();
        assert_eq!(ai.get("activeProvider").unwrap(), "dashscope");
        assert!(ai.get("provider").is_none());
        assert!(ai.get("apiKey").is_none());
        assert!(ai.get("maxSteps").is_none());
        let providers = ai.get("providers").unwrap().as_object().unwrap();
        assert_eq!(
            providers.get("dashscope").unwrap().get("apiKey").unwrap(),
            "sk-legacy-dashscope"
        );
        assert_eq!(providers.get("gemini").unwrap().get("apiKey").unwrap(), "");
    }

    #[test]
    fn missing_ui_defaults_to_quiet_ui() {
        let mut settings: AppSettings = serde_json::from_value(serde_json::json!({
            "ai": {
                "activeProvider": "dashscope",
                "providers": {}
            },
            "webClip": {}
        }))
        .unwrap();
        normalize_app_settings(&mut settings);
        assert!(!settings.ui.show_asset_panel);
        assert!(!settings.ui.debug_mode);
        assert_eq!(settings.web_clip.model, default_dashscope_model());
        assert_eq!(settings.format.provider, "dashscope");
        assert_eq!(settings.format.model, default_dashscope_model());
        assert_eq!(settings.format.output_language, "zh-CN");
    }

    #[test]
    fn missing_web_clip_model_defaults_to_provider_global_model() {
        let mut settings: AppSettings = serde_json::from_value(serde_json::json!({
            "ai": {
                "activeProvider": "dashscope",
                "providers": {
                    "dashscope": {
                        "model": "qwen-global-custom",
                        "apiKey": "sk",
                        "apiBase": ""
                    }
                }
            },
            "webClip": {
                "llmEnabled": true,
                "provider": "dashscope",
                "outputLanguage": "zh-CN"
            }
        }))
        .unwrap();
        normalize_app_settings(&mut settings);

        assert_eq!(settings.web_clip.model, "qwen-global-custom");
    }

    #[test]
    fn web_clip_model_deserializes_and_round_trips() {
        let mut settings: AppSettings = serde_json::from_value(serde_json::json!({
            "webClip": {
                "llmEnabled": true,
                "provider": "gemini",
                "model": "gemini-webclip-custom",
                "outputLanguage": "en"
            }
        }))
        .unwrap();
        normalize_app_settings(&mut settings);

        assert!(settings.web_clip.llm_enabled);
        assert_eq!(settings.web_clip.provider, "gemini");
        assert_eq!(settings.web_clip.model, "gemini-webclip-custom");
        assert_eq!(settings.web_clip.output_language, "en");

        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value["webClip"]["model"], "gemini-webclip-custom");
    }

    #[test]
    fn ui_debug_mode_round_trips() {
        let settings: AppSettings = serde_json::from_value(serde_json::json!({
            "ui": {
                "showAssetPanel": true,
                "debugMode": true
            }
        }))
        .unwrap();
        assert!(settings.ui.show_asset_panel);
        assert!(settings.ui.debug_mode);
    }
}
