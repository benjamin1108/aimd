package aimd

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	"github.com/aimd-org/aimd/internal/manifest"
)

// Reader exposes the contents of a .aimd file.
type Reader struct {
	zr       *zip.ReadCloser
	Manifest *manifest.Manifest
}

// Open reads dest and parses its manifest. Caller must call Close.
func Open(dest string) (*Reader, error) {
	zr, err := zip.OpenReader(dest)
	if err != nil {
		return nil, err
	}
	r := &Reader{zr: zr}
	mf, err := r.openEntry(manifest.FileManifest)
	if err != nil {
		zr.Close()
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	defer mf.Close()
	m, err := manifest.Decode(mf)
	if err != nil {
		zr.Close()
		return nil, fmt.Errorf("decode manifest: %w", err)
	}
	r.Manifest = m
	return r, nil
}

// Close releases the underlying ZIP file handle.
func (r *Reader) Close() error { return r.zr.Close() }

// MainMarkdown returns the document body as bytes.
func (r *Reader) MainMarkdown() ([]byte, error) {
	entry := manifest.FileMainMD
	if r.Manifest != nil && r.Manifest.Entry != "" {
		entry = r.Manifest.Entry
	}
	return r.ReadFile(entry)
}

// ReadFile returns the bytes of an arbitrary entry inside the archive.
func (r *Reader) ReadFile(name string) ([]byte, error) {
	rc, err := r.openEntry(name)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

// AssetByID returns the bytes of the asset with the given manifest id.
// Loads the asset fully into memory; prefer OpenAssetByID for large files.
func (r *Reader) AssetByID(id string) ([]byte, *manifest.Asset, error) {
	a := r.Manifest.FindAsset(id)
	if a == nil {
		return nil, nil, fmt.Errorf("asset %q not found", id)
	}
	data, err := r.ReadFile(a.Path)
	if err != nil {
		return nil, nil, err
	}
	return data, a, nil
}

// OpenAssetByID returns a streaming reader for the asset. The caller
// must Close the reader; only ~32KB of buffer is held during streaming.
func (r *Reader) OpenAssetByID(id string) (io.ReadCloser, *manifest.Asset, error) {
	a := r.Manifest.FindAsset(id)
	if a == nil {
		return nil, nil, fmt.Errorf("asset %q not found", id)
	}
	rc, err := r.openEntry(a.Path)
	if err != nil {
		return nil, nil, err
	}
	return rc, a, nil
}

// VerifyAssets recomputes SHA-256 for every asset listed in the manifest
// and reports the first mismatch (or missing) it encounters.
func (r *Reader) VerifyAssets() error {
	for i := range r.Manifest.Assets {
		a := &r.Manifest.Assets[i]
		data, err := r.ReadFile(a.Path)
		if err != nil {
			return fmt.Errorf("asset %s: %w", a.ID, err)
		}
		if a.SHA256 == "" {
			continue
		}
		sum := sha256.Sum256(data)
		got := hex.EncodeToString(sum[:])
		if got != a.SHA256 {
			return fmt.Errorf("asset %s: sha256 mismatch (have %s, want %s)", a.ID, got, a.SHA256)
		}
	}
	return nil
}

// Files lists every entry in the ZIP, useful for unpack and inspect.
func (r *Reader) Files() []*zip.File { return r.zr.File }

func (r *Reader) openEntry(name string) (io.ReadCloser, error) {
	for _, f := range r.zr.File {
		if f.Name == name {
			return f.Open()
		}
	}
	return nil, errors.New("entry not found: " + name)
}
