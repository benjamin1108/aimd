use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::cli::{SkillInstallArgs, SkillScope, SkillUninstallArgs};
use crate::util::print_json;

#[derive(Debug, Clone, Copy, Serialize)]
struct AgentSpec {
    name: &'static str,
    user_dir: &'static str,
    project_dir: &'static str,
    aliases: &'static [&'static str],
}

const AGENTS: &[AgentSpec] = &[
    AgentSpec {
        name: "ClaudeCode",
        user_dir: "~/.claude/skills",
        project_dir: ".claude/skills",
        aliases: &["claude-code", "claude", "claudecode"],
    },
    AgentSpec {
        name: "GitHubCopilot",
        user_dir: "~/.copilot/skills",
        project_dir: ".github/skills",
        aliases: &["github-copilot", "copilot", "githubcopilot"],
    },
    AgentSpec {
        name: "OpenAI Codex",
        user_dir: "~/.agents/skills",
        project_dir: ".agents/skills",
        aliases: &["codex", "openai-codex", "openai codex"],
    },
    AgentSpec {
        name: "GeminiCLI",
        user_dir: "~/.gemini/skills",
        project_dir: ".gemini/skills",
        aliases: &["gemini", "gemini-cli", "geminicli"],
    },
    AgentSpec {
        name: "Cursor",
        user_dir: "~/.cursor/skills",
        project_dir: ".cursor/skills",
        aliases: &["cursor"],
    },
    AgentSpec {
        name: "Amp",
        user_dir: "~/.config/agents/skills",
        project_dir: ".agents/skills",
        aliases: &["amp"],
    },
    AgentSpec {
        name: "Goose",
        user_dir: "~/.agents/skills",
        project_dir: ".agents/skills",
        aliases: &["goose"],
    },
    AgentSpec {
        name: "OpenCode",
        user_dir: "~/.config/opencode/skills",
        project_dir: ".opencode/skills",
        aliases: &["opencode", "open-code"],
    },
    AgentSpec {
        name: "Windsurf",
        user_dir: "~/.codeium/windsurf/skills",
        project_dir: ".windsurf/skills",
        aliases: &["windsurf"],
    },
    AgentSpec {
        name: "Antigravity",
        user_dir: "~/.gemini/antigravity/skills",
        project_dir: ".agents/skills",
        aliases: &["antigravity"],
    },
    AgentSpec {
        name: "Cline",
        user_dir: "~/.agents/skills",
        project_dir: ".agents/skills",
        aliases: &["cline"],
    },
    AgentSpec {
        name: "Warp",
        user_dir: "~/.agents/skills",
        project_dir: ".agents/skills",
        aliases: &["warp"],
    },
    AgentSpec {
        name: "Continue",
        user_dir: "~/.continue/skills",
        project_dir: ".continue/skills",
        aliases: &["continue"],
    },
    AgentSpec {
        name: "Roo",
        user_dir: "~/.roo/skills",
        project_dir: ".roo/skills",
        aliases: &["roo"],
    },
    AgentSpec {
        name: "KiroCLI",
        user_dir: "~/.kiro/skills",
        project_dir: ".kiro/skills",
        aliases: &["kiro", "kiro-cli", "kirocli"],
    },
    AgentSpec {
        name: "QwenCode",
        user_dir: "~/.qwen/skills",
        project_dir: ".qwen/skills",
        aliases: &["qwen", "qwen-code", "qwencode"],
    },
    AgentSpec {
        name: "OpenHands",
        user_dir: "~/.openhands/skills",
        project_dir: ".openhands/skills",
        aliases: &["openhands", "open-hands"],
    },
    AgentSpec {
        name: "Qoder / QoderWork",
        user_dir: "~/.qoderwork/skills",
        project_dir: ".qoder/skills",
        aliases: &["qoder", "qoderwork", "qoder-work"],
    },
];

