package mdx

import "testing"

func TestScanInline(t *testing.T) {
	src := []byte("# Title\n\n![cover](./cover.png)\n\nSome text ![diag](images/d.svg \"hello\") end.\n")
	refs := Scan(src)
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	if refs[0].URL != "./cover.png" || refs[0].Alt != "cover" {
		t.Errorf("ref0: %+v", refs[0])
	}
	if refs[1].URL != "images/d.svg" || refs[1].Title != "hello" {
		t.Errorf("ref1: %+v", refs[1])
	}
}

func TestScanHTML(t *testing.T) {
	src := []byte(`<img src="a.png" alt="x" />`)
	refs := Scan(src)
	if len(refs) != 1 || refs[0].URL != "a.png" || !refs[0].IsHTML {
		t.Fatalf("got %+v", refs)
	}
}

func TestRewrite(t *testing.T) {
	src := []byte("![a](one.png) and ![b](two.png)")
	got := Rewrite(src, func(r ImageRef) string {
		return "asset://" + r.URL
	})
	want := "![a](asset://one.png) and ![b](asset://two.png)"
	if string(got) != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRewriteNoChange(t *testing.T) {
	src := []byte("![a](http://example.com/x.png)")
	got := Rewrite(src, func(r ImageRef) string {
		if IsRemote(r.URL) {
			return ""
		}
		return "asset://" + r.URL
	})
	if string(got) != string(src) {
		t.Fatalf("remote URL should be untouched, got %q", got)
	}
}

func TestExtractTitle(t *testing.T) {
	if got := ExtractTitle([]byte("# Hello world\n\nbody")); got != "Hello world" {
		t.Errorf("ATX: %q", got)
	}
	if got := ExtractTitle([]byte("Setext\n======\n\nbody")); got != "Setext" {
		t.Errorf("Setext: %q", got)
	}
	if got := ExtractTitle([]byte("no heading here")); got != "" {
		t.Errorf("none: %q", got)
	}
}

func TestAssetURI(t *testing.T) {
	if !IsAssetURI("asset://abc") {
		t.Error("asset:// not recognised")
	}
	if AssetURIID("asset://abc?x=1") != "abc" {
		t.Error("strip query failed")
	}
}
