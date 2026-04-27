// Package seal produces a self-rendering single .html file from a .aimd.
//
// The output embeds the entire .aimd ZIP as base64 plus inline copies of
// fflate (ZIP parser) and marked (Markdown renderer). Opened in any browser
// it parses itself, extracts assets to blob: URLs, and renders main.md —
// no aimd CLI, network, or extension required.
package seal

import (
	_ "embed"
	"encoding/base64"
	"fmt"
	"html"
	"io"
	"os"
	"strings"

	"github.com/aimd-org/aimd/internal/aimd"
)

//go:embed template.html
var templateHTML string

//go:embed vendor/marked.min.js
var markedJS string

//go:embed vendor/fflate.min.js
var fflateJS string

// Options controls a seal run.
type Options struct {
	Input  string // .aimd file path
	Output string // .html file path
}

// Run reads input, embeds it into the self-rendering template, and writes output.
func Run(opt Options) error {
	zipBytes, err := os.ReadFile(opt.Input)
	if err != nil {
		return fmt.Errorf("read %s: %w", opt.Input, err)
	}

	// We open the archive only to recover the document title for <title>.
	r, err := aimd.Open(opt.Input)
	if err != nil {
		return fmt.Errorf("open .aimd: %w", err)
	}
	title := r.Manifest.Title
	r.Close()

	out := templateHTML
	out = strings.Replace(out, "__AIMD_TITLE__", html.EscapeString(title), 1)
	out = strings.Replace(out, "__AIMD_FFLATE__", fflateJS, 1)
	out = strings.Replace(out, "__AIMD_MARKED__", markedJS, 1)
	out = strings.Replace(out, "__AIMD_ZIP_BASE64__", base64.StdEncoding.EncodeToString(zipBytes), 1)

	f, err := os.Create(opt.Output)
	if err != nil {
		return fmt.Errorf("create %s: %w", opt.Output, err)
	}
	defer f.Close()
	if _, err := io.WriteString(f, out); err != nil {
		return err
	}
	return nil
}
