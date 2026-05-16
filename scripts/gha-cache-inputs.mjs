#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.env.AIMD_CACHE_INPUT_ROOT || fileURLToPath(new URL("..", import.meta.url)));
const workspaceCrates = new Set([
  "aimd-cli",
  "aimd-core",
  "aimd-desktop",
  "aimd-mdx",
  "aimd-render",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizePackageLock(path) {
  const lock = JSON.parse(read(path));
  delete lock.version;
  if (lock.packages?.[""]) {
    delete lock.packages[""].version;
  }
  return `${stableJson(lock)}\n`;
}

function normalizePackageJson(path) {
  const manifest = JSON.parse(read(path));
  delete manifest.version;
  return `${stableJson(manifest)}\n`;
}

function normalizeCargoLock(path) {
  const text = read(path);
  return text
    .split(/\n(?=\[\[package\]\]\n)/g)
    .map((block) => {
      const name = block.match(/^name = "([^"]+)"/m)?.[1];
      if (!workspaceCrates.has(name)) return block;
      return block.replace(/^version = "[^"]+"\r?\n/m, "");
    })
    .join("\n");
}

function normalizeCargoToml(path) {
  const text = read(path);
  if (path === "Cargo.toml") {
    return text.replace(/(\[workspace\.package\][\s\S]*?)^version = "[^"]+"\r?\n/m, "$1");
  }
  return text.replace(/^version\.workspace = true\r?\n/m, "");
}

function hashFiles(files, normalize) {
  const chunks = [];
  for (const file of files) {
    const absolute = resolve(root, file);
    if (!existsSync(absolute)) continue;
    chunks.push(`--- ${relative(root, absolute).replaceAll("\\", "/")} ---\n${normalize(file)}`);
  }
  return sha256(chunks.join("\n")).slice(0, 16);
}

const npmLockHash = hashFiles(["apps/desktop/package-lock.json"], normalizePackageLock);
const cargoLockHash = hashFiles(["Cargo.lock"], normalizeCargoLock);
const cargoManifestHash = hashFiles(
  [
    "Cargo.toml",
    "crates/aimd-cli/Cargo.toml",
    "crates/aimd-core/Cargo.toml",
    "crates/aimd-mdx/Cargo.toml",
    "crates/aimd-render/Cargo.toml",
    "apps/desktop/src-tauri/Cargo.toml",
  ],
  normalizeCargoToml,
);
const desktopToolsHash = sha256(
  `${npmLockHash}\n${normalizePackageJson("apps/desktop/package.json")}\n${read("apps/desktop/scripts/prepare-pdf-sidecar.mjs")}`,
).slice(0, 16);

const outputs = {
  npm_lock_hash: npmLockHash,
  rust_cache_hash: sha256(`${cargoLockHash}\n${cargoManifestHash}`).slice(0, 16),
  desktop_tools_hash: desktopToolsHash,
};

for (const [key, value] of Object.entries(outputs)) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    await import("node:fs").then(({ appendFileSync }) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`));
  }
}
