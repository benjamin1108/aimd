use super::*;
use std::fs;
use std::path::Path;
use std::process::Command;

fn root() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn git(repo: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn repo_with_seed() -> tempfile::TempDir {
    let dir = root();
    let repo = dir.path();
    git(repo, &["init"]);
    git(repo, &["config", "user.email", "aimd@example.test"]);
    git(repo, &["config", "user.name", "AIMD Test"]);
    fs::write(repo.join("tracked.txt"), "old\n").unwrap();
    git(repo, &["add", "tracked.txt"]);
    git(repo, &["commit", "-m", "seed"]);
    dir
}

#[test]
fn repo_detection_is_limited_to_workspace_root() {
    let dir = root();
    let root_path = canonical_root(dir.path().to_str().unwrap()).unwrap();
    assert!(!is_git_repo_root(&root_path));

    fs::create_dir(dir.path().join(".git")).unwrap();
    assert!(is_git_repo_root(&root_path));

    let other = root();
    fs::write(other.path().join(".git"), "gitdir: ../actual.git").unwrap();
    let other_path = canonical_root(other.path().to_str().unwrap()).unwrap();
    assert!(is_git_repo_root(&other_path));
}

#[test]
fn rejects_paths_that_escape_root() {
    let dir = root();
    let root_path = canonical_root(dir.path().to_str().unwrap()).unwrap();
    let err = safe_git_path(&root_path, "../outside.md").unwrap_err();
    assert!(err.contains("路径不能包含"));
}

#[test]
fn truncates_large_diff_output_with_flag() {
    let bytes = vec![b'a'; DIFF_OUTPUT_LIMIT + 4];
    let (text, truncated) = truncate_output_with_limit(&bytes, DIFF_OUTPUT_LIMIT);
    assert!(truncated);
    assert_eq!(text.len(), DIFF_OUTPUT_LIMIT);
}

#[test]
fn file_diff_args_keep_textconv_enabled() {
    let staged = git_file_diff_args(true, "doc.aimd");
    assert!(staged.contains(&"--textconv"));
    assert!(!staged.contains(&"--no-textconv"));
    assert!(staged.contains(&"--cached"));

    let unstaged = git_file_diff_args(false, "doc.aimd");
    assert!(unstaged.contains(&"--textconv"));
    assert!(!unstaged.contains(&"--no-textconv"));
    assert!(!unstaged.contains(&"--cached"));
}

#[cfg(unix)]
#[test]
fn file_diff_uses_configured_textconv_for_aimd() {
    use std::os::unix::fs::PermissionsExt;

    let dir = root();
    let repo = dir.path();
    git(repo, &["init"]);
    git(repo, &["config", "user.email", "aimd@example.test"]);
    git(repo, &["config", "user.name", "AIMD Test"]);

    let textconv = repo.join("textconv.sh");
    fs::write(
        &textconv,
        "#!/bin/sh\nprintf '%s\\n' '--- AIMD main.md ---'\ncat \"$1\"\n",
    )
    .unwrap();
    let mut permissions = fs::metadata(&textconv).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&textconv, permissions).unwrap();

    fs::write(repo.join(".gitattributes"), "*.aimd diff=aimd\n").unwrap();
    git(
        repo,
        &["config", "diff.aimd.textconv", textconv.to_str().unwrap()],
    );
    fs::write(repo.join("doc.aimd"), "old semantic\n").unwrap();
    git(repo, &["add", "."]);
    git(repo, &["commit", "-m", "seed"]);

    fs::write(repo.join("doc.aimd"), "new semantic\n").unwrap();
    let args = git_file_diff_args(false, "doc.aimd");
    let (diff, truncated) = run_git_ok_limited(repo, &args, DIFF_OUTPUT_LIMIT).unwrap();
    assert!(!truncated);
    assert!(diff.contains("--- AIMD main.md ---"));
    assert!(diff.contains("+new semantic"));
    assert!(!diff.contains("Binary files"));
}

#[test]
fn binary_diff_detection_ignores_source_text_mentions() {
    let text_diff = "diff --git a/test.rs b/test.rs\n@@ -1 +1 @@\n+assert!(!diff.contains(\"Binary files\"));\n";
    assert!(!repo::diff_reports_binary(text_diff));
    assert!(repo::diff_reports_binary(
        "diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n",
    ));
    assert!(repo::diff_reports_binary(
        "diff --git a/blob.bin b/blob.bin\nGIT binary patch\nliteral 0\n",
    ));
}

#[test]
fn status_discovers_parent_repo_from_workspace_subdir() {
    let dir = root();
    let repo = dir.path();
    git(repo, &["init"]);
    fs::create_dir_all(repo.join("docs/nested")).unwrap();

    let status = status_for_root(&repo.join("docs/nested")).unwrap();
    assert!(status.is_repo);
    assert_eq!(
        status.root,
        fs::canonicalize(repo).unwrap().to_string_lossy()
    );
}

#[test]
fn status_warns_for_aimd_changes_without_driver() {
    let dir = root();
    let repo = dir.path();
    git(repo, &["init"]);
    fs::write(repo.join("doc.aimd"), "semantic\n").unwrap();

    let status = status_for_root(repo).unwrap();
    assert!(status.is_repo);
    assert!(!status.aimd_driver_configured);
    assert!(status
        .aimd_driver_warning
        .as_deref()
        .unwrap_or("")
        .contains("Git diff 尚未启用"));
}

