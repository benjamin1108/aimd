use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

const GIT_TIMEOUT: Duration = Duration::from_secs(20);
const OUTPUT_LIMIT: usize = 64 * 1024;
const DIFF_OUTPUT_LIMIT: usize = 128 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitFileState {
    None,
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitFileKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    pub staged: GitFileState,
    pub unstaged: GitFileState,
    pub kind: GitFileKind,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    pub is_repo: bool,
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<i32>,
    pub clean: bool,
    pub conflicted: bool,
    pub files: Vec<GitChangedFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub path: String,
    pub staged_diff: String,
    pub unstaged_diff: String,
    pub is_binary: bool,
    pub truncated: bool,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| format!("无法访问目录: {e}"))?;
    if !root.is_dir() {
        return Err("工作目录不是文件夹".to_string());
    }
    Ok(root)
}

fn is_git_repo_root(root: &Path) -> bool {
    let git = root.join(".git");
    git.is_dir() || git.is_file()
}

fn ensure_git_root(root: &Path) -> Result<(), String> {
    if is_git_repo_root(root) {
        Ok(())
    } else {
        Err("当前目录不是 Git 仓库".to_string())
    }
}

fn path_has_escape(path: &Path) -> bool {
    path.components().any(|part| {
        matches!(
            part,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    })
}

fn safe_git_path(root: &Path, path: &str) -> Result<String, String> {
    let raw = Path::new(path);
    if raw.is_absolute() {
        let canonical = fs::canonicalize(raw).map_err(|e| format!("路径不存在或无法访问: {e}"))?;
        if !canonical.starts_with(root) {
            return Err("不能操作工作目录之外的文件".to_string());
        }
        return canonical
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .map_err(|_| "无法解析相对路径".to_string());
    }
    if path_has_escape(raw) {
        return Err("路径不能包含 .. 或绝对路径前缀".to_string());
    }
    Ok(path.replace('\\', "/"))
}

fn truncate_output(value: &[u8]) -> String {
    let take = value.len().min(OUTPUT_LIMIT);
    let mut text = String::from_utf8_lossy(&value[..take]).to_string();
    if value.len() > OUTPUT_LIMIT {
        text.push_str("\n...输出过长，已截断");
    }
    text
}

fn truncate_output_with_limit(value: &[u8], limit: usize) -> (String, bool) {
    let take = value.len().min(limit);
    let text = String::from_utf8_lossy(&value[..take]).to_string();
    (text, value.len() > limit)
}

fn run_git(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
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
        if start.elapsed() > GIT_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("git 命令超时".to_string());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn run_git_ok(root: &Path, args: &[&str]) -> Result<String, String> {
    let out = run_git(root, args)?;
    if out.status.success() {
        return Ok(truncate_output(&out.stdout));
    }
    let stderr = truncate_output(&out.stderr);
    Err(if stderr.trim().is_empty() {
        format!("git {:?} 执行失败", args)
    } else {
        stderr
    })
}

fn run_git_ok_limited(root: &Path, args: &[&str], limit: usize) -> Result<(String, bool), String> {
    let out = run_git(root, args)?;
    if out.status.success() {
        return Ok(truncate_output_with_limit(&out.stdout, limit));
    }
    let stderr = truncate_output(&out.stderr);
    Err(if stderr.trim().is_empty() {
        format!("git {:?} 执行失败", args)
    } else {
        stderr
    })
}

fn state_from_xy(ch: char, untracked: bool, conflict: bool) -> GitFileState {
    if conflict {
        return GitFileState::Conflicted;
    }
    if untracked {
        return GitFileState::Untracked;
    }
    match ch {
        'M' => GitFileState::Modified,
        'A' => GitFileState::Added,
        'D' => GitFileState::Deleted,
        'R' => GitFileState::Renamed,
        _ => GitFileState::None,
    }
}

fn kind_from_states(staged: &GitFileState, unstaged: &GitFileState) -> GitFileKind {
    if *staged == GitFileState::Conflicted || *unstaged == GitFileState::Conflicted {
        return GitFileKind::Conflicted;
    }
    for state in [staged, unstaged] {
        match state {
            GitFileState::Renamed => return GitFileKind::Renamed,
            GitFileState::Untracked => return GitFileKind::Untracked,
            GitFileState::Added => return GitFileKind::Added,
            GitFileState::Deleted => return GitFileKind::Deleted,
            GitFileState::Modified => return GitFileKind::Modified,
            _ => {}
        }
    }
    GitFileKind::Modified
}

pub fn parse_git_status(root: String, raw: &[u8]) -> GitRepoStatus {
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = None;
    let mut behind = None;
    let mut files = Vec::new();
    let mut parts = raw.split(|b| *b == 0).filter(|part| !part.is_empty());
    while let Some(part) = parts.next() {
        let line = String::from_utf8_lossy(part);
        if let Some(value) = line.strip_prefix("# branch.head ") {
            if value != "(detached)" {
                branch = Some(value.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("# branch.upstream ") {
            upstream = Some(value.to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("# branch.ab ") {
            for token in value.split_whitespace() {
                if let Some(v) = token.strip_prefix('+') {
                    ahead = v.parse::<i32>().ok();
                } else if let Some(v) = token.strip_prefix('-') {
                    behind = v.parse::<i32>().ok();
                }
            }
            continue;
        }
        let mut fields = line.split(' ');
        match fields.next() {
            Some("1") => {
                let xy = fields.next().unwrap_or("..");
                let path = line.splitn(9, ' ').nth(8).unwrap_or("").to_string();
                let x = xy.chars().next().unwrap_or('.');
                let y = xy.chars().nth(1).unwrap_or('.');
                let staged = state_from_xy(x, false, false);
                let unstaged = state_from_xy(y, false, false);
                files.push(GitChangedFile {
                    path,
                    original_path: None,
                    kind: kind_from_states(&staged, &unstaged),
                    staged,
                    unstaged,
                });
            }
            Some("2") => {
                let xy = fields.next().unwrap_or("..");
                let path = line.splitn(10, ' ').nth(9).unwrap_or("").to_string();
                let original_path = parts.next().map(|p| String::from_utf8_lossy(p).to_string());
                let x = xy.chars().next().unwrap_or('.');
                let y = xy.chars().nth(1).unwrap_or('.');
                let staged = state_from_xy(x, false, false);
                let unstaged = state_from_xy(y, false, false);
                files.push(GitChangedFile {
                    path,
                    original_path,
                    kind: GitFileKind::Renamed,
                    staged,
                    unstaged,
                });
            }
            Some("u") => {
                let path = line.splitn(11, ' ').nth(10).unwrap_or("").to_string();
                files.push(GitChangedFile {
                    path,
                    original_path: None,
                    kind: GitFileKind::Conflicted,
                    staged: GitFileState::Conflicted,
                    unstaged: GitFileState::Conflicted,
                });
            }
            Some("?") => {
                let path = line.strip_prefix("? ").unwrap_or("").to_string();
                files.push(GitChangedFile {
                    path,
                    original_path: None,
                    kind: GitFileKind::Untracked,
                    staged: GitFileState::None,
                    unstaged: GitFileState::Untracked,
                });
            }
            _ => {}
        }
    }
    let conflicted = files.iter().any(|f| f.kind == GitFileKind::Conflicted);
    GitRepoStatus {
        is_repo: true,
        root,
        branch,
        upstream,
        ahead,
        behind,
        clean: files.is_empty(),
        conflicted,
        files,
        error: None,
    }
}

fn status_for_root(root: &Path) -> Result<GitRepoStatus, String> {
    if !is_git_repo_root(root) {
        return Ok(GitRepoStatus {
            is_repo: false,
            root: path_string(root),
            branch: None,
            upstream: None,
            ahead: None,
            behind: None,
            clean: true,
            conflicted: false,
            files: Vec::new(),
            error: None,
        });
    }
    let out = run_git(root, &["status", "--porcelain=v2", "-z", "--branch"])?;
    if !out.status.success() {
        return Err(truncate_output(&out.stderr));
    }
    Ok(parse_git_status(path_string(root), &out.stdout))
}

#[tauri::command]
pub fn get_git_repo_status(root: String) -> Result<GitRepoStatus, String> {
    let root = canonical_root(&root)?;
    status_for_root(&root)
}

#[tauri::command]
pub fn get_git_file_diff(root: String, path: String) -> Result<GitFileDiff, String> {
    let root = canonical_root(&root)?;
    ensure_git_root(&root)?;
    let rel = safe_git_path(&root, &path)?;
    let (staged_diff, staged_truncated) =
        run_git_ok_limited(&root, &["diff", "--cached", "--", &rel], DIFF_OUTPUT_LIMIT)?;
    let (unstaged_diff, unstaged_truncated) =
        run_git_ok_limited(&root, &["diff", "--", &rel], DIFF_OUTPUT_LIMIT)?;
    let combined = format!("{staged_diff}\n{unstaged_diff}");
    Ok(GitFileDiff {
        path: rel,
        is_binary: combined.contains("Binary files") || combined.contains("GIT binary patch"),
        staged_diff,
        unstaged_diff,
        truncated: staged_truncated || unstaged_truncated,
    })
}

#[tauri::command]
pub fn git_stage_file(root: String, path: String) -> Result<(), String> {
    let root = canonical_root(&root)?;
    ensure_git_root(&root)?;
    let rel = safe_git_path(&root, &path)?;
    run_git_ok(&root, &["add", "--", &rel]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage_file(root: String, path: String) -> Result<(), String> {
    let root = canonical_root(&root)?;
    ensure_git_root(&root)?;
    let rel = safe_git_path(&root, &path)?;
    run_git_ok(&root, &["restore", "--staged", "--", &rel]).map(|_| ())
}

#[tauri::command]
pub fn git_stage_all(root: String) -> Result<(), String> {
    let root = canonical_root(&root)?;
    ensure_git_root(&root)?;
    run_git_ok(&root, &["add", "-A"]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage_all(root: String) -> Result<(), String> {
    let root = canonical_root(&root)?;
    ensure_git_root(&root)?;
    run_git_ok(&root, &["restore", "--staged", "."]).map(|_| ())
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<GitRepoStatus, String> {
    let root = canonical_root(&root)?;
    if message.trim().is_empty() {
        return Err("提交信息不能为空".to_string());
    }
    let status = status_for_root(&root)?;
    if !status.is_repo {
        return Err("当前目录不是 Git 仓库".to_string());
    }
    if status.conflicted {
        return Err("存在冲突文件，解决冲突后才能提交".to_string());
    }
    run_git_ok(&root, &["commit", "-m", message.trim()])?;
    status_for_root(&root)
}

#[tauri::command]
pub fn git_pull(root: String) -> Result<GitRepoStatus, String> {
    let root = canonical_root(&root)?;
    let status = status_for_root(&root)?;
    if !status.is_repo {
        return Err("当前目录不是 Git 仓库".to_string());
    }
    if status.conflicted {
        return Err("存在冲突文件，解决冲突后才能 pull".to_string());
    }
    run_git_ok(&root, &["pull", "--ff-only"])?;
    status_for_root(&root)
}

#[tauri::command]
pub fn git_push(root: String) -> Result<GitRepoStatus, String> {
    let root = canonical_root(&root)?;
    let status = status_for_root(&root)?;
    if !status.is_repo {
        return Err("当前目录不是 Git 仓库".to_string());
    }
    if status.conflicted {
        return Err("存在冲突文件，解决冲突后才能 push".to_string());
    }
    run_git_ok(&root, &["push"])?;
    status_for_root(&root)
}

#[cfg(test)]
#[path = "git_tests.rs"]
mod git_tests;
