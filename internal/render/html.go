// Package render turns AIMD documents into HTML.
package render

import (
	"bytes"
	stdhtml "html"

	"github.com/aimd-org/aimd/internal/mdx"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	gmhtml "github.com/yuin/goldmark/renderer/html"
)

// AssetResolver maps an asset:// id to a URL usable in <img src="...">.
// Return "" to leave the original asset:// URI untouched.
type AssetResolver func(id string) string

// Markdown renders a Markdown document to an HTML body fragment, rewriting
// asset:// image references using resolve.
func Markdown(src []byte, resolve AssetResolver) ([]byte, error) {
	rewritten := mdx.Rewrite(src, func(ref mdx.ImageRef) string {
		id := mdx.AssetURIID(ref.URL)
		if id == "" {
			return ""
		}
		if resolve == nil {
			return ""
		}
		return resolve(id)
	})
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(parser.WithAutoHeadingID()),
		goldmark.WithRendererOptions(gmhtml.WithUnsafe()),
	)
	var buf bytes.Buffer
	if err := md.Convert(rewritten, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Page wraps a body fragment in a self-contained HTML document with light
// default styling. title may be empty.
func Page(title string, body []byte) []byte {
	var buf bytes.Buffer
	buf.WriteString(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>`)
	buf.WriteString(stdhtml.EscapeString(title))
	buf.WriteString(`</title>
<style>` + defaultCSS + `</style>
</head>
<body><main class="aimd">
`)
	buf.Write(body)
	buf.WriteString(`
</main></body>
</html>
`)
	return buf.Bytes()
}
