import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(THIS_DIR, "..");

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const BUMP_LEVELS = new Set(["patch", "minor", "major"]);

export function repoPath(root, ...parts) {
  return path.join(root, ...parts);
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

export function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function parseSemver(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) {
    throw new Error(`Invalid SemVer version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || "",
    build: match[5] || "",
  };
}

export function bumpVersion(version, level) {
  if (!BUMP_LEVELS.has(level)) {
    throw new Error(`Invalid bump level: ${level || "(missing)"}. Expected patch, minor, or major.`);
  }
  const parsed = parseSemver(version);
  if (parsed.prerelease || parsed.build) {
    throw new Error(`Cannot bump pre-release/build metadata version automatically: ${version}`);
  }
  if (level === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (level === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major + 1}.0.0`;
}

export function validateReleaseConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("release.config.json must contain an object");
  }
  for (const key of ["version", "channel", "releaseUrl", "updaterManifestUrl"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) {
      throw new Error(`release.config.json missing required string field: ${key}`);
    }
  }
  const version = config.version.trim();
  const parsed = parseSemver(version);
  const allowedChannels = new Set(["stable", "beta", "dev"]);
  if (!allowedChannels.has(config.channel)) {
    throw new Error(`release.config.json channel must be stable, beta, or dev: ${config.channel}`);
  }
  if (config.channel === "stable" && parsed.prerelease) {
    throw new Error(`stable channel cannot use pre-release version: ${version}`);
  }
  if (!config.updater || typeof config.updater !== "object" || Array.isArray(config.updater)) {
    throw new Error("release.config.json missing required updater object");
  }
  for (const key of ["manifestAsset", "pubkey", "windowsInstallMode"]) {
    if (typeof config.updater[key] !== "string" || !config.updater[key].trim()) {
      throw new Error(`release.config.json updater missing required string field: ${key}`);
    }
  }
  if (config.updater.manifestAsset !== "latest.json") {
    throw new Error(`release.config.json updater.manifestAsset must be latest.json: ${config.updater.manifestAsset}`);
  }
  if (config.updater.windowsInstallMode !== "passive") {
    throw new Error(`release.config.json updater.windowsInstallMode must be passive: ${config.updater.windowsInstallMode}`);
  }
  if (!Array.isArray(config.updater.supportedPlatforms) || config.updater.supportedPlatforms.length === 0) {
    throw new Error("release.config.json updater.supportedPlatforms must be a non-empty array");
  }
  for (const platform of config.updater.supportedPlatforms) {
    if (typeof platform !== "string" || !/^(darwin|windows|linux)-(aarch64|x86_64|i686|armv7)$/.test(platform)) {
      throw new Error(`Invalid updater supported platform: ${platform}`);
    }
  }
  return { ...config, version };
}

export function loadReleaseConfig(root = REPO_ROOT) {
  const filePath = repoPath(root, "release.config.json");
  return validateReleaseConfig(readJson(filePath));
}

function replaceWorkspacePackageVersion(cargoToml, version) {
  const headerRe = /^\[workspace\.package\]\s*$/m;
  const header = headerRe.exec(cargoToml);
  if (!header) {
    throw new Error("Cargo.toml missing [workspace.package] section");
  }
  const bodyStart = header.index + header[0].length;
  const nextSection = cargoToml.slice(bodyStart).search(/^\[/m);
  const bodyEnd = nextSection === -1 ? cargoToml.length : bodyStart + nextSection;
  const body = cargoToml.slice(bodyStart, bodyEnd);
  if (!/^version[ \t]*=[ \t]*"[^"]*"[ \t]*$/m.test(body)) {
    throw new Error("Cargo.toml [workspace.package] missing version field");
  }
  const nextBody = body.replace(/^([ \t]*version[ \t]*=[ \t]*)"[^"]*"([ \t]*)$/m, `$1"${version}"$2`);
  return cargoToml.slice(0, bodyStart) + nextBody + cargoToml.slice(bodyEnd);
}

function updateJsonVersion(filePath, version) {
  const text = readText(filePath);
  const json = readJson(filePath);
  if (typeof json.version !== "string") {
    throw new Error(`${filePath} missing version string`);
  }
  if (!/"version"\s*:\s*"[^"]*"/.test(text)) {
    throw new Error(`${filePath} missing version field`);
  }
  return text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
}

function updatePackageLockVersion(filePath, version) {
  const json = readJson(filePath);
  if (typeof json.version !== "string") {
    throw new Error(`${filePath} missing root version string`);
  }
  if (!json.packages || typeof json.packages !== "object" || Array.isArray(json.packages)) {
    throw new Error(`${filePath} missing packages object`);
  }
  if (!json.packages[""] || typeof json.packages[""] !== "object") {
    throw new Error(`${filePath} missing root package entry`);
  }
  if (typeof json.packages[""].version !== "string") {
    throw new Error(`${filePath} missing root package entry version string`);
  }
  json.version = version;
  json.packages[""].version = version;
  return `${JSON.stringify(json, null, 2)}\n`;
}

