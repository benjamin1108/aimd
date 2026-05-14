use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

pub const FORMAT_NAME: &str = "aimd";
pub const FORMAT_VERSION: &str = "0.1";
pub const FILE_MANIFEST: &str = "manifest.json";
pub const FILE_MAIN_MD: &str = "main.md";
pub const DIR_ASSETS: &str = "assets/";
pub const ROLE_CONTENT_IMAGE: &str = "content-image";
pub const ROLE_COVER: &str = "cover";
pub const ROLE_ATTACHMENT: &str = "attachment";

/// Top-level descriptor stored as manifest.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub version: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub title: String,
    pub entry: String,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "updatedAt")]
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<Author>,
    #[serde(
        rename = "generatedBy",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub generated_by: Option<GeneratedBy>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<Asset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendering: Option<Rendering>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Author {
    pub name: String,
    #[serde(rename = "type", default, skip_serializing_if = "String::is_empty")]
    pub author_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedBy {
    #[serde(rename = "type", default, skip_serializing_if = "String::is_empty")]
    pub gen_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub provider: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub mime: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sha256: String,
    #[serde(default, skip_serializing_if = "is_zero_i64")]
    pub size: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub role: String,
}

fn is_zero_i64(v: &i64) -> bool {
    *v == 0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rendering {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub theme: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub style: String,
}

impl Manifest {
    pub fn new(title: impl Into<String>) -> Self {
        let now = Utc::now();
        Manifest {
            format: FORMAT_NAME.to_string(),
            version: FORMAT_VERSION.to_string(),
            title: title.into(),
            entry: FILE_MAIN_MD.to_string(),
            created_at: now,
            updated_at: now,
            authors: Vec::new(),
            generated_by: None,
            assets: Vec::new(),
            rendering: None,
        }
    }

    pub fn encode<W: Write>(&self, w: &mut W) -> io::Result<()> {
        let json = serde_json::to_string_pretty(&self.canonicalized())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        w.write_all(json.as_bytes())?;
        w.write_all(b"\n")
    }

    pub fn canonicalized(&self) -> Self {
        let mut out = self.clone();
        out.entry = FILE_MAIN_MD.to_string();
        out.assets.sort_by(|a, b| {
            a.id.cmp(&b.id)
                .then_with(|| a.path.cmp(&b.path))
                .then_with(|| a.sha256.cmp(&b.sha256))
        });
        out.authors.sort_by(|a, b| {
            a.name
                .cmp(&b.name)
                .then_with(|| a.author_type.cmp(&b.author_type))
        });
        out
    }

    pub fn decode<R: Read>(r: R) -> io::Result<Self> {
        serde_json::from_reader(r).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    pub fn find_asset(&self, id: &str) -> Option<&Asset> {
        self.assets.iter().find(|a| a.id == id)
    }

    pub fn find_asset_mut(&mut self, id: &str) -> Option<&mut Asset> {
        self.assets.iter_mut().find(|a| a.id == id)
    }
}

/// Returns a best-effort MIME type for an asset filename/path.
pub fn mime_by_ext(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "md" | "markdown" | "mdx" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn empty_manifest_serializes_required_fields() {
        let m = Manifest::new("Title");
        let mut buf = Vec::new();
        m.encode(&mut buf).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&buf).unwrap();

        assert_eq!(json["format"], "aimd");
        assert_eq!(json["version"], "0.1");
        assert_eq!(json["entry"], "main.md");

        let created = json["createdAt"].as_str().unwrap();
        let updated = json["updatedAt"].as_str().unwrap();
        chrono::DateTime::parse_from_rfc3339(created).expect("createdAt must be RFC3339");
        chrono::DateTime::parse_from_rfc3339(updated).expect("updatedAt must be RFC3339");

        assert!(
            json.get("assets").is_none(),
            "assets must be omitted when empty"
        );
        assert!(
            json.get("authors").is_none(),
            "authors must be omitted when empty"
        );
        assert!(
            json.get("generatedBy").is_none(),
            "generatedBy must be omitted when absent"
        );
    }

    #[test]
    fn roundtrip_with_assets_authors_generated_by() {
        let mut m = Manifest::new("Doc");
        m.authors.push(Author {
            name: "Alice".to_string(),
            author_type: "human".to_string(),
        });
        m.generated_by = Some(GeneratedBy {
            gen_type: "ai".to_string(),
            model: "gpt-4".to_string(),
            provider: "openai".to_string(),
            prompt: "write a doc".to_string(),
        });
        m.assets.push(Asset {
            id: "img-001".to_string(),
            path: "assets/img-001.png".to_string(),
            mime: "image/png".to_string(),
            sha256: "deadbeef".to_string(),
            size: 1024,
            role: "content-image".to_string(),
        });

        let mut buf = Vec::new();
        m.encode(&mut buf).unwrap();

        let m2 = Manifest::decode(Cursor::new(&buf)).unwrap();
        let mut buf2 = Vec::new();
        m2.encode(&mut buf2).unwrap();

        assert_eq!(buf, buf2, "encode→decode→encode must be byte-identical");
        assert_eq!(m2.authors.len(), 1);
        assert_eq!(m2.authors[0].name, "Alice");
        assert_eq!(m2.generated_by.as_ref().unwrap().model, "gpt-4");
        assert_eq!(m2.assets[0].sha256, "deadbeef");
        assert_eq!(m2.assets[0].role, "content-image");
    }

    #[test]
    fn deserialize_handwritten_json() {
        let json = r#"{
            "format": "aimd",
            "version": "0.1",
            "title": "Test",
            "entry": "main.md",
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-06-15T12:30:00Z",
            "assets": [
                {
                    "id": "cover-001",
                    "path": "assets/cover.png",
                    "mime": "image/png",
                    "sha256": "ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469f490bee0b29da3ecf",
                    "size": 512,
                    "role": "cover"
                }
            ]
        }"#;
        let m = Manifest::decode(Cursor::new(json.as_bytes())).unwrap();
        assert_eq!(m.format, "aimd");
        assert_eq!(m.version, "0.1");
        assert_eq!(m.assets.len(), 1);
        assert_eq!(m.assets[0].id, "cover-001");
        assert_eq!(m.assets[0].mime, "image/png");
        assert_eq!(m.assets[0].role, "cover");
        assert_eq!(m.assets[0].size, 512);
    }

    #[test]
    fn find_asset_hit_and_miss() {
        let mut m = Manifest::new("X");
        m.assets.push(Asset {
            id: "img-001".to_string(),
            path: "assets/img-001.png".to_string(),
            mime: "image/png".to_string(),
            sha256: "aabbcc".to_string(),
            size: 100,
            role: "content-image".to_string(),
        });

        let found = m.find_asset("img-001");
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "img-001");

        assert!(m.find_asset("nonexistent").is_none());
    }
}
