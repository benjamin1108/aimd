use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, Read as _, Write as _};
use std::path::Path;

use aimd_core::manifest;
use aimd_core::{
    canonical, pack_run_with_markdown, rewrite_file, set_title_file, unique_asset_name, NewAsset,
    Reader, RewriteOptions,
};
use serde::Serialize;

use crate::cli::{AssetAddArgs, NewArgs, SetTitleArgs, WriteArgs};
use crate::doctor::{body_title_from_markdown, doctor_report};
use crate::util::{empty_dash, print_json};

pub fn cmd_read(file: &Path) -> Result<(), String> {
    let reader = Reader::open(file).map_err(|e| format!("read {file:?}: {e}"))?;
    let body = reader
        .main_markdown()
        .map_err(|e| format!("read main markdown: {e}"))?;
    io::stdout()
        .write_all(&body)
        .map_err(|e| format!("write stdout: {e}"))
}

pub fn cmd_info(file: &Path, json: bool) -> Result<(), String> {
    let reader = Reader::open(file).map_err(|e| format!("open {file:?}: {e}"))?;
    let report = doctor_report(file);
    let info = DocumentInfo {
        title: reader.manifest.title.clone(),
        body_title: reader
            .main_markdown()
            .ok()
            .and_then(|markdown| body_title_from_markdown(&markdown)),
        format: reader.manifest.format.clone(),
        version: reader.manifest.version.clone(),
        entry: reader.manifest.entry.clone(),
        created_at: reader.manifest.created_at.to_rfc3339(),
        updated_at: reader.manifest.updated_at.to_rfc3339(),
        asset_count: reader.manifest.assets.len(),
        authors: reader
            .manifest
            .authors
            .iter()
            .map(|a| a.name.clone())
            .collect(),
        generated_by: reader
            .manifest
            .generated_by
            .as_ref()
            .map(|g| format!("{}:{}:{}", g.gen_type, g.provider, g.model)),
        health_status: if report.errors.is_empty() {
            "ok"
        } else {
            "error"
        }
        .to_string(),
        warnings: report.warnings.len(),
        errors: report.errors.len(),
    };
    if json {
        print_json(&info)
    } else {
        println!("title: {}", empty_dash(&info.title));
        if let Some(body_title) = &info.body_title {
            println!("bodyTitle: {body_title}");
        }
        println!("format: {} {}", info.format, info.version);
        println!("entry: {}", info.entry);
        println!("assets: {}", info.asset_count);
        println!("health: {}", info.health_status);
        for err in report.errors {
            println!("error: {err}");
        }
        for warning in report.warnings {
            println!("warning: {}", warning.message);
        }
        Ok(())
    }
}

pub fn cmd_manifest(file: &Path) -> Result<(), String> {
    let reader = Reader::open(file).map_err(|e| format!("open {file:?}: {e}"))?;
    print_json(&reader.manifest)
}

pub fn cmd_doctor(file: &Path, json: bool) -> Result<(), String> {
    let report = doctor_report(file);
    if json {
        print_json(&report)?;
    } else {
        println!("file: {}", file.display());
        println!(
            "status: {}",
            if report.errors.is_empty() {
                "ok"
            } else {
                "error"
            }
        );
        println!("assets: {}", report.asset_count);
        for warning in &report.warnings {
            println!("warning: {}", warning.message);
        }
        for error in &report.errors {
            println!("error: {error}");
        }
    }
    if report.errors.is_empty() {
        Ok(())
    } else {
        Err("doctor found errors".to_string())
    }
}

pub fn cmd_write(args: WriteArgs) -> Result<(), String> {
    let markdown = read_input(args.input.as_deref(), args.stdin)?;
    rewrite_file(
        &args.file,
        RewriteOptions {
            markdown,
            title: args.title,
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: args.gc,
        },
    )
    .map_err(|e| format!("write failed: {e}"))?;
    if args.canonicalize {
        canonicalize_in_place(&args.file)?;
    }
    Ok(())
}

pub fn cmd_set_title(args: SetTitleArgs) -> Result<(), String> {
    set_title_file(&args.file, args.title).map_err(|e| format!("set-title failed: {e}"))?;
    if args.canonicalize {
        canonicalize_in_place(&args.file)?;
    }
    Ok(())
}