pub fn cmd_skill_list_agents() -> Result<(), String> {
    println!("agent\tuser\tproject\taliases");
    for agent in AGENTS {
        println!(
            "{}\t{}\t{}\t{}",
            agent.name,
            agent.user_dir,
            agent.project_dir,
            agent.aliases.join(",")
        );
    }
    Ok(())
}

pub fn cmd_skill_install(args: SkillInstallArgs) -> Result<(), String> {
    let agent = find_agent(&args.agent)?;
    let source = find_skill_source()?;
    let target = skill_target_dir(agent, args.scope, args.project.as_deref())?.join("aimd");
    if target.exists() {
        if !args.force {
            return Err(format!(
                "AIMD skill already exists at {}; rerun with --force to replace it",
                target.display()
            ));
        }
        fs::remove_dir_all(&target).map_err(|e| format!("remove existing skill: {e}"))?;
    }
    copy_dir_all(&source, &target).map_err(|e| format!("install skill: {e}"))?;
    println!(
        "installed AIMD skill for {} at {}",
        agent.name,
        target.display()
    );
    println!("next: restart or reload the target agent so it can discover the skill");
    Ok(())
}

pub fn cmd_skill_uninstall(args: SkillUninstallArgs) -> Result<(), String> {
    let agent = find_agent(&args.agent)?;
    let target = skill_target_dir(agent, args.scope, args.project.as_deref())?.join("aimd");
    if !target.exists() {
        println!("AIMD skill is not installed at {}", target.display());
        return Ok(());
    }
    fs::remove_dir_all(&target).map_err(|e| format!("uninstall skill: {e}"))?;
    println!("removed AIMD skill from {}", target.display());
    Ok(())
}

pub fn cmd_skill_doctor(json: bool) -> Result<(), String> {
    let source = find_skill_source().ok();
    let report = SkillDoctorReport {
        cli: env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "unknown".to_string()),
        source: source.as_ref().map(|p| p.display().to_string()),
        agents: AGENTS
            .iter()
            .map(|agent| {
                let user =
                    expand_tilde(agent.user_dir).unwrap_or_else(|_| PathBuf::from(agent.user_dir));
                let project = PathBuf::from(agent.project_dir);
                SkillDoctorAgent {
                    agent: agent.name.to_string(),
                    user_dir: user.display().to_string(),
                    user_exists: user.exists(),
                    user_writable: dir_writable(&user),
                    user_installed: user.join("aimd/SKILL.md").is_file(),
                    project_dir: project.display().to_string(),
                    project_installed: project.join("aimd/SKILL.md").is_file(),
                }
            })
            .collect(),
    };
    if json {
        print_json(&report)
    } else {
        println!("aimd CLI: {}", report.cli);
        println!(
            "skill source: {}",
            report.source.as_deref().unwrap_or("not found")
        );
        println!("agent\tuser dir\twritable\tinstalled\tproject dir\tproject installed");
        for agent in report.agents {
            println!(
                "{}\t{}\t{}\t{}\t{}\t{}",
                agent.agent,
                agent.user_dir,
                agent.user_writable,
                agent.user_installed,
                agent.project_dir,
                agent.project_installed
            );
        }
        Ok(())
    }
}

fn find_agent(name: &str) -> Result<&'static AgentSpec, String> {
    let wanted = normalize_agent_name(name);
    AGENTS
        .iter()
        .find(|agent| {
            normalize_agent_name(agent.name) == wanted
                || agent
                    .aliases
                    .iter()
                    .any(|alias| normalize_agent_name(alias) == wanted)
        })
        .ok_or_else(|| format!("unsupported agent: {name}; run `aimd skill list-agents`"))
}

fn normalize_agent_name(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_' && *c != '/')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn skill_target_dir(
    agent: &AgentSpec,
    scope: SkillScope,
    project: Option<&Path>,
) -> Result<PathBuf, String> {
    match scope {
        SkillScope::User => expand_tilde(agent.user_dir),
        SkillScope::Project => {
            let root = project
                .map(Path::to_path_buf)
                .unwrap_or(env::current_dir().map_err(|e| format!("current dir: {e}"))?);
            Ok(root.join(agent.project_dir))
        }
    }
}

