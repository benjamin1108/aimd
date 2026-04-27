package preview

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/render"
)

// Server is a running HTTP preview server bound to a single .aimd file.
type Server struct {
	URL  string
	srv  *http.Server
	ln   net.Listener
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
	mux := http.NewServeMux()
	mux.HandleFunc("/", indexFor(r))
	mux.HandleFunc("/assets/", assetsFor(r))

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		r.Close()
		return nil, err
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	s := &Server{
		URL:  "http://" + ln.Addr().String() + "/",
		srv:  srv,
		ln:   ln,
		r:    r,
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

// Stop gracefully shuts the server down and releases the .aimd file.
func (s *Server) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
	<-s.done
	return s.r.Close()
}

// Wait blocks until the server stops on its own (e.g. a fatal Serve error).
func (s *Server) Wait() error { return <-s.done }

func indexFor(r *aimd.Reader) http.HandlerFunc {
	return func(rw http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/" {
			http.NotFound(rw, req)
			return
		}
		md, err := r.MainMarkdown()
		if err != nil {
			http.Error(rw, err.Error(), http.StatusInternalServerError)
			return
		}
		body, err := render.Markdown(md, func(id string) string { return "/assets/" + id })
		if err != nil {
			http.Error(rw, err.Error(), http.StatusInternalServerError)
			return
		}
		rw.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = rw.Write(render.Page(r.Manifest.Title, body))
	}
}

func assetsFor(r *aimd.Reader) http.HandlerFunc {
	return func(rw http.ResponseWriter, req *http.Request) {
		id := strings.TrimPrefix(req.URL.Path, "/assets/")
		rc, asset, err := r.OpenAssetByID(id)
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
}
