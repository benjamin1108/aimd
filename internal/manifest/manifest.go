// Package manifest defines the AIMD manifest schema (manifest.json).
package manifest

import (
	"encoding/json"
	"io"
	"time"
)

// FormatName and FormatVersion identify the AIMD spec level this build targets.
const (
	FormatName    = "aimd"
	FormatVersion = "0.1"
)

// Reserved file names inside the .aimd ZIP container.
const (
	FileManifest = "manifest.json"
	FileMainMD   = "main.md"
	DirAssets    = "assets/"
)

// Asset role values understood by v0.1 tooling.
const (
	RoleContentImage = "content-image"
	RoleCover        = "cover"
	RoleAttachment   = "attachment"
)

// Manifest is the top-level descriptor stored as manifest.json.
type Manifest struct {
	Format      string       `json:"format"`
	Version     string       `json:"version"`
	Title       string       `json:"title,omitempty"`
	Entry       string       `json:"entry"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
	Authors     []Author     `json:"authors,omitempty"`
	GeneratedBy *GeneratedBy `json:"generatedBy,omitempty"`
	Assets      []Asset      `json:"assets,omitempty"`
	Rendering   *Rendering   `json:"rendering,omitempty"`
}

// Author identifies a contributor; type is "human" or "ai".
type Author struct {
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

// GeneratedBy records the AI provenance of the document, if any.
type GeneratedBy struct {
	Type     string `json:"type,omitempty"`
	Model    string `json:"model,omitempty"`
	Provider string `json:"provider,omitempty"`
	Prompt   string `json:"prompt,omitempty"`
}

// Asset describes one resource inside the assets/ directory.
type Asset struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	MIME   string `json:"mime,omitempty"`
	SHA256 string `json:"sha256,omitempty"`
	Size   int64  `json:"size,omitempty"`
	Role   string `json:"role,omitempty"`
}

// Rendering carries optional theme and stylesheet hints.
type Rendering struct {
	Theme string `json:"theme,omitempty"`
	Style string `json:"style,omitempty"`
}

// New returns a Manifest pre-populated with format/version/timestamps.
func New(title string) *Manifest {
	now := time.Now().UTC()
	return &Manifest{
		Format:    FormatName,
		Version:   FormatVersion,
		Title:     title,
		Entry:     FileMainMD,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

// Encode writes m as indented JSON.
func (m *Manifest) Encode(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(m)
}

// Decode parses a manifest from r.
func Decode(r io.Reader) (*Manifest, error) {
	var m Manifest
	if err := json.NewDecoder(r).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

// FindAsset returns the asset with the given id, or nil.
func (m *Manifest) FindAsset(id string) *Asset {
	for i := range m.Assets {
		if m.Assets[i].ID == id {
			return &m.Assets[i]
		}
	}
	return nil
}
