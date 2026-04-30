package mdx

import (
	"bytes"
	"strings"
	"testing"
)

func TestExtractFrontmatter_basic(t *testing.T) {
	src := []byte("---\ntitle: Test\ntags:\n  - foo\n  - bar\ndate: 2026-01-01\n---\n\n# Body\n")
	fm, body, ok := ExtractFrontmatter(src)
	if !ok {
		t.Fatal("expected frontmatter")
	}
	if string(body) != "# Body\n" {
		t.Errorf("body=%q", body)
	}
	if !bytes.Contains(fm, []byte("title: Test")) {
		t.Errorf("missing title")
	}
}

func TestRenderFrontmatterHTML_simpleKeys(t *testing.T) {
	fm := []byte("title: 测试\ndate: 2026-04-30\ntags:\n  - alpha\n  - beta\n")
	html := string(RenderFrontmatterHTML(fm))
	for _, want := range []string{"<dt>title</dt>", "<dd>测试</dd>",
		"<dt>date</dt>", "<dd>2026-04-30</dd>",
		"<dt>tags</dt>", "<dd>alpha, beta</dd>"} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %s in:\n%s", want, html)
		}
	}
}

func TestRenderFrontmatterHTML_blockScalar(t *testing.T) {
	fm := []byte("description: |\n  Line 1\n  Line 2\n")
	html := string(RenderFrontmatterHTML(fm))
	if strings.Contains(html, "<dd>|</dd>") {
		t.Errorf("block scalar | leaked literally as value: %s", html)
	}
}

func TestRenderFrontmatterHTML_flowArray(t *testing.T) {
	fm := []byte("tags: [foo, bar]\n")
	html := string(RenderFrontmatterHTML(fm))
	if !strings.Contains(html, "<dd>foo, bar</dd>") &&
		!strings.Contains(html, "<dd>[foo, bar]</dd>") {
		t.Errorf("flow array not handled at all: %s", html)
	}
	if !strings.Contains(html, "<dt>tags</dt>") {
		t.Errorf("missing tags dt: %s", html)
	}
}
