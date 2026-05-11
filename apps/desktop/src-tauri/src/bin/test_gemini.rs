use serde_json::json;
use std::{env, fs, path::PathBuf, time::Instant};

const DEFAULT_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL: &str = "gemini-3.1-flash-lite-preview";

fn load_env_local() -> bool {
    let Ok(cwd) = env::current_dir() else {
        return false;
    };
    let candidates = [
        cwd.join("../.env.local"),
        cwd.join(".env.local"),
        cwd.join("../../.env.local"),
    ];
    let Some(path) = candidates.iter().find(|path| path.exists()) else {
        return false;
    };
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        if env::var_os(key.trim()).is_some() {
            continue;
        }
        let mut value = value.trim().to_string();
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len().saturating_sub(1)].to_string();
        }
        env::set_var(key.trim(), value);
    }
    true
}

fn arg_value(name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    env::args()
        .skip(1)
        .find_map(|arg| arg.strip_prefix(&prefix).map(str::to_string))
}

fn redact(value: &str) -> String {
    if value.len() <= 10 {
        return format!("{}...", &value[..value.len().min(2)]);
    }
    format!("{}...{}", &value[..6], &value[value.len() - 4..])
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

fn read_prompt() -> Result<String, String> {
    if let Some(path) = arg_value("--from-file") {
        let path = PathBuf::from(path);
        return fs::read_to_string(&path)
            .map_err(|err| format!("读取 prompt 文件失败 {:?}: {err}", path));
    }
    Ok(arg_value("--prompt")
        .or_else(|| env::var("GEMINI_PROMPT").ok())
        .unwrap_or_else(|| {
            "请只回复一个 JSON 对象：{\"ok\":true,\"message\":\"pong\"}".to_string()
        }))
}

#[tokio::main]
async fn main() {
    let loaded_env = load_env_local();
    let api_key = env::var("GEMINI_API_KEY")
        .or_else(|_| env::var("GOOGLE_API_KEY"))
        .unwrap_or_default();
    if api_key.trim().is_empty() {
        eprintln!("Missing GEMINI_API_KEY. Put it in apps/desktop/.env.local or export it.");
        std::process::exit(2);
    }

    let model = arg_value("--model")
        .or_else(|| env::var("GEMINI_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let base = arg_value("--base")
        .or_else(|| env::var("GEMINI_API_BASE").ok())
        .unwrap_or_else(|| DEFAULT_BASE.to_string())
        .trim_end_matches('/')
        .to_string();
    let prompt = match read_prompt() {
        Ok(prompt) => prompt,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(2);
        }
    };
    let repeat = arg_value("--repeat")
        .or_else(|| env::var("GEMINI_REPEAT").ok())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let url = format!(
        "{base}/models/{model}:generateContent?key={}",
        api_key.trim()
    );
    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.1
        }
    });
    let body_bytes = match serde_json::to_vec(&body) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("Serialize request failed: {err}");
            std::process::exit(2);
        }
    };

    println!("Gemini Rust reqwest smoke test");
    println!(
        "Loaded .env.local: {}",
        if loaded_env { "yes" } else { "no" }
    );
    println!(
        "URL: {base}/models/{model}:generateContent?key={}",
        redact(api_key.trim())
    );
    println!("Repeat: {repeat}");
    println!("Prompt chars: {}", prompt.chars().count());
    println!("Body bytes: {}", body_bytes.len());

    let client = reqwest::Client::new();
    let mut failures = 0usize;
    for i in 1..=repeat {
        let started = Instant::now();
        println!("--- request {i}/{repeat} ---");
        let response = match client
            .post(&url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body_bytes.clone())
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                failures += 1;
                eprintln!("Request failed after {}ms", started.elapsed().as_millis());
                eprintln!("{}", format_reqwest_error(&err));
                continue;
            }
        };

        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        println!("HTTP: {status}");
        println!("Elapsed: {}ms", started.elapsed().as_millis());
        if !status.is_success() {
            failures += 1;
            eprintln!("Body preview:");
            eprintln!("{}", &text[..text.len().min(1200)]);
            continue;
        }
        println!("Body preview:");
        println!("{}", &text[..text.len().min(1200)]);
    }

    if failures > 0 {
        eprintln!("{failures}/{repeat} request(s) failed");
        std::process::exit(1);
    }
}
