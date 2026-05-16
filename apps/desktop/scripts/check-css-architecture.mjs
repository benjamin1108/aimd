#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  categories,
  hiddenScrollbars,
  pointerEventsNone,
  registeredBreakpoints,
  runtimeStyleWrites,
  runtimeVars,
} from "./css-architecture-registry.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const rel = (file) => path.relative(repoRoot, file).split(path.sep).join("/");
const abs = (repoPath) => path.join(repoRoot, repoPath);
const reports = new Map(categories.map((category) => [category, []]));
const cssRoot = abs("apps/desktop/src");
const distInjector = abs("apps/dist/injector.js");

function add(category, file, line, message) {
  reports.get(category).push({ file, line, message });
}

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "target", "test-results"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function lineFor(text, index) {
  return text.slice(0, index).split(/\r\n|\n|\r/).length;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => " ".repeat(match.length));
}

function lineAt(text, line) {
  return text.split(/\r\n|\n|\r/)[line - 1] ?? "";
}

function previousLines(text, line, count = 4) {
  const lines = text.split(/\r\n|\n|\r/);
  return lines.slice(Math.max(0, line - count - 1), line).join("\n");
}

function selectorForDeclaration(text, index) {
  const before = text.slice(0, index);
  const open = before.lastIndexOf("{");
  if (open < 0) return "";
  const close = before.lastIndexOf("}");
  return before.slice(close + 1, open).replace(/\s+/g, " ").trim();
}

const cssFiles = walk(cssRoot, (file) => file.endsWith(".css"));
const tsFiles = walk(cssRoot, (file) => /\.(ts|tsx)$/.test(file));
const htmlFiles = [abs("apps/desktop/index.html"), abs("apps/desktop/settings.html")];
const cssTexts = new Map(cssFiles.map((file) => [rel(file), readFileSync(file, "utf8")]));
const htmlTexts = new Map(htmlFiles.map((file) => [rel(file), readFileSync(file, "utf8")]));

function checkEntries() {
  const styles = readFileSync(abs("apps/desktop/src/styles.css"), "utf8");
  if (!styles.includes('@import "./styles/entries/desktop.css";')) {
    add("entry-imports", "apps/desktop/src/styles.css", 1, "compat entry must only import entries/desktop.css");
  }
  const settingsMain = readFileSync(abs("apps/desktop/src/settings/main.ts"), "utf8");
  if (settingsMain.includes('import "../styles.css"')) {
    add("entry-imports", "apps/desktop/src/settings/main.ts", 1, "settings must not import full desktop CSS");
  }
  for (const entry of ["desktop.css", "settings.css"]) {
    const file = `apps/desktop/src/styles/entries/${entry}`;
    const text = cssTexts.get(file) ?? "";
    if (!text.startsWith("@layer reset, tokens, base, layout, surfaces, components, overlays, utilities, responsive;")) {
      add("entry-imports", file, 1, "entry must declare the cascade layer order");
    }
  }
  const settingsEntry = cssTexts.get("apps/desktop/src/styles/entries/settings.css") ?? "";
  if (settingsEntry.includes("desktop.css") || settingsEntry.includes("../surfaces/reader.css")) {
    add("entry-imports", "apps/desktop/src/styles/entries/settings.css", 1, "settings entry must not import desktop-only surfaces");
  }
}

function checkWebclipSource() {
  const styleTs = readFileSync(abs("apps/desktop/src/webview/injector-style.ts"), "utf8");
  const pkg = readFileSync(abs("apps/desktop/package.json"), "utf8");
  if (!styleTs.includes("../styles/entries/webclip.css")) {
    add("webclip-style-source", "apps/desktop/src/webview/injector-style.ts", 1, "injector style must import scanable CSS source");
  }
  if (!pkg.includes("--loader:.css=text")) {
    add("webclip-style-source", "apps/desktop/package.json", 1, "build:injector must bundle CSS source as text");
  }
  if (!existsSync(distInjector)) {
    add("webclip-style-source", "apps/dist/injector.js", 1, "run build:injector before CSS architecture check");
    return;
  }
  const dist = readFileSync(distInjector, "utf8");
  if (!dist.includes("aimd-clip-shell") || dist.includes("2147483647")) {
    add("webclip-style-source", "apps/dist/injector.js", 1, "injector output must include current WebClip CSS and avoid max z-index");
  }
}

function checkHtmlPreboot() {
  const settings = htmlTexts.get("apps/desktop/settings.html") ?? "";
  if (!settings.includes("data-aimd-preboot-style")) add("html-preboot-style", "apps/desktop/settings.html", 1, "settings preboot style must be identifiable");
  if (!settings.includes("@layer reset, tokens")) add("html-preboot-style", "apps/desktop/settings.html", 1, "settings preboot style must use cascade layers");
  if (/100vh|#[0-9a-fA-F]{3,8}|rgba?\(/.test(stripComments(settings))) {
    add("html-preboot-style", "apps/desktop/settings.html", 1, "settings preboot style must avoid 100vh and hard-coded colors");
  }
}

