#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");

const roots = [
  "apps/desktop/src",
  "apps/desktop/e2e",
  "apps/desktop/scripts",
  "apps/desktop/src-tauri/src",
  "crates",
];

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".rs", ".css"]);

const ignoredPathParts = new Set([
  ".git",
  "dist",
  "node_modules",
  "playwright-report",
  "target",
  "test-results",
  "vendor",
]);

const defaultLimits = [
  {
    name: "e2e specs",
    maxLines: 750,
    matches: (file) => file.startsWith("apps/desktop/e2e/") && file.endsWith(".spec.ts"),
  },
  {
    name: "stylesheets",
    maxLines: 450,
    matches: (file) => file.endsWith(".css"),
  },
  {
    name: "source modules",
    maxLines: 500,
    matches: () => true,
  },
];

const baselineLimits = {};

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function isIgnored(repoPath) {
  return repoPath.split("/").some((part) => ignoredPathParts.has(part));
}

function lineCount(text) {
  if (text.length === 0) {
    return 0;
  }

  const lines = text.split(/\r\n|\n|\r/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function limitFor(file) {
  const baseline = baselineLimits[file];
  if (baseline) {
    return {
      kind: "baseline",
      name: "ratchet baseline",
      maxLines: baseline.maxLines,
      reason: baseline.reason,
    };
  }

  const limit = defaultLimits.find((candidate) => candidate.matches(file));
  return {
    kind: "default",
    name: limit.name,
    maxLines: limit.maxLines,
    reason: null,
  };
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const repoPath = toRepoPath(fullPath);

    if (isIgnored(repoPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = (
  await Promise.all(roots.map((root) => walk(path.join(repoRoot, root))))
).flat();

const results = [];

for (const filePath of files) {
  const repoPath = toRepoPath(filePath);
  const text = await readFile(filePath, "utf8");
  const lines = lineCount(text);
  const limit = limitFor(repoPath);

  results.push({
    file: repoPath,
    lines,
    limit,
  });
}

results.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

const failures = results.filter((result) => result.lines > result.limit.maxLines);
const totalsByExtension = new Map();

for (const result of results) {
  const ext = path.extname(result.file) || "(none)";
  const current = totalsByExtension.get(ext) ?? { files: 0, lines: 0 };
  current.files += 1;
  current.lines += result.lines;
  totalsByExtension.set(ext, current);
}

console.log("Code size check");
console.log(`- scanned files: ${results.length}`);
console.log(
  `- total lines: ${results.reduce((total, result) => total + result.lines, 0)}`,
);

for (const [ext, total] of [...totalsByExtension.entries()].sort()) {
  console.log(`- ${ext}: ${total.files} files, ${total.lines} lines`);
}

console.log("\nLargest files:");
for (const result of results.slice(0, 10)) {
  const extra = result.limit.kind === "baseline" ? " baseline" : "";
  console.log(`- ${result.lines}/${result.limit.maxLines}${extra} ${result.file}`);
}

if (failures.length > 0) {
  console.error("\nCode size gate failed:");
  for (const failure of failures) {
    const overBy = failure.lines - failure.limit.maxLines;
    console.error(
      `- ${failure.file}: ${failure.lines} lines, limit ${failure.limit.maxLines} (+${overBy})`,
    );
    if (failure.limit.reason) {
      console.error(`  ${failure.limit.reason}`);
    }
  }
  console.error("\nRefactor the oversized file or lower its line count before merging.");
  process.exit(1);
}

console.log("\nCode size gate passed.");
