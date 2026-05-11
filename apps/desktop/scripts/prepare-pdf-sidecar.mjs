#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwrightCorePackagePath = require.resolve("playwright-core/package.json");
const playwrightCoreRoot = path.dirname(playwrightCorePackagePath);
const { registry } = require(path.join(playwrightCoreRoot, "lib", "server", "registry", "index.js"));

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const targetDir = path.join(desktopDir, "vendor", "sidecars", "chrome-headless-shell");
const readmeName = "README.md";
const expectedExecutableName =
  process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

async function emptyGeneratedSidecarDir() {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name !== readmeName) {
      await fs.rm(path.join(targetDir, entry.name), { recursive: true, force: true });
    }
  }
}

async function copyDirectoryContents(fromDir, toDir) {
  await fs.mkdir(toDir, { recursive: true });
  const entries = await fs.readdir(fromDir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      fs.cp(path.join(fromDir, entry.name), path.join(toDir, entry.name), {
        recursive: true,
        verbatimSymlinks: true,
      }),
    ),
  );
}

async function main() {
  const executable = registry.findExecutable("chromium-headless-shell");
  if (!executable) {
    throw new Error("当前 Playwright 版本不支持 chromium-headless-shell");
  }

  const initialExecutablePath = executable.executablePath();
  if (!initialExecutablePath || !existsSync(initialExecutablePath)) {
    console.log("==> downloading Playwright chromium-headless-shell for this platform");
    await registry.install([executable], { force: false });
  } else {
    console.log(`==> using cached Playwright chromium-headless-shell: ${initialExecutablePath}`);
  }

  const executablePath = executable.executablePathOrDie("javascript");
  const sourceDir = path.dirname(executablePath);
  const sourceExecutableName = path.basename(executablePath);

  await emptyGeneratedSidecarDir();
  await copyDirectoryContents(sourceDir, targetDir);

  const copiedExecutablePath = path.join(targetDir, sourceExecutableName);
  const expectedExecutablePath = path.join(targetDir, expectedExecutableName);
  if (sourceExecutableName !== expectedExecutableName) {
    await fs.copyFile(copiedExecutablePath, expectedExecutablePath);
  }
  if (process.platform !== "win32") {
    await fs.chmod(expectedExecutablePath, 0o755);
  }

  console.log(
    `==> prepared PDF sidecar: ${relativeToRepo(expectedExecutablePath)} (${process.platform}/${process.arch})`,
  );
}

main().catch((error) => {
  console.error(`error: failed to prepare PDF sidecar: ${error.message}`);
  process.exit(1);
});