function updateTauriConfig(filePath, config) {
  const json = readJson(filePath);
  if (typeof json.version !== "string") {
    throw new Error(`${filePath} missing version string`);
  }
  json.version = config.version;
  json.plugins = json.plugins && typeof json.plugins === "object" && !Array.isArray(json.plugins)
    ? json.plugins
    : {};
  json.plugins.updater = {
    pubkey: config.updater.pubkey,
    endpoints: [config.updaterManifestUrl],
    windows: {
      installMode: config.updater.windowsInstallMode,
    },
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

function releaseMetadataContent(config) {
  return `// Generated by scripts/sync-version.mjs. Do not edit by hand.
export const AIMD_RELEASE = ${JSON.stringify({
    version: config.version,
    channel: config.channel,
    releaseUrl: config.releaseUrl,
    updaterManifestUrl: config.updaterManifestUrl,
    updaterManifestAsset: config.updater.manifestAsset,
    updaterPubkey: config.updater.pubkey,
    updaterSupportedPlatforms: config.updater.supportedPlatforms,
  }, null, 2)} as const;
`;
}

export function computeSyncedFiles(root = REPO_ROOT, config = loadReleaseConfig(root)) {
  const version = config.version;
  const cargoPath = repoPath(root, "Cargo.toml");
  const packagePath = repoPath(root, "apps", "desktop", "package.json");
  const packageLockPath = repoPath(root, "apps", "desktop", "package-lock.json");
  const tauriPath = repoPath(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
  const releaseMetadataPath = repoPath(root, "apps", "desktop", "src", "updater", "release.ts");

  return [
    {
      path: cargoPath,
      label: "Cargo.toml",
      content: replaceWorkspacePackageVersion(readText(cargoPath), version),
    },
    {
      path: packagePath,
      label: "apps/desktop/package.json",
      content: updateJsonVersion(packagePath, version),
    },
    {
      path: packageLockPath,
      label: "apps/desktop/package-lock.json",
      content: updatePackageLockVersion(packageLockPath, version),
    },
    {
      path: tauriPath,
      label: "apps/desktop/src-tauri/tauri.conf.json",
      content: updateTauriConfig(tauriPath, config),
    },
    {
      path: releaseMetadataPath,
      label: "apps/desktop/src/updater/release.ts",
      content: releaseMetadataContent(config),
    },
  ];
}

function sameTextIgnoringCheckoutEol(left, right) {
  return left === right || left.replace(/\r\n/g, "\n") === right.replace(/\r\n/g, "\n");
}

export function syncVersion({ root = REPO_ROOT, check = false } = {}) {
  const config = loadReleaseConfig(root);
  const files = computeSyncedFiles(root, config);
  const stale = [];

  for (const file of files) {
    const current = fs.existsSync(file.path) ? readText(file.path) : "";
    if (sameTextIgnoringCheckoutEol(current, file.content)) continue;
    stale.push(file.label);
    if (!check) writeText(file.path, file.content);
  }

  if (check && stale.length > 0) {
    throw new Error(`Version drift detected in: ${stale.join(", ")}. Run npm run version:sync.`);
  }

  return { version: config.version, stale };
}

export function getGitTag(root = REPO_ROOT) {
  const envTag = process.env.GITHUB_REF_NAME || process.env.RELEASE_TAG || "";
  if (envTag) return envTag.trim();
  try {
    return execFileSync("git", ["describe", "--tags", "--exact-match"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function assertTagMatchesVersion(version, tag) {
  if (!tag) return;
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match release.config.json version ${version}`);
  }
}

export function ensureCleanWorktree(root = REPO_ROOT) {
  const status = execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim();
  if (status) {
    throw new Error(`Release requires a clean worktree:\n${status}`);
  }
}

export function executableForPlatform(command) {
  if (process.platform === "win32" && !path.extname(command)) {
    if (command === "npm" || command === "npx") return `${command}.cmd`;
  }
  return command;
}

function windowsShellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function execCommandSync(command, args, { cwd = REPO_ROOT, stdio = "inherit" } = {}) {
  const executable = executableForPlatform(command);
  const extension = path.extname(executable).toLowerCase();
  if (process.platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    execFileSync(`${windowsShellQuote(executable)} ${args.map(windowsShellQuote).join(" ")}`, {
      cwd,
      stdio,
      shell: true,
    });
    return;
  }
  execFileSync(executable, args, {
    cwd,
    stdio,
    shell: false,
  });
}

export function ensureCommandsAvailable(commands, { cwd = REPO_ROOT } = {}) {
  for (const command of commands) {
    try {
      execCommandSync(command, ["--version"], {
        cwd,
        stdio: "ignore",
      });
    } catch {
      throw new Error(`Required release command is not available on PATH: ${command}`);
    }
  }
}

export function runCommand(command, args, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] ${command} ${args.join(" ")}`);
    return;
  }
  execCommandSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    stdio: "inherit",
  });
}

export function updateReleaseConfigVersion(root, version) {
  const filePath = repoPath(root, "release.config.json");
  const config = validateReleaseConfig(readJson(filePath));
  config.version = version;
  writeJson(filePath, config);
}
