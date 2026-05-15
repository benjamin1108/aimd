import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  assertTagMatchesVersion,
  loadReleaseConfig,
  parseSemver,
  REPO_ROOT,
  repoPath,
  writeJson,
} from "./version-tools.mjs";

export const PLATFORM_CONTRACTS = [
  {
    platform: "darwin-aarch64",
    label: "macOS Apple Silicon",
    runner: "macos-14",
    updaterKind: "app.tar.gz",
    userAssetName: (version) => `AIMD-${version}.pkg`,
    updaterAssetName: (version) => `AIMD-Desktop_${version}_macos_aarch64.app.tar.gz`,
    notes: "The updater replaces the desktop app bundle. Reinstall the PKG when CLI or Agent skill payloads must be refreshed.",
  },
  {
    platform: "windows-x86_64",
    label: "Windows x64",
    runner: "windows-latest",
    updaterKind: "nsis.exe",
    userAssetName: (version) => `AIMD-Desktop_${version}_windows_x64-setup.exe`,
    updaterAssetName: (version) => `AIMD-Desktop_${version}_windows_x64-setup.exe`,
    notes: "The updater runs the signed NSIS installer in passive mode.",
  },
];

export function releaseDownloadBase(config, tag = `v${config.version}`) {
  const releaseUrl = config.releaseUrl.replace(/\/+$/, "");
  return `${releaseUrl}/download/${tag}`;
}

export function updaterContracts(config = loadReleaseConfig(REPO_ROOT)) {
  const supported = new Set(config.updater.supportedPlatforms);
  return PLATFORM_CONTRACTS
    .filter((contract) => supported.has(contract.platform))
    .map((contract) => {
      const updaterAsset = contract.updaterAssetName(config.version);
      const userAsset = contract.userAssetName(config.version);
      return {
        ...contract,
        version: config.version,
        userAsset,
        updaterAsset,
        signatureAsset: `${updaterAsset}.sig`,
      };
    });
}

export function expectedReleaseAssets(config = loadReleaseConfig(REPO_ROOT)) {
  const names = new Set([config.updater.manifestAsset]);
  for (const contract of updaterContracts(config)) {
    names.add(contract.userAsset);
    names.add(contract.updaterAsset);
    names.add(contract.signatureAsset);
  }
  return [...names].sort();
}

