#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  REPO_ROOT,
  RELEASE_WORKFLOW_FILE,
  RELEASE_WORKFLOW_REF,
  assertTagMatchesVersion,
  bumpVersion,
  ensureCommandsAvailable,
  loadReleaseConfig,
  releaseWorkflowDispatchArgs,
  runCommand,
  syncVersion,
  updateReleaseConfigVersion,
} from "./version-tools.mjs";
import { updaterPlan } from "./updater-tools.mjs";

const RELEASE_MODES = new Set(["patch", "minor", "major", "republish"]);
const RELEASE_FILES = new Set([
  "release.config.json",
  "Cargo.toml",
  "Cargo.lock",
  "apps/desktop/package.json",
  "apps/desktop/package-lock.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src/updater/release.ts",
  "README.md",
]);
const WORKFLOW_DISPATCH_ATTEMPTS = 3;
const WORKFLOW_DISPATCH_RETRY_DELAY_MS = 5000;

function parseArgs(argv) {
  const args = [...argv];
  const dryRun = args.includes("--dry-run");
  const resume = args.includes("--resume") || args.includes("--no-bump");
  const filtered = args.filter((arg) => arg !== "--dry-run" && arg !== "--resume" && arg !== "--no-bump");
  if (filtered.length !== 1) {
    throw new Error("Usage: npm run release -- <patch|minor|major|republish> [-- --dry-run|--resume]");
  }
  const mode = filtered[0];
  if (!RELEASE_MODES.has(mode)) {
    throw new Error(`Invalid release mode: ${mode}. Expected patch, minor, major, or republish.`);
  }
  return { mode, dryRun, resume };
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

function ensureMainBranch() {
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  if (branch !== "main") {
    throw new Error(`Release must run from main branch, current branch is ${branch || "(detached)"}`);
  }
}

function ensureHeadMatchesOriginMain() {
  runCommand("git", ["fetch", "origin", "main"], { cwd: REPO_ROOT });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const originMain = execFileSync("git", ["rev-parse", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  if (head !== originMain) {
    throw new Error("Release requires HEAD to match origin/main");
  }
}

function deleteGithubRelease(tag, dryRun) {
  try {
    execFileSync("gh", ["release", "view", tag], { cwd: REPO_ROOT, stdio: "ignore" });
  } catch {
    console.log(`release ${tag}: no existing GitHub release to delete`);
    return;
  }
  runCommand("gh", ["release", "delete", tag, "--cleanup-tag", "-y"], { cwd: REPO_ROOT, dryRun });
}

function deleteLocalTag(tag, dryRun) {
  if (!tagExists(tag)) return;
  runCommand("git", ["tag", "-d", tag], { cwd: REPO_ROOT, dryRun });
}

function remoteTagExists(tag) {
  const output = execFileSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  return output.length > 0;
}

function deleteRemoteTag(tag, dryRun) {
  if (!remoteTagExists(tag)) return;
  runCommand("git", ["push", "origin", `:refs/tags/${tag}`], { cwd: REPO_ROOT, dryRun });
}

function pushRepublishTag(tag, dryRun) {
  deleteGithubRelease(tag, dryRun);
  deleteRemoteTag(tag, dryRun);
  deleteLocalTag(tag, dryRun);
  runCommand("git", ["tag", tag], { cwd: REPO_ROOT, dryRun });
  runCommand("git", ["push", "origin", tag], { cwd: REPO_ROOT, dryRun });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function activeReleaseWorkflowRun(tag) {
  try {
    const output = execFileSync("gh", [
      "run",
      "list",
      "--workflow",
      RELEASE_WORKFLOW_FILE,
      "--branch",
      RELEASE_WORKFLOW_REF,
      "--limit",
      "20",
      "--json",
      "databaseId,displayTitle,headBranch,status,conclusion",
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const runs = JSON.parse(output);
    return runs.find((run) => (
      run.displayTitle === `Release ${tag}`
      && run.headBranch === RELEASE_WORKFLOW_REF
      && run.status !== "completed"
    ));
  } catch {
    return null;
  }
}

function triggerReleaseWorkflow(tag, dryRun) {
  const args = releaseWorkflowDispatchArgs(tag);
  if (dryRun) {
    runCommand("gh", args, { cwd: REPO_ROOT, dryRun });
    return;
  }
  for (let attempt = 1; attempt <= WORKFLOW_DISPATCH_ATTEMPTS; attempt += 1) {
    try {
      runCommand("gh", args, { cwd: REPO_ROOT });
      return;
    } catch (error) {
      const delay = WORKFLOW_DISPATCH_RETRY_DELAY_MS * attempt;
      const retrying = attempt < WORKFLOW_DISPATCH_ATTEMPTS;
      const nextAction = retrying ? `retrying in ${delay / 1000}s` : "checking for an active run";
      console.warn(
        `release ${tag}: workflow dispatch failed on attempt ${attempt}/${WORKFLOW_DISPATCH_ATTEMPTS}; ${nextAction}`,
      );
      sleep(delay);
      const activeRun = activeReleaseWorkflowRun(tag);
      if (activeRun) {
        console.log(`release ${tag}: workflow dispatch is already active as run ${activeRun.databaseId}`);
        return;
      }
      if (!retrying) {
        throw error;
      }
    }
  }
}

try {
  const { mode, dryRun, resume } = parseArgs(process.argv.slice(2));
  if (!dryRun) ensureReleaseWorktree({ resume });

  const current = loadReleaseConfig(REPO_ROOT).version;
  const currentConfig = loadReleaseConfig(REPO_ROOT);
  const republish = mode === "republish";
  const next = republish || resume ? current : bumpVersion(current, mode);
  const tag = `v${next}`;

  assertTagMatchesVersion(next, tag);

  if (dryRun) {
    const plan = updaterPlan({ ...currentConfig, version: next }, tag);
    console.log(republish ? `release republish: ${tag}` : `release ${mode}: ${current} -> ${next}`);
    console.log(`updater manifest: ${plan.manifestAsset}`);
    for (const platform of plan.platforms) {
      console.log(`updater ${platform.platform}: ${platform.updaterAsset} + ${platform.signatureAsset}`);
    }
    console.log(republish
      ? `[dry-run] would check main/origin, delete existing ${tag} release/tag, recreate tag, push, and dispatch Release Desktop on main`
      : `[dry-run] would sync, check, commit, tag ${tag}, push main/tag, and dispatch Release Desktop on main`);
    process.exit(0);
  }

  ensureMainBranch();
  ensureCommandsAvailable(republish ? ["gh", "git"] : ["npm", "cargo", "git", "gh"]);

  if (republish) {
    syncVersion({ check: true });
    ensureHeadMatchesOriginMain();
    pushRepublishTag(tag, dryRun);
    triggerReleaseWorkflow(tag, dryRun);
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

  runCommand("git", ["add", "release.config.json", "Cargo.toml", "Cargo.lock", "apps/desktop/package.json", "apps/desktop/package-lock.json", "apps/desktop/src-tauri/tauri.conf.json", "apps/desktop/src/updater/release.ts", "README.md"], { cwd: REPO_ROOT });
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
  triggerReleaseWorkflow(tag, dryRun);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
