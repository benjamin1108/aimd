mod asset_names;
pub mod canonical;
pub mod export;
pub mod git_diff;
pub mod git_merge;
pub mod health;
mod local_paths;
pub mod manifest;
pub mod pack;
pub mod reader;
pub mod rewrite;
pub mod writer;

pub use export::{
    export_html_bytes, export_html_document_bytes, export_markdown_with_assets,
    rewrite_asset_uris_to_relative, ExportMarkdownResult, ExportedAsset,
};
pub use health::{
    check_document_health, check_document_health_with_threshold, DocumentHealthReport, HealthIssue,
    HealthSeverity, HealthStatus,
};
pub use local_paths::{is_path_like_image_url, resolve_image_path};
pub use manifest::Manifest;
pub use pack::{
    bundle_local_images, run as pack_run, run_with_markdown as pack_run_with_markdown,
    BundleLocalImagesResult,
};
pub use reader::Reader;
pub use rewrite::{
    referenced_asset_ids, rewrite_file, set_title_file, unique_asset_name, NewAsset, PackageFile,
    RewriteOptions,
};
pub use writer::Writer;
