// Package inspect prints a human-readable summary of a .aimd file.
package inspect

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"text/tabwriter"

	"github.com/aimd-org/aimd/internal/aimd"
)

// Options controls an inspect run.
type Options struct {
	Input string
	JSON  bool // dump raw manifest.json
}

// Run executes the inspect pipeline, writing output to w.
func Run(w io.Writer, opt Options) error {
	r, err := aimd.Open(opt.Input)
	if err != nil {
		return err
	}
	defer r.Close()

	if opt.JSON {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(r.Manifest)
	}

	m := r.Manifest
	fmt.Fprintf(w, "File:    %s\n", opt.Input)
	fmt.Fprintf(w, "Format:  %s v%s\n", m.Format, m.Version)
	fmt.Fprintf(w, "Title:   %s\n", m.Title)
	fmt.Fprintf(w, "Entry:   %s\n", m.Entry)
	fmt.Fprintf(w, "Created: %s\n", m.CreatedAt.Format("2006-01-02 15:04:05 MST"))
	fmt.Fprintf(w, "Updated: %s\n", m.UpdatedAt.Format("2006-01-02 15:04:05 MST"))
	if len(m.Authors) > 0 {
		fmt.Fprintf(w, "Authors:\n")
		for _, a := range m.Authors {
			fmt.Fprintf(w, "  - %s (%s)\n", a.Name, a.Type)
		}
	}
	if m.GeneratedBy != nil {
		fmt.Fprintf(w, "GeneratedBy: %s/%s (%s)\n",
			m.GeneratedBy.Provider, m.GeneratedBy.Model, m.GeneratedBy.Type)
	}
	fmt.Fprintf(w, "\nAssets (%d):\n", len(m.Assets))
	if len(m.Assets) == 0 {
		return nil
	}
	tw := tabwriter.NewWriter(w, 0, 2, 2, ' ', 0)
	fmt.Fprintln(tw, "  ID\tPATH\tMIME\tSIZE\tCHECK")
	for _, a := range m.Assets {
		check := verify(r, a.Path, a.SHA256)
		fmt.Fprintf(tw, "  %s\t%s\t%s\t%d\t%s\n", a.ID, a.Path, a.MIME, a.Size, check)
	}
	return tw.Flush()
}

func verify(r *aimd.Reader, path, want string) string {
	if want == "" {
		return "no-hash"
	}
	data, err := r.ReadFile(path)
	if err != nil {
		return "missing"
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) == want {
		return "ok"
	}
	return "MISMATCH"
}
