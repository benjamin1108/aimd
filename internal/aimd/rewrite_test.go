package aimd

import (
	"testing"

	"github.com/aimd-org/aimd/internal/manifest"
)

func TestRewriteUpdatesMarkdownAndAssets(t *testing.T) {
	file := t.TempDir() + "/doc.aimd"
	mf := manifest.New("Test")
	w, err := Create(file, mf)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SetMainMarkdown([]byte("# Old\n\n![old](asset://old-001)")); err != nil {
		t.Fatal(err)
	}
	if _, err := w.AddAsset("old-001", "old.png", []byte("old image"), manifest.RoleContentImage); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	if err := Rewrite(file, RewriteOptions{
		Markdown:     []byte("# New\n\n![new](asset://new-001)"),
		DeleteAssets: map[string]bool{"old-001": true},
		AddAssets: []NewAsset{{
			ID:       "new-001",
			Filename: "new.png",
			Data:     []byte("new image"),
			Role:     manifest.RoleContentImage,
		}},
	}); err != nil {
		t.Fatal(err)
	}

	r, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	md, err := r.MainMarkdown()
	if err != nil {
		t.Fatal(err)
	}
	if string(md) != "# New\n\n![new](asset://new-001)" {
		t.Fatalf("markdown = %q", string(md))
	}
	if r.Manifest.FindAsset("old-001") != nil {
		t.Fatal("old asset was not deleted")
	}
	if r.Manifest.FindAsset("new-001") == nil {
		t.Fatal("new asset was not added")
	}
	if err := r.VerifyAssets(); err != nil {
		t.Fatal(err)
	}
}

func TestUniqueAssetNameAvoidsCollisions(t *testing.T) {
	mf := manifest.New("Test")
	mf.Assets = []manifest.Asset{
		{ID: "cover-001", Path: "assets/cover.svg"},
		{ID: "cover-002", Path: "assets/cover-2.svg"},
	}
	id, filename := UniqueAssetName(mf, "cover.svg")
	if id != "cover-003" {
		t.Fatalf("id = %q", id)
	}
	if filename != "cover-3.svg" {
		t.Fatalf("filename = %q", filename)
	}
}