pub fn cmd_new(args: NewArgs) -> Result<(), String> {
    let markdown = fs::read(&args.input).map_err(|e| format!("read markdown input: {e}"))?;
    if args.embed_local_images {
        pack_run_with_markdown(&args.input, &markdown, &args.out, args.title.as_deref())
            .map_err(|e| format!("new failed: {e}"))
    } else {
        let title = args.title.unwrap_or_else(|| {
            args.input
                .file_stem()
                .and_then(OsStr::to_str)
                .unwrap_or("document")
                .to_string()
        });
        let manifest = manifest::Manifest::new(title);
        aimd_core::writer::create(&args.out, manifest, |w| w.set_main_markdown(&markdown))
            .map_err(|e| format!("new failed: {e}"))
    }
}

pub fn cmd_gc(file: &Path) -> Result<(), String> {
    let reader = Reader::open(file).map_err(|e| format!("open {file:?}: {e}"))?;
    let markdown = reader
        .main_markdown()
        .map_err(|e| format!("read main markdown: {e}"))?;
    rewrite_file(
        file,
        RewriteOptions {
            markdown,
            title: None,
            delete_assets: None,
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: true,
        },
    )
    .map_err(|e| format!("gc failed: {e}"))
}

pub fn cmd_canonicalize(file: &Path) -> Result<(), String> {
    canonicalize_in_place(file)
}

pub fn cmd_assets_list(file: &Path, json: bool) -> Result<(), String> {
    let reader = Reader::open(file).map_err(|e| format!("open {file:?}: {e}"))?;
    if json {
        print_json(&reader.manifest.assets)
    } else {
        println!("id\tpath\tmime\tsize\tsha256\trole");
        for asset in &reader.manifest.assets {
            println!(
                "{}\t{}\t{}\t{}\t{}\t{}",
                asset.id, asset.path, asset.mime, asset.size, asset.sha256, asset.role
            );
        }
        Ok(())
    }
}

pub fn cmd_assets_extract(file: &Path, asset_id: &str, output: &Path) -> Result<(), String> {
    let reader = Reader::open(file).map_err(|e| format!("open {file:?}: {e}"))?;
    let (data, _) = reader
        .asset_by_id(asset_id)
        .map_err(|e| format!("extract asset: {e}"))?;
    if output == Path::new("-") {
        io::stdout()
            .write_all(&data)
            .map_err(|e| format!("write stdout: {e}"))
    } else {
        if let Some(parent) = output.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent).map_err(|e| format!("create output dir: {e}"))?;
        }
        fs::write(output, data).map_err(|e| format!("write output: {e}"))
    }
}

pub fn cmd_assets_add(args: AssetAddArgs) -> Result<(), String> {
    let reader = Reader::open(&args.file).map_err(|e| format!("open {:?}: {e}", args.file))?;
    let data = fs::read(&args.local_path).map_err(|e| format!("read local asset: {e}"))?;
    let name = args.name.unwrap_or_else(|| {
        args.local_path
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("asset.bin")
            .to_string()
    });
    let (auto_id, filename) = unique_asset_name(Some(&reader.manifest), &name);
    let id = args.id.unwrap_or(auto_id);
    validate_asset_id(&id)?;
    if reader.manifest.assets.iter().any(|asset| asset.id == id) {
        return Err(format!("asset id already exists: {id}"));
    }
    let markdown = reader
        .main_markdown()
        .map_err(|e| format!("read main markdown: {e}"))?;
    rewrite_file(
        &args.file,
        RewriteOptions {
            markdown,
            title: None,
            delete_assets: None,
            add_assets: vec![NewAsset {
                id: id.clone(),
                filename,
                data,
                role: args
                    .role
                    .unwrap_or_else(|| manifest::ROLE_CONTENT_IMAGE.to_string()),
                mime: args.mime,
                extra: Default::default(),
            }],
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .map_err(|e| format!("add asset failed: {e}"))?;
    println!("asset://{id}");
    Ok(())
}

pub fn cmd_assets_remove(file: &Path, asset_id: &str) -> Result<(), String> {
    let reader = Reader::open(file).map_err(|e| format!("open {file:?}: {e}"))?;
    if reader.manifest.find_asset(asset_id).is_none() {
        return Err(format!("asset not found: {asset_id}"));
    }
    let markdown = reader
        .main_markdown()
        .map_err(|e| format!("read main markdown: {e}"))?;
    rewrite_file(
        file,
        RewriteOptions {
            markdown,
            title: None,
            delete_assets: Some(HashSet::from([asset_id.to_string()])),
            add_assets: Vec::new(),
            add_files: Vec::new(),
            delete_files: HashSet::new(),
            gc_unreferenced: false,
        },
    )
    .map_err(|e| format!("remove asset failed: {e}"))
}

fn canonicalize_in_place(file: &Path) -> Result<(), String> {
    let tmp = file.with_extension("aimd.canonical.tmp");
    canonical::canonicalize_aimd(file, &tmp).map_err(|e| format!("canonicalize failed: {e}"))?;
    fs::rename(&tmp, file).map_err(|e| format!("replace canonical file: {e}"))
}

fn read_input(input: Option<&Path>, stdin: bool) -> Result<Vec<u8>, String> {
    if let Some(path) = input {
        fs::read(path).map_err(|e| format!("read input: {e}"))
    } else if stdin {
        let mut buf = Vec::new();
        io::stdin()
            .read_to_end(&mut buf)
            .map_err(|e| format!("read stdin: {e}"))?;
        Ok(buf)
    } else {
        Err("choose --input PATH or --stdin".to_string())
    }
}

fn validate_asset_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        Err(format!("invalid asset id: {id}"))
    } else {
        Ok(())
    }
}

