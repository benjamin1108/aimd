use std::fs;
use std::path::{Path, PathBuf};

use super::{GitFileKind, GitFileState, GitRepoStatus};

pub(super) struct AimdDriverHealth {
    pub aimd_driver_configured: bool,
    pub gitattributes_configured: bool,
    pub warning: Option<String>,
}

pub(super) fn discover_git_root(workspace: &Path) -> Result<Option<PathBuf>, String> {
    if super::is_git_repo_root(workspace) {
        return Ok(Some(workspace.to_path_buf()));
    }
    let out = super::run_git(workspace, &["rev-parse", "--show-toplevel"])?;
    if !out.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if value.is_empty() {
        return Ok(None);
    }
    let root = fs::canonicalize(value).map_err(|e| format!("无法解析 Git 根目录: {e}"))?;
    Ok(root.is_dir().then_some(root))
}

pub(super) fn aimd_driver_health(repo_root: &Path, has_aimd_changes: bool) -> AimdDriverHealth {
    let gitattributes_configured = gitattributes_configured(repo_root);
    let textconv = git_config_value(repo_root, "diff.aimd.textconv");
    let textconv_is_aimd = textconv
        .as_deref()
        .map(|value| value.contains("aimd") && value.contains("git-diff"))
        .unwrap_or(false);
    let aimd_driver_configured = gitattributes_configured && textconv_is_aimd;
    let warning = if !has_aimd_changes || aimd_driver_configured {
        None
    } else if !gitattributes_configured && textconv.is_none() {
        Some(".aimd Git diff 尚未启用，设置页启用 Git 集成后才能看到语义 diff".to_string())
    } else if !gitattributes_configured {
        Some(
            ".gitattributes 未配置 *.aimd diff=aimd，当前 .aimd diff 可能不会走 AIMD textconv"
                .to_string(),
        )
    } else if !textconv_is_aimd {
        Some(
            "diff.aimd.textconv 未指向 AIMD git-diff，当前 .aimd diff 可能不是语义 diff"
                .to_string(),
        )
    } else {
        None
    };
    AimdDriverHealth {
        aimd_driver_configured,
        gitattributes_configured,
        warning,
    }
}

fn git_config_value(repo_root: &Path, key: &str) -> Option<String> {
    let out = super::run_git(repo_root, &["config", "--get", key]).ok()?;
    if !out.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn gitattributes_configured(repo_root: &Path) -> bool {
    let Ok(text) = fs::read_to_string(repo_root.join(".gitattributes")) else {
        return false;
    };
    text.lines().any(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return false;
        }
        let mut parts = line.split_whitespace();
        let Some(pattern) = parts.next() else {
            return false;
        };
        pattern == "*.aimd" && parts.any(|part| part == "diff=aimd")
    })
}

pub(super) fn ensure_sync_ready(status: &GitRepoStatus, action: &str) -> Result<(), String> {
    if !status.is_repo {
        return Err("当前目录不是 Git 仓库".to_string());
    }
    if status.conflicted {
        return Err(format!("存在冲突文件，解决冲突后才能{action}"));
    }
    if status.upstream.is_none() {
        return Err(format!("当前分支未设置 upstream，无法{action}"));
    }
    Ok(())
}

pub(super) fn run_git_sync(root: &Path, args: &[&str], action: &str) -> Result<(), String> {
    let out = super::run_git(root, args)?;
    if out.status.success() {
        return Ok(());
    }
    Err(explain_sync_error(
        &super::truncate_output(&out.stderr),
        action,
    ))
}

pub(super) fn diff_reports_binary(diff: &str) -> bool {
    diff.lines().any(|line| {
        let line = line.strip_suffix('\r').unwrap_or(line);
        line.starts_with("Binary files ") || line == "GIT binary patch"
    })
}

pub(super) fn file_diff(
    root: &Path,
    rel: String,
    status: &GitRepoStatus,
) -> Result<super::GitFileDiff, String> {
    if status
        .files
        .iter()
        .any(|file| file.path == rel && file.kind == GitFileKind::Untracked)
    {
        let (unstaged_diff, truncated) = run_untracked_diff(root, &rel, super::DIFF_OUTPUT_LIMIT)?;
        return Ok(super::GitFileDiff {
            path: rel,
            staged_diff: String::new(),
            is_binary: diff_reports_binary(&unstaged_diff),
            unstaged_diff,
            truncated,
        });
    }
    let staged_args = super::git_file_diff_args(true, &rel);
    let (staged_diff, staged_truncated) =
        super::run_git_ok_limited(root, &staged_args, super::DIFF_OUTPUT_LIMIT)?;
    let unstaged_args = super::git_file_diff_args(false, &rel);
    let (unstaged_diff, unstaged_truncated) =
        super::run_git_ok_limited(root, &unstaged_args, super::DIFF_OUTPUT_LIMIT)?;
    let combined = format!("{staged_diff}\n{unstaged_diff}");
    Ok(super::GitFileDiff {
        path: rel,
        is_binary: diff_reports_binary(&combined),
        staged_diff,
        unstaged_diff,
        truncated: staged_truncated || unstaged_truncated,
    })
}

