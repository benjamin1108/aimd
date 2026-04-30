import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "../..");
const binDir = resolve(repoRoot, "bin");
const plainOut = resolve(binDir, "aimd");
const exeOut = resolve(binDir, "aimd.exe");
const primaryOut = process.platform === "win32" ? exeOut : plainOut;

mkdirSync(binDir, { recursive: true });

const result = spawnSync("go", ["build", "-o", primaryOut, "./cmd/aimd"], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// Keep both names available because Tauri resource paths are static while the
// runtime executable suffix is platform-specific.
if (process.platform === "win32") {
  copyFileSync(exeOut, plainOut);
} else {
  copyFileSync(plainOut, exeOut);
}
