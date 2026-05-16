// 应用级设置持久化。

use crate::menu;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

const SETTINGS_FILE: &str = "settings.json";
pub const MODEL_TIMEOUT_SECONDS_MIN: u64 = 5;
pub const MODEL_TIMEOUT_SECONDS_MAX: u64 = 600;
pub const MODEL_RETRY_COUNT_MIN: u32 = 0;
pub const MODEL_RETRY_COUNT_MAX: u32 = 5;

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;

fn default_provider() -> String {
    "dashscope".to_string()
}

fn default_web_clip_output_language() -> String {
    "zh-CN".to_string()
}

fn default_format_output_language() -> String {
    "zh-CN".to_string()
}

fn default_web_clip_model_timeout_seconds() -> u64 {
    300
}

fn default_format_model_timeout_seconds() -> u64 {
    300
}

fn default_model_retry_count() -> u32 {
    2
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
    #[serde(default = "default_web_clip_model_timeout_seconds")]
    pub model_timeout_seconds: u64,
    #[serde(default = "default_model_retry_count")]
    pub model_retry_count: u32,
}

impl Default for WebClipSettings {
    fn default() -> Self {
        Self {
            llm_enabled: false,
            provider: default_provider(),
            model: default_dashscope_model(),
            output_language: default_web_clip_output_language(),
            model_timeout_seconds: default_web_clip_model_timeout_seconds(),
            model_retry_count: default_model_retry_count(),
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
    #[serde(default = "default_format_model_timeout_seconds")]
    pub model_timeout_seconds: u64,
    #[serde(default = "default_model_retry_count")]
    pub model_retry_count: u32,
}

impl Default for FormatSettings {
    fn default() -> Self {
        Self {
            provider: default_provider(),
            model: default_dashscope_model(),
            output_language: default_format_output_language(),
            model_timeout_seconds: default_format_model_timeout_seconds(),
            model_retry_count: default_model_retry_count(),
        }
    }
}

fn default_false() -> bool {
    false
}

fn default_theme() -> String {
    "system".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    #[serde(default)]
    pub show_asset_panel: bool,
    #[serde(default = "default_false")]
    pub debug_mode: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            show_asset_panel: false,
            debug_mode: false,
            theme: default_theme(),
        }
    }
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

pub fn normalize_model_timeout_seconds(value: u64, fallback: u64) -> u64 {
    let fallback = fallback.clamp(MODEL_TIMEOUT_SECONDS_MIN, MODEL_TIMEOUT_SECONDS_MAX);
    if value == 0 {
        fallback
    } else {
        value.clamp(MODEL_TIMEOUT_SECONDS_MIN, MODEL_TIMEOUT_SECONDS_MAX)
    }
}

pub fn normalize_model_retry_count(value: u32) -> u32 {
    value.clamp(MODEL_RETRY_COUNT_MIN, MODEL_RETRY_COUNT_MAX)
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
    settings.web_clip.model_timeout_seconds = normalize_model_timeout_seconds(
        settings.web_clip.model_timeout_seconds,
        default_web_clip_model_timeout_seconds(),
    );
    settings.web_clip.model_retry_count =
        normalize_model_retry_count(settings.web_clip.model_retry_count);
    if settings.format.provider != "dashscope" && settings.format.provider != "gemini" {
        settings.format.provider = default_provider();
    }
    if settings.format.model.trim().is_empty() {
        settings.format.model = default_model_for_provider(&settings.format.provider);
    }
    if settings.format.output_language != "en" {
        settings.format.output_language = default_format_output_language();
    }
    settings.format.model_timeout_seconds = normalize_model_timeout_seconds(
        settings.format.model_timeout_seconds,
        default_format_model_timeout_seconds(),
    );
    settings.format.model_retry_count =
        normalize_model_retry_count(settings.format.model_retry_count);
    if !matches!(
        settings.ui.theme.as_str(),
        "system" | "light" | "dark" | "high-contrast"
    ) {
        settings.ui.theme = default_theme();
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
