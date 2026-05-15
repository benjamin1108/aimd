import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aimd-updater-telemetry-"));

async function importBuilt(entry, name) {
  const outfile = path.join(tmpDir, `${name}.mjs`);
  await build({
    entryPoints: [path.resolve(entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  return await import(pathToFileURL(outfile).href);
}

try {
  const {
    DownloadTelemetry,
    formatBytes,
    formatDuration,
    formatProgressLine,
    formatSpeed,
    safeProgressValue,
  } = await importBuilt("src/updater/telemetry.ts", "telemetry");
  const {
    shouldRunAutomaticUpdateCheck,
    nextAutomaticCheckDelayMs,
    dismissedVersionMatches,
  } = await importBuilt("src/updater/schedule.ts", "schedule");
  const {
    versionDiagnostics,
    errorDiagnostics,
  } = await importBuilt("src/updater/diagnostics.ts", "diagnostics");

  assert.equal(formatBytes(0), "0 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
  assert.equal(formatSpeed(2 * 1024 * 1024), "2.0 MB/s");
  assert.equal(formatDuration(9), "约 9 秒");

  const telemetry = new DownloadTelemetry(0);
  telemetry.setTotalBytes(10 * 1024 * 1024);
  telemetry.addChunk(5 * 1024 * 1024, 1000);
  const snapshot = telemetry.snapshot(1000);
  assert.equal(Math.round(snapshot.percent), 50);
  assert.equal(Math.round(snapshot.bytesPerSecond), 5 * 1024 * 1024);
  assert.equal(snapshot.etaSeconds, 1);
  const line = formatProgressLine(snapshot);
  assert.match(line, /50%/);
  assert.match(line, /5\.0 MB \/ 10\.0 MB/);
  assert.match(line, /5\.0 MB\/s/);
  assert.match(line, /约 1 秒/);

  const unknown = new DownloadTelemetry(0);
  unknown.addChunk(2 * 1024 * 1024, 1000);
  const unknownLine = formatProgressLine(unknown.snapshot(1000));
  assert.match(unknownLine, /已下载 2\.0 MB/);
  assert.doesNotMatch(unknownLine, /%/);
  assert.equal(safeProgressValue(undefined), undefined);
  assert.equal(safeProgressValue(42.4), 42);

  assert.equal(shouldRunAutomaticUpdateCheck({}, 1000, 1000), true);
  assert.equal(shouldRunAutomaticUpdateCheck({ lastAutoCheckAt: 500 }, 1000, 1000), false);
  assert.equal(shouldRunAutomaticUpdateCheck({ lastAutoCheckAt: 0 }, 1001, 1000), true);
  assert.equal(nextAutomaticCheckDelayMs(1000, 2000, () => 0.5), 2000);
  assert.equal(dismissedVersionMatches({ lastDismissedVersion: "1.0.6" }, "1.0.6"), true);
  assert.equal(dismissedVersionMatches({ lastDismissedVersion: "1.0.6" }, "1.0.7"), false);

  const versionText = versionDiagnostics({
    version: "1.0.5",
    channel: "stable",
    platformKey: "darwin-aarch64",
    updaterStatus: "发现 1.0.6",
    updaterManifestUrl: "https://github.com/benjamin1108/aimd/releases/latest/download/latest.json",
    releaseUrl: "https://github.com/benjamin1108/aimd/releases",
  });
  assert.match(versionText, /AIMD 1\.0\.5/);
  assert.doesNotMatch(versionText, /PRIVATE|SIGNING|KEY/);

  const errorText = errorDiagnostics({
    requestId: "upd-test",
    currentVersion: "1.0.5",
    latestVersion: "1.0.6",
    platformKey: "windows-x86_64",
    endpoint: "https://github.com/benjamin1108/aimd/releases/latest/download/latest.json",
    elapsedMs: 1234,
    errorMessage: "network offline",
  });
  assert.match(errorText, /upd-test/);
  assert.match(errorText, /network offline/);
  assert.doesNotMatch(errorText, /PRIVATE|SIGNING|KEY/);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