function checkLayersAndGlobals() {
  const allowedGlobal = /\/(base|tokens|entries)\//;
  const allowedGlobalFile = (file) => allowedGlobal.test(file)
    || file.endsWith("layout/root.css")
    || file.endsWith("utilities/print.css")
    || file.endsWith("utilities/state.css");
  const globalSelector = /^(html|body|\*|button|input|select|textarea|svg|pre|code|img|a|table)\b[^{]*{/;
  for (const [file, text] of cssTexts) {
    if (file === "apps/desktop/src/styles.css") continue;
    const trimmed = stripComments(text).trimStart();
    if (!trimmed.startsWith("@layer") && !trimmed.startsWith("@import")) {
      add("layers", file, 1, "CSS source must enter an explicit cascade layer");
    }
    if (!allowedGlobalFile(file)) {
      stripComments(text).split(/\r\n|\n|\r/).forEach((line, index) => {
        const trimmed = line.trim();
        const match = trimmed.match(globalSelector);
        if (match) add("global-selectors", file, index + 1, `bare global selector ${match[1]} is not allowed here`);
      });
    }
  }
}

function checkVarsAndColors() {
  const defs = new Set(Object.keys(runtimeVars));
  const varDef = /(--[\w-]+)\s*:/g;
  const varUse = /var\(\s*(--[\w-]+)/g;
  const hardColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/g;
  const colorFallback = /var\(\s*--[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\()/g;
  for (const [file, text] of [...cssTexts, ...htmlTexts]) {
    for (const match of text.matchAll(varDef)) defs.add(match[1]);
  }
  for (const [file, text] of [...cssTexts, ...htmlTexts]) {
    const clean = stripComments(text);
    for (const match of clean.matchAll(varUse)) {
      if (!defs.has(match[1])) add("undefined-vars", file, lineFor(clean, match.index ?? 0), `${match[1]} is not registered`);
    }
    for (const match of clean.matchAll(colorFallback)) {
      add("var-fallback-colors", file, lineFor(clean, match.index ?? 0), "CSS var fallbacks may not hide missing color tokens");
    }
    const tokenFile = file.includes("/tokens/") || file.endsWith("entries/webclip.css");
    if (!tokenFile) {
      for (const match of clean.matchAll(/var\(\s*(--color-[\w-]+)/g)) {
        add("raw-color-tokens", file, lineFor(clean, match.index ?? 0), `${match[1]} is a generated/raw color token; use a semantic theme token`);
      }
      for (const match of clean.matchAll(hardColor)) {
        add("hard-colors", file, lineFor(clean, match.index ?? 0), `hard color ${match[0]} must be tokenized`);
      }
    }
  }
}

function parseColor(value) {
  const raw = String(value || "").trim();
  let match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (match) {
    let hex = match[1];
    if (hex.length === 3) hex = hex.split("").map((part) => part + part).join("");
    const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: alpha,
    };
  }
  match = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: Number.isNaN(parts[3]) ? 1 : parts[3] };
}

function mixOver(fg, bg) {
  const alpha = fg.a ?? 1;
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
    a: 1,
  };
}

function linearChannel(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  return 0.2126 * linearChannel(color.r)
    + 0.7152 * linearChannel(color.g)
    + 0.0722 * linearChannel(color.b);
}

function contrastRatio(foreground, background) {
  const fg = mixOver(foreground, background);
  const bg = mixOver(background, { r: 255, g: 255, b: 255, a: 1 });
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function extractVarBlocks(text, selectorPattern) {
  const matches = [];
  for (const match of stripComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, " ").trim();
    if (!selectorPattern.test(selector)) continue;
    matches.push(match[2]);
  }
  return matches;
}

function extractVarDefinitions(block) {
  const vars = {};
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

function resolveCssVar(name, vars, stack = []) {
  if (stack.includes(name)) return "";
  const value = vars[name];
  if (!value) return "";
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_match, nested) => resolveCssVar(nested, vars, [...stack, name]));
}

function checkThemeContrast() {
  const tokenFiles = [
    "apps/desktop/src/styles/tokens/primitives.css",
    "apps/desktop/src/styles/tokens/semantic.css",
    "apps/desktop/src/styles/tokens/themes.css",
  ];
  const rootVars = {};
  const darkVars = {};
  for (const file of tokenFiles) {
    const text = cssTexts.get(file) ?? "";
    for (const block of extractVarBlocks(text, /(^|,)\s*:root(\s|,|$)/)) {
      Object.assign(rootVars, extractVarDefinitions(block));
    }
    for (const block of extractVarBlocks(text, /\[data-theme="dark"\]/)) {
      Object.assign(darkVars, extractVarDefinitions(block));
    }
  }
  const vars = { ...rootVars, ...darkVars };
  const foregrounds = [
    ["--ink", 4.5],
    ["--ink-strong", 4.5],
    ["--ink-muted", 4.5],
    ["--ink-faint", 3],
    ["--tone-success", 4.5],
    ["--tone-warn", 4.5],
    ["--tone-info", 4.5],
    ["--tone-danger", 4.5],
    ["--nav-active-fg", 4.5],
    ["--git-added-text", 4.5],
    ["--git-removed-text", 4.5],
    ["--git-modified-text", 4.5],
    ["--markdown-heading", 4.5],
    ["--markdown-code-fence", 4.5],
    ["--markdown-code", 4.5],
    ["--markdown-quote", 4.5],
    ["--markdown-list", 4.5],
    ["--markdown-table", 4.5],
    ["--markdown-image", 4.5],
  ];
  const backgrounds = [
    "--surface-panel",
    "--surface-panel-raised",
    "--surface-rail",
    "--surface-document",
    "--surface-document-soft",
    "--surface-source",
    "--surface-popover-core",
    "--surface-code",
    "--surface-table-head",
  ];
  for (const [fgName, threshold] of foregrounds) {
    const fgValue = resolveCssVar(fgName, vars);
    const fg = parseColor(fgValue);
    if (!fg) {
      add("theme-contrast", "apps/desktop/src/styles/tokens/themes.css", 1, `dark ${fgName} must resolve to a parseable color`);
      continue;
    }
    for (const bgName of backgrounds) {
      const bgValue = resolveCssVar(bgName, vars);
      const bg = parseColor(bgValue);
      if (!bg) {
        add("theme-contrast", "apps/desktop/src/styles/tokens/themes.css", 1, `dark ${bgName} must resolve to a parseable color`);
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      if (ratio < threshold) {
        add("theme-contrast", "apps/desktop/src/styles/tokens/themes.css", 1, `dark ${fgName} on ${bgName} is ${ratio.toFixed(2)}:1, below ${threshold}:1`);
      }
    }
  }
}

function checkZIndexAndImportant() {
  for (const [file, text] of cssTexts) {
    const clean = stripComments(text);
    for (const match of clean.matchAll(/z-index\s*:\s*(\d+)/g)) {
      if (!file.endsWith("entries/webclip.css")) add("naked-z-index", file, lineFor(clean, match.index ?? 0), "z-index must use registry token");
    }
    for (const match of clean.matchAll(/calc\(\s*var\(--z-/g)) {
      add("naked-z-index", file, lineFor(clean, match.index ?? 0), "z-index arithmetic may not bypass registry");
    }
    const lines = text.split(/\r\n|\n|\r/);
    lines.forEach((line, index) => {
      if (!line.includes("!important")) return;
      const context = previousLines(text, index + 1);
      const allowed = file.includes("utilities/print.css")
        || file.endsWith("entries/webclip.css")
        || context.includes("[hidden]")
        || context.includes("body.resizing-h")
        || context.includes("body.resizing-v")
        || line.includes("Hidden is allowed");
      if (!allowed) add("important-allowlist", file, index + 1, "!important requires a selector/property allowlist entry");
    });
  }
}

function checkRuntimeStyles() {
  const allowed = (file, line) => runtimeStyleWrites.some((item) => item.file === file && line.includes(item.pattern));
  const writePattern = /\.style\.(left|top|width|height|flex|transform|position|display|overflow|zIndex|gridTemplateColumns|cssText)\s*=|\.style\.(setProperty|removeProperty)\(|style="/;
  for (const fileAbs of tsFiles) {
    const file = rel(fileAbs);
    const text = readFileSync(fileAbs, "utf8");
    text.split(/\r\n|\n|\r/).forEach((line, index) => {
      if (writePattern.test(line) && !allowed(file, line)) {
        add("runtime-style-writes", file, index + 1, "runtime style write must be in registry");
      }
    });
  }
  for (const [name, info] of Object.entries(runtimeVars)) {
    reports.get("runtime-vars").push({ file: info.owner, line: 1, message: `${name}: ${info.reason}; cleanup: ${info.cleanup}` });
  }
}

function checkMotionResponsiveAndPrint() {
  const mediaRe = /@media\s*\([^)]*(?:max|min)-(?:width|height):\s*(\d+)px/g;
  const containerRe = /@container\s+(?![a-zA-Z_-][\w-]*\s*\()/g;
  const tsBreakpoint = /window\.innerWidth\s*(?:<=|<|>=|>)\s*(\d+)|matchMedia\(["'`]\((?:max|min)-width:\s*(\d+)px\)/g;
  for (const [file, text] of cssTexts) {
    const clean = stripComments(text);
    if ((/@keyframes|\banimation\s*:/.test(clean)) && !clean.includes("prefers-reduced-motion")) {
      add("motion", file, 1, "animated CSS must include a reduced-motion override");
    }
    for (const match of text.matchAll(mediaRe)) {
      const value = Number(match[1]);
      if (!registeredBreakpoints.has(value)) add("breakpoints", file, lineFor(text, match.index ?? 0), `${value}px breakpoint is not registered`);
    }
    for (const match of text.matchAll(containerRe)) {
      add("container-queries", file, lineFor(text, match.index ?? 0), "@container must use a named container");
    }
    if ((/@media\s+print|@page|print-color-adjust/.test(text)) && !file.includes("utilities/print.css")) {
      add("print-ownership", file, 1, "print CSS belongs in utilities/print.css");
    }
    let cursor = 0;
    const cleanLines = clean.split(/\r\n|\n|\r/);
    text.split(/\r\n|\n|\r/).forEach((line, index) => {
      const cleanLine = cleanLines[index] ?? "";
      const lineStart = cursor;
      cursor += line.length + 1;
      if (/max-height|height/.test(cleanLine) && /\b(100|90)vh\b/.test(cleanLine)) {
        add("breakpoints", file, index + 1, "height constraints must use dynamic viewport units");
      }
      if (/outline\s*:\s*(none|0)\b/.test(cleanLine) && !text.includes(":focus-visible")) {
        add("outline-none", file, index + 1, "outline removal requires focus-visible replacement");
      }
      if (/^\s*pointer-events\s*:\s*none\b/.test(cleanLine)) {
        const selector = selectorForDeclaration(text, lineStart + line.indexOf("pointer-events"));
        const allowed = pointerEventsNone.some((item) => item.file === file && selector.includes(item.selector));
        if (!allowed) add("pointer-events-none", file, index + 1, `pointer-events none requires registry ownership near ${selector || "unknown selector"}`);
      }
      if (/transition(?:-property)?\s*:[^;]*(\bwidth\b|\bheight\b|\bleft\b|\bright\b|\btop\b|\bbottom\b)/.test(cleanLine)) {
        add("motion", file, index + 1, "layout-position transitions require an explicit registry exception");
      }
      if (/scrollbar-width:\s*none|::-webkit-scrollbar\s*{\s*display:\s*none/.test(cleanLine) && !file.endsWith("components/tabs.css")) {
        const selector = selectorForDeclaration(text, lineStart + line.indexOf("scrollbar"));
        const allowed = hiddenScrollbars.some((item) => item.file === file && selector.includes(item.selector));
        if (!allowed) add("hidden-scrollbars", file, index + 1, "hidden scrollbars require explicit alternate navigation");
      }
      const truncationOwner = /components\/(app-topbar|buttons|inspector|tabs|toolbar|menus|sidebar|launch|settings)|layout\/workspace|surfaces\/(editor|git-diff)|overlays\/(updater|tree-overflow-portal)|entries\/webclip/.test(file);
      if (/white-space:\s*nowrap|text-overflow:\s*(ellipsis|clip)|line-clamp/.test(cleanLine) && !truncationOwner) {
        add("nowrap-truncation", file, index + 1, "truncation must have a recoverability owner");
      }
    });
  }
  for (const fileAbs of tsFiles) {
    const file = rel(fileAbs);
    const text = readFileSync(fileAbs, "utf8");
    for (const match of text.matchAll(tsBreakpoint)) {
      const value = Number(match[1] || match[2]);
      if (!registeredBreakpoints.has(value)) add("breakpoints", file, lineFor(text, match.index ?? 0), `${value}px TS breakpoint is not registered`);
    }
  }
}

checkEntries();
checkWebclipSource();
checkHtmlPreboot();
checkLayersAndGlobals();
checkVarsAndColors();
checkThemeContrast();
checkZIndexAndImportant();
checkRuntimeStyles();
checkMotionResponsiveAndPrint();

let failures = 0;
console.log("CSS architecture check");
for (const category of categories) {
  const items = reports.get(category);
  const failing = category !== "runtime-vars" ? items : [];
  console.log(`\n[${category}] ${items.length}`);
  for (const item of items.slice(0, 40)) {
    console.log(`- ${item.file}:${item.line} ${item.message}`);
  }
  if (items.length > 40) console.log(`- ... ${items.length - 40} more`);
  failures += failing.length;
}

if (failures > 0) {
  console.error(`\nCSS architecture gate failed with ${failures} issue(s).`);
  process.exit(1);
}

console.log("\nCSS architecture gate passed.");
