use std::{env, path::Path, process};

pub fn git_config_command(enable: bool, global: bool, repo: bool) -> Result<(), String> {
    if global == repo {
        return Err("choose exactly one of --global or --repo".to_string());
    }
    let scope = if global { "--global" } else { "--local" };
    let textconv = format!("{} git-diff", driver_program());
    let merge_driver = format!("{} git-merge %O %A %B %P", driver_program());
    let writes: Vec<(&str, Option<String>)> = if enable {
        vec![
            ("diff.aimd.textconv", Some(textconv)),
            ("diff.aimd.cachetextconv", Some("false".to_string())),
            ("merge.aimd.name", Some("AIMD merge driver".to_string())),
            ("merge.aimd.driver", Some(merge_driver)),
        ]
    } else {
        vec![
            ("diff.aimd.textconv", None),
            ("diff.aimd.cachetextconv", None),
            ("merge.aimd.name", None),
            ("merge.aimd.driver", None),
        ]
    };
    for (key, value) in writes {
        let status = if let Some(value) = value.as_deref() {
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

fn driver_program() -> String {
    env::current_exe()
        .ok()
        .filter(|path| path.is_file())
        .map(|path| quote_git_command_arg(&normalize_git_path(&path)))
        .unwrap_or_else(|| "aimd".to_string())
}

#[cfg(windows)]
fn normalize_git_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(not(windows))]
fn normalize_git_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_command_arg_quotes_paths_with_spaces() {
        assert_eq!(
            quote_git_command_arg("C:/Program Files/AIMD/bin/aimd.exe"),
            "\"C:/Program Files/AIMD/bin/aimd.exe\""
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_git_paths_use_forward_slashes() {
        assert_eq!(
            normalize_git_path(Path::new(r"C:\Program Files\AIMD\bin\aimd.exe")),
            "C:/Program Files/AIMD/bin/aimd.exe"
        );
    }
}
