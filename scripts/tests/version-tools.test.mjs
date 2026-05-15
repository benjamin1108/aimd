import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertTagMatchesVersion,
  bumpVersion,
  computeSyncedFiles,
  syncVersion,
  validateReleaseConfig,
} from "../version-tools.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aimd-version-test-"));
  fs.mkdirSync(path.join(root, "apps", "desktop", "src-tauri"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "release.config.json"),
    JSON.stringify({
      version: "1.0.0",
      channel: "stable",
      releaseUrl: "https://github.com/benjamin1108/aimd/releases",
      updaterManifestUrl: "https://github.com/benjamin1108/aimd/releases/latest/download/latest.json",
      updater: {
        manifestAsset: "latest.json",
        pubkey: "test-updater-public-key",
        windowsInstallMode: "passive",
        supportedPlatforms: ["darwin-aarch64", "windows-x86_64"],
      },
    }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "Cargo.toml"),
    `[workspace]\nresolver = "2"\n\n[workspace.package]\nversion = "0.9.0"\nedition = "2021"\n`,
  );
  fs.writeFileSync(
    path.join(root, "apps", "desktop", "package.json"),
    JSON.stringify({ name: "@aimd/desktop-tauri", version: "0.9.0", private: true }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "apps", "desktop", "package-lock.json"),
    JSON.stringify({
      name: "@aimd/desktop-tauri",
      version: "0.9.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "@aimd/desktop-tauri",
          version: "0.9.0",
        },
      },
    }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json"),
    JSON.stringify({ productName: "AIMD Desktop", version: "0.9.0" }, null, 2) + "\n",
  );
  return root;
}

test("bumpVersion follows SemVer reset rules", () => {
  assert.equal(bumpVersion("1.0.0", "patch"), "1.0.1");
  assert.equal(bumpVersion("1.0.7", "minor"), "1.1.0");
  assert.equal(bumpVersion("1.9.7", "major"), "2.0.0");
  assert.throws(() => bumpVersion("1.0.0", "feature"), /Invalid bump level/);
  assert.throws(() => bumpVersion("1.0.0-beta.1", "patch"), /Cannot bump pre-release/);
});

test("release config validates channel and pre-release policy", () => {
  assert.equal(validateReleaseConfig({
    version: "1.2.3",
    channel: "stable",
    releaseUrl: "https://example.test/releases",
    updaterManifestUrl: "https://example.test/latest.json",
    updater: {
      manifestAsset: "latest.json",
      pubkey: "public-key",
      windowsInstallMode: "passive",
      supportedPlatforms: ["darwin-aarch64", "windows-x86_64"],
    },
  }).version, "1.2.3");
  assert.throws(() => validateReleaseConfig({
    version: "1.2.3-beta.1",
    channel: "stable",
    releaseUrl: "https://example.test/releases",
    updaterManifestUrl: "https://example.test/latest.json",
    updater: {
      manifestAsset: "latest.json",
      pubkey: "public-key",
      windowsInstallMode: "passive",
      supportedPlatforms: ["darwin-aarch64", "windows-x86_64"],
    },
  }), /stable channel cannot use pre-release/);
  assert.throws(() => validateReleaseConfig({
    version: "1.2.3",
    channel: "stable",
    releaseUrl: "https://example.test/releases",
    updaterManifestUrl: "https://example.test/latest.json",
  }), /missing required updater object/);
});

test("syncVersion updates all derived version fields and is idempotent", () => {
  const root = fixture();
  assert.throws(() => syncVersion({ root, check: true }), /Version drift detected/);
  const result = syncVersion({ root });
  assert.deepEqual(result.stale, [
    "Cargo.toml",
    "apps/desktop/package.json",
    "apps/desktop/package-lock.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src/updater/release.ts",
  ]);
  assert.doesNotThrow(() => syncVersion({ root, check: true }));
  const files = computeSyncedFiles(root);
  for (const file of files) {
    assert.equal(fs.readFileSync(file.path, "utf8"), file.content);
  }
});

test("syncVersion check ignores Windows CRLF checkout when versions match", () => {
  const root = fixture();
  syncVersion({ root });
  for (const file of computeSyncedFiles(root)) {
    fs.writeFileSync(file.path, fs.readFileSync(file.path, "utf8").replace(/\n/g, "\r\n"));
  }
  assert.doesNotThrow(() => syncVersion({ root, check: true }));
});

test("tag validation rejects mismatched tags", () => {
  assert.doesNotThrow(() => assertTagMatchesVersion("1.2.3", "v1.2.3"));
  assert.throws(() => assertTagMatchesVersion("1.2.3", "v1.2.4"), /does not match/);
});
