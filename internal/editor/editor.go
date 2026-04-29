// Package editor opens a .aimd file for live editing in a webview.
//
// Unlike preview (read-only), the editor session keeps the file path and
// the in-memory pending state, exposes HTTP endpoints for image upload and
// document save, and rewrites the .aimd archive atomically when the user
// hits "Save".
package editor

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/manifest"
	"github.com/aimd-org/aimd/internal/mdx"
)

// Pending is an image that the user has uploaded but not yet saved.
type Pending struct {
	Filename string
	MIME     string
	Data     []byte
}

// Session owns the open .aimd file and the editor's mutable state.
//
// All exported methods are safe for concurrent use; HTTP handlers are
// expected to call them from many goroutines.
type Session struct {
	mu      sync.Mutex
	path    string
	r       *aimd.Reader
	pending map[string]*Pending // id -> uploaded image
}

// Open loads path for editing.
func Open(path string) (*Session, error) {
	r, err := aimd.Open(path)
	if err != nil {
		return nil, err
	}
	return &Session{
		path:    path,
		r:       r,
		pending: map[string]*Pending{},
	}, nil
}

// Close releases the underlying file handle.
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.r == nil {
		return nil
	}
	err := s.r.Close()
	s.r = nil
	return err
}

// Path returns the .aimd path being edited.
func (s *Session) Path() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.path
}

// Title returns the current document title from the manifest.
func (s *Session) Title() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.r == nil || s.r.Manifest == nil {
		return ""
	}
	return s.r.Manifest.Title
}

// Markdown returns the current main.md bytes from the on-disk archive.
// It does not include unsaved editor edits — those live only in the browser.
func (s *Session) Markdown() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.r == nil {
		return nil, errors.New("session closed")
	}
	return s.r.MainMarkdown()
}

