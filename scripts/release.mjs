#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  REPO_ROOT,
  assertTagMatchesVersion,
  bumpVersion,
  loadReleaseConfig,
  runCommand,
  syncVersion,
  updateReleaseConfigVersion,
} from "./version-tools.mjs";

const RELEASE_FILES = new Set([
  "release.config.json",
  "Cargo.toml",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "README.md",
]);

function parseArgs(argv) {
  const args = [...argv];
  const dryRun = args.includes("--dry-run");
  const resume = args.includes("--resume") || args.includes("--no-bump");
  const filtered = args.filter((arg) => arg !== "--dry-run" && arg !== "--resume" && arg !== "--no-bump");
  if (filtered.length !== 1) {
    throw new Error("Usage: npm run release -- <patch|minor|major> [-- --dry-run|--resume]");
  }
  return { level: filtered[0], dryRun, resume };
}

function shortStatus() {
  return execFileSync("git", ["status", "--short"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function statusPath(line) {
  const raw = line.slice(3).trim();
  const renameTarget = raw.split(" -> ").pop();
  return renameTarget || raw;
}

function ensureReleaseWorktree({ resume }) {
  const status = shortStatus();
  if (!status) return;
  if (!resume) {
    throw new Error(`Release requires a clean worktree:\n${status}`);
  }
  const unexpected = status
    .split(/\r?\n/)
    .map((line) => ({ line, path: statusPath(line) }))
    .filter((item) => !RELEASE_FILES.has(item.path));
  if (unexpected.length > 0) {
    throw new Error(`Release resume has unrelated worktree changes:\n${unexpected.map((item) => item.line).join("\n")}`);
  }
}

function hasStagedChanges() {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: REPO_ROOT, stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

function tagExists(tag) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

try {
  const { level, dryRun, resume } = parseArgs(process.argv.slice(2));
  if (!dryRun) ensureReleaseWorktree({ resume });

  const current = loadReleaseConfig(REPO_ROOT).version;
  const next = resume ? current : bumpVersion(current, level);
  const tag = `v${next}`;

  assertTagMatchesVersion(next, tag);

  if (dryRun) {
    console.log(`release ${level}: ${current} -> ${next}`);
    console.log(`[dry-run] would sync, check, commit, tag ${tag}, and push`);
    process.exit(0);
  }

  if (!resume) {
    updateReleaseConfigVersion(REPO_ROOT, next);
  }
  syncVersion({ check: false });
  syncVersion({ check: true });

  runCommand("npm", ["--prefix", "apps/desktop", "run", "check"], { cwd: REPO_ROOT });
  runCommand("cargo", ["check", "--workspace"], { cwd: REPO_ROOT });
  runCommand("git", ["diff", "--check"], { cwd: REPO_ROOT });

  runCommand("git", ["add", "release.config.json", "Cargo.toml", "apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json", "README.md"], { cwd: REPO_ROOT });
  if (hasStagedChanges()) {
    runCommand("git", ["commit", "-m", `Release ${tag}`], { cwd: REPO_ROOT });
  } else {
    console.log(`release ${tag}: no version files to commit`);
  }
  if (tagExists(tag)) {
    if (!resume) {
      throw new Error(`Release tag already exists: ${tag}`);
    }
    console.log(`release ${tag}: tag already exists`);
  } else {
    runCommand("git", ["tag", tag], { cwd: REPO_ROOT });
  }
  runCommand("git", ["push", "origin", "main"], { cwd: REPO_ROOT });
  runCommand("git", ["push", "origin", tag], { cwd: REPO_ROOT });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