fn find_skill_source() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("AIMD_SKILL_SOURCE") {
        let candidate = PathBuf::from(path);
        if candidate.join("SKILL.md").is_file() {
            return Ok(candidate);
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(install_root) = exe.parent().and_then(Path::parent) {
            let installed = install_root.join("share/skill/aimd");
            if installed.join("SKILL.md").is_file() {
                return Ok(installed);
            }
        }
    }
    if let Ok(cwd) = env::current_dir() {
        let repo = cwd.join("skill");
        if repo.join("SKILL.md").is_file() {
            return Ok(repo);
        }
    }
    let system = PathBuf::from("/usr/local/share/aimd/skill/aimd");
    if system.join("SKILL.md").is_file() {
        return Ok(system);
    }
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        let windows_user = PathBuf::from(local_app_data).join("AIMD/share/skill/aimd");
        if windows_user.join("SKILL.md").is_file() {
            return Ok(windows_user);
        }
    }
    Err(
        "AIMD skill source not found; install the AIMD CLI/skill package or run from the AIMD repository"
            .to_string(),
    )
}

fn expand_tilde(path: &str) -> Result<PathBuf, String> {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = env::var("HOME")
            .or_else(|_| env::var("USERPROFILE"))
            .map_err(|_| "HOME or USERPROFILE is not set".to_string())?;
        Ok(PathBuf::from(home).join(rest))
    } else {
        Ok(PathBuf::from(path))
    }
}

fn copy_dir_all(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest = target.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

fn dir_writable(path: &Path) -> bool {
    if path.exists() {
        let probe = path.join(".aimd-write-test");
        match fs::File::create(&probe) {
            Ok(_) => {
                let _ = fs::remove_file(probe);
                true
            }
            Err(_) => false,
        }
    } else {
        path.parent().is_some_and(dir_writable)
    }
}

#[derive(Serialize)]
struct SkillDoctorReport {
    cli: String,
    source: Option<String>,
    agents: Vec<SkillDoctorAgent>,
}

#[derive(Serialize)]
struct SkillDoctorAgent {
    agent: String,
    user_dir: String,
    user_exists: bool,
    user_writable: bool,
    user_installed: bool,
    project_dir: String,
    project_installed: bool,
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Mutex;

    use super::*;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn agent_aliases_and_paths_work() {
        let codex = find_agent("openai-codex").unwrap();
        assert_eq!(codex.project_dir, ".agents/skills");
        let qoder = find_agent("qoderwork").unwrap();
        assert_eq!(qoder.user_dir, "~/.qoderwork/skills");
    }

    #[test]
    fn expand_tilde_uses_windows_userprofile_when_home_is_missing() {
        let _guard = ENV_LOCK.lock().unwrap();
        let original_home = env::var_os("HOME");
        let original_userprofile = env::var_os("USERPROFILE");
        env::remove_var("HOME");
        env::set_var("USERPROFILE", r"C:\Users\AIMD");

        let expanded = expand_tilde("~/AppData").unwrap();
        assert_eq!(expanded, PathBuf::from(r"C:\Users\AIMD").join("AppData"));

        if let Some(home) = original_home {
            env::set_var("HOME", home);
        }
        if let Some(userprofile) = original_userprofile {
            env::set_var("USERPROFILE", userprofile);
        } else {
            env::remove_var("USERPROFILE");
        }
    }

    #[test]
    fn copy_dir_all_installs_nested_skill_files() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        fs::create_dir_all(source.join("references")).unwrap();
        fs::write(source.join("SKILL.md"), "skill").unwrap();
        fs::write(source.join("references/cli.md"), "cli").unwrap();
        let target = tmp.path().join("repo/.agents/skills/aimd");
        copy_dir_all(&source, &target).unwrap();
        assert!(target.join("SKILL.md").is_file());
        assert!(target.join("references/cli.md").is_file());
    }
}
