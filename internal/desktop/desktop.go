// Package desktop exposes a small JSON command surface for desktop shells.
package desktop

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/manifest"
	"github.com/aimd-org/aimd/internal/render"
)

const usage = `Usage:
  aimd desktop open <file.aimd>
  aimd desktop save <file.aimd>        # stdin: {"markdown":"..."}
  aimd desktop render <file.aimd>      # stdin: {"markdown":"..."}
  aimd desktop add-image <file.aimd> <image>
`

// DocumentDTO is the JSON document shape consumed by the Tauri app.
type DocumentDTO struct {
	Path     string             `json:"path"`
	Title    string             `json:"title"`
	Markdown string             `json:"markdown"`
	HTML     string             `json:"html"`
	Manifest *manifest.Manifest `json:"manifest"`
	Assets   []AssetDTO         `json:"assets"`
	Dirty    bool               `json:"dirty"`
}

// AssetDTO is the JSON asset shape consumed by the Tauri app.
type AssetDTO struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	MIME   string `json:"mime"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Role   string `json:"role"`
	URL    string `json:"url"`
}

// AddedAssetDTO is returned after adding an image to an AIMD package.
type AddedAssetDTO struct {
	Asset    AssetDTO `json:"asset"`
	URI      string   `json:"uri"`
	Markdown string   `json:"markdown"`
}

// Run executes a desktop JSON subcommand.
func Run(args []string, stdout, stderr io.Writer, input io.Reader) error {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return fmt.Errorf("desktop requires a command")
	}
	var out any
	var err error
	switch args[0] {
	case "open":
		if len(args) != 2 {
			return fmt.Errorf("usage: aimd desktop open <file.aimd>")
		}
		out, err = Open(args[1])
	case "save":
		if len(args) != 2 {
			return fmt.Errorf("usage: aimd desktop save <file.aimd>")
		}
		var in struct {
			Markdown string `json:"markdown"`
		}
		if err := json.NewDecoder(input).Decode(&in); err != nil {
			return fmt.Errorf("decode save payload: %w", err)
		}
		out, err = Save(args[1], in.Markdown)
	case "render":
		if len(args) != 2 {
			return fmt.Errorf("usage: aimd desktop render <file.aimd>")
		}
		var in struct {
			Markdown string `json:"markdown"`
		}
		if err := json.NewDecoder(input).Decode(&in); err != nil {
			return fmt.Errorf("decode render payload: %w", err)
		}
		out, err = Render(args[1], in.Markdown)
	case "add-image":
		if len(args) != 3 {
			return fmt.Errorf("usage: aimd desktop add-image <file.aimd> <image>")
		}
		out, err = AddImage(args[1], args[2])
	case "help", "-h", "--help":
		fmt.Fprint(stdout, usage)
		return nil
	default:
		return fmt.Errorf("unknown desktop command: %s", args[0])
	}
	if err != nil {
		return err
	}
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}

// Open reads an AIMD document and returns markdown, rendered HTML and assets.
func Open(file string) (*DocumentDTO, error) {
	r, err := aimd.Open(file)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	md, err := r.MainMarkdown()
	if err != nil {
		return nil, err
	}
	return documentDTO(file, r, string(md))
}

// Save rewrites the document markdown and returns the updated document.
func Save(file, markdown string) (*DocumentDTO, error) {
	if err := aimd.Rewrite(file, aimd.RewriteOptions{Markdown: []byte(markdown)}); err != nil {
		return nil, err
	}
	return Open(file)
}

// Render renders markdown in the context of an existing AIMD file.
func Render(file, markdown string) (map[string]string, error) {
	r, err := aimd.Open(file)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	html, err := render.Markdown([]byte(markdown), dataURLResolver(r))
	if err != nil {
		return nil, err
	}
	return map[string]string{"html": string(html)}, nil
}

// AddImage stores imagePath as an asset and returns an insertable markdown node.
func AddImage(file, imagePath string) (*AddedAssetDTO, error) {
	if !isImageFilename(imagePath) {
		return nil, fmt.Errorf("not an image file: %s", imagePath)
	}
	data, err := os.ReadFile(imagePath)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("empty image: %s", imagePath)
	}
	r, err := aimd.Open(file)
	if err != nil {
		return nil, err
	}
	md, err := r.MainMarkdown()
	if err != nil {
		r.Close()
		return nil, err
	}
	id, filename := aimd.UniqueAssetName(r.Manifest, filepath.Base(imagePath))
	if err := r.Close(); err != nil {
		return nil, err
	}
	if err := aimd.Rewrite(file, aimd.RewriteOptions{
		Markdown: md,
		AddAssets: []aimd.NewAsset{{
			ID:       id,
			Filename: filename,
			Data:     data,
			Role:     manifest.RoleContentImage,
		}},
	}); err != nil {
		return nil, err
	}
	r, err = aimd.Open(file)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	asset := r.Manifest.FindAsset(id)
	if asset == nil {
		return nil, fmt.Errorf("added asset %q not found", id)
	}
	dto, err := assetDTO(r, *asset)
	if err != nil {
		return nil, err
	}
	return &AddedAssetDTO{
		Asset:    dto,
		URI:      "asset://" + id,
		Markdown: fmt.Sprintf("![%s](asset://%s)", imageAlt(filename), id),
	}, nil
}

func documentDTO(file string, r *aimd.Reader, markdown string) (*DocumentDTO, error) {
	html, err := render.Markdown([]byte(markdown), dataURLResolver(r))
	if err != nil {
		return nil, err
	}
	assets := make([]AssetDTO, 0, len(r.Manifest.Assets))
	for _, asset := range r.Manifest.Assets {
		dto, err := assetDTO(r, asset)
		if err != nil {
			return nil, err
		}
		assets = append(assets, dto)
	}
	abs, err := filepath.Abs(file)
	if err != nil {
		abs = file
	}
	return &DocumentDTO{
		Path:     abs,
		Title:    r.Manifest.Title,
		Markdown: markdown,
		HTML:     string(html),
		Manifest: r.Manifest,
		Assets:   assets,
		Dirty:    false,
	}, nil
}

func assetDTO(r *aimd.Reader, asset manifest.Asset) (AssetDTO, error) {
	url, err := assetDataURL(r, asset)
	if err != nil {
		return AssetDTO{}, err
	}
	return AssetDTO{
		ID:     asset.ID,
		Path:   asset.Path,
		MIME:   asset.MIME,
		Size:   asset.Size,
		SHA256: asset.SHA256,
		Role:   asset.Role,
		URL:    url,
	}, nil
}

func dataURLResolver(r *aimd.Reader) render.AssetResolver {
	return func(id string) string {
		asset := r.Manifest.FindAsset(id)
		if asset == nil {
			return ""
		}
		u, err := assetDataURL(r, *asset)
		if err != nil {
			return ""
		}
		return u
	}
}

func assetDataURL(r *aimd.Reader, asset manifest.Asset) (string, error) {
	data, err := r.ReadFile(asset.Path)
	if err != nil {
		return "", err
	}
	mime := asset.MIME
	if mime == "" {
		mime = "application/octet-stream"
	}
	var buf bytes.Buffer
	buf.WriteString("data:")
	buf.WriteString(mime)
	buf.WriteString(";base64,")
	enc := base64.NewEncoder(base64.StdEncoding, &buf)
	if _, err := enc.Write(data); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func isImageFilename(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg":
		return true
	default:
		return false
	}
}

func imageAlt(filename string) string {
	name := filename
	if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	return strings.ReplaceAll(name, "-", " ")
}
