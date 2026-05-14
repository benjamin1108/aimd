use std::process;

pub fn git_config_command(enable: bool, global: bool, repo: bool) -> Result<(), String> {
    if global == repo {
        return Err("choose exactly one of --global or --repo".to_string());
    }
    let scope = if global { "--global" } else { "--local" };
    let writes: &[(&str, Option<&str>)] = if enable {
        &[
            ("diff.aimd.textconv", Some("aimd git-diff")),
            ("diff.aimd.cachetextconv", Some("false")),
            ("merge.aimd.name", Some("AIMD merge driver")),
            ("merge.aimd.driver", Some("aimd git-merge %O %A %B %P")),
        ]
    } else {
        &[
            ("diff.aimd.textconv", None),
            ("diff.aimd.cachetextconv", None),
            ("merge.aimd.name", None),
            ("merge.aimd.driver", None),
        ]
    };
    for (key, value) in writes {
        let status = if let Some(value) = value {
            process::Command::new("git")
                .args(["config", scope, key, value])
                .status()
        } else {
            process::Command::new("git")
                .args(["config", scope, "--unset-all", key])
                .status()
        }
        .map_err(|e| format!("start git config: {e}"))?;
        if !status.success() && enable {
            return Err(format!("git config failed for {key}"));
        }
    }
    Ok(())
}

pub fn git_version() -> Result<String, String> {
    let output = process::Command::new("git")
        .arg("--version")
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}
