import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const desktopRoot = process.cwd();

test.describe("CSS architecture contract", () => {
  test("scanner passes and entries stay isolated", () => {
    execFileSync("npm", ["run", "build:injector"], { cwd: desktopRoot, stdio: "pipe" });
    const output = execFileSync("node", ["scripts/check-css-architecture.mjs"], {
      cwd: desktopRoot,
      encoding: "utf8",
    });
    expect(output).toContain("CSS architecture gate passed");
    for (const category of [
      "global-selectors",
      "undefined-vars",
      "runtime-vars",
      "raw-color-tokens",
      "theme-contrast",
      "pointer-events-none",
      "motion",
      "entry-imports",
      "webclip-style-source",
      "html-preboot-style",
      "container-queries",
      "layers",
    ]) {
      expect(output).toContain(`[${category}]`);
    }

    const desktopEntry = readFileSync(path.join(desktopRoot, "src/styles/entries/desktop.css"), "utf8");
    const settingsEntry = readFileSync(path.join(desktopRoot, "src/styles/entries/settings.css"), "utf8");
    expect(desktopEntry).toContain("@layer reset, tokens, base, layout, surfaces, components, overlays, utilities, responsive;");
    expect(settingsEntry).not.toContain("../surfaces/reader.css");
    expect(settingsEntry).not.toContain("desktop.css");
  });
});