#[derive(Serialize)]
struct DocumentInfo {
    title: String,
    #[serde(rename = "bodyTitle")]
    body_title: Option<String>,
    format: String,
    version: String,
    entry: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "assetCount")]
    asset_count: usize,
    authors: Vec<String>,
    #[serde(rename = "generatedBy")]
    generated_by: Option<String>,
    #[serde(rename = "healthStatus")]
    health_status: String,
    warnings: usize,
    errors: usize,
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;

    use aimd_core::{manifest, rewrite_file, Reader, RewriteOptions, Writer};

    use super::{cmd_set_title, cmd_write, validate_asset_id};
    use crate::cli::{SetTitleArgs, WriteArgs};

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    fn make_aimd(path: &Path, markdown: &[u8]) {
        let manifest = manifest::Manifest::new("Test");
        let mut writer = Writer::new(manifest);
        writer.set_main_markdown(markdown).unwrap();
        writer
            .add_asset("img-001", "image.png", PNG, manifest::ROLE_CONTENT_IMAGE)
            .unwrap();
        fs::write(path, writer.finish_bytes().unwrap()).unwrap();
    }

    #[test]
    fn write_gc_removes_unreferenced_asset() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("doc.aimd");
        make_aimd(&file, b"![x](asset://img-001)");
        rewrite_file(
            &file,
            RewriteOptions {
                markdown: b"# Changed".to_vec(),
                title: None,
                delete_assets: None,
                add_assets: Vec::new(),
                add_files: Vec::new(),
                delete_files: HashSet::new(),
                gc_unreferenced: true,
            },
        )
        .unwrap();
        let reader = Reader::open(&file).unwrap();
        assert!(reader.manifest.assets.is_empty());
    }

    #[test]
    fn asset_id_validation_rejects_paths() {
        assert!(validate_asset_id("../bad").is_err());
        assert!(validate_asset_id("image-001").is_ok());
    }

    #[test]
    fn write_can_update_manifest_title_without_changing_asset_id() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("doc.aimd");
        let input = tmp.path().join("body.md");
        make_aimd(&file, b"# Old\n\n![x](asset://img-001)");
        fs::write(&input, b"# Body\n\n![x](asset://img-001)").unwrap();
        let before = Reader::open(&file).unwrap();
        let before_asset = before.manifest.assets[0].clone();

        cmd_write(WriteArgs {
            file: file.clone(),
            input: Some(input),
            stdin: false,
            title: Some("Manifest Title".to_string()),
            gc: false,
            canonicalize: false,
        })
        .unwrap();

        let after = Reader::open(&file).unwrap();
        assert_eq!(after.manifest.title, "Manifest Title");
        assert_eq!(
            after.main_markdown().unwrap(),
            b"# Body\n\n![x](asset://img-001)"
        );
        assert_eq!(after.manifest.assets[0].id, before_asset.id);
        assert_eq!(after.manifest.assets[0].sha256, before_asset.sha256);
    }

    #[test]
    fn set_title_preserves_body_and_assets() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("doc.aimd");
        make_aimd(&file, b"# Body\n\n![x](asset://img-001)");
        let before = Reader::open(&file).unwrap();
        let before_body = before.main_markdown().unwrap();
        let before_asset = before.manifest.assets[0].clone();

        cmd_set_title(SetTitleArgs {
            file: file.clone(),
            title: "Only Metadata".to_string(),
            canonicalize: false,
        })
        .unwrap();

        let after = Reader::open(&file).unwrap();
        assert_eq!(after.manifest.title, "Only Metadata");
        assert_eq!(after.main_markdown().unwrap(), before_body);
        assert_eq!(after.manifest.assets[0].id, before_asset.id);
        assert_eq!(after.manifest.assets[0].path, before_asset.path);
        assert_eq!(after.manifest.assets[0].sha256, before_asset.sha256);
    }
}
