use std::io;
use std::path::Path;

use crate::canonical::unpack_for_git;

pub fn textconv(path: &Path) -> io::Result<String> {
    let package = unpack_for_git(path)?;
    let main = String::from_utf8(package.main_markdown).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("main.md is not utf-8: {e}"),
        )
    })?;
    let manifest = package.manifest.canonicalized();

    let mut out = String::new();
    out.push_str("--- AIMD main.md ---\n");
    out.push_str(&main);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("\n--- AIMD manifest.json ---\n");
    out.push_str(&format!(
        "{{\n  \"format\": \"{}\",\n  \"version\": \"{}\",\n  \"title\": \"{}\",\n  \"entry\": \"{}\",\n  \"createdAt\": \"{}\"\n}}",
        escape_json_string(&manifest.format),
        escape_json_string(&manifest.version),
        escape_json_string(&manifest.title),
        escape_json_string(&manifest.entry),
        manifest.created_at.to_rfc3339()
    ));
    out.push_str("\n\n--- AIMD assets ---\n");
    out.push_str("id\tpath\tmime\tsize\tsha256\trole\n");
    let mut assets = manifest.assets.clone();
    assets.sort_by(|a, b| a.id.cmp(&b.id).then_with(|| a.path.cmp(&b.path)));
    for asset in assets {
        out.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\n",
            asset.id, asset.path, asset.mime, asset.size, asset.sha256, asset.role
        ));
    }
    Ok(out)
}

fn escape_json_string(value: &str) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| "\"\"".to_string())
        .trim_matches('"')
        .to_string()
}
