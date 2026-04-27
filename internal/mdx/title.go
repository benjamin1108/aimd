package mdx

import (
	"bufio"
	"bytes"
	"strings"
)

// ExtractTitle returns the first H1 heading text from src, or "" if none.
// Setext H1 (underline ===) and ATX H1 (# Title) are both supported.
func ExtractTitle(src []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(src))
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	var prev string
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# ") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "#"))
		}
		if isSetextH1(trimmed) && prev != "" {
			return strings.TrimSpace(prev)
		}
		prev = line
	}
	return ""
}

func isSetextH1(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != '=' {
			return false
		}
	}
	return true
}
