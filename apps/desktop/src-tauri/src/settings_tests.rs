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
    assert_eq!(settings.ui.theme, "system");
    assert_eq!(settings.web_clip.model, default_dashscope_model());
    assert_eq!(settings.web_clip.model_timeout_seconds, 300);
    assert_eq!(settings.web_clip.model_retry_count, 2);
    assert_eq!(settings.format.provider, "dashscope");
    assert_eq!(settings.format.model, default_dashscope_model());
    assert_eq!(settings.format.output_language, "zh-CN");
    assert_eq!(settings.format.model_timeout_seconds, 300);
    assert_eq!(settings.format.model_retry_count, 2);
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
            "outputLanguage": "en",
            "modelTimeoutSeconds": 120,
            "modelRetryCount": 3
        }
    }))
    .unwrap();
    normalize_app_settings(&mut settings);

    assert!(settings.web_clip.llm_enabled);
    assert_eq!(settings.web_clip.provider, "gemini");
    assert_eq!(settings.web_clip.model, "gemini-webclip-custom");
    assert_eq!(settings.web_clip.output_language, "en");
    assert_eq!(settings.web_clip.model_timeout_seconds, 120);
    assert_eq!(settings.web_clip.model_retry_count, 3);

    let value = serde_json::to_value(&settings).unwrap();
    assert_eq!(value["webClip"]["model"], "gemini-webclip-custom");
    assert_eq!(value["webClip"]["modelTimeoutSeconds"], 120);
    assert_eq!(value["webClip"]["modelRetryCount"], 3);
}

#[test]
fn model_generation_controls_are_clamped() {
    let mut settings: AppSettings = serde_json::from_value(serde_json::json!({
        "webClip": {
            "modelTimeoutSeconds": 1,
            "modelRetryCount": 99
        },
        "format": {
            "modelTimeoutSeconds": 9999,
            "modelRetryCount": 99
        }
    }))
    .unwrap();
    normalize_app_settings(&mut settings);

    assert_eq!(
        settings.web_clip.model_timeout_seconds,
        MODEL_TIMEOUT_SECONDS_MIN
    );
    assert_eq!(settings.web_clip.model_retry_count, MODEL_RETRY_COUNT_MAX);
    assert_eq!(
        settings.format.model_timeout_seconds,
        MODEL_TIMEOUT_SECONDS_MAX
    );
    assert_eq!(settings.format.model_retry_count, MODEL_RETRY_COUNT_MAX);
}

#[test]
fn ui_debug_mode_round_trips() {
    let settings: AppSettings = serde_json::from_value(serde_json::json!({
        "ui": {
            "showAssetPanel": true,
            "debugMode": true,
            "theme": "dark"
        }
    }))
    .unwrap();
    assert!(settings.ui.show_asset_panel);
    assert!(settings.ui.debug_mode);
    assert_eq!(settings.ui.theme, "dark");
}

#[test]
fn ui_theme_invalid_defaults_to_system() {
    let mut settings: AppSettings = serde_json::from_value(serde_json::json!({
        "ui": {
            "theme": "solarized"
        }
    }))
    .unwrap();
    normalize_app_settings(&mut settings);
    assert_eq!(settings.ui.theme, "system");
}
