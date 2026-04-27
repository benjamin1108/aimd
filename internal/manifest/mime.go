package manifest

import (
	"path/filepath"
	"strings"
)

// MIMEByExt returns a best-effort MIME type for an asset path.
// v0.1 supports the image formats listed in the MRD plus a generic fallback.
func MIMEByExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".gif":
		return "image/gif"
	case ".pdf":
		return "application/pdf"
	case ".md":
		return "text/markdown; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
