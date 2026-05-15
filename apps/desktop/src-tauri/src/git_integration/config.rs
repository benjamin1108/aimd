use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use super::support::{run_git, run_git_logged, stderr_or_stdout};
use super::{BARE_DIFF_TEXTCONV, BARE_MERGE_DRIVER, GITATTRIBUTES_LINE, MERGE_NAME};
#[cfg(not(windows))]
use super::{STABLE_CLI_PATH, STABLE_DIFF_TEXTCONV, STABLE_MERGE_DRIVER};

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

#[derive(Debug, Default, Clone)]
pub(super) struct GitConfigSnapshot {
    values: HashMap<String, String>,
}

impl GitConfigSnapshot {
    pub(super) fn get(&self, key: &str) -> Option<String> {
        self.values.get(key).cloned()
    }
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
    let stable = stable_cli_path();
    let stable_cli_executable = is_executable(&stable);
    let commands = driver_commands(
        cli_path.as_deref(),
        stable_cli_executable.then_some(stable.as_path()),
    );
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

#[cfg(test)]
pub(super) fn driver_configured(repo: Option<&Path>, commands: &DriverCommands) -> bool {
    let config = config_snapshot(repo);
    driver_configured_snapshot(&config, commands)
}

pub(super) fn driver_configured_snapshot(
    config: &GitConfigSnapshot,
    commands: &DriverCommands,
) -> bool {
    config.get("diff.aimd.textconv").as_deref() == Some(commands.textconv.as_str())
        && config.get("diff.aimd.cachetextconv").as_deref() != Some("true")
        && config.get("merge.aimd.name").as_deref() == Some(MERGE_NAME)
        && config.get("merge.aimd.driver").as_deref() == Some(commands.merge_driver.as_str())
}

pub(super) fn config_snapshot(repo: Option<&Path>) -> GitConfigSnapshot {
    let scope = if repo.is_some() {
        "--local"
    } else {
        "--global"
    };
    let out = match run_git(repo, &["config", scope, "--list"]) {
        Ok(out) => out,
        Err(_) => return GitConfigSnapshot::default(),
    };
    if !out.status.success() {
        return GitConfigSnapshot::default();
    }
    let mut values = HashMap::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        values.insert(key.to_string(), value.to_string());
    }
    GitConfigSnapshot { values }
}

#[cfg(test)]
pub(super) fn config_value(repo: Option<&Path>, key: &str) -> Option<String> {
    config_snapshot(repo).get(key)
}

fn verify_config(
    repo: Option<&Path>,
    enable: bool,
    commands: &DriverCommands,
) -> Result<(), String> {
    if enable {
        let config = config_snapshot(repo);
        if driver_configured_snapshot(&config, commands) {
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
            .filter(|key| config_snapshot(repo).get(key).is_some())
            .collect();
        if remaining.is_empty() {
            Ok(())
        } else {
            Err(format!("git config 禁用后仍存在: {}", remaining.join(", ")))
        }
    }
}

pub(super) fn driver_commands(
    cli_in_path: Option<&Path>,
    stable_cli: Option<&Path>,
) -> DriverCommands {
    if stable_cli.is_some() {
        #[cfg(windows)]
        let stable_cli = stable_cli.expect("stable_cli was checked above");
        #[cfg(windows)]
        let textconv = format!("{} git-diff", git_command_path(stable_cli));
        #[cfg(windows)]
        let merge_driver = format!("{} git-merge %O %A %B %P", git_command_path(stable_cli));
        #[cfg(not(windows))]
        let textconv = STABLE_DIFF_TEXTCONV.to_string();
        #[cfg(not(windows))]
        let merge_driver = STABLE_MERGE_DRIVER.to_string();

        DriverCommands {
            source: "stable".to_string(),
            textconv,
            merge_driver,
        }
    } else if cli_in_path.is_some() {
        DriverCommands {
            source: "path".to_string(),
            textconv: BARE_DIFF_TEXTCONV.to_string(),
            merge_driver: BARE_MERGE_DRIVER.to_string(),
        }
    } else {
        DriverCommands {
            source: "path".to_string(),
            textconv: BARE_DIFF_TEXTCONV.to_string(),
            merge_driver: BARE_MERGE_DRIVER.to_string(),
        }
    }
}

#[cfg(windows)]
pub(super) fn stable_cli_path() -> PathBuf {
    if let Some(path) = std::env::var_os("AIMD_CLI_PATH").map(PathBuf::from) {
        return path;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join("bin").join("aimd.exe");
        }
    }
    PathBuf::from(r"C:\Program Files\AIMD Desktop\bin\aimd.exe")
}

#[cfg(not(windows))]
pub(super) fn stable_cli_path() -> PathBuf {
    PathBuf::from(STABLE_CLI_PATH)
}

#[cfg(windows)]
fn git_command_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    quote_git_command_arg(&value)
}

#[cfg(windows)]
fn quote_git_command_arg(value: &str) -> String {
    if value
        .chars()
        .any(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '&' | '(' | ')' | ';'))
    {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

pub(super) fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let names = executable_names(name);
    for dir in std::env::split_paths(&path) {
        for name in &names {
            let candidate = dir.join(name);
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn executable_names(name: &str) -> Vec<String> {
    let has_extension = Path::new(name).extension().is_some();
    if has_extension {
        return vec![name.to_string()];
    }
    let pathext = std::env::var_os("PATHEXT")
        .and_then(|v| v.into_string().ok())
        .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_string());
    let mut names = vec![name.to_string()];
    for ext in pathext.split(';').filter(|ext| !ext.trim().is_empty()) {
        names.push(format!("{name}{}", ext.trim().to_ascii_lowercase()));
        names.push(format!("{name}{}", ext.trim().to_ascii_uppercase()));
    }
    names.sort();
    names.dedup();
    names
}

#[cfg(not(windows))]
fn executable_names(name: &str) -> Vec<String> {
    vec![name.to_string()]
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_stable_driver_command_quotes_cli_path() {
        let cli = Path::new(r"C:\Program Files\AIMD Desktop\bin\aimd.exe");
        let commands = driver_commands(None, Some(cli));
        assert_eq!(
            commands.textconv,
            "\"C:/Program Files/AIMD Desktop/bin/aimd.exe\" git-diff"
        );
        assert_eq!(
            commands.merge_driver,
            "\"C:/Program Files/AIMD Desktop/bin/aimd.exe\" git-merge %O %A %B %P"
        );
    }

    #[test]
    fn windows_find_in_path_uses_pathext_for_exe() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("aimd.exe");
        fs::write(&bin, b"").unwrap();
        let old_path = std::env::var_os("PATH");
        let old_pathext = std::env::var_os("PATHEXT");
        std::env::set_var("PATH", tmp.path());
        std::env::set_var("PATHEXT", ".EXE");
        let found = find_in_path("aimd");
        match old_path {
            Some(value) => std::env::set_var("PATH", value),
            None => std::env::remove_var("PATH"),
        }
        match old_pathext {
            Some(value) => std::env::set_var("PATHEXT", value),
            None => std::env::remove_var("PATHEXT"),
        }
        assert!(found.is_some());
        assert_eq!(
            found
                .as_ref()
                .and_then(|path| path.file_name())
                .map(|name| name.to_string_lossy().to_ascii_lowercase()),
            Some("aimd.exe".to_string())
        );
    }
}
