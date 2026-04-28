package aimd

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/aimd-org/aimd/internal/manifest"
)

// NewAsset is an asset to be appended while rewriting an existing AIMD file.
type NewAsset struct {
	ID       string
	Filename string
	Data     []byte
	Role     string
}

// RewriteOptions controls an in-place rewrite of an AIMD file.
type RewriteOptions struct {
	Markdown     []byte
	DeleteAssets map[string]bool
	AddAssets    []NewAsset
}

// Rewrite replaces the mutable parts of an AIMD file while preserving its
// metadata and existing assets by default.
func Rewrite(file string, opt RewriteOptions) error {
	r, err := Open(file)
	if err != nil {
		return err
	}
	mf := *r.Manifest
	mf.Assets = nil
	mf.UpdatedAt = time.Now().UTC()

	existing := make([]NewAsset, 0, len(r.Manifest.Assets))
	for _, asset := range r.Manifest.Assets {
		if opt.DeleteAssets != nil && opt.DeleteAssets[asset.ID] {
			continue
		}
		data, err := r.ReadFile(asset.Path)
		if err != nil {
			r.Close()
			return fmt.Errorf("read asset %s: %w", asset.ID, err)
		}
		existing = append(existing, NewAsset{
			ID:       asset.ID,
			Filename: path.Base(asset.Path),
			Data:     data,
			Role:     asset.Role,
		})
	}
	if err := r.Close(); err != nil {
		return err
	}

	dir := filepath.Dir(file)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(file)+".*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		return err
	}
	defer os.Remove(tmpPath)

	w, err := Create(tmpPath, &mf)
	if err != nil {
		return err
	}
	if err := w.SetMainMarkdown(opt.Markdown); err != nil {
		w.Close()
		return err
	}
	for _, asset := range append(existing, opt.AddAssets...) {
		role := asset.Role
		if role == "" {
			role = manifest.RoleContentImage
		}
		if _, err := w.AddAsset(asset.ID, asset.Filename, asset.Data, role); err != nil {
			w.Close()
			return err
		}
	}
	if err := w.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, file)
}

// UniqueAssetName returns a collision-free id and filename for a new asset.
func UniqueAssetName(m *manifest.Manifest, original string) (string, string) {
	filename := sanitizeFilename(filepath.Base(original))
	if filename == "" {
		filename = "image"
	}
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".bin"
		filename += ext
	}
	stem := strings.TrimSuffix(filename, ext)

	takenIDs := map[string]bool{}
	takenNames := map[string]bool{}
	if m != nil {
		for _, a := range m.Assets {
			takenIDs[a.ID] = true
			takenNames[path.Base(a.Path)] = true
		}
	}

	idStem := sanitizeID(stem)
	if idStem == "" {
		sum := sha256.Sum256([]byte(original + time.Now().String()))
		idStem = "image-" + hex.EncodeToString(sum[:3])
	}
	for i := 1; ; i++ {
		id := fmt.Sprintf("%s-%03d", idStem, i)
		name := filename
		if i > 1 {
			name = fmt.Sprintf("%s-%d%s", stem, i, ext)
		}
		if !takenIDs[id] && !takenNames[name] {
			return id, name
		}
	}
}

func sanitizeFilename(s string) string {
	s = strings.ReplaceAll(s, " ", "-")
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-', r == '_', r == '.':
			b.WriteRune(r)
		}
	}
	return b.String()
}

func sanitizeID(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-")
}
