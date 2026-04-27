// Package pack converts a Markdown file plus its local images into a .aimd file.
package pack

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/manifest"
	"github.com/aimd-org/aimd/internal/mdx"
)

// Options controls a pack run.
type Options struct {
	// Input is the path to the source Markdown file.
	Input string
	// Output is the destination .aimd path.
	Output string
	// IncludeRemote downloads http(s) images and embeds them. v0.1: false.
	IncludeRemote bool
	// Title overrides the auto-detected H1 title.
	Title string
}

type localAsset struct {
	id       string
	filename string
	fullPath string
}

// Run executes the pack pipeline.
func Run(opt Options) error {
	srcBytes, err := os.ReadFile(opt.Input)
	if err != nil {
		return fmt.Errorf("read input: %w", err)
	}
	baseDir := filepath.Dir(opt.Input)

	title := opt.Title
	if title == "" {
		title = mdx.ExtractTitle(srcBytes)
	}
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(opt.Input), filepath.Ext(opt.Input))
	}

	mf := manifest.New(title)

	urlToID := map[string]string{} // original URL -> asset id
	takenFilenames := map[string]bool{}
	var locals []localAsset
	idCounter := 0
	for _, ref := range mdx.Scan(srcBytes) {
		if mdx.IsRemote(ref.URL) || mdx.IsAssetURI(ref.URL) {
			continue
		}
		if _, ok := urlToID[ref.URL]; ok {
			continue
		}
		full := ref.URL
		if !filepath.IsAbs(full) {
			full = filepath.Join(baseDir, ref.URL)
		}
		if _, err := os.Stat(full); err != nil {
			fmt.Fprintf(os.Stderr, "warning: image %q not found, leaving reference unchanged\n", ref.URL)
			continue
		}
		idCounter++
		id := makeAssetID(ref.URL, idCounter)
		filename := uniqueFilename(takenFilenames, filepath.Base(full))
		takenFilenames[filename] = true
		locals = append(locals, localAsset{id: id, filename: filename, fullPath: full})
		urlToID[ref.URL] = id
	}

	rewritten := mdx.Rewrite(srcBytes, func(ref mdx.ImageRef) string {
		if id, ok := urlToID[ref.URL]; ok {
			return mdx.AssetURIPrefix + id
		}
		return ""
	})

	w, err := aimd.Create(opt.Output, mf)
	if err != nil {
		return fmt.Errorf("create %s: %w", opt.Output, err)
	}
	if err := w.SetMainMarkdown(rewritten); err != nil {
		w.Close()
		return err
	}
	for _, la := range locals {
		data, err := os.ReadFile(la.fullPath)
		if err != nil {
			w.Close()
			return fmt.Errorf("read asset %s: %w", la.fullPath, err)
		}
		if _, err := w.AddAsset(la.id, la.filename, data, manifest.RoleContentImage); err != nil {
			w.Close()
			return err
		}
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("finalize: %w", err)
	}
	return nil
}

// makeAssetID derives a stable id from the original URL and a sequence number.
func makeAssetID(url string, seq int) string {
	base := strings.TrimSuffix(filepath.Base(url), filepath.Ext(url))
	base = sanitize(base)
	if base == "" {
		sum := sha256.Sum256([]byte(url))
		return fmt.Sprintf("asset-%s", hex.EncodeToString(sum[:4]))
	}
	return fmt.Sprintf("%s-%03d", base, seq)
}

func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ' || r == '.':
			b.WriteRune('-')
		}
	}
	return b.String()
}

func uniqueFilename(taken map[string]bool, name string) string {
	if !taken[name] {
		return name
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", stem, i, ext)
		if !taken[candidate] {
			return candidate
		}
	}
}
