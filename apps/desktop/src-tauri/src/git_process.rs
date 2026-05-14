use std::io;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static GIT_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn run_git(root: &Path, args: &[&str], timeout: Duration) -> Result<Output, String> {
    let git = git_executable();
    let mut command = Command::new(&git);
    command
        .args(args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            "未找到 git 命令".to_string()
        } else {
            format!("启动 git 失败: {e}")
        }
    })?;
    let start = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|e| format!("等待 git 失败: {e}"))?
            .is_some()
        {
            return child
                .wait_with_output()
                .map_err(|e| format!("读取 git 输出失败: {e}"));
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("git 命令超时".to_string());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

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

#[cfg(windows)]
fn hide_window(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}
