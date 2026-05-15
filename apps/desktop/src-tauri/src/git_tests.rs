use super::*;
use std::fs;

fn root() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
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
    use std::process::Command;

    let dir = root();
    let repo = dir.path();
    Command::new("git")
        .args(["init"])
        .current_dir(repo)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.email", "aimd@example.test"])
        .current_dir(repo)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.name", "AIMD Test"])
        .current_dir(repo)
        .output()
        .unwrap();

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
    Command::new("git")
        .args(["config", "diff.aimd.textconv", textconv.to_str().unwrap()])
        .current_dir(repo)
        .output()
        .unwrap();
    fs::write(repo.join("doc.aimd"), "old semantic\n").unwrap();
    Command::new("git")
        .args(["add", "."])
        .current_dir(repo)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "seed"])
        .current_dir(repo)
        .output()
        .unwrap();

    fs::write(repo.join("doc.aimd"), "new semantic\n").unwrap();
    let args = git_file_diff_args(false, "doc.aimd");
    let (diff, truncated) = run_git_ok_limited(repo, &args, DIFF_OUTPUT_LIMIT).unwrap();
    assert!(!truncated);
    assert!(diff.contains("--- AIMD main.md ---"));
    assert!(diff.contains("+new semantic"));
    assert!(!diff.contains("Binary files"));
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
