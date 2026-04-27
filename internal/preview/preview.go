// Package preview serves a .aimd file over HTTP for browser viewing.
package preview

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"runtime"
)

// Options controls a preview run.
type Options struct {
	Input string
	Port  int  // 0 = pick a free port
	Open  bool // attempt to launch the system browser
}

// Run serves the document and blocks until ctx is cancelled or Serve fails.
func Run(ctx context.Context, w io.Writer, opt Options) error {
	s, err := Start(opt.Input, opt.Port)
	if err != nil {
		return err
	}
	defer s.Stop()

	fmt.Fprintf(w, "AIMD preview: %s\nPress Ctrl+C to stop.\n", s.URL)
	if opt.Open {
		go openBrowser(s.URL)
	}
	select {
	case <-ctx.Done():
		return nil
	case err := <-s.done:
		return err
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
