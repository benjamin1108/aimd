use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::Serialize;

#[derive(Parser)]
#[command(
    name = "aimd",
    version,
    about = "Read, edit, validate, package, and integrate AIMD documents"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Print the AIMD CLI version.
    Version,
    /// Print main.md from an AIMD document.
    Read { file: PathBuf },
    /// Print document metadata and health summary.
    Info {
        file: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Print manifest.json.
    Manifest { file: PathBuf },
    /// Validate container, manifest, entry, assets, and asset:// references.
    Doctor {
        file: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Replace main.md while preserving package metadata and assets.
    Write(WriteArgs),
    /// Update only manifest title while preserving body, assets, and metadata.
    SetTitle(SetTitleArgs),
    /// Create a new AIMD document from Markdown.
    New(NewArgs),
    /// Remove manifest assets that are not referenced by main.md.
    Gc { file: PathBuf },
    /// Rewrite an AIMD document into canonical ZIP and manifest order.
    Canonicalize { file: PathBuf },
    /// List, extract, add, and remove AIMD assets.
    Assets {
        #[command(subcommand)]
        command: AssetsCommand,
    },
    /// Install or inspect the AIMD Agent skill for supported agents.
    Skill {
        #[command(subcommand)]
        command: SkillCommand,
    },
    /// Git textconv output for .aimd files.
    GitDiff { file: PathBuf },
    /// Three-way merge driver for .aimd files.
    GitMerge {
        base: PathBuf,
        ours: PathBuf,
        theirs: PathBuf,
        path: String,
    },
    /// Install AIMD Git diff and merge config.
    GitInstall(GitScopeArgs),
    /// Remove AIMD Git diff and merge config.
    GitUninstall(GitScopeArgs),
    /// Print Git integration diagnostics.
    GitDoctor {
        #[arg(long)]
        repo: bool,
    },
}

#[derive(Args)]
pub struct GitScopeArgs {
    #[arg(long, conflicts_with = "repo")]
    pub global: bool,
    #[arg(long, conflicts_with = "global")]
    pub repo: bool,
}

#[derive(Args)]
pub struct WriteArgs {
    pub file: PathBuf,
    #[arg(long, conflicts_with = "stdin")]
    pub input: Option<PathBuf>,
    #[arg(long)]
    pub stdin: bool,
    #[arg(long)]
    pub title: Option<String>,
    #[arg(long)]
    pub gc: bool,
    #[arg(long)]
    pub canonicalize: bool,
}

#[derive(Args)]
pub struct SetTitleArgs {
    pub file: PathBuf,
    pub title: String,
    #[arg(long)]
    pub canonicalize: bool,
}

#[derive(Args)]
pub struct NewArgs {
    pub out: PathBuf,
    #[arg(long)]
    pub input: PathBuf,
    #[arg(long)]
    pub title: Option<String>,
    #[arg(long)]
    pub embed_local_images: bool,
}

#[derive(Subcommand)]
pub enum AssetsCommand {
    /// List manifest assets.
    List {
        file: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Extract one asset by manifest id.
    Extract {
        file: PathBuf,
        asset_id: String,
        #[arg(long)]
        output: PathBuf,
    },
    /// Add a local file as an AIMD asset and print the asset:// reference.
    Add(AssetAddArgs),
    /// Remove an asset by manifest id.
    Remove { file: PathBuf, asset_id: String },
}

#[derive(Args)]
pub struct AssetAddArgs {
    pub file: PathBuf,
    pub local_path: PathBuf,
    #[arg(long)]
    pub id: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub role: Option<String>,
    #[arg(long)]
    pub mime: Option<String>,
}

#[derive(Subcommand)]
pub enum SkillCommand {
    /// List supported agents and their user/project skill directories.
    ListAgents,
    /// Install the bundled AIMD skill into an agent skills directory.
    Install(SkillInstallArgs),
    /// Remove the installed AIMD skill from an agent skills directory.
    Uninstall(SkillUninstallArgs),
    /// Print AIMD skill installation diagnostics.
    Doctor {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args)]
pub struct SkillInstallArgs {
    #[arg(long)]
    pub agent: String,
    #[arg(long, value_enum)]
    pub scope: SkillScope,
    #[arg(long)]
    pub project: Option<PathBuf>,
    #[arg(long)]
    pub force: bool,
}

#[derive(Args)]
pub struct SkillUninstallArgs {
    #[arg(long)]
    pub agent: String,
    #[arg(long, value_enum)]
    pub scope: SkillScope,
    #[arg(long)]
    pub project: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, ValueEnum, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillScope {
    User,
    Project,
}
