use serde::Serialize;
use std::{fs, path::Path};
#[path = "git_integration/config.rs"]
mod config;
#[path = "git_integration/support.rs"]
mod support;
#[cfg(test)]
use config::stable_cli_path;
use config::{
    canonical_repo_root, config_value, driver_commands, driver_configured, ensure_repo,
    find_in_path, is_executable, write_gitattributes_line, write_global_config, write_repo_config,
    WriteConfigReport,
};
use support::{log_event, new_request_id, run_git, stderr_or_stdout};
const BARE_DIFF_TEXTCONV: &str = "aimd git-diff";
const BARE_MERGE_DRIVER: &str = "aimd git-merge %O %A %B %P";
#[cfg(not(windows))]
const STABLE_DIFF_TEXTCONV: &str = "/usr/local/bin/aimd git-diff";
#[cfg(not(windows))]
const STABLE_MERGE_DRIVER: &str = "/usr/local/bin/aimd git-merge %O %A %B %P";
const MERGE_NAME: &str = "AIMD merge driver";
const GITATTRIBUTES_LINE: &str = "*.aimd diff=aimd merge=aimd";
#[cfg(not(windows))]
const STABLE_CLI_PATH: &str = "/usr/local/bin/aimd";
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIntegrationStatus {
    pub request_id: String,
    pub git_installed: bool,
    pub git_error: Option<String>,
    pub cli_in_path: bool,
    pub cli_path: Option<String>,
    pub stable_cli_path: String,
    pub stable_cli_exists: bool,
    pub stable_cli_executable: bool,
    pub stable_cli_error: Option<String>,
    pub repo_path: Option<String>,
    pub repo_is_git: bool,
    pub repo_error: Option<String>,
    pub repo_path_requested: bool,
    pub gitattributes_present: bool,
    pub gitattributes_configured: bool,
    pub repo_driver_configured: bool,
    pub global_driver_configured: bool,
    pub driver_command_source: String,
    pub expected_textconv: String,
    pub expected_merge_driver: String,
    pub global_textconv: Option<String>,
    pub global_cache_textconv: Option<String>,
    pub global_merge_name: Option<String>,
    pub global_merge_driver: Option<String>,
    pub repo_textconv: Option<String>,
    pub repo_cache_textconv: Option<String>,
    pub repo_merge_name: Option<String>,
    pub repo_merge_driver: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDoctorResult {
    pub request_id: String,
    pub ok: bool,
    pub messages: Vec<String>,
    pub suggestions: Vec<String>,
    pub status: GitIntegrationStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIntegrationActionResult {
    pub request_id: String,
    pub ok: bool,
    pub title: String,
    pub message: String,
    pub details: Vec<String>,
    pub status: GitIntegrationStatus,
}

#[tauri::command]
pub fn git_integration_status(repo_path: Option<String>) -> Result<GitIntegrationStatus, String> {
    let request_id = new_request_id("status");
    let status = status_impl(repo_path.as_deref(), request_id.clone());
    log_event(
        &request_id,
        "status",
        "status",
        repo_path.as_deref(),
        None,
        None,
        None,
        "ok",
        "status checked",
    );
    Ok(status)
}

#[tauri::command]
pub fn git_integration_enable_global() -> Result<GitIntegrationActionResult, String> {
    let request_id = new_request_id("global-enable");
    let result = write_global_config(true, &request_id);
    action_result(
        request_id,
        "global",
        None,
        result,
        "全局 Git driver 已启用",
        "全局 Git driver 启用失败",
        None,
    )
}

#[tauri::command]
pub fn git_integration_disable_global() -> Result<GitIntegrationActionResult, String> {
    let request_id = new_request_id("global-disable");
    let result = write_global_config(false, &request_id);
    action_result(
        request_id,
        "global",
        None,
        result,
        "全局 Git driver 已禁用",
        "全局 Git driver 禁用失败",
        None,
    )
}

#[tauri::command]
pub fn git_integration_enable_repo(
    repo_path: String,
) -> Result<GitIntegrationActionResult, String> {
    let request_id = new_request_id("repo-enable");
    let repo = ensure_repo(&repo_path)?;
    let result = write_repo_config(&repo, true, &request_id);
    action_result(
        request_id,
        "repo",
        Some(repo_path.as_str()),
        result,
        "当前仓库 Git driver 已启用",
        "当前仓库 Git driver 启用失败",
        Some(repo_path.as_str()),
    )
}

#[tauri::command]
pub fn git_integration_disable_repo(
    repo_path: String,
) -> Result<GitIntegrationActionResult, String> {
    let request_id = new_request_id("repo-disable");
    let repo = ensure_repo(&repo_path)?;
    let result = write_repo_config(&repo, false, &request_id);
    action_result(
        request_id,
        "repo",
        Some(repo_path.as_str()),
        result,
        "当前仓库 Git driver 已禁用",
        "当前仓库 Git driver 禁用失败",
        Some(repo_path.as_str()),
    )
}

#[tauri::command]
pub fn git_integration_write_gitattributes(
    repo_path: String,
) -> Result<GitIntegrationActionResult, String> {
    let request_id = new_request_id("gitattributes");
    let repo = ensure_repo(&repo_path)?;
    let result = write_gitattributes_line(&repo).map(|details| WriteConfigReport { details });
    action_result(
        request_id,
        "gitattributes",
        Some(repo_path.as_str()),
        result,
        ".gitattributes 已写入",
        ".gitattributes 写入失败",
        Some(repo_path.as_str()),
    )
}

#[tauri::command]
pub fn git_integration_doctor(repo_path: Option<String>) -> Result<GitDoctorResult, String> {
    let request_id = new_request_id("doctor");
    let status = status_impl(repo_path.as_deref(), request_id.clone());
    let mut messages = Vec::new();
    let mut suggestions = Vec::new();
    if !status.git_installed {
        messages.push(
            status
                .git_error
                .clone()
                .unwrap_or_else(|| "Git 不可用".to_string()),
        );
        suggestions.push("安装或修复 Git 后重新检查".to_string());
    }
    if status.stable_cli_executable {
        if !status.cli_in_path {
            messages.push(format!(
                "aimd 不在 App PATH 中，已使用 {} 作为稳定入口",
                status.stable_cli_path
            ));
        }
    } else {
        messages.push(
            status
                .stable_cli_error
                .clone()
                .unwrap_or_else(|| format!("{} 不可执行", status.stable_cli_path)),
        );
        suggestions.push(format!(
            "安装 AIMD Windows 安装包，确保 {} 可执行",
            status.stable_cli_path
        ));
    }
    if !status.repo_path_requested {
        messages.push("未设置仓库路径，仓库 driver 和 .gitattributes 检查不适用".to_string());
        suggestions.push("填写仓库路径后可启用当前仓库 Git 集成".to_string());
    } else if !status.repo_is_git {
        messages.push(
            status
                .repo_error
                .clone()
                .unwrap_or_else(|| "当前路径不是 Git 仓库".to_string()),
        );
        suggestions.push("填写有效 Git 仓库路径".to_string());
    }
    if status.repo_is_git && !status.gitattributes_configured {
        messages.push(".gitattributes 未包含 *.aimd diff=aimd merge=aimd".to_string());
        suggestions.push("点击写入 .gitattributes".to_string());
    }
    if !status.global_driver_configured && !status.repo_driver_configured {
        messages.push("尚未配置 AIMD Git driver".to_string());
        suggestions.push("点击启用全局 Git 集成或启用当前仓库 Git 集成".to_string());
    }
    log_event(
        &request_id,
        "doctor",
        "doctor",
        repo_path.as_deref(),
        None,
        None,
        None,
        "ok",
        "doctor checked",
    );
    Ok(GitDoctorResult {
        request_id,
        ok: messages.is_empty(),
        messages,
        suggestions,
        status,
    })
}

fn status_impl(repo_path: Option<&str>, request_id: String) -> GitIntegrationStatus {
    let git_version = run_git(None, &["--version"]);
    let git_installed = git_version
        .as_ref()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let git_error = match git_version {
        Ok(out) if out.status.success() => None,
        Ok(out) => Some(stderr_or_stdout(&out)),
        Err(err) => Some(err),
    };
    let cli_path_buf = find_in_path("aimd");
    let cli_path = cli_path_buf
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());
    let stable = config::stable_cli_path();
    let stable_cli_exists = stable.exists();
    let stable_cli_executable = is_executable(&stable);
    let commands = driver_commands(
        cli_path_buf.as_deref(),
        stable_cli_executable.then_some(stable.as_path()),
    );
    let stable_cli_error = if stable_cli_exists && !stable_cli_executable {
        Some(format!("{} 存在但不可执行", stable.display()))
    } else if !stable_cli_exists {
        Some(format!("{} 不存在", stable.display()))
    } else {
        None
    };

    let repo_path_requested = repo_path.map(|p| !p.trim().is_empty()).unwrap_or(false);
    let repo = repo_path
        .filter(|p| !p.trim().is_empty())
        .and_then(|p| canonical_repo_root(Path::new(p)).ok());
    let repo_error = if repo_path.is_some() && repo.is_none() {
        Some("不是 Git 仓库或无法访问 .git".to_string())
    } else {
        None
    };
    let gitattributes = repo.as_ref().map(|r| r.join(".gitattributes"));
    let gitattributes_present = gitattributes.as_ref().map(|p| p.exists()).unwrap_or(false);
    let gitattributes_configured = gitattributes
        .as_ref()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.lines().any(|line| line.trim() == GITATTRIBUTES_LINE))
        .unwrap_or(false);

    GitIntegrationStatus {
        request_id,
        git_installed,
        git_error,
        cli_in_path: cli_path.is_some(),
        cli_path,
        stable_cli_path: stable.to_string_lossy().to_string(),
        stable_cli_exists,
        stable_cli_executable,
        stable_cli_error,
        repo_path: repo.as_ref().map(|p| p.to_string_lossy().to_string()),
        repo_is_git: repo.is_some(),
        repo_error,
        repo_path_requested,
        gitattributes_present,
        gitattributes_configured,
        repo_driver_configured: repo
            .as_ref()
            .map(|r| driver_configured(Some(r), &commands))
            .unwrap_or(false),
        global_driver_configured: driver_configured(None, &commands),
        driver_command_source: commands.source,
        expected_textconv: commands.textconv,
        expected_merge_driver: commands.merge_driver,
        global_textconv: config_value(None, "diff.aimd.textconv"),
        global_cache_textconv: config_value(None, "diff.aimd.cachetextconv"),
        global_merge_name: config_value(None, "merge.aimd.name"),
        global_merge_driver: config_value(None, "merge.aimd.driver"),
        repo_textconv: repo
            .as_ref()
            .and_then(|r| config_value(Some(r), "diff.aimd.textconv")),
        repo_cache_textconv: repo
            .as_ref()
            .and_then(|r| config_value(Some(r), "diff.aimd.cachetextconv")),
        repo_merge_name: repo
            .as_ref()
            .and_then(|r| config_value(Some(r), "merge.aimd.name")),
        repo_merge_driver: repo
            .as_ref()
            .and_then(|r| config_value(Some(r), "merge.aimd.driver")),
    }
}

fn action_result(
    request_id: String,
    scope: &str,
    repo_path: Option<&str>,
    result: Result<WriteConfigReport, String>,
    success_title: &str,
    failure_title: &str,
    status_repo_path: Option<&str>,
) -> Result<GitIntegrationActionResult, String> {
    match result {
        Ok(report) => {
            let status = status_impl(status_repo_path, request_id.clone());
            log_event(
                &request_id,
                "action",
                scope,
                repo_path,
                None,
                None,
                None,
                "ok",
                success_title,
            );
            Ok(GitIntegrationActionResult {
                request_id,
                ok: true,
                title: success_title.to_string(),
                message: "操作已完成并通过验证".to_string(),
                details: report.details,
                status,
            })
        }
        Err(err) => {
            log_event(
                &request_id,
                "action",
                scope,
                repo_path,
                None,
                None,
                None,
                "failed",
                &err,
            );
            Err(format!("{failure_title}: {err}（requestId: {request_id}）"))
        }
    }
}

#[cfg(test)]
#[path = "git_integration/tests.rs"]
mod tests;