#[test]
fn status_reports_configured_aimd_driver() {
    let dir = root();
    let repo = dir.path();
    git(repo, &["init"]);
    fs::write(repo.join(".gitattributes"), "*.aimd diff=aimd merge=aimd\n").unwrap();
    git(repo, &["config", "diff.aimd.textconv", "aimd git-diff"]);
    fs::write(repo.join("doc.aimd"), "semantic\n").unwrap();

    let status = status_for_root(repo).unwrap();
    assert!(status.aimd_driver_configured);
    assert!(status.gitattributes_configured);
    assert!(status.aimd_driver_warning.is_none());
}

#[test]
fn status_expands_untracked_directories_to_files() {
    let dir = root();
    let repo = dir.path();
    git(repo, &["init"]);
    fs::create_dir_all(repo.join("src/git")).unwrap();
    fs::write(repo.join("src/git/repo.rs"), "mod repo;\n").unwrap();

    let status = status_for_root(repo).unwrap();

    assert!(status
        .files
        .iter()
        .any(|file| file.path == "src/git/repo.rs"));
    assert!(!status.files.iter().any(|file| file.path == "src/git/"));
}

#[test]
fn file_diff_renders_untracked_file_content() {
    let dir = root();
    let repo = dir.path();
    git(repo, &["init"]);
    fs::write(repo.join("new.rs"), "fn main() {}\n").unwrap();
    let status = status_for_root(repo).unwrap();

    let diff = repo::file_diff(repo, "new.rs".to_string(), &status).unwrap();

    assert!(!diff.is_binary);
    assert!(diff.staged_diff.is_empty());
    assert!(diff.unstaged_diff.contains("new file mode"));
    assert!(diff.unstaged_diff.contains("+fn main() {}"));
}

#[test]
fn discard_file_reverts_staged_and_unstaged_changes() {
    let dir = repo_with_seed();
    let repo = dir.path();
    fs::write(repo.join("tracked.txt"), "staged\n").unwrap();
    git(repo, &["add", "tracked.txt"]);
    fs::write(repo.join("tracked.txt"), "worktree\n").unwrap();

    git_discard_file(
        repo.to_str().unwrap().to_string(),
        "tracked.txt".to_string(),
    )
    .unwrap();

    assert_eq!(
        fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "old\n"
    );
    assert!(status_for_root(repo).unwrap().clean);
}

#[test]
fn discard_file_removes_untracked_file() {
    let dir = repo_with_seed();
    let repo = dir.path();
    fs::write(repo.join("scratch.txt"), "scratch\n").unwrap();

    git_discard_file(
        repo.to_str().unwrap().to_string(),
        "scratch.txt".to_string(),
    )
    .unwrap();

    assert!(!repo.join("scratch.txt").exists());
    assert!(status_for_root(repo).unwrap().clean);
}

#[test]
fn discard_all_reverts_tracked_staged_and_untracked_files() {
    let dir = repo_with_seed();
    let repo = dir.path();
    fs::write(repo.join("tracked.txt"), "staged\n").unwrap();
    git(repo, &["add", "tracked.txt"]);
    fs::write(repo.join("tracked.txt"), "worktree\n").unwrap();
    fs::write(repo.join("added.txt"), "added\n").unwrap();
    git(repo, &["add", "added.txt"]);
    fs::write(repo.join("scratch.txt"), "scratch\n").unwrap();

    let status = git_discard_all(repo.to_str().unwrap().to_string()).unwrap();

    assert_eq!(
        fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "old\n"
    );
    assert!(!repo.join("added.txt").exists());
    assert!(!repo.join("scratch.txt").exists());
    assert!(status.clean);
}

#[test]
fn parses_branch_upstream_and_ahead_behind() {
    let raw =
        b"# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0";
    let status = parse_git_status("/repo".to_string(), raw);
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!(status.ahead, Some(2));
    assert_eq!(status.behind, Some(1));
    assert!(status.clean);
}

#[test]
fn parses_changed_file_states() {
    let raw = concat!(
        "1 .M N... 100644 100644 100644 aaa aaa src/modified.md\0",
        "1 A. N... 000000 100644 100644 000 bbb docs/added.md\0",
        "1 D. N... 100644 000000 000000 ccc 000 docs/deleted.md\0",
        "1 .M N... 100644 100644 100644 aaa aaa docs/with space.md\0",
        "? draft.md\0",
    )
    .as_bytes();
    let status = parse_git_status("/repo".to_string(), raw);
    assert_eq!(status.files.len(), 5);
    assert_eq!(status.files[0].unstaged, GitFileState::Modified);
    assert_eq!(status.files[1].staged, GitFileState::Added);
    assert_eq!(status.files[2].staged, GitFileState::Deleted);
    assert_eq!(status.files[3].path, "docs/with space.md");
    assert_eq!(status.files[4].kind, GitFileKind::Untracked);
}

#[test]
fn parses_renamed_and_conflicted_files() {
    let raw = b"2 R. N... 100644 100644 100644 aaa bbb R100 new name.md\0old name.md\0u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict file.md\0";
    let status = parse_git_status("/repo".to_string(), raw);
    assert_eq!(status.files.len(), 2);
    assert_eq!(status.files[0].kind, GitFileKind::Renamed);
    assert_eq!(status.files[0].path, "new name.md");
    assert_eq!(
        status.files[0].original_path.as_deref(),
        Some("old name.md")
    );
    assert_eq!(status.files[1].kind, GitFileKind::Conflicted);
    assert_eq!(status.files[1].path, "conflict file.md");
    assert!(status.conflicted);
}
