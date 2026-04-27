// Command aimd is the CLI for the AIMD (AI Markdown Document) format.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/aimd-org/aimd/internal/export"
	"github.com/aimd-org/aimd/internal/inspect"
	"github.com/aimd-org/aimd/internal/manifest"
	"github.com/aimd-org/aimd/internal/pack"
	"github.com/aimd-org/aimd/internal/preview"
	"github.com/aimd-org/aimd/internal/seal"
	"github.com/aimd-org/aimd/internal/unpack"
	"github.com/aimd-org/aimd/internal/view"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

const usage = `aimd — AI Markdown Document toolkit (v0.1 spec)

Usage:
  aimd <command> [flags]

Commands:
  pack       Bundle a Markdown file and its images into a .aimd file
  unpack     Expand a .aimd file into a directory of plain Markdown + assets
  inspect    Print the manifest and resource summary of a .aimd file
  view       Open a .aimd file in a native window (macOS WKWebView)
  preview    Serve a .aimd file locally in your browser
  seal       Produce a self-rendering single .html that needs no aimd CLI
  export     Export a .aimd to another format (html for v0.1)
  version    Print the aimd version
  help       Show this help

Run 'aimd <command> -h' for command-specific options.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "pack":
		err = runPack(args)
	case "unpack":
		err = runUnpack(args)
	case "inspect":
		err = runInspect(args)
	case "preview":
		err = runPreview(args)
	case "view":
		err = runView(args)
	case "seal":
		err = runSeal(args)
	case "export":
		err = runExport(args)
	case "version", "--version", "-v":
		fmt.Printf("aimd %s (spec %s v%s)\n", version, manifest.FormatName, manifest.FormatVersion)
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n%s", cmd, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func runPack(args []string) error {
	fs := flag.NewFlagSet("pack", flag.ExitOnError)
	out := fs.String("o", "", "output .aimd path (default: <input>.aimd)")
	title := fs.String("title", "", "override document title")
	includeRemote := fs.Bool("include-remote", false, "download and embed http(s) images (not implemented in v0.1)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: aimd pack <input.md> [-o output.aimd]")
		fs.PrintDefaults()
	}
	_ = fs.Parse(permute(fs, args))
	if fs.NArg() != 1 {
		fs.Usage()
		return fmt.Errorf("pack requires exactly one input file")
	}
	in := fs.Arg(0)
	output := *out
	if output == "" {
		output = strings.TrimSuffix(in, ".md") + ".aimd"
	}
	if *includeRemote {
		fmt.Fprintln(os.Stderr, "warning: --include-remote is not implemented yet (v0.1)")
	}
	return pack.Run(pack.Options{
		Input:  in,
		Output: output,
		Title:  *title,
	})
}

func runUnpack(args []string) error {
	fs := flag.NewFlagSet("unpack", flag.ExitOnError)
	out := fs.String("o", "", "output directory (default: <input> without .aimd suffix)")
	keep := fs.Bool("keep-asset-uri", false, "keep asset:// references in main.md (default: rewrite to assets/<path>)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: aimd unpack <input.aimd> [-o output-dir]")
		fs.PrintDefaults()
	}
	_ = fs.Parse(permute(fs, args))
	if fs.NArg() != 1 {
		fs.Usage()
		return fmt.Errorf("unpack requires exactly one input file")
	}
	in := fs.Arg(0)
	dir := *out
	if dir == "" {
		dir = strings.TrimSuffix(in, ".aimd")
	}
	return unpack.Run(unpack.Options{
		Input:        in,
		OutputDir:    dir,
		KeepAssetURI: *keep,
	})
}

func runInspect(args []string) error {
	fs := flag.NewFlagSet("inspect", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "print raw manifest.json")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: aimd inspect <input.aimd> [--json]")
		fs.PrintDefaults()
	}
	_ = fs.Parse(permute(fs, args))
	if fs.NArg() != 1 {
		fs.Usage()
		return fmt.Errorf("inspect requires exactly one input file")
	}
	return inspect.Run(os.Stdout, inspect.Options{Input: fs.Arg(0), JSON: *asJSON})
}

func runPreview(args []string) error {
	fs := flag.NewFlagSet("preview", flag.ExitOnError)
	port := fs.Int("port", 0, "port to listen on (0 = pick a free one)")
	noOpen := fs.Bool("no-open", false, "do not launch the system browser")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: aimd preview <input.aimd> [--port N] [--no-open]")
		fs.PrintDefaults()
	}
	_ = fs.Parse(permute(fs, args))
	if fs.NArg() != 1 {
		fs.Usage()
		return fmt.Errorf("preview requires exactly one input file")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return preview.Run(ctx, os.Stdout, preview.Options{
		Input: fs.Arg(0),
		Port:  *port,
		Open:  !*noOpen,
	})
}

func runView(args []string) error {
	fs := flag.NewFlagSet("view", flag.ExitOnError)
	width := fs.Int("width", 1100, "window width in pixels")
	height := fs.Int("height", 820, "window height in pixels")
	title := fs.String("title", "", "window title (default: document title)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: aimd view <input.aimd> [--width W --height H]")
		fs.PrintDefaults()
	}
	_ = fs.Parse(permute(fs, args))
	if fs.NArg() != 1 {
		fs.Usage()
		return fmt.Errorf("view requires exactly one input file")
	}
	return view.Run(view.Options{
		Input:  fs.Arg(0),
		Width:  *width,
		Height: *height,
		Title:  *title,
	})
}

func runSeal(args []string) error {
	fs := flag.NewFlagSet("seal", flag.ExitOnError)
	out := fs.String("o", "", "output .html path (default: <input>.html)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: aimd seal <input.aimd> [-o output.html]")
		fs.PrintDefaults()
	}
	_ = fs.Parse(permute(fs, args))
	if fs.NArg() != 1 {
		fs.Usage()
		return fmt.Errorf("seal requires exactly one input file")
	}
	in := fs.Arg(0)
	output := *out
	if output == "" {
		output = strings.TrimSuffix(in, ".aimd") + ".html"
	}
	return seal.Run(seal.Options{Input: in, Output: output})
}

func runExport(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: aimd export <format> <input.aimd> [-o output]\nformats: html")
	}
	format, rest := args[0], args[1:]
	switch format {
	case "html":
		fs := flag.NewFlagSet("export html", flag.ExitOnError)
		out := fs.String("o", "", "output .html path (default: <input>.html)")
		fs.Usage = func() {
			fmt.Fprintln(fs.Output(), "Usage: aimd export html <input.aimd> [-o output.html]")
			fs.PrintDefaults()
		}
		_ = fs.Parse(permute(fs, rest))
		if fs.NArg() != 1 {
			fs.Usage()
			return fmt.Errorf("export html requires exactly one input file")
		}
		in := fs.Arg(0)
		output := *out
		if output == "" {
			output = strings.TrimSuffix(in, ".aimd") + ".html"
		}
		return export.HTML(export.HTMLOptions{Input: in, Output: output})
	default:
		return fmt.Errorf("unknown export format: %s (supported: html)", format)
	}
}
