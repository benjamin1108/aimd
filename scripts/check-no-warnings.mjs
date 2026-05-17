#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
  {
    label: "desktop check",
    cmd: "npm",
    args: ["--prefix", "apps/desktop", "run", "check"],
  },
  {
    label: "rust check",
    cmd: "cargo",
    args: ["check", "--workspace", "--all-targets"],
  },
  {
    label: "diff whitespace check",
    cmd: "git",
    args: ["diff", "--check"],
  },
];

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const WARNING_PATTERNS = [
  /(^|\s)(warning|warn)(\[[^\]]+\])?:/i,
  /\b(npm|pnpm|yarn)\s+warn\b/i,
  /\[\s*warning\s*\]/i,
  /\bWARNING\b/,
];

function stripAnsi(value) {
  return value.replace(ANSI_RE, "");
}

function warningLines(output) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .filter((line) => WARNING_PATTERNS.some((pattern) => pattern.test(line)));
}

for (const { label, cmd, args } of commands) {
  console.log(`==> ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? "unknown"}`);
    process.exit(result.status || 1);
  }

  const warnings = warningLines(`${stdout}\n${stderr}`);
  if (warnings.length > 0) {
    console.error(`${label} emitted warning output:`);
    for (const line of warnings) console.error(`  ${line}`);
    process.exit(1);
  }
}

console.log("All checks passed with no warning output.");
