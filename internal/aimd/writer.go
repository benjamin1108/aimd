// Package aimd implements low-level read and write of the .aimd ZIP container.
package aimd

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"

	"github.com/aimd-org/aimd/internal/manifest"
)

// Writer assembles a .aimd file. Use New, then Add* methods, then Close.
type Writer struct {
	f  *os.File
	zw *zip.Writer
	m  *manifest.Manifest
}

// Create opens dest for writing as a new .aimd file.
// The caller must Close the returned Writer to flush the ZIP central directory.
func Create(dest string, m *manifest.Manifest) (*Writer, error) {
	f, err := os.Create(dest)
	if err != nil {
		return nil, err
	}
	return &Writer{f: f, zw: zip.NewWriter(f), m: m}, nil
}

// SetMainMarkdown writes the document body as main.md.
func (w *Writer) SetMainMarkdown(content []byte) error {
	return w.writeFile(manifest.FileMainMD, content)
}

// AddAsset writes a binary asset under assets/<filename> and registers it
// in the manifest. The id should be unique within the document.
func (w *Writer) AddAsset(id, filename string, data []byte, role string) (manifest.Asset, error) {
	relPath := path.Join("assets", filename)
	if err := w.writeFile(relPath, data); err != nil {
		return manifest.Asset{}, err
	}
	sum := sha256.Sum256(data)
	asset := manifest.Asset{
		ID:     id,
		Path:   relPath,
		MIME:   manifest.MIMEByExt(filename),
		SHA256: hex.EncodeToString(sum[:]),
		Size:   int64(len(data)),
		Role:   role,
	}
	w.m.Assets = append(w.m.Assets, asset)
	return asset, nil
}

// Close finalises manifest.json and the ZIP archive.
func (w *Writer) Close() error {
	var buf bytes.Buffer
	if err := w.m.Encode(&buf); err != nil {
		return fmt.Errorf("encode manifest: %w", err)
	}
	if err := w.writeFile(manifest.FileManifest, buf.Bytes()); err != nil {
		return err
	}
	if err := w.zw.Close(); err != nil {
		w.f.Close()
		return err
	}
	return w.f.Close()
}

func (w *Writer) writeFile(name string, data []byte) error {
	fw, err := w.zw.Create(name)
	if err != nil {
		return fmt.Errorf("zip create %s: %w", name, err)
	}
	if _, err := io.Copy(fw, bytes.NewReader(data)); err != nil {
		return fmt.Errorf("zip write %s: %w", name, err)
	}
	return nil
}
