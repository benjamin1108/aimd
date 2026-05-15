#!/usr/bin/env node
import path from "node:path";
import {
  checkSigningSecrets,
  generateManifestObject,
  loadManifest,
  updaterPlan,
  validateManifestObject,
  verifyReleaseAssets,
  writeManifest,
} from "./updater-tools.mjs";
import {
  loadReleaseConfig,
  REPO_ROOT,
  repoPath,
} from "./version-tools.mjs";

function takeValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function printPlan(plan, json) {
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(`updater release plan: ${plan.tag}`);
  console.log(`manifest: ${plan.manifestAsset}`);
  for (const platform of plan.platforms) {
    console.log(`${platform.platform}: user=${platform.userAsset} updater=${platform.updaterAsset} sig=${platform.signatureAsset}`);
  }
}

try {
  const [command = "plan", ...args] = process.argv.slice(2);
  const config = loadReleaseConfig(REPO_ROOT);
  const tag = takeValue(args, "--tag", process.env.RELEASE_TAG || `v${config.version}`);
  const distDir = path.resolve(takeValue(args, "--dist", repoPath(REPO_ROOT, "dist")));

  if (command === "plan") {
    printPlan(updaterPlan(config, tag), hasFlag(args, "--json"));
  } else if (command === "check-secrets") {
    const result = checkSigningSecrets(process.env, { require: hasFlag(args, "--require") });
    console.log(`updater signing private key: ${result.hasPrivateKey ? "configured" : "missing"}`);
    console.log(`updater signing password: ${result.passwordMode}`);
  } else if (command === "generate") {
    const output = path.resolve(takeValue(args, "--output", path.join(distDir, config.updater.manifestAsset)));
    const notes = takeValue(args, "--notes", `AIMD Desktop ${tag}`);
    const pubDate = takeValue(args, "--pub-date", "");
    const manifest = generateManifestObject({ config, distDir, tag, notes, pubDate });
    validateManifestObject(manifest, { config, distDir, tag, requireFiles: true });
    writeManifest(output, manifest);
    console.log(`updater manifest -> ${output}`);
  } else if (command === "validate") {
    const manifestPath = path.resolve(takeValue(args, "--manifest", path.join(distDir, config.updater.manifestAsset)));
    validateManifestObject(loadManifest(manifestPath), {
      config,
      distDir,
      tag,
      requireFiles: hasFlag(args, "--require-files"),
    });
    console.log(`updater manifest validated: ${manifestPath}`);
  } else if (command === "verify-release") {
    const manifestPath = takeValue(args, "--manifest", "");
    verifyReleaseAssets({ config, tag, manifestPath: manifestPath ? path.resolve(manifestPath) : "" });
    console.log(`GitHub Release updater assets validated: ${tag}`);
  } else {
    throw new Error("Usage: node scripts/updater-manifest.mjs <plan|check-secrets|generate|validate|verify-release>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
