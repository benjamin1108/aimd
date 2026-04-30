package aimd

import (
	"reflect"
	"sort"
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

func TestReferencedAssetIDs(t *testing.T) {
	cases := []struct {
		name     string
		markdown string
		want     []string
	}{
		{
			name:     "markdown image",
			markdown: "![alt](asset://img-001.png)",
			want:     []string{"img-001.png"},
		},
		{
			name:     "markdown link",
			markdown: "[text](asset://doc-002)",
			want:     []string{"doc-002"},
		},
		{
			name:     "html img double quote",
			markdown: `<img src="asset://photo-003.jpg" alt="x">`,
			want:     []string{"photo-003.jpg"},
		},
		{
			name:     "html img single quote",
			markdown: `<img src='asset://photo-004.jpg'>`,
			want:     []string{"photo-004.jpg"},
		},
		{
			name:     "html img extra attributes before src",
			markdown: `<img alt="y" src="asset://photo-005.png" width="200">`,
			want:     []string{"photo-005.png"},
		},
		{
			name:     "multiple references same id deduplicated",
			markdown: "![a](asset://img-006.png)\n![b](asset://img-006.png)",
			want:     []string{"img-006.png"},
		},
		{
			name:     "multiple distinct ids",
			markdown: "![a](asset://img-007.png)\n![b](asset://img-008.jpg)",
			want:     []string{"img-007.png", "img-008.jpg"},
		},
		{
			name:     "id with underscores and hyphens",
			markdown: "![x](asset://my_image-001.png)",
			want:     []string{"my_image-001.png"},
		},
		{
			name:     "no asset references",
			markdown: "# Hello\n\nPlain text.",
			want:     []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ReferencedAssetIDs([]byte(tc.markdown))
			keys := make([]string, 0, len(got))
			for k := range got {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			want := append([]string{}, tc.want...)
			sort.Strings(want)
			if !reflect.DeepEqual(keys, want) {
				t.Fatalf("got %v, want %v", keys, want)
			}
		})
	}
}

func TestRewriteGCUnreferenced(t *testing.T) {
	file := t.TempDir() + "/doc.aimd"
	mf := manifest.New("GC Test")
	w, err := Create(file, mf)
	if err != nil {
		t.Fatal(err)
	}
	// Write markdown that references only img-001, but add both img-001 and img-002.
	if err := w.SetMainMarkdown([]byte("# GC\n\n![a](asset://img-001)")); err != nil {
		t.Fatal(err)
	}
	if _, err := w.AddAsset("img-001", "img-001.png", []byte("data1"), manifest.RoleContentImage); err != nil {
		t.Fatal(err)
	}
	if _, err := w.AddAsset("img-002", "img-002.png", []byte("data2"), manifest.RoleContentImage); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	// Now save with new markdown that only references img-001, with GC enabled.
	if err := Rewrite(file, RewriteOptions{
		Markdown:       []byte("# GC\n\n![a](asset://img-001)"),
		GCUnreferenced: true,
	}); err != nil {
		t.Fatal(err)
	}

	r, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if r.Manifest.FindAsset("img-001") == nil {
		t.Fatal("img-001 should be retained (referenced)")
	}
	if r.Manifest.FindAsset("img-002") != nil {
		t.Fatal("img-002 should be removed (unreferenced)")
	}
}

func TestRewriteGCRemovesAllWhenNoRefs(t *testing.T) {
	file := t.TempDir() + "/doc.aimd"
	mf := manifest.New("GC All Test")
	w, err := Create(file, mf)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SetMainMarkdown([]byte("# No images here")); err != nil {
		t.Fatal(err)
	}
	if _, err := w.AddAsset("orphan-001", "orphan.png", []byte("orphan"), manifest.RoleContentImage); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	if err := Rewrite(file, RewriteOptions{
		Markdown:       []byte("# No images here"),
		GCUnreferenced: true,
	}); err != nil {
		t.Fatal(err)
	}

	r, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if len(r.Manifest.Assets) != 0 {
		t.Fatalf("expected 0 assets after GC, got %d", len(r.Manifest.Assets))
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
