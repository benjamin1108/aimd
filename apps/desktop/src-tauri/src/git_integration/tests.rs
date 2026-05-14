use super::*;
use std::process::Command;

#[test]
fn gitattributes_write_is_idempotent() {
    let tmp = tempfile::tempdir().unwrap();
    write_gitattributes_line(tmp.path()).unwrap();
    write_gitattributes_line(tmp.path()).unwrap();
    let body = fs::read_to_string(tmp.path().join(".gitattributes")).unwrap();
    assert_eq!(body.matches(GITATTRIBUTES_LINE).count(), 1);
}

#[test]
fn repo_config_enable_and_disable_round_trips() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let init = Command::new("git")
        .arg("init")
        .current_dir(tmp.path())
        .output()
        .unwrap();
    if !init.status.success() {
        return;
    }

    let cli_path = find_in_path("aimd");
    let stable = stable_cli_path();
    let commands = driver_commands(
        cli_path.as_deref(),
        is_executable(&stable).then_some(stable.as_path()),
    );
    write_repo_config(tmp.path(), true, "test-repo-enable").unwrap();
    assert!(driver_configured(Some(tmp.path()), &commands));
    assert_eq!(
        config_value(Some(tmp.path()), "diff.aimd.cachetextconv").as_deref(),
        Some("false")
    );
    write_repo_config(tmp.path(), false, "test-repo-disable").unwrap();
    assert!(!driver_configured(Some(tmp.path()), &commands));
}

#[test]
fn textconv_cache_true_is_not_considered_configured() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let init = Command::new("git")
        .arg("init")
        .current_dir(tmp.path())
        .output()
        .unwrap();
    if !init.status.success() {
        return;
    }

    let stable = stable_cli_path();
    let commands = driver_commands(None, Some(stable.as_path()));
    for (key, value) in [
        ("diff.aimd.textconv", commands.textconv.as_str()),
        ("diff.aimd.cachetextconv", "true"),
        ("merge.aimd.name", MERGE_NAME),
        ("merge.aimd.driver", commands.merge_driver.as_str()),
    ] {
        let status = Command::new("git")
            .args(["config", "--local", key, value])
            .current_dir(tmp.path())
            .status()
            .unwrap();
        assert!(status.success());
    }

    assert!(!driver_configured(Some(tmp.path()), &commands));
}

#[test]
fn stable_cli_is_used_when_path_cli_is_missing() {
    let stable = stable_cli_path();
    let commands = driver_commands(None, Some(stable.as_path()));
    assert_eq!(commands.source, "stable");
    #[cfg(not(windows))]
    assert_eq!(commands.textconv, STABLE_DIFF_TEXTCONV);
    #[cfg(not(windows))]
    assert_eq!(commands.merge_driver, STABLE_MERGE_DRIVER);
    #[cfg(windows)]
    {
        assert!(commands.textconv.ends_with(" git-diff"));
        assert!(commands.merge_driver.ends_with(" git-merge %O %A %B %P"));
        assert!(commands.merge_driver.contains("aimd.exe"));
    }
}

#[test]
fn stable_cli_is_preferred_over_path_cli() {
    let path_cli = Path::new(r"C:\Tools\aimd.exe");
    let stable = stable_cli_path();
    let commands = driver_commands(Some(path_cli), Some(stable.as_path()));
    assert_eq!(commands.source, "stable");
    assert_ne!(commands.textconv, BARE_DIFF_TEXTCONV);
}

#[test]
fn missing_repo_path_is_not_reported_as_git_repo() {
    let status = status_impl(Some(""), "test-status".to_string());
    assert!(status.repo_path_requested == false);
    assert!(!status.repo_is_git);
    assert!(status.repo_path.is_none());
    assert!(!status.gitattributes_configured);
}

#[test]
fn disabling_missing_repo_keys_is_successful() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let init = Command::new("git")
        .arg("init")
        .current_dir(tmp.path())
        .output()
        .unwrap();
    if !init.status.success() {
        return;
    }

    let report = write_repo_config(tmp.path(), false, "test-disable-missing").unwrap();
    assert!(report
        .details
        .iter()
        .any(|line| line.contains("原本不存在")));
}

#[cfg(unix)]
#[test]
fn executable_detection_reports_non_executable_file() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("aimd");
    fs::write(&path, b"#!/bin/sh\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(!is_executable(&path));
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(is_executable(&path));
}
