use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::Path;
use std::process::Command;

use chrono::Utc;

use crate::canonical::{pack_canonical, sha256_hex, unpack_for_git, GitAimdPackage, GitAsset};
use crate::manifest::{Asset, Manifest, FILE_MAIN_MD, FORMAT_NAME, FORMAT_VERSION};

#[derive(Debug, Clone)]
pub struct GitMergeResult {
    pub had_text_conflicts: bool,
}

pub fn merge_aimd(
    base: &Path,
    ours: &Path,
    theirs: &Path,
    _worktree_path: &str,
) -> io::Result<GitMergeResult> {
    let base_pkg = unpack_for_git(base)?;
    let ours_pkg = unpack_for_git(ours)?;
    let theirs_pkg = unpack_for_git(theirs)?;

    ensure_no_asset_id_conflicts(&ours_pkg, &theirs_pkg)?;
    let merged_main = merge_markdown(
        &base_pkg.main_markdown,
        &ours_pkg.main_markdown,
        &theirs_pkg.main_markdown,
    )?;
    let had_text_conflicts = contains_conflict_markers_bytes(&merged_main);
    let assets = merge_assets(&base_pkg, &ours_pkg, &theirs_pkg, &merged_main)?;
    let manifest = merge_manifest(
        &base_pkg.manifest,
        &ours_pkg.manifest,
        &theirs_pkg.manifest,
        assets.values().map(|a| a.meta.clone()).collect(),
    );

    let merged = GitAimdPackage {
        manifest,
        main_markdown: merged_main,
        assets,
    };
    pack_canonical(&merged, ours)?;
    Ok(GitMergeResult { had_text_conflicts })
}

fn merge_markdown(base: &[u8], ours: &[u8], theirs: &[u8]) -> io::Result<Vec<u8>> {
    let temp = tempfile::tempdir()?;
    let base_path = temp.path().join("base.md");
    let ours_path = temp.path().join("ours.md");
    let theirs_path = temp.path().join("theirs.md");
    std::fs::write(&base_path, base)?;
    std::fs::write(&ours_path, ours)?;
    std::fs::write(&theirs_path, theirs)?;
    let output = Command::new("git")
        .args(["merge-file", "-p", "--diff3"])
        .arg(&ours_path)
        .arg(&base_path)
        .arg(&theirs_path)
        .output()
        .map_err(|e| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("start git merge-file: {e}"),
            )
        })?;
    if output.status.success() || output.status.code() == Some(1) {
        return Ok(output.stdout);
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    Err(io::Error::other(format!("git merge-file failed: {detail}")))
}

fn ensure_no_asset_id_conflicts(ours: &GitAimdPackage, theirs: &GitAimdPackage) -> io::Result<()> {
    for (id, ours_asset) in &ours.assets {
        if let Some(theirs_asset) = theirs.assets.get(id) {
            let ours_sha = sha256_hex(&ours_asset.bytes);
            let theirs_sha = sha256_hex(&theirs_asset.bytes);
            if ours_sha != theirs_sha {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("asset id conflict for {id}: different sha256"),
                ));
            }
        }
    }
    Ok(())
}

fn merge_assets(
    base: &GitAimdPackage,
    ours: &GitAimdPackage,
    theirs: &GitAimdPackage,
    merged_main: &[u8],
) -> io::Result<BTreeMap<String, GitAsset>> {
    let referenced = referenced_asset_ids(merged_main);
    let mut out = BTreeMap::new();
    for (id, asset) in &ours.assets {
        out.insert(id.clone(), asset.clone());
    }
    for (id, asset) in &theirs.assets {
        out.entry(id.clone()).or_insert_with(|| asset.clone());
    }
    for (id, asset) in &base.assets {
        if referenced.contains(id) {
            out.entry(id.clone()).or_insert_with(|| asset.clone());
        }
    }
    for asset in out.values_mut() {
        asset.meta.sha256 = sha256_hex(&asset.bytes);
        asset.meta.size = asset.bytes.len() as i64;
    }
    Ok(out)
}

fn merge_manifest(
    base: &Manifest,
    ours: &Manifest,
    theirs: &Manifest,
    assets: Vec<Asset>,
) -> Manifest {
    let mut manifest = ours.clone();
    manifest.format = FORMAT_NAME.to_string();
    manifest.version = FORMAT_VERSION.to_string();
    manifest.entry = FILE_MAIN_MD.to_string();
    manifest.created_at = [base.created_at, ours.created_at, theirs.created_at]
        .into_iter()
        .min()
        .unwrap_or(ours.created_at);
    manifest.updated_at = Utc::now();
    manifest.assets = assets;
    manifest.canonicalized()
}

fn referenced_asset_ids(markdown: &[u8]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let text = String::from_utf8_lossy(markdown);
    for m in text.match_indices("asset://") {
        let tail = &text[m.0 + "asset://".len()..];
        let id: String = tail
            .chars()
            .take_while(|c| !c.is_whitespace() && ![')', '"', '\'', '>', '<'].contains(c))
            .collect();
        if !id.is_empty() {
            out.insert(id);
        }
    }
    out
}

fn contains_conflict_markers_bytes(bytes: &[u8]) -> bool {
    let s = String::from_utf8_lossy(bytes);
    s.contains("<<<<<<<") && s.contains("=======") && s.contains(">>>>>>>")
}
