// Package desktop exposes a small JSON command surface for desktop shells.
package desktop

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/manifest"
	"github.com/aimd-org/aimd/internal/pack"
	"github.com/aimd-org/aimd/internal/render"
)

const usage = `Usage:
  aimd desktop open <file.aimd>
  aimd desktop create <file.aimd>      # stdin: {"markdown":"...","title":"..."}
  aimd desktop save <file.aimd>        # stdin: {"markdown":"..."}
  aimd desktop save-as <src> <dest>    # stdin: {"markdown":"...","title":"..."}
  aimd desktop render <file.aimd>      # stdin: {"markdown":"..."}
  aimd desktop render-standalone       # stdin: {"markdown":"..."}
  aimd desktop add-image <file.aimd> <image>
  aimd desktop import-markdown <input.md> <output.aimd>
  aimd desktop read-markdown <input.md>
`

const desktopAssetCacheDirName = "aimd-desktop-assets"

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
	Local  string `json:"localPath"`
}

// AddedAssetDTO is returned after adding an image to an AIMD package.
type AddedAssetDTO struct {
	Asset    AssetDTO `json:"asset"`
	URI      string   `json:"uri"`
	Markdown string   `json:"markdown"`
}

type markdownPayload struct {
	Markdown string `json:"markdown"`
	Title    string `json:"title"`
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
	case "create":
		if len(args) != 2 {
			return fmt.Errorf("usage: aimd desktop create <file.aimd>")
		}
		var in markdownPayload
		if err := json.NewDecoder(input).Decode(&in); err != nil {
			return fmt.Errorf("decode create payload: %w", err)
		}
		out, err = Create(args[1], in.Markdown, in.Title)
	case "save":
		if len(args) != 2 {
			return fmt.Errorf("usage: aimd desktop save <file.aimd>")
		}
		var in markdownPayload
		if err := json.NewDecoder(input).Decode(&in); err != nil {
			return fmt.Errorf("decode save payload: %w", err)
		}
		out, err = Save(args[1], in.Markdown)
	case "save-as":
		if len(args) != 3 {
			return fmt.Errorf("usage: aimd desktop save-as <src> <dest>")
		}
		var in markdownPayload
		if err := json.NewDecoder(input).Decode(&in); err != nil {
			return fmt.Errorf("decode save-as payload: %w", err)
		}
		out, err = SaveAs(args[1], args[2], in.Markdown, in.Title)
	case "render":
		if len(args) != 2 {
			return fmt.Errorf("usage: aimd desktop render <file.aimd>")
		}
		var in markdownPayload
		if err := json.NewDecoder(input).Decode(&in); err != nil {
			return fmt.Errorf("decode render payload: %w", err)
		}
		out, err = Render(args[1], in.Markdown)
	case "render-standalone":
		if len(args) != 1 {
			return fmt.Errorf("usage: aimd desktop render-standalone")
		}
		var in markdownPayload
		if err := json.NewDecoder(input).Decode(&in); err != nil {
			return fmt.Errorf("decode render-standalone payload: %w", err)
		}
		out, err = RenderStandalone(in.Markdown)
	case "add-image":
		if len(args) != 3 {
			return fmt.Errorf("usage: aimd desktop add-image <file.aimd> <image>")
		}
		out, err = AddImage(args[1], args[2])
	case "import-markdown":
		if len(args) != 3 {
			return fmt.Errorf("usage: aimd desktop import-markdown <input.md> <output.aimd>")
		}
		out, err = ImportMarkdown(args[1], args[2])
	case "read-markdown":
		if len(args) != 2 {
			return fmt.Errorf("usage: aimd desktop read-markdown <input.md>")
		}
		out, err = ReadMarkdown(args[1])
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

// Create assembles a new AIMD document from markdown.
func Create(file, markdown, title string) (*DocumentDTO, error) {
	mf := manifest.New(resolveTitle(title, markdown, file))
	w, err := aimd.Create(file, mf)
	if err != nil {
		return nil, err
	}
	if err := w.SetMainMarkdown([]byte(markdown)); err != nil {
		w.Close()
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return Open(file)
}

// Save rewrites the document markdown and returns the updated document.
func Save(file, markdown string) (*DocumentDTO, error) {
	if err := aimd.Rewrite(file, aimd.RewriteOptions{Markdown: []byte(markdown)}); err != nil {
		return nil, err
	}
	return Open(file)
}

// SaveAs writes a copy of srcFile to destFile with the provided markdown.
// Use srcFile "-" to create a new document from scratch.
func SaveAs(srcFile, destFile, markdown, title string) (*DocumentDTO, error) {
	if srcFile == "" || srcFile == "-" {
		return Create(destFile, markdown, title)
	}
	srcAbs, _ := filepath.Abs(srcFile)
	destAbs, _ := filepath.Abs(destFile)
	if srcAbs != "" && srcAbs == destAbs {
		return Save(srcFile, markdown)
	}

	r, err := aimd.Open(srcFile)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	mf := *r.Manifest
	mf.Assets = nil
	mf.UpdatedAt = time.Now().UTC()
	if title != "" {
		mf.Title = title
	}
	if mf.Title == "" {
		mf.Title = resolveTitle("", markdown, destFile)
	}

	w, err := aimd.Create(destFile, &mf)
	if err != nil {
		return nil, err
	}
	if err := w.SetMainMarkdown([]byte(markdown)); err != nil {
		w.Close()
		return nil, err
	}
	for _, asset := range r.Manifest.Assets {
		data, err := r.ReadFile(asset.Path)
		if err != nil {
			w.Close()
			return nil, fmt.Errorf("read asset %s: %w", asset.ID, err)
		}
		role := asset.Role
		if role == "" {
			role = manifest.RoleContentImage
		}
		if _, err := w.AddAsset(asset.ID, filepath.Base(asset.Path), data, role); err != nil {
			w.Close()
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return Open(destFile)
}

// Render renders markdown in the context of an existing AIMD file.
func Render(file, markdown string) (map[string]string, error) {
	r, err := aimd.Open(file)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	html, err := render.Markdown([]byte(markdown), nil)
	if err != nil {
		return nil, err
	}
	return map[string]string{"html": string(html)}, nil
}

// RenderStandalone renders markdown without requiring an existing AIMD file.
func RenderStandalone(markdown string) (map[string]string, error) {
	html, err := render.Markdown([]byte(markdown), nil)
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
	cacheDir, err := materializeAssets(file, r)
	if err != nil {
		return nil, err
	}
	dto := assetDTO(*asset, cacheDir)
	return &AddedAssetDTO{
		Asset:    dto,
		URI:      "asset://" + id,
		Markdown: fmt.Sprintf("![%s](asset://%s)", imageAlt(filename), id),
	}, nil
}

// ImportMarkdown packs a plain markdown project into a new AIMD file and opens it.
func ImportMarkdown(inputFile, outputFile string) (*DocumentDTO, error) {
	if err := pack.Run(pack.Options{
		Input:  inputFile,
		Output: outputFile,
	}); err != nil {
		return nil, err
	}
	return Open(outputFile)
}

// MarkdownDraftDTO is the shape returned by ReadMarkdown for in-memory draft loading.
type MarkdownDraftDTO struct {
	Markdown string `json:"markdown"`
	Title    string `json:"title"`
	HTML     string `json:"html"`
}

// ReadMarkdown reads a plain .md file, renders it to HTML, and returns the draft DTO.
// Nothing is written to disk — the caller decides when/whether to save.
func ReadMarkdown(inputFile string) (*MarkdownDraftDTO, error) {
	data, err := os.ReadFile(inputFile)
	if err != nil {
		return nil, fmt.Errorf("read-markdown: %w", err)
	}
	md := string(data)
	html, err := render.Markdown(data, nil)
	if err != nil {
		return nil, fmt.Errorf("read-markdown render: %w", err)
	}
	title := resolveTitle("", md, inputFile)
	return &MarkdownDraftDTO{
		Markdown: md,
		Title:    title,
		HTML:     string(html),
	}, nil
}

func documentDTO(file string, r *aimd.Reader, markdown string) (*DocumentDTO, error) {
	html, err := render.Markdown([]byte(markdown), nil)
	if err != nil {
		return nil, err
	}
	cacheDir, err := materializeAssets(file, r)
	if err != nil {
		return nil, err
	}
	assets := make([]AssetDTO, 0, len(r.Manifest.Assets))
	for _, asset := range r.Manifest.Assets {
		assets = append(assets, assetDTO(asset, cacheDir))
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

func assetDTO(asset manifest.Asset, cacheDir string) AssetDTO {
	localPath := filepath.Join(cacheDir, tempAssetFilename(asset))
	return AssetDTO{
		ID:     asset.ID,
		Path:   asset.Path,
		MIME:   asset.MIME,
		Size:   asset.Size,
		SHA256: asset.SHA256,
		Role:   asset.Role,
		URL:    localPath,
		Local:  localPath,
	}
}

func materializeAssets(file string, r *aimd.Reader) (string, error) {
	cacheDir, err := assetCacheDir(file)
	if err != nil {
		return "", err
	}
	if err := os.RemoveAll(cacheDir); err != nil {
		return "", fmt.Errorf("reset desktop asset cache: %w", err)
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", fmt.Errorf("create desktop asset cache: %w", err)
	}
	for _, asset := range r.Manifest.Assets {
		if err := materializeAsset(cacheDir, r, asset); err != nil {
			return "", err
		}
	}
	return cacheDir, nil
}

func materializeAsset(cacheDir string, r *aimd.Reader, asset manifest.Asset) error {
	data, err := r.ReadFile(asset.Path)
	if err != nil {
		return fmt.Errorf("read asset %s: %w", asset.ID, err)
	}
	target := filepath.Join(cacheDir, tempAssetFilename(asset))
	if err := os.WriteFile(target, data, 0o600); err != nil {
		return fmt.Errorf("write desktop asset cache %s: %w", asset.ID, err)
	}
	return nil
}

func assetCacheDir(file string) (string, error) {
	abs, err := filepath.Abs(file)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(abs))
	key := hex.EncodeToString(sum[:16])
	return filepath.Join(os.TempDir(), desktopAssetCacheDirName, key), nil
}

func tempAssetFilename(asset manifest.Asset) string {
	name := filepath.Base(asset.Path)
	if name == "." || name == string(filepath.Separator) || name == "" {
		name = asset.ID
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if stem == "" {
		stem = asset.ID
	}
	id := sanitizeTempComponent(asset.ID)
	if id == "" {
		id = sanitizeTempComponent(stem)
	}
	if id == "" {
		id = "asset"
	}
	if ext == "" {
		ext = filepath.Ext(asset.Path)
	}
	return id + ext
}

func sanitizeTempComponent(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return strings.Trim(b.String(), "._-")
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

func resolveTitle(title, markdown, file string) string {
	if strings.TrimSpace(title) != "" {
		return strings.TrimSpace(title)
	}
	if extracted := strings.TrimSpace(extractTitle(markdown)); extracted != "" {
		return extracted
	}
	base := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	if strings.TrimSpace(base) != "" {
		return base
	}
	return "未命名文档"
}

func extractTitle(markdown string) string {
	return strings.TrimSpace(strings.TrimPrefix(firstHeading(markdown), "# "))
}

func firstHeading(markdown string) string {
	for _, line := range strings.Split(markdown, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "# ") {
			return strings.TrimSpace(line)
		}
	}
	return ""
}
