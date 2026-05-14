use aimd_core::manifest::Manifest;
use aimd_core::writer;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

const SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    ".tauri",
];
const MAX_TREE_DEPTH: usize = 12;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceNodeKind {
    Folder,
    Document,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceDocumentFormat {
    Aimd,
    Markdown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTreeNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: WorkspaceNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<WorkspaceDocumentFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<WorkspaceTreeNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootDTO {
    pub root: String,
    pub tree: WorkspaceTreeNode,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn display_name(path: &Path) -> String {
    if let Some(name) = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
    {
        return name.to_string();
    }
    path.to_string_lossy().to_string()
}

pub fn workspace_document_format(path: &Path) -> Option<WorkspaceDocumentFormat> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("aimd") => Some(WorkspaceDocumentFormat::Aimd),
        Some("md") | Some("markdown") | Some("mdx") => Some(WorkspaceDocumentFormat::Markdown),
        _ => None,
    }
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

fn should_skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    is_hidden_name(name) || SKIP_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(name))
}

fn modified_at(path: &Path) -> Option<String> {
    let modified = fs::metadata(path).and_then(|m| m.modified()).ok()?;
    let datetime: DateTime<Utc> = modified.into();
    Some(datetime.to_rfc3339())
}

fn validate_entry_name(name: &str, allow_extension: bool) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if trimmed != name {
        return Err("名称不能包含首尾空格".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("名称不能包含路径分隔符".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("名称非法".to_string());
    }
    if !allow_extension && trimmed.contains('.') {
        return Err("文件夹名称不能包含扩展名".to_string());
    }
    Ok(())
}

fn has_parent_escape(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let root_path = Path::new(root);
    let canonical = fs::canonicalize(root_path).map_err(|e| format!("无法访问目录: {e}"))?;
    if !canonical.is_dir() {
        return Err("工作目录不是文件夹".to_string());
    }
    Ok(canonical)
}

fn ensure_existing_inside_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if has_parent_escape(candidate) {
        return Err("路径不能包含 ..".to_string());
    }
    let canonical =
        fs::canonicalize(candidate).map_err(|e| format!("路径不存在或无法访问: {e}"))?;
    if !canonical.starts_with(root) {
        return Err("不能操作工作目录之外的文件".to_string());
    }
    Ok(canonical)
}

fn ensure_parent_inside_root(root: &Path, parent: &str) -> Result<PathBuf, String> {
    let parent = ensure_existing_inside_root(root, parent)?;
    if !parent.is_dir() {
        return Err("目标父级不是文件夹".to_string());
    }
    Ok(parent)
}

fn ensure_child_inside_root(root: &Path, parent: &Path, name: &str) -> Result<PathBuf, String> {
    let child = parent.join(name);
    if has_parent_escape(&child) || !child.starts_with(root) {
        return Err("不能创建或移动到工作目录之外".to_string());
    }
    Ok(child)
}

fn read_tree_node(path: &Path, depth: usize) -> WorkspaceTreeNode {
    if path.is_dir() {
        let mut children = Vec::new();
        let mut error = None;
        if depth >= MAX_TREE_DEPTH {
            error = Some("目录层级过深，已停止展开".to_string());
        } else {
            match fs::read_dir(path) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        let child = entry.path();
                        if child.is_dir() {
                            if should_skip_dir(&child) {
                                continue;
                            }
                            children.push(read_tree_node(&child, depth + 1));
                        } else if child.is_file() && workspace_document_format(&child).is_some() {
                            children.push(read_tree_node(&child, depth + 1));
                        }
                    }
                }
                Err(err) => {
                    error = Some(format!("无法读取目录: {err}"));
                }
            }
        }
        children.sort_by(|a, b| match (&a.kind, &b.kind) {
            (WorkspaceNodeKind::Folder, WorkspaceNodeKind::Document) => std::cmp::Ordering::Less,
            (WorkspaceNodeKind::Document, WorkspaceNodeKind::Folder) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        WorkspaceTreeNode {
            id: path_string(path),
            name: display_name(path),
            path: path_string(path),
            kind: WorkspaceNodeKind::Folder,
            format: None,
            children: Some(children),
            modified_at: modified_at(path),
            error,
        }
    } else {
        WorkspaceTreeNode {
            id: path_string(path),
            name: display_name(path),
            path: path_string(path),
            kind: WorkspaceNodeKind::Document,
            format: workspace_document_format(path),
            children: None,
            modified_at: modified_at(path),
            error: None,
        }
    }
}

fn read_workspace_tree_inner(root: &str) -> Result<WorkspaceRootDTO, String> {
    let root = canonical_root(root)?;
    let tree = read_tree_node(&root, 0);
    Ok(WorkspaceRootDTO {
        root: path_string(&root),
        tree,
    })
}

#[tauri::command]
pub fn open_workspace_dir() -> Result<Option<WorkspaceRootDTO>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("选择 AIMD 工作目录")
        .pick_folder()
    else {
        return Ok(None);
    };
    read_workspace_tree_inner(&path_string(&path)).map(Some)
}

#[tauri::command]
pub fn read_workspace_tree(root: String) -> Result<WorkspaceRootDTO, String> {
    read_workspace_tree_inner(&root)
}