export function updaterPlan(config = loadReleaseConfig(REPO_ROOT), tag = `v${config.version}`) {
  assertTagMatchesVersion(config.version, tag);
  return {
    version: config.version,
    tag,
    channel: config.channel,
    manifestAsset: config.updater.manifestAsset,
    manifestUrl: config.updaterManifestUrl,
    releaseDownloadBase: releaseDownloadBase(config, tag),
    windowsInstallMode: config.updater.windowsInstallMode,
    platforms: updaterContracts(config),
    releaseAssets: expectedReleaseAssets(config),
  };
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function decodeTauriSignature(signature) {
  try {
    const decoded = Buffer.from(signature, "base64").toString("utf8");
    return decoded.includes("untrusted comment: signature") ? decoded : "";
  } catch {
    return "";
  }
}

function validateSignatureContent(signature, expectedAssetName, filePath) {
  if (/^https?:\/\//i.test(signature) || /\.sig$/i.test(signature)) {
    throw new Error(`Updater manifest signature must contain .sig file content, not a URL or path: ${filePath}`);
  }
  const decoded = decodeTauriSignature(signature);
  if (!decoded || !expectedAssetName) return;
  const trustedLine = decoded.split(/\r?\n/).find((line) => line.startsWith("trusted comment: "));
  if (!trustedLine) {
    throw new Error(`Updater signature missing trusted comment: ${filePath}`);
  }
  if (!trustedLine.includes(`\tfile:${expectedAssetName}`)) {
    throw new Error(`Updater signature trusted comment does not match ${expectedAssetName}: ${filePath}`);
  }
}

export function readSignatureFile(filePath, expectedAssetName = "") {
  if (!fileExists(filePath)) {
    throw new Error(`Missing updater signature: ${filePath}`);
  }
  const signature = fs.readFileSync(filePath, "utf8").trim();
  if (!signature) {
    throw new Error(`Updater signature is empty: ${filePath}`);
  }
  validateSignatureContent(signature, expectedAssetName, filePath);
  return signature;
}

function assertDistAsset(distDir, assetName) {
  const assetPath = path.join(distDir, assetName);
  if (!fileExists(assetPath)) {
    throw new Error(`Missing release asset: ${assetPath}`);
  }
  return assetPath;
}

export function generateManifestObject({
  config = loadReleaseConfig(REPO_ROOT),
  distDir = repoPath(REPO_ROOT, "dist"),
  tag = `v${config.version}`,
  notes = `AIMD Desktop ${tag}`,
  pubDate = "",
} = {}) {
  const plan = updaterPlan(config, tag);
  const platforms = {};
  for (const contract of plan.platforms) {
    assertDistAsset(distDir, contract.updaterAsset);
    const sigPath = assertDistAsset(distDir, contract.signatureAsset);
    platforms[contract.platform] = {
      signature: readSignatureFile(sigPath, contract.updaterAsset),
      url: `${plan.releaseDownloadBase}/${contract.updaterAsset}`,
    };
  }
  const manifest = {
    version: config.version,
    notes,
    platforms,
  };
  if (pubDate) {
    const parsed = Date.parse(pubDate);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid updater pub_date: ${pubDate}`);
    }
    manifest.pub_date = new Date(parsed).toISOString();
  }
  return manifest;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assetNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

export function validateManifestObject(manifest, {
  config = loadReleaseConfig(REPO_ROOT),
  distDir = "",
  tag = `v${config.version}`,
  requireFiles = false,
} = {}) {
  assertTagMatchesVersion(config.version, tag);
  if (!isObject(manifest)) {
    throw new Error("Updater manifest must be an object");
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("Updater manifest missing required version");
  }
  parseSemver(manifest.version.replace(/^v/, ""));
  if (manifest.version.replace(/^v/, "") !== config.version) {
    throw new Error(`Updater manifest version ${manifest.version} does not match release.config.json version ${config.version}`);
  }
  if (manifest.pub_date && Number.isNaN(Date.parse(manifest.pub_date))) {
    throw new Error(`Updater manifest pub_date is not RFC3339-compatible: ${manifest.pub_date}`);
  }
  if (!isObject(manifest.platforms)) {
    throw new Error("Updater manifest missing required platforms object");
  }

  const contracts = updaterContracts(config);
  const expectedPlatforms = contracts.map((contract) => contract.platform).sort();
  const actualPlatforms = Object.keys(manifest.platforms).sort();
  if (JSON.stringify(actualPlatforms) !== JSON.stringify(expectedPlatforms)) {
    throw new Error(`Updater manifest platforms mismatch. Expected ${expectedPlatforms.join(", ")}, got ${actualPlatforms.join(", ")}`);
  }

  for (const contract of contracts) {
    const entry = manifest.platforms[contract.platform];
    if (!isObject(entry)) {
      throw new Error(`Updater manifest platform entry must be an object: ${contract.platform}`);
    }
    if (typeof entry.url !== "string" || !entry.url.trim()) {
      throw new Error(`Updater manifest missing platform URL: ${contract.platform}`);
    }
    if (!entry.url.startsWith("https://")) {
      throw new Error(`Updater manifest URL must use HTTPS: ${contract.platform}`);
    }
    const expectedPrefix = `${releaseDownloadBase(config, tag)}/`;
    if (!entry.url.startsWith(expectedPrefix)) {
      throw new Error(`Updater manifest URL must point to ${expectedPrefix}: ${entry.url}`);
    }
    if (assetNameFromUrl(entry.url) !== contract.updaterAsset) {
      throw new Error(`Updater manifest URL asset mismatch for ${contract.platform}: ${entry.url}`);
    }
    if (typeof entry.signature !== "string" || !entry.signature.trim()) {
      throw new Error(`Updater manifest missing platform signature: ${contract.platform}`);
    }
    validateSignatureContent(entry.signature.trim(), contract.updaterAsset, contract.signatureAsset);
    if (requireFiles) {
      assertDistAsset(distDir, contract.updaterAsset);
      const sigPath = assertDistAsset(distDir, contract.signatureAsset);
      const signature = readSignatureFile(sigPath, contract.updaterAsset);
      if (signature !== entry.signature.trim()) {
        throw new Error(`Updater manifest signature does not match ${contract.signatureAsset}`);
      }
    }
  }
  return true;
}

export function writeManifest(filePath, manifest) {
  writeJson(filePath, manifest);
}

export function loadManifest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function checkSigningSecrets(env = process.env, { require = false } = {}) {
  const hasPrivateKey = Boolean(env.TAURI_SIGNING_PRIVATE_KEY || env.TAURI_SIGNING_PRIVATE_KEY_PATH);
  const passwordConfigured = Object.prototype.hasOwnProperty.call(env, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
  if (require && !hasPrivateKey) {
    throw new Error("Missing updater signing secret: set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH");
  }
  return {
    hasPrivateKey,
    passwordConfigured,
    passwordMode: passwordConfigured ? "explicit" : "default-empty",
  };
}

export function verifyReleaseAssets({
  config = loadReleaseConfig(REPO_ROOT),
  tag = `v${config.version}`,
  manifestPath = "",
} = {}) {
  const output = execFileSync("gh", ["release", "view", tag, "--json", "assets"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const release = JSON.parse(output);
  const names = new Set((release.assets || []).map((asset) => asset.name));
  for (const asset of expectedReleaseAssets(config)) {
    if (!names.has(asset)) {
      throw new Error(`GitHub Release ${tag} missing asset: ${asset}`);
    }
  }
  if (manifestPath) {
    validateManifestObject(loadManifest(manifestPath), { config, tag });
  }
  return true;
}
