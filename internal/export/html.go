// Package export converts .aimd files to other formats. v0.1: single-file HTML.
package export

import (
	"encoding/base64"
	"fmt"
	"os"

	"github.com/aimd-org/aimd/internal/aimd"
	"github.com/aimd-org/aimd/internal/render"
)

// HTMLOptions controls export html.
type HTMLOptions struct {
	Input  string
	Output string
}

// HTML writes a self-contained .html file with all assets inlined as data URIs.
func HTML(opt HTMLOptions) error {
	r, err := aimd.Open(opt.Input)
	if err != nil {
		return err
	}
	defer r.Close()

	md, err := r.MainMarkdown()
	if err != nil {
		return err
	}
	body, err := render.Markdown(md, func(id string) string {
		data, asset, err := r.AssetByID(id)
		if err != nil {
			return ""
		}
		mime := asset.MIME
		if mime == "" {
			mime = "application/octet-stream"
		}
		return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
	})
	if err != nil {
		return err
	}
	return os.WriteFile(opt.Output, render.Page(r.Manifest.Title, body), 0o644)
}
