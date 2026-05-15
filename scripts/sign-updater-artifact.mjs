#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, repoPath } from "./version-tools.mjs";
import { normalizedUpdaterSigningEnv } from "./updater-tools.mjs";

function parseArgs(args) {
  const parsed = {
    artifact: "",
    cwd: repoPath(REPO_ROOT, "apps", "desktop"),
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cwd") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --cwd");
      }
      parsed.cwd = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.artifact) {
      parsed.artifact = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

try {
  const { artifact, cwd: cwdArg } = parseArgs(process.argv.slice(2));
  if (!artifact) {
    throw new Error("Usage: node scripts/sign-updater-artifact.mjs <artifact> [--cwd <tauri-project-dir>]");
  }

  const cwd = path.resolve(cwdArg);
  const artifactPath = path.resolve(artifact);
  const signaturePath = `${artifactPath}.sig`;

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Updater artifact does not exist: ${artifactPath}`);
  }
  fs.rmSync(signaturePath, { force: true });

  const isWindows = process.platform === "win32";
  const result = spawnSync("npx", ["tauri", "signer", "sign", artifactPath], {
    cwd,
    env: normalizedUpdaterSigningEnv(process.env),
    shell: isWindows,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  if (!fs.existsSync(signaturePath) || fs.statSync(signaturePath).size === 0) {
    throw new Error(`Updater signature was not produced: ${signaturePath}`);
  }
  console.log(`signature -> ${signaturePath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
