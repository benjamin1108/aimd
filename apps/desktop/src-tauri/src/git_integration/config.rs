use std::{
    fs,
    path::{Path, PathBuf},
};

use super::support::{run_git, run_git_logged, stderr_or_stdout};
use super::{
    BARE_DIFF_TEXTCONV, BARE_MERGE_DRIVER, GITATTRIBUTES_LINE, MERGE_NAME, STABLE_CLI_PATH,
    STABLE_DIFF_TEXTCONV, STABLE_MERGE_DRIVER,
};

#[derive(Debug, Clone)]
pub(super) struct DriverCommands {
    pub source: String,
    pub textconv: String,
    pub merge_driver: String,
}

#[derive(Debug)]
pub(super) struct WriteConfigReport {
    pub details: Vec<String>,
}

pub(super) fn write_global_config(
    enable: bool,
    request_id: &str,
) -> Result<WriteConfigReport, String> {
    write_config(None, "--global", enable, request_id)
}

pub(super) fn write_repo_config(
    repo: &Path,
    enable: bool,
    request_id: &str,
) -> Result<WriteConfigReport, String> {
    write_config(Some(repo), "--local", enable, request_id)
}

fn write_config(
    repo: Option<&Path>,
    scope: &str,
    enable: bool,
    request_id: &str,
) -> Result<WriteConfigReport, String> {
    let cli_path = find_in_path("aimd");
    let stable_cli_executable = is_executable(Path::new(STABLE_CLI_PATH));
    let commands = driver_commands(cli_path.is_some(), stable_cli_executable);
    let writes = [
        ("diff.aimd.textconv", Some(commands.textconv.as_str())),
        ("diff.aimd.cachetextconv", Some("false")),
        ("merge.aimd.name", Some(MERGE_NAME)),
        ("merge.aimd.driver", Some(commands.merge_driver.as_str())),
    ];
    let mut details = Vec::new();
    for (key, value) in writes {
        let args: Vec<&str> = if enable {
            vec!["config", scope, key, value.unwrap()]
        } else {
            vec!["config", scope, "--unset-all", key]
        };
        let out = run_git_logged(
            request_id,
            if repo.is_some() { "repo" } else { "global" },
            repo,
            &args,
        )?;
        if enable && !out.status.success() {
            return Err(format!("git config {key} 失败: {}", stderr_or_stdout(&out)));
        }
        if enable {
            details.push(format!("{key} = {}", value.unwrap()));
        } else if out.status.success() {
            details.push(format!("{key} 已删除"));
        } else {
            details.push(format!("{key} 原本不存在"));
        }
    }
    verify_config(repo, enable, &commands)?;
    Ok(WriteConfigReport { details })
}

pub(super) fn write_gitattributes_line(repo: &Path) -> Result<Vec<String>, String> {
    let path = repo.join(".gitattributes");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing
        .lines()
        .any(|line| line.trim() == GITATTRIBUTES_LINE)
    {
        return Ok(vec![
            ".gitattributes 已包含 *.aimd diff=aimd merge=aimd".to_string()
        ]);
    }
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(GITATTRIBUTES_LINE);
    next.push('\n');
    fs::write(&path, next).map_err(|e| format!("写入 .gitattributes 失败: {e}"))?;
    Ok(vec![
        ".gitattributes 已追加 *.aimd diff=aimd merge=aimd".to_string()
    ])
}

pub(super) fn ensure_repo(path: &str) -> Result<PathBuf, String> {
    canonical_repo_root(Path::new(path)).map_err(|_| "当前路径不是 Git 仓库".to_string())
}

pub(super) fn canonical_repo_root(path: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let out = run_git(Some(&root), &["rev-parse", "--show-toplevel"])?;
    if !out.status.success() {
        return Err(stderr_or_stdout(&out));
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        Err("empty git root".to_string())
    } else {
        Ok(PathBuf::from(s))
    }
}

pub(super) fn driver_configured(repo: Option<&Path>, commands: &DriverCommands) -> bool {
    config_value(repo, "diff.aimd.textconv").as_deref() == Some(commands.textconv.as_str())
        && config_value(repo, "diff.aimd.cachetextconv").as_deref() != Some("true")
        && config_value(repo, "merge.aimd.name").as_deref() == Some(MERGE_NAME)
        && config_value(repo, "merge.aimd.driver").as_deref()
            == Some(commands.merge_driver.as_str())
}

pub(super) fn config_value(repo: Option<&Path>, key: &str) -> Option<String> {
    let scope = if repo.is_some() {
        "--local"
    } else {
        "--global"
    };
    let out = run_git(repo, &["config", scope, "--get", key]).ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn verify_config(
    repo: Option<&Path>,
    enable: bool,
    commands: &DriverCommands,
) -> Result<(), String> {
    if enable {
        if driver_configured(repo, commands) {
            Ok(())
        } else {
            Err("git config 写入后验证失败".to_string())
        }
    } else {
        let keys = [
            "diff.aimd.textconv",
            "diff.aimd.cachetextconv",
            "merge.aimd.name",
            "merge.aimd.driver",
        ];
        let remaining: Vec<_> = keys
            .into_iter()
            .filter(|key| config_value(repo, key).is_some())
            .collect();
        if remaining.is_empty() {
            Ok(())
        } else {
            Err(format!("git config 禁用后仍存在: {}", remaining.join(", ")))
        }
    }
}

pub(super) fn driver_commands(cli_in_path: bool, stable_cli_executable: bool) -> DriverCommands {
    if cli_in_path {
        DriverCommands {
            source: "path".to_string(),
            textconv: BARE_DIFF_TEXTCONV.to_string(),
            merge_driver: BARE_MERGE_DRIVER.to_string(),
        }
    } else if stable_cli_executable {
        DriverCommands {
            source: "stable".to_string(),
            textconv: STABLE_DIFF_TEXTCONV.to_string(),
            merge_driver: STABLE_MERGE_DRIVER.to_string(),
        }
    } else {
        DriverCommands {
            source: "path".to_string(),
            textconv: BARE_DIFF_TEXTCONV.to_string(),
            merge_driver: BARE_MERGE_DRIVER.to_string(),
        }
    }
}

pub(super) fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

#[cfg(unix)]
pub(super) fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|m| m.is_file() && (m.permissions().mode() & 0o111 != 0))
        .unwrap_or(false)
}

#[cfg(not(unix))]
pub(super) fn is_executable(path: &Path) -> bool {
    path.is_file()
}
