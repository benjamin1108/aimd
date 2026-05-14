use crate::dev_log;
use chrono::Utc;
use serde_json::json;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);
static GIT_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();
const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) fn new_request_id(action: &str) -> String {
    let seq = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("git-{}-{}-{}", action, std::process::id(), seq)
}

pub(super) fn run_git(cwd: Option<&Path>, args: &[&str]) -> Result<Output, String> {
    let git = git_executable();
    let mut child = Command::new(&git);
    child
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut child);
    if let Some(cwd) = cwd {
        child.current_dir(cwd);
    }
    let mut child = child.spawn().map_err(|e| format!("启动 git 失败: {e}"))?;
    let start = Instant::now();
    loop {
        match child
            .try_wait()
            .map_err(|e| format!("等待 git 失败: {e}"))?
        {
            Some(_) => {
                return child
                    .wait_with_output()
                    .map_err(|e| format!("读取 git 输出失败: {e}"))
            }
            None if start.elapsed() > GIT_COMMAND_TIMEOUT => {
                let _ = child.kill();
                return Err("git 命令超时".to_string());
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

pub(super) fn run_git_logged(
    request_id: &str,
    scope: &str,
    cwd: Option<&Path>,
    args: &[&str],
) -> Result<Output, String> {
    let started = Instant::now();
    let command: Vec<String> = std::iter::once(git_executable().to_string_lossy().to_string())
        .chain(args.iter().map(|arg| (*arg).to_string()))
        .collect();
    let result = run_git(cwd, args);
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let cwd_display = cwd.map(|p| p.to_string_lossy().to_string());
    match &result {
        Ok(out) => {
            log_event(
                request_id,
                "git-command",
                scope,
                cwd_display.as_deref(),
                Some(command),
                Some(out),
                Some(elapsed_ms),
                if out.status.success() { "ok" } else { "failed" },
                "git command finished",
            );
        }
        Err(err) => log_event(
            request_id,
            "git-command",
            scope,
            cwd_display.as_deref(),
            Some(command),
            None,
            Some(elapsed_ms),
            "failed",
            err,
        ),
    }
    result
}

pub(super) fn stderr_or_stdout(out: &Output) -> String {
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if stderr.is_empty() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        stderr
    }
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

fn git_executable() -> PathBuf {
    GIT_EXECUTABLE.get_or_init(resolve_git_executable).clone()
}

#[cfg(windows)]
fn resolve_git_executable() -> PathBuf {
    for key in ["AIMD_GIT_PATH", "GIT_EXE"] {
        if let Some(path) = std::env::var_os(key).map(PathBuf::from) {
            if path.is_file() {
                return path;
            }
        }
    }

    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(key).map(PathBuf::from) {
            for relative in [r"Git\cmd\git.exe", r"Git\bin\git.exe"] {
                let candidate = root.join(relative);
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }

    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in ["git.exe", "git.cmd", "git.bat"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }

    PathBuf::from("git")
}

#[cfg(not(windows))]
fn resolve_git_executable() -> PathBuf {
    PathBuf::from("git")
}

pub(super) fn log_event(
    request_id: &str,
    action: &str,
    scope: &str,
    repo_path: Option<&str>,
    command: Option<Vec<String>>,
    output: Option<&Output>,
    elapsed_ms: Option<u64>,
    result: &str,
    message: &str,
) {
    let exit_code = output.and_then(|out| out.status.code());
    let stdout_tail = output
        .map(|out| tail(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default();
    let stderr_tail = output
        .map(|out| tail(&String::from_utf8_lossy(&out.stderr)))
        .unwrap_or_default();
    dev_log::git_integration(action, || {
        json!({
            "requestId": request_id,
            "action": action,
            "scope": scope,
            "repoPath": repo_path,
            "command": command,
            "startedAt": Utc::now().to_rfc3339(),
            "elapsedMs": elapsed_ms,
            "exitCode": exit_code,
            "stdoutTail": stdout_tail,
            "stderrTail": stderr_tail,
            "result": result,
            "message": message,
        })
    });
}

fn tail(value: &str) -> String {
    const MAX: usize = 500;
    let trimmed = value.trim();
    if trimmed.len() <= MAX {
        trimmed.to_string()
    } else {
        trimmed[trimmed.len() - MAX..].to_string()
    }
}
