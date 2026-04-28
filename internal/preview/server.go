package preview

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/manifest"
	"github.com/aimd-org/aimd/internal/render"
)

// Server is a running HTTP preview server bound to a single .aimd file.
type Server struct {
	URL  string
	srv  *http.Server
	ln   net.Listener
	path string
	mu   sync.RWMutex
	r    *aimd.Reader
	done chan error
}

// Start opens path, binds 127.0.0.1:port (port 0 picks a free one), and serves.
// Caller must Stop the returned server to release the file handle and socket.
func Start(path string, port int) (*Server, error) {
	r, err := aimd.Open(path)
	if err != nil {
		return nil, err
	}
	s := &Server{
		path: path,
		r:    r,
		done: make(chan error, 1),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.index)
	mux.HandleFunc("/assets/", s.assets)
	mux.HandleFunc("/api/document", s.document)
	mux.HandleFunc("/api/render", s.render)
	mux.HandleFunc("/api/save", s.save)
	mux.HandleFunc("/api/images", s.uploadImage)
	mux.HandleFunc("/api/images/from-path", s.uploadImageFromPath)
	mux.HandleFunc("/api/assets/delete", s.deleteAsset)

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		r.Close()
		return nil, err
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	s.URL = "http://" + ln.Addr().String() + "/"
	s.srv = srv
	s.ln = ln
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

// Stop gracefully shuts the server down and releases the .aimd file.
func (s *Server) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
	<-s.done
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.r.Close()
}

// Wait blocks until the server stops on its own (e.g. a fatal Serve error).
func (s *Server) Wait() error { return <-s.done }

func (s *Server) index(rw http.ResponseWriter, req *http.Request) {
	if req.URL.Path != "/" {
		http.NotFound(rw, req)
		return
	}
	s.mu.RLock()
	title := s.r.Manifest.Title
	s.mu.RUnlock()
	rw.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = rw.Write(render.EditorPage(title))
}

func (s *Server) document(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		methodNotAllowed(rw)
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	md, err := s.r.MainMarkdown()
	if err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	body, err := render.Markdown(md, func(id string) string { return "/assets/" + id })
	if err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	assets := make([]manifest.Asset, len(s.r.Manifest.Assets))
	copy(assets, s.r.Manifest.Assets)
	writeJSON(rw, map[string]any{
		"title":    s.r.Manifest.Title,
		"markdown": string(md),
		"html":     string(body),
		"assets":   assets,
	})
}

func (s *Server) render(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(rw)
		return
	}
	var in struct {
		Markdown string `json:"markdown"`
	}
	if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	body, err := render.Markdown([]byte(in.Markdown), func(id string) string { return "/assets/" + id })
	if err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(rw, map[string]string{"html": string(body)})
}

func (s *Server) save(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(rw)
		return
	}
	var in struct {
		Markdown string `json:"markdown"`
	}
	if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.rewrite(aimd.RewriteOptions{Markdown: []byte(in.Markdown)}); err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(rw, map[string]string{"status": "saved"})
}

func (s *Server) uploadImage(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(rw)
		return
	}
	if err := req.ParseMultipartForm(32 << 20); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	file, hdr, err := req.FormFile("image")
	if err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 50<<20))
	if err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if len(data) == 0 {
		http.Error(rw, "empty image", http.StatusBadRequest)
		return
	}
	s.writeAddedImage(rw, hdr.Filename, data)
}

func (s *Server) uploadImageFromPath(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(rw)
		return
	}
	var in struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	path := strings.TrimSpace(in.Path)
	if strings.HasPrefix(path, "file://") {
		u, err := url.Parse(path)
		if err != nil {
			http.Error(rw, err.Error(), http.StatusBadRequest)
			return
		}
		path = u.Path
	}
	if !isImageFilename(path) {
		http.Error(rw, "not an image file", http.StatusBadRequest)
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if len(data) == 0 {
		http.Error(rw, "empty image", http.StatusBadRequest)
		return
	}
	s.writeAddedImage(rw, filepath.Base(path), data)
}

func (s *Server) writeAddedImage(rw http.ResponseWriter, originalName string, data []byte) {
	s.mu.RLock()
	id, filename := aimd.UniqueAssetName(s.r.Manifest, originalName)
	currentMD, err := s.r.MainMarkdown()
	s.mu.RUnlock()
	if err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := s.rewrite(aimd.RewriteOptions{
		Markdown: currentMD,
		AddAssets: []aimd.NewAsset{{
			ID:       id,
			Filename: filename,
			Data:     data,
			Role:     manifest.RoleContentImage,
		}},
	}); err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(rw, map[string]string{
		"id":       id,
		"filename": filename,
		"uri":      "asset://" + id,
		"markdown": fmt.Sprintf("![%s](asset://%s)", imageAlt(filename), id),
	})
}

func isImageFilename(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg":
		return true
	default:
		return false
	}
}

func (s *Server) deleteAsset(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(rw)
		return
	}
	var in struct {
		ID       string `json:"id"`
		Markdown string `json:"markdown"`
	}
	if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if in.ID == "" {
		http.Error(rw, "missing id", http.StatusBadRequest)
		return
	}
	if err := s.rewrite(aimd.RewriteOptions{
		Markdown:     []byte(in.Markdown),
		DeleteAssets: map[string]bool{in.ID: true},
	}); err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(rw, map[string]string{"status": "deleted"})
}

func (s *Server) assets(rw http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/assets/")
	s.mu.RLock()
	defer s.mu.RUnlock()
	rc, asset, err := s.r.OpenAssetByID(id)
	if err != nil {
		http.NotFound(rw, req)
		return
	}
	defer rc.Close()
	if asset.MIME != "" {
		rw.Header().Set("Content-Type", asset.MIME)
	}
	if asset.Size > 0 {
		rw.Header().Set("Content-Length", fmt.Sprintf("%d", asset.Size))
	}
	_, _ = io.Copy(rw, rc)
}

func (s *Server) rewrite(opt aimd.RewriteOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.r.Close(); err != nil {
		return err
	}
	if err := aimd.Rewrite(s.path, opt); err != nil {
		r, openErr := aimd.Open(s.path)
		if openErr == nil {
			s.r = r
		}
		return err
	}
	r, err := aimd.Open(s.path)
	if err != nil {
		return err
	}
	s.r = r
	return nil
}

func writeJSON(rw http.ResponseWriter, v any) {
	rw.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(rw).Encode(v)
}

func methodNotAllowed(rw http.ResponseWriter) {
	http.Error(rw, "method not allowed", http.StatusMethodNotAllowed)
}

func imageAlt(filename string) string {
	name := filename
	if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	return strings.ReplaceAll(name, "-", " ")
}
