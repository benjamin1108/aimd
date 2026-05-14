use super::*;
use std::fs;
use std::path::Path;

fn tmp_root() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn document_format_filters_supported_extensions() {
    assert_eq!(
        workspace_document_format(Path::new("a.aimd")),
        Some(WorkspaceDocumentFormat::Aimd)
    );
    assert_eq!(
        workspace_document_format(Path::new("a.md")),
        Some(WorkspaceDocumentFormat::Markdown)
    );
    assert_eq!(
        workspace_document_format(Path::new("a.markdown")),
        Some(WorkspaceDocumentFormat::Markdown)
    );
    assert_eq!(
        workspace_document_format(Path::new("a.mdx")),
        Some(WorkspaceDocumentFormat::Markdown)
    );
    assert_eq!(workspace_document_format(Path::new("a.png")), None);
}

#[test]
fn path_must_stay_inside_workspace_root() {
    let root = tmp_root();
    let outside = tempfile::NamedTempFile::new().unwrap();
    let root_path = canonical_root(root.path().to_str().unwrap()).unwrap();
    let err =
        ensure_existing_inside_root(&root_path, outside.path().to_str().unwrap()).unwrap_err();
    assert!(err.contains("工作目录之外"));
}

#[test]
fn tree_skips_hidden_and_non_document_files() {
    let root = tmp_root();
    fs::write(root.path().join("doc.md"), "# Doc").unwrap();
    fs::write(root.path().join("image.png"), "png").unwrap();
    fs::create_dir(root.path().join(".git")).unwrap();
    fs::write(root.path().join(".git").join("hidden.md"), "# Hidden").unwrap();
    let tree = read_workspace_tree_inner(root.path().to_str().unwrap()).unwrap();
    let children = tree.tree.children.unwrap();
    assert!(children.iter().any(|node| node.name == "doc.md"));
    assert!(!children.iter().any(|node| node.name == "image.png"));
    assert!(!children.iter().any(|node| node.name == ".git"));
}

#[test]
fn create_rename_move_and_trash_entries() {
    let root = tmp_root();
    let root_str = root.path().to_string_lossy().to_string();

    create_workspace_folder(root_str.clone(), root_str.clone(), "子目录".to_string()).unwrap();
    let folder = root.path().join("子目录");
    assert!(folder.is_dir());

    create_workspace_file(
        root_str.clone(),
        folder.to_string_lossy().to_string(),
        "报告.md".to_string(),
        "markdown".to_string(),
    )
    .unwrap();
    let markdown = folder.join("报告.md");
    assert!(markdown.is_file());

    rename_workspace_entry(
        root_str.clone(),
        markdown.to_string_lossy().to_string(),
        "归档.md".to_string(),
    )
    .unwrap();
    let renamed = folder.join("归档.md");
    assert!(renamed.is_file());

    move_workspace_entry(
        root_str.clone(),
        renamed.to_string_lossy().to_string(),
        root_str.clone(),
    )
    .unwrap();
    let moved = root.path().join("归档.md");
    assert!(moved.is_file());

    trash_workspace_entry(root_str, moved.to_string_lossy().to_string()).unwrap();
    assert!(!moved.exists());
}

#[test]
fn rejects_invalid_operations() {
    let root = tmp_root();
    let root_str = root.path().to_string_lossy().to_string();
    let err = create_workspace_file(
        root_str.clone(),
        root_str.clone(),
        "bad.txt".to_string(),
        "markdown".to_string(),
    )
    .unwrap_err();
    assert!(err.contains("Markdown"));

    fs::create_dir(root.path().join("a")).unwrap();
    fs::create_dir(root.path().join("a").join("b")).unwrap();
    let err = move_workspace_entry(
        root_str.clone(),
        root.path().join("a").to_string_lossy().to_string(),
        root.path()
            .join("a")
            .join("b")
            .to_string_lossy()
            .to_string(),
    )
    .unwrap_err();
    assert!(err.contains("自身或子目录"));

    let err = rename_workspace_entry(root_str.clone(), root_str, "x".to_string()).unwrap_err();
    assert!(err.contains("根节点"));
}
