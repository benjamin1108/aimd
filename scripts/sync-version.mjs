#!/usr/bin/env node
import { assertTagMatchesVersion, getGitTag, syncVersion } from "./version-tools.mjs";

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

try {
  const check = hasFlag("--check");
  const verifyTag = hasFlag("--verify-tag") || process.env.CI_RELEASE === "1";
  const result = syncVersion({ check });
  if (verifyTag) {
    assertTagMatchesVersion(result.version, getGitTag());
  }
  const action = check ? "checked" : "synchronized";
  const detail = result.stale.length > 0 ? ` (${result.stale.join(", ")})` : "";
  console.log(`version ${action}: ${result.version}${detail}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
