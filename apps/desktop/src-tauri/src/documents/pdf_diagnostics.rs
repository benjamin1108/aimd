use chrono::Utc;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub(super) fn trace_id() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{:x}", d.as_millis()))
        .unwrap_or_else(|_| "unknown".to_string())
}

pub(super) fn emit(
    app: &AppHandle,
    trace_id: &str,
    start: Instant,
    level: &str,
    message: impl AsRef<str>,
) {
    let message = message.as_ref().to_string();
    log(trace_id, start, &message);
    let _ = app.emit(
        "aimd-pdf-log",
        serde_json::json!({
            "traceId": trace_id,
            "elapsedMs": start.elapsed().as_millis(),
            "level": level,
            "message": message,
        }),
    );
}

pub(super) fn human_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    let bytes_f = bytes as f64;
    if bytes_f >= GB {
        format!("{:.1}GB", bytes_f / GB)
    } else if bytes_f >= MB {
        format!("{:.1}MB", bytes_f / MB)
    } else if bytes_f >= KB {
        format!("{:.1}KB", bytes_f / KB)
    } else {
        format!("{bytes}B")
    }
}

pub(super) fn html_summary(html: &[u8]) -> String {
    let text = String::from_utf8_lossy(html);
    format!(
        "html_bytes={} html_lines={} max_line_chars={} h1={} h2={} img={} table={} pre={} max_pre_chars={} code={} link={} page_css={} fixed_css={}",
        html.len(),
        text.lines().count(),
        text.lines().map(|line| line.chars().count()).max().unwrap_or(0),
        text.matches("<h1").count(),
        text.matches("<h2").count(),
        text.matches("<img").count(),
        text.matches("<table").count(),
        text.matches("<pre").count(),
        max_tag_inner_chars(&text, "<pre", "</pre>"),
        text.matches("<code").count(),
        text.matches("<a ").count(),
        text.matches("@page").count(),
        text.matches("position:fixed").count()
    )
}

pub(super) fn write_html_snapshot(trace_id: &str, html: &[u8]) -> Option<PathBuf> {
    let dir = PathBuf::from("/tmp/aimd-dev-logs");
    fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("pdf-{trace_id}.html"));
    fs::write(&path, html).ok()?;
    Some(path)
}

pub(super) fn format_command_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| format!("{:?}", arg))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn compact_command_output(stdout: &[u8], stderr: &[u8]) -> String {
    let mut text = String::new();
    let out = String::from_utf8_lossy(stdout);
    let err = String::from_utf8_lossy(stderr);
    if !out.trim().is_empty() {
        text.push_str(out.trim());
    }
    if !err.trim().is_empty() {
        if !text.is_empty() {
            text.push_str(" | ");
        }
        text.push_str(err.trim());
    }
    if text.chars().count() <= 800 {
        return text;
    }
    text.chars().take(800).collect::<String>() + "..."
}

fn log(trace_id: &str, start: Instant, message: impl AsRef<str>) {
    let message = message.as_ref();
    let elapsed_ms = start.elapsed().as_millis();
    eprintln!("[aimd:pdf:{trace_id} +{}ms] {}", elapsed_ms, message);
    write_log_line(trace_id, elapsed_ms, message);
}

fn write_log_line(trace_id: &str, elapsed_ms: u128, message: &str) {
    let dir = PathBuf::from("/tmp/aimd-dev-logs");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(format!("pdf-{}.jsonl", Utc::now().format("%Y%m%d")));
    let line = serde_json::json!({
        "ts": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "pid": std::process::id(),
        "traceId": trace_id,
        "elapsedMs": elapsed_ms,
        "message": message,
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", line);
    }
}

fn max_tag_inner_chars(text: &str, open: &str, close: &str) -> usize {
    let mut max_len = 0;
    let mut remaining = text;
    while let Some(open_idx) = remaining.find(open) {
        let after_open = &remaining[open_idx..];
        let Some(open_end) = after_open.find('>') else {
            break;
        };
        let body = &after_open[open_end + 1..];
        let Some(close_idx) = body.find(close) else {
            break;
        };
        max_len = max_len.max(body[..close_idx].chars().count());
        remaining = &body[close_idx + close.len()..];
    }
    max_len
}
