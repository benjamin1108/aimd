//go:build darwin

// Package view opens a .aimd file in a native WKWebView window.
package view

import (
	"github.com/aimd-org/aimd/internal/preview"
	webview "github.com/webview/webview_go"
)

// Options controls a view run.
type Options struct {
	Input  string
	Width  int
	Height int
	Title  string
}

// Run starts a loopback HTTP server, opens a WKWebView window pointed at it,
// and blocks until the window is closed. Server is shut down on return.
func Run(opt Options) error {
	s, err := preview.Start(opt.Input, 0)
	if err != nil {
		return err
	}
	defer s.Stop()

	w := webview.New(false)
	defer w.Destroy()

	title := opt.Title
	if title == "" {
		title = "AIMD"
	}
	w.SetTitle(title)
	width := opt.Width
	if width == 0 {
		width = 1100
	}
	height := opt.Height
	if height == 0 {
		height = 820
	}
	w.SetSize(width, height, webview.HintNone)
	if err := w.Bind("aimdPasteImagePaths", func() []string {
		return pasteboardImagePaths()
	}); err != nil {
		return err
	}
	if err := w.Bind("aimdChooseImagePaths", func() []string {
		return chooseImagePaths()
	}); err != nil {
		return err
	}
	w.Navigate(s.URL)
	w.Run()
	return nil
}