#[tauri::command]
pub fn create_workspace_file(
    root: String,
    parent: String,
    name: String,
    kind: String,
) -> Result<WorkspaceRootDTO, String> {
    validate_entry_name(&name, true)?;
    let root_path = canonical_root(&root)?;
    let parent = ensure_parent_inside_root(&root_path, &parent)?;
    let file = ensure_child_inside_root(&root_path, &parent, &name)?;
    if file.exists() {
        return Err("同名文件已存在".to_string());
    }

    let lower = name.to_ascii_lowercase();
    let markdown = format!(
        "# {}\n\n",
        file.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名文档")
    );
    match kind.as_str() {
        "aimd" => {
            if !lower.ends_with(".aimd") {
                return Err("AIMD 文档必须使用 .aimd 扩展名".to_string());
            }
            let title = file
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("未命名文档")
                .to_string();
            writer::create(&file, Manifest::new(title), |w| {
                w.set_main_markdown(markdown.as_bytes())
            })
            .map_err(|e| format!("创建 AIMD 文档失败: {e}"))?;
        }
        "markdown" => {
            if workspace_document_format(&file) != Some(WorkspaceDocumentFormat::Markdown) {
                return Err("Markdown 文档必须使用 .md、.markdown 或 .mdx 扩展名".to_string());
            }
            fs::write(&file, markdown.as_bytes())
                .map_err(|e| format!("创建 Markdown 文档失败: {e}"))?;
        }
        _ => return Err("不支持的文档类型".to_string()),
    }

    read_workspace_tree_inner(&root)
}

#[tauri::command]
pub fn create_workspace_folder(
    root: String,
    parent: String,
    name: String,
) -> Result<WorkspaceRootDTO, String> {
    validate_entry_name(&name, false)?;
    let root_path = canonical_root(&root)?;
    let parent = ensure_parent_inside_root(&root_path, &parent)?;
    let folder = ensure_child_inside_root(&root_path, &parent, &name)?;
    if folder.exists() {
        return Err("同名文件夹已存在".to_string());
    }
    fs::create_dir(&folder).map_err(|e| format!("创建文件夹失败: {e}"))?;
    read_workspace_tree_inner(&root)
}

#[tauri::command]
pub fn rename_workspace_entry(
    root: String,
    path: String,
    new_name: String,
) -> Result<WorkspaceRootDTO, String> {
    validate_entry_name(&new_name, true)?;
    let root_path = canonical_root(&root)?;
    let source = ensure_existing_inside_root(&root_path, &path)?;
    if source == root_path {
        return Err("不能重命名工作目录根节点".to_string());
    }
    let is_dir = source.is_dir();
    if is_dir {
        validate_entry_name(&new_name, false)?;
    } else {
        let target_probe = source.with_file_name(&new_name);
        if workspace_document_format(&target_probe).is_none() {
            return Err("文档扩展名必须是 .aimd、.md、.markdown 或 .mdx".to_string());
        }
    }
    let parent = source
        .parent()
        .ok_or_else(|| "无法解析父目录".to_string())?;
    let target = ensure_child_inside_root(&root_path, parent, &new_name)?;
    if target.exists() {
        return Err("目标名称已存在".to_string());
    }
    fs::rename(&source, &target).map_err(|e| format!("重命名失败: {e}"))?;
    read_workspace_tree_inner(&root)
}

#[tauri::command]
pub fn move_workspace_entry(
    root: String,
    from: String,
    to_parent: String,
) -> Result<WorkspaceRootDTO, String> {
    let root_path = canonical_root(&root)?;
    let source = ensure_existing_inside_root(&root_path, &from)?;
    if source == root_path {
        return Err("不能移动工作目录根节点".to_string());
    }
    let parent = ensure_parent_inside_root(&root_path, &to_parent)?;
    if source.is_dir() && parent.starts_with(&source) {
        return Err("不能把文件夹移动到自身或子目录".to_string());
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法解析名称".to_string())?;
    let target = ensure_child_inside_root(&root_path, &parent, name)?;
    if target.exists() {
        return Err("目标位置已有同名项目".to_string());
    }
    fs::rename(&source, &target).map_err(|e| format!("移动失败: {e}"))?;
    read_workspace_tree_inner(&root)
}

#[tauri::command]
pub fn trash_workspace_entry(root: String, path: String) -> Result<WorkspaceRootDTO, String> {
    let root_path = canonical_root(&root)?;
    let source = ensure_existing_inside_root(&root_path, &path)?;
    if source == root_path {
        return Err("不能删除工作目录根节点".to_string());
    }
    trash_or_delete(&source)?;
    read_workspace_tree_inner(&root)
}

#[cfg(all(target_os = "macos", not(test)))]
fn trash_or_delete(source: &Path) -> Result<(), String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "无法定位用户目录".to_string())?;
    let trash_dir = PathBuf::from(home).join(".Trash");
    fs::create_dir_all(&trash_dir).map_err(|e| format!("无法访问废纸篓: {e}"))?;
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法解析名称".to_string())?;
    let mut target = trash_dir.join(name);
    if target.exists() {
        let stamp = Utc::now().format("%Y%m%d%H%M%S");
        target = trash_dir.join(format!("{stamp}-{name}"));
    }
    fs::rename(source, target).map_err(|e| format!("移到废纸篓失败: {e}"))
}

#[cfg(any(not(target_os = "macos"), test))]
fn trash_or_delete(source: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::remove_dir_all(source).map_err(|e| format!("删除文件夹失败: {e}"))
    } else {
        fs::remove_file(source).map_err(|e| format!("删除文件失败: {e}"))
    }
}

#[cfg(test)]
#[path = "workspace_tests.rs"]
mod workspace_tests;