// AssetEntry is the JSON-friendly description of one asset.
type AssetEntry struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	MIME     string `json:"mime,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Role     string `json:"role,omitempty"`
	Pending  bool   `json:"pending,omitempty"`
}

// Assets returns every asset known to the session — both saved and pending.
func (s *Session) Assets() []AssetEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []AssetEntry
	if s.r != nil && s.r.Manifest != nil {
		for _, a := range s.r.Manifest.Assets {
			out = append(out, AssetEntry{
				ID:       a.ID,
				Filename: filepath.Base(a.Path),
				MIME:     a.MIME,
				Size:     a.Size,
				Role:     a.Role,
			})
		}
	}
	for id, p := range s.pending {
		out = append(out, AssetEntry{
			ID:       id,
			Filename: p.Filename,
			MIME:     p.MIME,
			Size:     int64(len(p.Data)),
			Role:     manifest.RoleContentImage,
			Pending:  true,
		})
	}
	return out
}

// OpenAsset returns a reader for the asset with the given id, looking first
// in pending uploads and falling back to the on-disk archive.
func (s *Session) OpenAsset(id string) (io.ReadCloser, string, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.pending[id]; ok {
		return io.NopCloser(bytes.NewReader(p.Data)), p.MIME, int64(len(p.Data)), nil
	}
	if s.r == nil {
		return nil, "", 0, errors.New("session closed")
	}
	rc, a, err := s.r.OpenAssetByID(id)
	if err != nil {
		return nil, "", 0, err
	}
	return rc, a.MIME, a.Size, nil
}

// AddPending stores an uploaded image in memory and returns its allocated id.
// Filename is sanitised for use inside the archive.
func (s *Session) AddPending(filename string, data []byte) (AssetEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if filename == "" {
		filename = "image"
	}
	mime := manifest.MIMEByExt(filename)
	id := s.allocateAssetIDLocked(filename)
	p := &Pending{
		Filename: uniqueFilenameLocked(s, filename),
		MIME:     mime,
		Data:     data,
	}
	s.pending[id] = p
	return AssetEntry{
		ID:       id,
		Filename: p.Filename,
		MIME:     p.MIME,
		Size:     int64(len(p.Data)),
		Role:     manifest.RoleContentImage,
		Pending:  true,
	}, nil
}

// allocateAssetIDLocked picks an id that does not yet collide with the
// existing manifest or any pending upload. Caller must hold s.mu.
func (s *Session) allocateAssetIDLocked(filename string) string {
	stem := sanitizeStem(filename)
	if stem == "" {
		stem = "img"
	}
	used := map[string]bool{}
	if s.r != nil && s.r.Manifest != nil {
		for _, a := range s.r.Manifest.Assets {
			used[a.ID] = true
		}
	}
	for id := range s.pending {
		used[id] = true
	}
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s-%03d", stem, i)
		if !used[candidate] {
			return candidate
		}
	}
}

// SaveOptions describes what the editor is asking us to commit to disk.
type SaveOptions struct {
	Markdown []byte
	Title    string // optional override; empty = keep current
}

// Save rewrites the .aimd archive on disk with the given markdown plus all
// assets still referenced by it. Orphan assets (uploaded but not used,
// previously-existing but no longer linked) are dropped.
//
// The write is atomic on POSIX: a sibling temp file is filled, then renamed
// into place. The on-disk reader is closed and reopened around the rename.
func (s *Session) Save(opt SaveOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.r == nil {
		return errors.New("session closed")
	}

	referenced := referencedAssetIDs(opt.Markdown)

	// Build the new manifest by walking the references in source order, so
	// the manifest order matches the document order.
	newManifest := manifest.New(opt.Title)
	if newManifest.Title == "" {
		newManifest.Title = s.r.Manifest.Title
	}
	newManifest.CreatedAt = s.r.Manifest.CreatedAt
	newManifest.UpdatedAt = time.Now().UTC()
	newManifest.Authors = s.r.Manifest.Authors
	newManifest.GeneratedBy = s.r.Manifest.GeneratedBy
	newManifest.Rendering = s.r.Manifest.Rendering

	// Each asset is either an existing one (already in the archive) or a
	// pending upload (data in memory). We build assemble specs in order so
	// the new ZIP layout is deterministic.
	type spec struct {
		asset    manifest.Asset
		fromZip  string // existing path inside old archive
		fromMem  []byte // pending upload data
	}
	var specs []spec
	seen := map[string]bool{}

	for _, id := range referenced {
		if seen[id] {
			continue
		}
		seen[id] = true
		if p, ok := s.pending[id]; ok {
			sum := sha256.Sum256(p.Data)
			a := manifest.Asset{
				ID:     id,
				Path:   filepath.ToSlash(filepath.Join("assets", p.Filename)),
				MIME:   p.MIME,
				SHA256: hex.EncodeToString(sum[:]),
				Size:   int64(len(p.Data)),
				Role:   manifest.RoleContentImage,
			}
			specs = append(specs, spec{asset: a, fromMem: p.Data})
			continue
		}
		if existing := s.r.Manifest.FindAsset(id); existing != nil {
			specs = append(specs, spec{asset: *existing, fromZip: existing.Path})
			continue
		}
		// Reference to an unknown id: leave it as-is in markdown but skip
		// in the manifest. The renderer will show a broken image — which
		// is the correct signal to the user.
	}
	for _, sp := range specs {
		newManifest.Assets = append(newManifest.Assets, sp.asset)
	}

	// Write to a temp file in the same directory so rename(2) stays on the
	// same filesystem.
	dir := filepath.Dir(s.path)
	tmp, err := os.CreateTemp(dir, ".aimd-save-*.tmp")
	if err != nil {
		return fmt.Errorf("create tmp: %w", err)
	}
	tmpName := tmp.Name()
	zw := zip.NewWriter(tmp)

	if err := writeZipEntry(zw, "main.md", opt.Markdown); err != nil {
		zw.Close()
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	for _, sp := range specs {
		var data []byte
		if sp.fromMem != nil {
			data = sp.fromMem
		} else {
			data, err = s.r.ReadFile(sp.fromZip)
			if err != nil {
				zw.Close()
				tmp.Close()
				os.Remove(tmpName)
				return fmt.Errorf("copy asset %s: %w", sp.asset.ID, err)
			}
		}
		if err := writeZipEntry(zw, sp.asset.Path, data); err != nil {
			zw.Close()
			tmp.Close()
			os.Remove(tmpName)
			return err
		}
	}
	var manifestBuf bytes.Buffer
	if err := newManifest.Encode(&manifestBuf); err != nil {
		zw.Close()
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("encode manifest: %w", err)
	}
	if err := writeZipEntry(zw, manifest.FileManifest, manifestBuf.Bytes()); err != nil {
		zw.Close()
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := zw.Close(); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("finalize zip: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}

	// Close the old reader before swapping the file. macOS allows rename
	// while the file is open, but Linux does too — and Windows requires it.
	if err := s.r.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	s.r = nil
	if err := os.Rename(tmpName, s.path); err != nil {
		// Try to recover by reopening the original.
		if r2, err2 := aimd.Open(s.path); err2 == nil {
			s.r = r2
		}
		os.Remove(tmpName)
		return fmt.Errorf("rename: %w", err)
	}
	r2, err := aimd.Open(s.path)
	if err != nil {
		return fmt.Errorf("reopen: %w", err)
	}
	s.r = r2
	s.pending = map[string]*Pending{}
	return nil
}

// Server is the HTTP front-end of an editor session.
type Server struct {
	URL  string
	srv  *http.Server
	ln   net.Listener
	sess *Session
	done chan error
}

// Start opens path and serves the editor on 127.0.0.1:port (port 0 picks).
func Start(path string, port int) (*Server, error) {
	sess, err := Open(path)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	registerHandlers(mux, sess)

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		sess.Close()
		return nil, err
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	s := &Server{
		URL:  "http://" + ln.Addr().String() + "/",
		srv:  srv,
		ln:   ln,
		sess: sess,
		done: make(chan error, 1),
	}
	go func() {
		err := srv.Serve(ln)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.done <- err
			return
		}
		s.done <- nil
	}()
	return s, nil
}

// Stop tears down the HTTP server and closes the underlying file.
func (s *Server) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
	<-s.done
	return s.sess.Close()
}

// Wait blocks until the server stops.
func (s *Server) Wait() error { return <-s.done }

// referencedAssetIDs returns asset ids that the markdown still links to,
// in document order with duplicates preserved on first occurrence only.
func referencedAssetIDs(md []byte) []string {
	var ids []string
	seen := map[string]bool{}
	for _, ref := range mdx.Scan(md) {
		id := mdx.AssetURIID(ref.URL)
		if id == "" {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids
}

func writeZipEntry(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return fmt.Errorf("zip create %s: %w", name, err)
	}
	if _, err := w.Write(data); err != nil {
		return fmt.Errorf("zip write %s: %w", name, err)
	}
	return nil
}

func sanitizeStem(filename string) string {
	stem := filename
	if i := lastIndexByte(stem, '.'); i > 0 {
		stem = stem[:i]
	}
	var b []byte
	for _, r := range stem {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b = append(b, byte(r))
		case r == ' ' || r == '.':
			b = append(b, '-')
		}
	}
	return string(b)
}

func lastIndexByte(s string, c byte) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func uniqueFilenameLocked(s *Session, name string) string {
	taken := map[string]bool{}
	if s.r != nil && s.r.Manifest != nil {
		for _, a := range s.r.Manifest.Assets {
			taken[filepath.Base(a.Path)] = true
		}
	}
	for _, p := range s.pending {
		taken[p.Filename] = true
	}
	if !taken[name] {
		return name
	}
	ext := filepath.Ext(name)
	stem := name[:len(name)-len(ext)]
	for i := 1; ; i++ {
		c := fmt.Sprintf("%s-%d%s", stem, i, ext)
		if !taken[c] {
			return c
		}
	}
}
