package mdx

import (
	"bytes"
	"html"
	"strings"
)

// ExtractFrontmatter splits src into (yaml, body, found).
// It recognises a frontmatter block only when the very first non-BOM byte is
// "---" on its own line. If the closing "---" is not found, the whole src is
// returned as body with found=false.
func ExtractFrontmatter(src []byte) (yamlBlock []byte, body []byte, ok bool) {
	s := src
	// Strip UTF-8 BOM.
	if bytes.HasPrefix(s, []byte{0xEF, 0xBB, 0xBF}) {
		s = s[3:]
	}
	if !bytes.HasPrefix(s, []byte("---")) {
		return nil, src, false
	}
	// The "---" must be followed by \n or \r\n (not arbitrary content on same line).
	rest := s[3:]
	if len(rest) == 0 || (rest[0] != '\n' && rest[0] != '\r') {
		return nil, src, false
	}
	if rest[0] == '\r' && len(rest) > 1 && rest[1] == '\n' {
		rest = rest[2:]
	} else {
		rest = rest[1:]
	}
	// Find the closing "---" on its own line.
	lines := bytes.SplitAfter(rest, []byte("\n"))
	var yamlLines []string
	closingIdx := -1
	for i, line := range lines {
		trimmed := strings.TrimRight(string(line), "\r\n")
		if trimmed == "---" || trimmed == "..." {
			closingIdx = i
			break
		}
		yamlLines = append(yamlLines, string(line))
	}
	if closingIdx < 0 {
		return nil, src, false
	}
	yamlContent := []byte(strings.Join(yamlLines, ""))
	remaining := bytes.Join(lines[closingIdx+1:], nil)
	// Skip a single leading blank line in the body.
	if bytes.HasPrefix(remaining, []byte("\r\n")) {
		remaining = remaining[2:]
	} else if bytes.HasPrefix(remaining, []byte("\n")) {
		remaining = remaining[1:]
	}
	return yamlContent, remaining, true
}

// RenderFrontmatterHTML converts the raw YAML block to an HTML metadata card.
// Only simple "key: value" and "key:\n  - item" list forms are supported.
// Unsupported syntax falls back to a <pre><code> block.
func RenderFrontmatterHTML(yamlBlock []byte) []byte {
	pairs := parseSimpleYAML(string(yamlBlock))
	if len(pairs) == 0 {
		var buf bytes.Buffer
		buf.WriteString(`<section class="aimd-frontmatter"><pre><code>`)
		buf.WriteString(html.EscapeString(string(yamlBlock)))
		buf.WriteString("</code></pre></section>\n")
		return buf.Bytes()
	}
	var buf bytes.Buffer
	buf.WriteString("<section class=\"aimd-frontmatter\">\n<dl>\n")
	for _, kv := range pairs {
		buf.WriteString("<dt>")
		buf.WriteString(html.EscapeString(kv[0]))
		buf.WriteString("</dt><dd>")
		buf.WriteString(html.EscapeString(kv[1]))
		buf.WriteString("</dd>\n")
	}
	buf.WriteString("</dl>\n</section>\n")
	return buf.Bytes()
}

type kv = [2]string

// parseSimpleYAML handles:
//   - "key: value" (scalar)
//   - "key:" followed by "  - item" lines (list → joined with ", ")
//   - ignores comment lines starting with "#"
func parseSimpleYAML(src string) []kv {
	lines := strings.Split(src, "\n")
	var result []kv
	i := 0
	for i < len(lines) {
		line := strings.TrimRight(lines[i], "\r")
		i++
		if strings.HasPrefix(line, "#") || strings.TrimSpace(line) == "" {
			continue
		}
		colonIdx := strings.Index(line, ":")
		if colonIdx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:colonIdx])
		value := strings.TrimSpace(line[colonIdx+1:])
		if value != "" {
			// Block scalar indicators: | (literal) or > (folded).
			// Consume subsequent indented lines and join them as the value.
			if value == "|" || value == ">" {
				sep := "\n"
				if value == ">" {
					sep = " "
				}
				var blockLines []string
				for i < len(lines) {
					sub := strings.TrimRight(lines[i], "\r")
					if len(sub) > 0 && (sub[0] == ' ' || sub[0] == '\t') {
						blockLines = append(blockLines, strings.TrimSpace(sub))
						i++
					} else {
						break
					}
				}
				result = append(result, kv{key, strings.Join(blockLines, sep)})
				continue
			}
			// Flow-style array: [a, b, c]
			if len(value) >= 2 && value[0] == '[' && value[len(value)-1] == ']' {
				inner := value[1 : len(value)-1]
				parts := strings.Split(inner, ",")
				for j := range parts {
					parts[j] = strings.TrimSpace(parts[j])
				}
				result = append(result, kv{key, strings.Join(parts, ", ")})
				continue
			}
			// Scalar value — strip optional surrounding quotes.
			value = stripYAMLQuotes(value)
			result = append(result, kv{key, value})
			continue
		}
		// Possibly a list: collect "  - item" lines.
		var items []string
		for i < len(lines) {
			sub := strings.TrimRight(lines[i], "\r")
			trimmed := strings.TrimSpace(sub)
			if strings.HasPrefix(trimmed, "- ") {
				items = append(items, strings.TrimPrefix(trimmed, "- "))
				i++
			} else if trimmed == "-" {
				i++
			} else {
				break
			}
		}
		if len(items) > 0 {
			result = append(result, kv{key, strings.Join(items, ", ")})
		} else {
			result = append(result, kv{key, ""})
		}
	}
	return result
}

func stripYAMLQuotes(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}