fn run_untracked_diff(root: &Path, rel: &str, limit: usize) -> Result<(String, bool), String> {
    let empty = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let out = super::run_git(
        root,
        &[
            "diff",
            "--no-ext-diff",
            "--textconv",
            "--no-index",
            "--",
            empty,
            rel,
        ],
    )?;
    if out.status.success() || out.status.code() == Some(1) {
        return Ok(super::truncate_output_with_limit(&out.stdout, limit));
    }
    let stderr = super::truncate_output(&out.stderr);
    Err(if stderr.trim().is_empty() {
        "未跟踪文件 diff 生成失败".to_string()
    } else {
        stderr
    })
}

fn has_head(root: &Path) -> bool {
    super::run_git(root, &["rev-parse", "--verify", "HEAD"])
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn unstage_path(root: &Path, rel: &str, head_exists: bool) -> Result<(), String> {
    if head_exists {
        super::run_git_ok(root, &["restore", "--staged", "--", rel])?;
    } else {
        super::run_git_ok(root, &["rm", "--cached", "-r", "--", rel])?;
    }
    Ok(())
}

pub(super) fn discard_file(root: &Path, rel: &str, status: &GitRepoStatus) -> Result<(), String> {
    let Some(file) = status.files.iter().find(|file| file.path == rel) else {
        return Err("该文件没有可放弃的改动".to_string());
    };
    if file.kind == GitFileKind::Conflicted {
        return Err("冲突文件不能在这里放弃改动，请先解决冲突".to_string());
    }
    let head_exists = has_head(root);
    if file.staged != GitFileState::None {
        unstage_path(root, rel, head_exists)?;
    }
    if file.kind == GitFileKind::Untracked {
        super::run_git_ok(root, &["clean", "-fd", "--", rel])?;
        return Ok(());
    }
    if file.staged == GitFileState::Added || !head_exists {
        super::run_git_ok(root, &["clean", "-fd", "--", rel])?;
        return Ok(());
    }
    if let Some(original) = file.original_path.as_deref() {
        super::run_git_ok(root, &["restore", "--worktree", "--", original])?;
        super::run_git_ok(root, &["clean", "-fd", "--", rel])?;
        return Ok(());
    }
    if file.unstaged == GitFileState::None && file.staged == GitFileState::None {
        return Err("该文件没有可放弃的改动".to_string());
    }
    super::run_git_ok(root, &["restore", "--worktree", "--", rel]).map(|_| ())
}

pub(super) fn discard_all(root: &Path, status: &GitRepoStatus) -> Result<(), String> {
    if !status.is_repo {
        return Err("当前目录不是 Git 仓库".to_string());
    }
    if status.conflicted {
        return Err("冲突文件不能在这里放弃改动，请先解决冲突".to_string());
    }
    if status.clean {
        return Err("工作区没有可放弃的改动".to_string());
    }

    let head_exists = has_head(root);
    let has_staged = status
        .files
        .iter()
        .any(|file| file.staged != GitFileState::None && file.kind != GitFileKind::Conflicted);
    let has_tracked_changes = status
        .files
        .iter()
        .any(|file| file.kind != GitFileKind::Untracked && file.kind != GitFileKind::Conflicted);

    if has_staged {
        if head_exists {
            super::run_git_ok(root, &["restore", "--staged", "."])?;
        } else {
            super::run_git_ok(root, &["rm", "--cached", "-r", "--", "."])?;
        }
    }
    if has_tracked_changes && head_exists {
        super::run_git_ok(root, &["restore", "--worktree", "."])?;
    }
    super::run_git_ok(root, &["clean", "-fd"]).map(|_| ())
}

fn explain_sync_error(raw: &str, action: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("authentication failed")
        || lower.contains("permission denied")
        || lower.contains("could not read username")
    {
        return format!("Git 认证失败，检查远端凭证后再{action}");
    }
    if lower.contains("non-fast-forward") || lower.contains("fetch first") {
        return "远端分支已有新提交，请先拉取后再推送".to_string();
    }
    if lower.contains("no such remote ref")
        || lower.contains("couldn't find remote ref")
        || lower.contains("the requested upstream branch")
    {
        return "远端分支不存在或 upstream 配置无效".to_string();
    }
    if lower.contains("not possible to fast-forward") || lower.contains("divergent") {
        return "当前分支无法快进拉取，请先用命令行处理分叉历史".to_string();
    }
    if raw.trim().is_empty() {
        format!("Git {action}失败")
    } else {
        raw.to_string()
    }
}
