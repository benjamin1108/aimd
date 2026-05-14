mod cli;
mod commands;
mod doctor;
mod git;
mod skill;
mod util;

use std::{env, process};

use aimd_core::{git_diff, git_merge};
use clap::Parser;

use crate::cli::{AssetsCommand, Cli, Command, SkillCommand};
use crate::commands::{
    cmd_assets_add, cmd_assets_extract, cmd_assets_list, cmd_assets_remove, cmd_canonicalize,
    cmd_doctor, cmd_gc, cmd_info, cmd_manifest, cmd_new, cmd_read, cmd_set_title, cmd_write,
};
use crate::git::{git_config_command, git_version};
use crate::skill::{
    cmd_skill_doctor, cmd_skill_install, cmd_skill_list_agents, cmd_skill_uninstall,
};

fn main() {
    if let Err(err) = run() {
        eprintln!("aimd: {err}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let cli = Cli::parse();
    match cli.command {
        Command::Read { file } => cmd_read(&file),
        Command::Info { file, json } => cmd_info(&file, json),
        Command::Manifest { file } => cmd_manifest(&file),
        Command::Doctor { file, json } => cmd_doctor(&file, json),
        Command::Write(args) => cmd_write(args),
        Command::SetTitle(args) => cmd_set_title(args),
        Command::New(args) => cmd_new(args),
        Command::Gc { file } => cmd_gc(&file),
        Command::Canonicalize { file } => cmd_canonicalize(&file),
        Command::Assets { command } => match command {
            AssetsCommand::List { file, json } => cmd_assets_list(&file, json),
            AssetsCommand::Extract {
                file,
                asset_id,
                output,
            } => cmd_assets_extract(&file, &asset_id, &output),
            AssetsCommand::Add(args) => cmd_assets_add(args),
            AssetsCommand::Remove { file, asset_id } => cmd_assets_remove(&file, &asset_id),
        },
        Command::Skill { command } => match command {
            SkillCommand::ListAgents => cmd_skill_list_agents(),
            SkillCommand::Install(args) => cmd_skill_install(args),
            SkillCommand::Uninstall(args) => cmd_skill_uninstall(args),
            SkillCommand::Doctor { json } => cmd_skill_doctor(json),
        },
        Command::GitDiff { file } => {
            let out = git_diff::textconv(&file).map_err(|e| format!("git-diff failed: {e}"))?;
            print!("{out}");
            Ok(())
        }
        Command::GitMerge {
            base,
            ours,
            theirs,
            path,
        } => git_merge::merge_aimd(&base, &ours, &theirs, &path)
            .map(|_| ())
            .map_err(|e| format!("git-merge failed: {e}")),
        Command::GitInstall(args) => git_config_command(true, args.global, args.repo),
        Command::GitUninstall(args) => git_config_command(false, args.global, args.repo),
        Command::GitDoctor { repo } => {
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
    }
}
