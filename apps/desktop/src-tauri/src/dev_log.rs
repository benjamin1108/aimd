#[cfg(debug_assertions)]
use chrono::Local;
#[cfg(debug_assertions)]
use serde_json::{json, Value};
#[cfg(debug_assertions)]
use std::fs::{self, OpenOptions};
#[cfg(debug_assertions)]
use std::io::Write;
#[cfg(debug_assertions)]
use std::path::PathBuf;

#[cfg(debug_assertions)]
pub fn init() {
    let dir = log_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        eprintln!("[dev-log] failed to create log dir {:?}: {err}", dir);
        return;
    }
    println!("[dev-log] writing development logs to {}", dir.display());
}

#[cfg(not(debug_assertions))]
pub fn init() {}

#[cfg(debug_assertions)]
pub fn llm<F>(event: &str, payload: F)
where
    F: FnOnce() -> Value,
{
    write_json_line("llm", event, payload());
}

#[cfg(debug_assertions)]
pub fn git_integration<F>(event: &str, payload: F)
where
    F: FnOnce() -> Value,
{
    write_json_line("git-integration", event, payload());
}

#[cfg(not(debug_assertions))]
pub fn llm<F>(_event: &str, _payload: F)
where
    F: FnOnce() -> serde_json::Value,
{
}

#[cfg(not(debug_assertions))]
pub fn git_integration<F>(_event: &str, _payload: F)
where
    F: FnOnce() -> serde_json::Value,
{
}

#[cfg(debug_assertions)]
fn write_json_line(category: &str, event: &str, payload: Value) {
    let dir = log_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        eprintln!("[dev-log] failed to create log dir {:?}: {err}", dir);
        return;
    }

    let path = dir.join(format!(
        "{}-{}.jsonl",
        category,
        Local::now().format("%Y%m%d")
    ));
    let line = json!({
        "ts": Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "pid": std::process::id(),
        "event": event,
        "payload": payload,
    });
    println!("[dev-log:{category}] {}", line);

    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(err) = writeln!(file, "{}", line) {
                eprintln!("[dev-log] failed to write {:?}: {err}", path);
            }
        }
        Err(err) => eprintln!("[dev-log] failed to open {:?}: {err}", path),
    }
}

#[cfg(debug_assertions)]
fn log_dir() -> PathBuf {
    PathBuf::from("/tmp/aimd-dev-logs")
}
