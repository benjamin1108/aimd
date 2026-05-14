use std::env;
use std::path::{Path, PathBuf};
use std::process;

use aimd_core::{canonical, git_diff, git_merge};

fn main() {
    if let Err(err) = run() {
        eprintln!("aimd: {err}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let Some(cmd) = args.next() else {
        return Err(usage());
    };
    let rest: Vec<String> = args.collect();
    match cmd.as_str() {
        "git-diff" => {
            if rest.len() != 1 {
                return Err("usage: aimd git-diff <file.aimd>".to_string());
            }
            let out = git_diff::textconv(Path::new(&rest[0]))
                .map_err(|e| format!("git-diff failed: {e}"))?;
            print!("{out}");
            Ok(())
        }
        "git-merge" => {
            if rest.len() != 4 {
                return Err(
                    "usage: aimd git-merge <base.aimd> <ours.aimd> <theirs.aimd> <path>"
                        .to_string(),
                );
            }
            git_merge::merge_aimd(
                Path::new(&rest[0]),
                Path::new(&rest[1]),
                Path::new(&rest[2]),
                &rest[3],
            )
            .map_err(|e| format!("git-merge failed: {e}"))?;
            Ok(())
        }
        "canonicalize" => {
            if rest.len() != 1 {
                return Err("usage: aimd canonicalize <file.aimd>".to_string());
            }
            let path = PathBuf::from(&rest[0]);
            let tmp = path.with_extension("aimd.canonical.tmp");
            canonical::canonicalize_aimd(&path, &tmp)
                .map_err(|e| format!("canonicalize failed: {e}"))?;
            std::fs::rename(&tmp, &path).map_err(|e| format!("replace canonical file: {e}"))?;
            Ok(())
        }
        "git-install" => git_config_command(true, &rest),
        "git-uninstall" => git_config_command(false, &rest),
        "git-doctor" => {
            let repo = rest.iter().any(|a| a == "--repo");
            println!(
                "aimd CLI: {}",
                env::current_exe()
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|_| "unknown".to_string())
            );
            println!(
                "git: {}",
                git_version().unwrap_or_else(|e| format!("unavailable ({e})"))
            );
            println!("scope: {}", if repo { "repo" } else { "global" });
            Ok(())
        }
        _ => Err(usage()),
    }
}

fn git_config_command(enable: bool, args: &[String]) -> Result<(), String> {
    let global = args.iter().any(|a| a == "--global");
    let repo = args.iter().any(|a| a == "--repo");
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

fn git_version() -> Result<String, String> {
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

fn usage() -> String {
    "usage: aimd <git-diff|git-merge|git-install|git-uninstall|git-doctor|canonicalize> ..."
        .to_string()
}
