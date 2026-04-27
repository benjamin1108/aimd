// Package unpack expands a .aimd file into a regular Markdown directory.
package unpack

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/manifest"
	"github.com/aimd-org/aimd/internal/mdx"
)

// Options controls an unpack run.
type Options struct {
	// Input is the path to the .aimd file.
	Input string
	// OutputDir is the destination directory (created if absent).
	OutputDir string
	// KeepAssetURI leaves asset:// references untouched. Default rewrites
	// them to relative paths so plain Markdown editors can resolve images.
	KeepAssetURI bool
}

// Run executes the unpack pipeline.
func Run(opt Options) error {
	r, err := aimd.Open(opt.Input)
	if err != nil {
		return fmt.Errorf("open %s: %w", opt.Input, err)
	}
	defer r.Close()

	if err := os.MkdirAll(opt.OutputDir, 0o755); err != nil {
		return err
	}

	for _, f := range r.Files() {
		// Refuse zip-slip paths that escape the output directory.
		dest := filepath.Join(opt.OutputDir, f.Name)
		if !isWithin(opt.OutputDir, dest) {
			return fmt.Errorf("unsafe entry path: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		data, err := r.ReadFile(f.Name)
		if err != nil {
			return err
		}
		if f.Name == manifest.FileMainMD && !opt.KeepAssetURI {
			data = rewriteToRelative(data, r.Manifest)
		}
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func rewriteToRelative(src []byte, m *manifest.Manifest) []byte {
	return mdx.Rewrite(src, func(ref mdx.ImageRef) string {
		id := mdx.AssetURIID(ref.URL)
		if id == "" {
			return ""
		}
		if a := m.FindAsset(id); a != nil {
			return a.Path
		}
		return ""
	})
}

func isWithin(parent, child string) bool {
	absParent, err1 := filepath.Abs(parent)
	absChild, err2 := filepath.Abs(child)
	if err1 != nil || err2 != nil {
		return false
	}
	rel, err := filepath.Rel(absParent, absChild)
	if err != nil {
		return false
	}
	return rel != ".." && !startsWith(rel, ".."+string(filepath.Separator))
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
