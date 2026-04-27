// Package mdx scans and rewrites image references in Markdown source.
//
// v0.1 handles the two common forms found in AI-generated Markdown:
//
//	![alt](url)            // CommonMark inline image
//	![alt](url "title")    // with title
//	<img src="url" .../>   // raw HTML
//
// Reference-style images (![alt][ref] + [ref]: url) are out of scope for v0.1.
package mdx

import (
	"regexp"
	"strings"
)

// ImageRef describes one image reference inside Markdown source.
type ImageRef struct {
	URL      string // raw destination as written
	Alt      string // alt text (may be empty)
	Title    string // optional title
	Start    int    // byte offset of the URL within the source
	End      int    // byte offset after the URL
	IsHTML   bool   // true when matched from <img src="...">
}

// inlineImage matches ![alt](url) and ![alt](url "title").
// Group layout: 1=alt, 2=url, 3=optional title (without quotes).
var inlineImage = regexp.MustCompile(
	`!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)`,
)

// htmlImage matches <img ... src="url" ... />. Group 1 is the URL.
var htmlImage = regexp.MustCompile(`(?i)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>`)

// Scan returns every image reference in src.
func Scan(src []byte) []ImageRef {
	var refs []ImageRef
	for _, m := range inlineImage.FindAllSubmatchIndex(src, -1) {
		ref := ImageRef{
			Alt:   string(src[m[2]:m[3]]),
			URL:   string(src[m[4]:m[5]]),
			Start: m[4],
			End:   m[5],
		}
		if m[6] != -1 {
			ref.Title = string(src[m[6]:m[7]])
		}
		refs = append(refs, ref)
	}
	for _, m := range htmlImage.FindAllSubmatchIndex(src, -1) {
		refs = append(refs, ImageRef{
			URL:    string(src[m[2]:m[3]]),
			Start:  m[2],
			End:    m[3],
			IsHTML: true,
		})
	}
	return refs
}

// Rewrite replaces each image URL using mapper. If mapper returns the
// original URL unchanged, the source byte range is left intact. URLs that
// mapper returns as "" are also left unchanged.
func Rewrite(src []byte, mapper func(ref ImageRef) string) []byte {
	refs := Scan(src)
	if len(refs) == 0 {
		return src
	}
	// Apply replacements right-to-left so earlier offsets stay valid.
	sorted := make([]ImageRef, len(refs))
	copy(sorted, refs)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Start > sorted[i].Start {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	out := make([]byte, len(src))
	copy(out, src)
	for _, ref := range sorted {
		newURL := mapper(ref)
		if newURL == "" || newURL == ref.URL {
			continue
		}
		out = append(out[:ref.Start], append([]byte(newURL), out[ref.End:]...)...)
	}
	return out
}

// IsRemote reports whether url is an http(s) or data URL.
func IsRemote(url string) bool {
	u := strings.ToLower(url)
	return strings.HasPrefix(u, "http://") ||
		strings.HasPrefix(u, "https://") ||
		strings.HasPrefix(u, "data:")
}

// AssetURIPrefix is the canonical scheme for AIMD-internal assets.
const AssetURIPrefix = "asset://"

// IsAssetURI reports whether url is an asset:// reference.
func IsAssetURI(url string) bool { return strings.HasPrefix(url, AssetURIPrefix) }

// AssetURIID extracts the id portion of an asset:// URL, or "".
func AssetURIID(url string) string {
	if !IsAssetURI(url) {
		return ""
	}
	id := strings.TrimPrefix(url, AssetURIPrefix)
	// Strip query/fragment if any.
	if i := strings.IndexAny(id, "?#"); i >= 0 {
		id = id[:i]
	}
	return id
}
