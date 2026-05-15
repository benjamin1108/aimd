import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  expectedReleaseAssets,
  generateManifestObject,
  normalizedUpdaterSigningEnv,
  updaterPlan,
  validateManifestObject,
} from "../updater-tools.mjs";

const config = {
  version: "1.2.3",
  channel: "stable",
  releaseUrl: "https://github.com/benjamin1108/aimd/releases",
  updaterManifestUrl: "https://github.com/benjamin1108/aimd/releases/latest/download/latest.json",
  updater: {
    manifestAsset: "latest.json",
    pubkey: "public-key",
    windowsInstallMode: "passive",
    supportedPlatforms: ["darwin-aarch64", "windows-x86_64"],
  },
};

function fixtureDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aimd-updater-test-"));
  for (const asset of [
    "AIMD-1.2.3.pkg",
    "AIMD-Desktop_1.2.3_windows_x64-setup.exe",
  ]) {
    fs.writeFileSync(path.join(dir, asset), "artifact");
    fs.writeFileSync(path.join(dir, `${asset}.sig`), `signature-content-for-${asset}`);
  }
  return dir;
}

test("updater plan defines exact production release assets", () => {
  const plan = updaterPlan(config, "v1.2.3");
  assert.equal(plan.manifestAsset, "latest.json");
  assert.deepEqual(expectedReleaseAssets(config), [
    "AIMD-1.2.3.pkg",
    "AIMD-1.2.3.pkg.sig",
    "AIMD-Desktop_1.2.3_windows_x64-setup.exe",
    "AIMD-Desktop_1.2.3_windows_x64-setup.exe.sig",
    "latest.json",
  ]);
});

test("manifest generation uses .sig file content and immutable release URLs", () => {
  const distDir = fixtureDist();
  const manifest = generateManifestObject({ config, distDir, tag: "v1.2.3", notes: "notes" });
  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.platforms["darwin-aarch64"].signature, "signature-content-for-AIMD-1.2.3.pkg");
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://github.com/benjamin1108/aimd/releases/download/v1.2.3/AIMD-1.2.3.pkg",
  );
  assert.equal(
    manifest.platforms["windows-x86_64"].url,
    "https://github.com/benjamin1108/aimd/releases/download/v1.2.3/AIMD-Desktop_1.2.3_windows_x64-setup.exe",
  );
  assert.doesNotThrow(() => validateManifestObject(manifest, { config, distDir, tag: "v1.2.3", requireFiles: true }));
});

test("manifest validation rejects missing version, platform URL, and signature", () => {
  const valid = generateManifestObject({ config, distDir: fixtureDist(), tag: "v1.2.3" });
  assert.throws(() => validateManifestObject({ ...valid, version: "" }, { config, tag: "v1.2.3" }), /missing required version/);
  assert.throws(() => validateManifestObject({
    ...valid,
    platforms: {
      ...valid.platforms,
      "darwin-aarch64": { ...valid.platforms["darwin-aarch64"], url: "" },
    },
  }, { config, tag: "v1.2.3" }), /missing platform URL/);
  assert.throws(() => validateManifestObject({
    ...valid,
    platforms: {
      ...valid.platforms,
      "windows-x86_64": { ...valid.platforms["windows-x86_64"], signature: "" },
    },
  }, { config, tag: "v1.2.3" }), /missing platform signature/);
});

test("manifest validation rejects version/tag drift and signature paths", () => {
  const valid = generateManifestObject({ config, distDir: fixtureDist(), tag: "v1.2.3" });
  assert.throws(() => validateManifestObject(valid, { config, tag: "v1.2.4" }), /does not match/);
  assert.throws(() => validateManifestObject({
    ...valid,
    platforms: {
      ...valid.platforms,
      "windows-x86_64": { ...valid.platforms["windows-x86_64"], signature: "AIMD.sig" },
    },
  }, { config, tag: "v1.2.3" }), /must contain .sig file content/);
});

test("signing environment removes empty GitHub secret placeholders", () => {
  const env = normalizedUpdaterSigningEnv({
    PATH: "/usr/bin",
    TAURI_SIGNING_PRIVATE_KEY: "private-key",
    TAURI_SIGNING_PRIVATE_KEY_PATH: "",
  });
  assert.equal(env.TAURI_SIGNING_PRIVATE_KEY, "private-key");
  assert.equal(Object.hasOwn(env, "TAURI_SIGNING_PRIVATE_KEY_PATH"), false);
  assert.equal(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "");
});

test("signing environment prefers non-empty key path and keeps password explicit", () => {
  const env = normalizedUpdaterSigningEnv({
    TAURI_SIGNING_PRIVATE_KEY: "private-key",
    TAURI_SIGNING_PRIVATE_KEY_PATH: "/tmp/key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "secret",
  });
  assert.equal(env.TAURI_SIGNING_PRIVATE_KEY_PATH, "/tmp/key");
  assert.equal(Object.hasOwn(env, "TAURI_SIGNING_PRIVATE_KEY"), false);
  assert.equal(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "secret");
});
