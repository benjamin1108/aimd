#!/usr/bin/env python3
"""aimd_io.py — read/write AIMD (.aimd) documents without external deps.

An .aimd file is a ZIP container with manifest.json + main.md + assets/.
This script covers the common read/write paths so an LLM can manipulate
.aimd files via small, scriptable commands.

Usage (run with --help on any subcommand for details):

  read FILE
  info FILE
  manifest FILE
  list FILE
  extract FILE ASSET_ID [-o PATH]
  write FILE [-i body.md | -]            replace main.md (preserves metadata)
  add-asset FILE LOCAL_PATH [--id ID] [--name NAME] [--role ROLE]
  remove-asset FILE ASSET_ID
  set-meta FILE [--title T] [--author NAME[:type]]... [--gen-by k=v]...
  gc FILE                                drop assets unreferenced by main.md
  new FILE -i body.md [--title T]        pack a Markdown file + local images

Spec: aimd v0.1 (https://github.com/aimd-org/aimd).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable

FORMAT_NAME = "aimd"
FORMAT_VERSION = "0.1"
FILE_MANIFEST = "manifest.json"
FILE_MAIN_MD = "main.md"
DIR_ASSETS = "assets/"

# Same regexes as internal/mdx/images.go.
INLINE_IMG = re.compile(r'!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)')
HTML_IMG = re.compile(r'(?i)<img\b[^>]*?\bsrc\s*=\s*["\']([^"\']+)["\'][^>]*>')
ASSET_URI_RE = re.compile(r"asset://([A-Za-z0-9._-]+)")


# ---------- low-level zip helpers ----------

def _open_aimd(path: str) -> tuple[zipfile.ZipFile, dict]:
    zf = zipfile.ZipFile(path, "r")
    try:
        manifest = json.loads(zf.read(FILE_MANIFEST).decode("utf-8"))
    except KeyError:
        zf.close()
        raise SystemExit(f"error: {path} is missing {FILE_MANIFEST} (not an .aimd)")
    return zf, manifest


def _utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _entry(manifest: dict) -> str:
    return manifest.get("entry") or FILE_MAIN_MD


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _atomic_replace(target: str, build: callable) -> None:
    """Build a new zip via build(zip_writer) and atomically replace target."""
    target_dir = os.path.dirname(os.path.abspath(target)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".aimd-", suffix=".tmp", dir=target_dir)
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zw:
            build(zw)
        os.replace(tmp, target)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _write_manifest(zw: zipfile.ZipFile, manifest: dict) -> None:
    body = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    zw.writestr(FILE_MANIFEST, body.encode("utf-8"))


def _rebuild(
    src_zip: zipfile.ZipFile,
    src_manifest: dict,
    target_path: str,
    *,
    new_main_md: bytes | None = None,
    drop_asset_ids: set[str] | None = None,
    add_assets: list[dict] | None = None,
    manifest_overrides: dict | None = None,
    gc_unreferenced: bool = False,
) -> dict:
    """Rebuild target_path from src, applying mutations. Returns new manifest."""
    drop_asset_ids = drop_asset_ids or set()
    add_assets = add_assets or []
    main_entry = _entry(src_manifest)
    main_bytes = new_main_md if new_main_md is not None else src_zip.read(main_entry)

    if gc_unreferenced:
        referenced = referenced_asset_ids(main_bytes.decode("utf-8", "replace"))
    else:
        referenced = None

    kept_assets: list[dict] = []
    kept_payload: dict[str, bytes] = {}
    for asset in src_manifest.get("assets") or []:
        if asset["id"] in drop_asset_ids:
            continue
        if referenced is not None and asset["id"] not in referenced:
            continue
        try:
            data = src_zip.read(asset["path"])
        except KeyError:
            continue  # asset listed but missing; drop it
        kept_payload[asset["path"]] = data
        kept_assets.append({
            **asset,
            "size": len(data),
            "sha256": asset.get("sha256") or _sha256_hex(data),
        })

    used_ids = {a["id"] for a in kept_assets}
    used_paths = {a["path"] for a in kept_assets}
    final_added: list[dict] = []
    for spec in add_assets:
        asset_id = spec.get("id")
        filename = spec["filename"]
        data = spec["data"]
        role = spec.get("role") or "content-image"
        if asset_id is None or asset_id in used_ids:
            asset_id, filename = unique_asset_name(used_ids, used_paths, filename)
        path = DIR_ASSETS + filename
        if path in used_paths:
            asset_id, filename = unique_asset_name(used_ids, used_paths, filename)
            path = DIR_ASSETS + filename
        used_ids.add(asset_id)
        used_paths.add(path)
        mime = spec.get("mime") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        kept_payload[path] = data
        final_added.append({
            "id": asset_id,
            "path": path,
            "mime": mime,
            "size": len(data),
            "sha256": _sha256_hex(data),
            "role": role,
        })

    new_manifest = dict(src_manifest)
    new_manifest["format"] = FORMAT_NAME
    new_manifest["version"] = new_manifest.get("version") or FORMAT_VERSION
    new_manifest["entry"] = main_entry
    new_manifest["assets"] = kept_assets + final_added
    new_manifest["updatedAt"] = _utc_now_iso()
    if "createdAt" not in new_manifest:
        new_manifest["createdAt"] = new_manifest["updatedAt"]
    if manifest_overrides:
        new_manifest.update(manifest_overrides)

    def _build(zw: zipfile.ZipFile) -> None:
        _write_manifest(zw, new_manifest)
        zw.writestr(main_entry, main_bytes)
        for asset in new_manifest["assets"]:
            zw.writestr(asset["path"], kept_payload[asset["path"]])

    _atomic_replace(target_path, _build)
    return new_manifest


# ---------- markdown helpers ----------

def referenced_asset_ids(md: str) -> set[str]:
    return {m.group(1) for m in ASSET_URI_RE.finditer(md)}


def scan_image_refs(md: str) -> Iterable[tuple[str, int, int]]:
    """Yield (url, start, end) for every image ref in md."""
    for m in INLINE_IMG.finditer(md):
        yield m.group(2), m.start(2), m.end(2)
    for m in HTML_IMG.finditer(md):
        yield m.group(1), m.start(1), m.end(1)


def is_remote(url: str) -> bool:
    u = url.lower()
    return u.startswith(("http://", "https://", "data:"))


def is_asset_uri(url: str) -> bool:
    return url.startswith("asset://")


def sanitize_filename(s: str) -> str:
    s = s.replace(" ", "-")
    return "".join(c for c in s if c.isalnum() or c in "-_.")


def sanitize_id(s: str) -> str:
    out = []
    for c in s:
        if c.isalnum():
            out.append(c)
        elif c in "-_.":
            out.append("-")
    return "".join(out).strip("-")


def unique_asset_name(used_ids: set[str], used_paths: set[str], original: str) -> tuple[str, str]:
    filename = sanitize_filename(os.path.basename(original)) or "image"
    stem, ext = os.path.splitext(filename)
    if not ext:
        ext = ".bin"
        filename += ext
        stem = filename[: -len(ext)]
    id_stem = sanitize_id(stem) or ("image-" + hashlib.sha256(original.encode()).hexdigest()[:6])
    i = 1
    while True:
        asset_id = f"{id_stem}-{i:03d}"
        name = filename if i == 1 else f"{stem}-{i}{ext}"
        path = DIR_ASSETS + name
        if asset_id not in used_ids and path not in used_paths:
            return asset_id, name
        i += 1


# ---------- subcommand implementations ----------

def cmd_read(args: argparse.Namespace) -> None:
    zf, mf = _open_aimd(args.file)
    try:
        sys.stdout.buffer.write(zf.read(_entry(mf)))
    finally:
        zf.close()


def cmd_info(args: argparse.Namespace) -> None:
    zf, mf = _open_aimd(args.file)
    try:
        print(f"File:    {args.file}")
        print(f"Format:  {mf.get('format', '?')} v{mf.get('version', '?')}")
        if mf.get("title"):
            print(f"Title:   {mf['title']}")
        print(f"Entry:   {_entry(mf)}")
        if mf.get("createdAt"):
            print(f"Created: {mf['createdAt']}")
        if mf.get("updatedAt"):
            print(f"Updated: {mf['updatedAt']}")
        for a in mf.get("authors") or []:
            print(f"Author:  {a.get('name')} ({a.get('type', 'human')})")
        gb = mf.get("generatedBy")
        if gb:
            print(f"Generated: {gb.get('provider', '?')}/{gb.get('model', '?')} [{gb.get('type', '?')}]")
        assets = mf.get("assets") or []
        print(f"Assets:  {len(assets)}")
    finally:
        zf.close()


def cmd_manifest(args: argparse.Namespace) -> None:
    zf, mf = _open_aimd(args.file)
    try:
        print(json.dumps(mf, indent=2, ensure_ascii=False))
    finally:
        zf.close()


def cmd_list(args: argparse.Namespace) -> None:
    zf, mf = _open_aimd(args.file)
    try:
        assets = mf.get("assets") or []
        if not assets:
            print("(no assets)")
            return
        rows = [("ID", "PATH", "MIME", "SIZE", "ROLE")]
        for a in assets:
            rows.append((a.get("id", ""), a.get("path", ""), a.get("mime", ""),
                         str(a.get("size", "")), a.get("role", "")))
        widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
        for r in rows:
            print("  ".join(r[i].ljust(widths[i]) for i in range(len(r))))
    finally:
        zf.close()


def cmd_extract(args: argparse.Namespace) -> None:
    zf, mf = _open_aimd(args.file)
    try:
        asset = next((a for a in (mf.get("assets") or []) if a.get("id") == args.asset_id), None)
        if not asset:
            raise SystemExit(f"error: asset id {args.asset_id!r} not found")
        data = zf.read(asset["path"])
        if args.output and args.output != "-":
            Path(args.output).write_bytes(data)
        else:
            sys.stdout.buffer.write(data)
    finally:
        zf.close()


def _read_body(args: argparse.Namespace) -> bytes:
    if args.input is None or args.input == "-":
        return sys.stdin.buffer.read()
    return Path(args.input).read_bytes()


def cmd_write(args: argparse.Namespace) -> None:
    body = _read_body(args)
    zf, mf = _open_aimd(args.file)
    try:
        new_mf = _rebuild(zf, mf, args.file,
                          new_main_md=body,
                          gc_unreferenced=args.gc)
    finally:
        zf.close()
    print(f"updated {args.file} ({len(body)} bytes body, {len(new_mf['assets'])} assets)")


def cmd_add_asset(args: argparse.Namespace) -> None:
    src_path = Path(args.local_path)
    if not src_path.exists():
        raise SystemExit(f"error: {src_path} not found")
    data = src_path.read_bytes()
    spec = {
        "id": args.id,
        "filename": args.name or src_path.name,
        "data": data,
        "role": args.role,
        "mime": args.mime,
    }
    zf, mf = _open_aimd(args.file)
    try:
        new_mf = _rebuild(zf, mf, args.file, add_assets=[spec])
    finally:
        zf.close()
    added = new_mf["assets"][-1]
    print(f"added asset {added['id']} -> {added['path']} ({added['size']}B, {added['mime']})")
    print(f"reference it as: ![alt](asset://{added['id']})")


def cmd_remove_asset(args: argparse.Namespace) -> None:
    zf, mf = _open_aimd(args.file)
    try:
        ids = {a["id"] for a in (mf.get("assets") or [])}
        if args.asset_id not in ids:
            raise SystemExit(f"error: asset id {args.asset_id!r} not found")
        _rebuild(zf, mf, args.file, drop_asset_ids={args.asset_id})
    finally:
        zf.close()
    print(f"removed asset {args.asset_id}")


def cmd_set_meta(args: argparse.Namespace) -> None:
    overrides: dict[str, Any] = {}
    if args.title is not None:
        overrides["title"] = args.title
    if args.author:
        authors = []
        for spec in args.author:
            name, _, kind = spec.partition(":")
            authors.append({"name": name, "type": kind or "human"})
        overrides["authors"] = authors
    if args.gen_by:
        gb: dict[str, str] = {}
        for kv in args.gen_by:
            k, _, v = kv.partition("=")
            if not k:
                raise SystemExit(f"error: bad --gen-by entry {kv!r} (use key=value)")
            gb[k] = v
        overrides["generatedBy"] = gb
    if not overrides:
        raise SystemExit("error: nothing to set (provide --title, --author, or --gen-by)")
    zf, mf = _open_aimd(args.file)
    try:
        _rebuild(zf, mf, args.file, manifest_overrides=overrides)
    finally:
        zf.close()
    print(f"updated metadata: {', '.join(overrides.keys())}")


def cmd_gc(args: argparse.Namespace) -> None:
    zf, mf = _open_aimd(args.file)
    try:
        before = len(mf.get("assets") or [])
        new_mf = _rebuild(zf, mf, args.file, gc_unreferenced=True)
    finally:
        zf.close()
    after = len(new_mf["assets"])
    print(f"gc: {before} -> {after} assets ({before - after} removed)")


def cmd_new(args: argparse.Namespace) -> None:
    src_md = Path(args.input)
    if not src_md.exists():
        raise SystemExit(f"error: {src_md} not found")
    src_bytes = src_md.read_bytes()
    base_dir = src_md.parent
    md_text = src_bytes.decode("utf-8", "replace")

    title = args.title or _extract_h1(md_text) or src_md.stem

    used_ids: set[str] = set()
    used_paths: set[str] = set()
    url_to_id: dict[str, str] = {}
    payloads: dict[str, bytes] = {}
    assets: list[dict] = []

    refs = list(scan_image_refs(md_text))
    for url, _, _ in refs:
        if is_remote(url) or is_asset_uri(url) or url in url_to_id:
            continue
        full = url if os.path.isabs(url) else str(base_dir / url)
        if not os.path.exists(full):
            print(f"warning: image {url!r} not found, leaving reference unchanged", file=sys.stderr)
            continue
        with open(full, "rb") as f:
            data = f.read()
        asset_id, filename = unique_asset_name(used_ids, used_paths, url)
        path = DIR_ASSETS + filename
        used_ids.add(asset_id)
        used_paths.add(path)
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        payloads[path] = data
        assets.append({
            "id": asset_id,
            "path": path,
            "mime": mime,
            "size": len(data),
            "sha256": _sha256_hex(data),
            "role": "content-image",
        })
        url_to_id[url] = asset_id

    # Rewrite markdown right-to-left to keep offsets stable.
    new_md = md_text
    for url, start, end in sorted(refs, key=lambda r: r[1], reverse=True):
        if url in url_to_id:
            new_md = new_md[:start] + f"asset://{url_to_id[url]}" + new_md[end:]

    now = _utc_now_iso()
    manifest = {
        "format": FORMAT_NAME,
        "version": FORMAT_VERSION,
        "title": title,
        "entry": FILE_MAIN_MD,
        "createdAt": now,
        "updatedAt": now,
        "assets": assets,
    }
    main_bytes = new_md.encode("utf-8")

    def _build(zw: zipfile.ZipFile) -> None:
        _write_manifest(zw, manifest)
        zw.writestr(FILE_MAIN_MD, main_bytes)
        for a in assets:
            zw.writestr(a["path"], payloads[a["path"]])

    _atomic_replace(args.file, _build)
    print(f"wrote {args.file}: title={title!r}, {len(assets)} assets")


def _extract_h1(md: str) -> str | None:
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip()
        if s and not s.startswith("#"):
            return None
    return None


# ---------- argparse wiring ----------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="aimd_io", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("read", help="print main markdown body to stdout")
    p.add_argument("file"); p.set_defaults(func=cmd_read)

    p = sub.add_parser("info", help="short header summary")
    p.add_argument("file"); p.set_defaults(func=cmd_info)

    p = sub.add_parser("manifest", help="dump full manifest as JSON")
    p.add_argument("file"); p.set_defaults(func=cmd_manifest)

    p = sub.add_parser("list", help="list assets")
    p.add_argument("file"); p.set_defaults(func=cmd_list)

    p = sub.add_parser("extract", help="write one asset's bytes to PATH (or stdout)")
    p.add_argument("file"); p.add_argument("asset_id")
    p.add_argument("-o", "--output", help="write to this path, or '-' for stdout")
    p.set_defaults(func=cmd_extract)

    p = sub.add_parser("write", help="replace main.md (preserves manifest + assets)")
    p.add_argument("file")
    p.add_argument("-i", "--input", default="-",
                   help="markdown source path, or '-' for stdin (default)")
    p.add_argument("--gc", action="store_true",
                   help="also drop assets no longer referenced from main.md")
    p.set_defaults(func=cmd_write)

    p = sub.add_parser("add-asset", help="add a local file as an asset")
    p.add_argument("file"); p.add_argument("local_path")
    p.add_argument("--id", help="explicit asset id (auto-generated if absent or in use)")
    p.add_argument("--name", help="override stored filename")
    p.add_argument("--role", default="content-image",
                   help="content-image | cover | attachment (default: content-image)")
    p.add_argument("--mime", help="override MIME type")
    p.set_defaults(func=cmd_add_asset)

    p = sub.add_parser("remove-asset", help="remove an asset by id")
    p.add_argument("file"); p.add_argument("asset_id")
    p.set_defaults(func=cmd_remove_asset)

    p = sub.add_parser("set-meta", help="update title / authors / generatedBy")
    p.add_argument("file")
    p.add_argument("--title")
    p.add_argument("--author", action="append",
                   help="NAME or NAME:TYPE (type: human|ai). Repeat to add more.")
    p.add_argument("--gen-by", action="append", dest="gen_by", metavar="KEY=VALUE",
                   help="generatedBy fields: type=ai, model=..., provider=..., prompt=...")
    p.set_defaults(func=cmd_set_meta)

    p = sub.add_parser("gc", help="drop assets unreferenced by main.md")
    p.add_argument("file"); p.set_defaults(func=cmd_gc)

    p = sub.add_parser("new", help="create a fresh .aimd from a Markdown file + local images")
    p.add_argument("file")
    p.add_argument("-i", "--input", required=True, help="source Markdown file")
    p.add_argument("--title", help="override document title")
    p.set_defaults(func=cmd_new)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
