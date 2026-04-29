package editor

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aimd-org/aimd/internal/render"
	"github.com/aimd-org/aimd/internal/vendor"
)

var timeNow = time.Now

func renderEditorPage(title string) []byte { return render.EditorPage(title) }

const maxUploadBytes = 50 << 20 // 50 MiB per image is generous for v0.1.

func registerHandlers(mux *http.ServeMux, sess *Session) {
	mux.HandleFunc("/", indexHandler(sess))
	mux.HandleFunc("/marked.js", staticJS(vendor.MarkedJS))
	mux.HandleFunc("/preview.css", previewCSSHandler())
	mux.HandleFunc("/api/doc", docHandler(sess))
	mux.HandleFunc("/api/upload", uploadHandler(sess))
	mux.HandleFunc("/api/save", saveHandler(sess))
	mux.HandleFunc("/assets/", assetsHandler(sess))
}

func indexHandler(sess *Session) http.HandlerFunc {
	return func(rw http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/" {
			http.NotFound(rw, req)
			return
		}
		title := sess.Title()
		if title == "" {
			title = "AIMD"
		}
		rw.Header().Set("Content-Type", "text/html; charset=utf-8")
		rw.Header().Set("Cache-Control", "no-store")
		_, _ = rw.Write(renderEditorPage(title))
	}
}

// previewCSSHandler serves the same CSS the read-only renderer uses, so the
// editor preview pane looks identical to `aimd preview` / `aimd seal` output.
func previewCSSHandler() http.HandlerFunc {
	body := []byte(render.PreviewCSS())
	return func(rw http.ResponseWriter, _ *http.Request) {
		rw.Header().Set("Content-Type", "text/css; charset=utf-8")
		_, _ = rw.Write(body)
	}
}

func staticJS(body string) http.HandlerFunc {
	return func(rw http.ResponseWriter, _ *http.Request) {
		rw.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		_, _ = io.WriteString(rw, body)
	}
}

type docResponse struct {
	Title    string       `json:"title"`
	Path     string       `json:"path"`
	Markdown string       `json:"markdown"`
	Assets   []AssetEntry `json:"assets"`
}

func docHandler(sess *Session) http.HandlerFunc {
	return func(rw http.ResponseWriter, _ *http.Request) {
		md, err := sess.Markdown()
		if err != nil {
			http.Error(rw, err.Error(), http.StatusInternalServerError)
			return
		}
		resp := docResponse{
			Title:    sess.Title(),
			Path:     sess.Path(),
			Markdown: string(md),
			Assets:   sess.Assets(),
		}
		writeJSON(rw, resp)
	}
}

func uploadHandler(sess *Session) http.HandlerFunc {
	return func(rw http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(rw, "POST required", http.StatusMethodNotAllowed)
			return
		}
		req.Body = http.MaxBytesReader(rw, req.Body, maxUploadBytes+1<<20)
		if err := req.ParseMultipartForm(maxUploadBytes); err != nil {
			http.Error(rw, "upload too large or malformed: "+err.Error(), http.StatusBadRequest)
			return
		}
		file, header, err := req.FormFile("file")
		if err != nil {
			http.Error(rw, "missing file field", http.StatusBadRequest)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil {
			http.Error(rw, "read file: "+err.Error(), http.StatusBadRequest)
			return
		}
		entry, err := sess.AddPending(header.Filename, data)
		if err != nil {
			http.Error(rw, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(rw, entry)
	}
}

type saveRequest struct {
	Markdown string `json:"markdown"`
	Title    string `json:"title,omitempty"`
}

type saveResponse struct {
	OK      bool         `json:"ok"`
	Path    string       `json:"path"`
	Title   string       `json:"title"`
	Assets  []AssetEntry `json:"assets"`
	SavedAt string       `json:"savedAt"`
}

func saveHandler(sess *Session) http.HandlerFunc {
	return func(rw http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(rw, "POST required", http.StatusMethodNotAllowed)
			return
		}
		var body saveRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(rw, "bad json: "+err.Error(), http.StatusBadRequest)
			return
		}
		if err := sess.Save(SaveOptions{
			Markdown: []byte(body.Markdown),
			Title:    body.Title,
		}); err != nil {
			http.Error(rw, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(rw, saveResponse{
			OK:      true,
			Path:    sess.Path(),
			Title:   sess.Title(),
			Assets:  sess.Assets(),
			SavedAt: nowRFC3339(),
		})
	}
}

func assetsHandler(sess *Session) http.HandlerFunc {
	return func(rw http.ResponseWriter, req *http.Request) {
		id := strings.TrimPrefix(req.URL.Path, "/assets/")
		if id == "" {
			http.NotFound(rw, req)
			return
		}
		rc, mime, size, err := sess.OpenAsset(id)
		if err != nil {
			http.NotFound(rw, req)
			return
		}
		defer rc.Close()
		if mime != "" {
			rw.Header().Set("Content-Type", mime)
		}
		if size > 0 {
			rw.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		rw.Header().Set("Cache-Control", "no-store")
		_, _ = io.Copy(rw, rc)
	}
}

func writeJSON(rw http.ResponseWriter, v any) {
	rw.Header().Set("Content-Type", "application/json; charset=utf-8")
	rw.Header().Set("Cache-Control", "no-store")
	enc := json.NewEncoder(rw)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func nowRFC3339() string {
	return timeNow().UTC().Format("2006-01-02T15:04:05Z")
}
