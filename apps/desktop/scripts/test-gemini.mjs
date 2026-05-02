#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return false;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function redact(value) {
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function usage() {
  console.log(`Usage:
  GEMINI_API_KEY=your_key node scripts/test-gemini.mjs
  npm run test:gemini

Options:
  --model=gemini-3.1-flash-lite-preview
  --base=https://generativelanguage.googleapis.com/v1beta
  --timeout=30000
  --prompt="你好，返回一句话"
`);
}

const loadedEnv = loadLocalEnv();
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const model = argValue("--model", process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
const base = argValue("--base", process.env.GEMINI_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, "");
const timeoutMs = Number(argValue("--timeout", process.env.GEMINI_TIMEOUT_MS || "30000"));
const prompt = argValue("--prompt", "请只回复一个 JSON 对象：{\"ok\":true,\"message\":\"pong\"}");

if (!apiKey.trim()) {
  console.error("Missing GEMINI_API_KEY. Example:");
  usage();
  process.exit(2);
}

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(`Invalid timeout: ${timeoutMs}`);
  process.exit(2);
}

const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
const redactedUrl = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${redact(apiKey.trim())}`;
const body = {
  contents: [{
    role: "user",
    parts: [{ text: prompt }],
  }],
  generationConfig: {
    temperature: 0.1,
  },
};

const startedAt = performance.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

console.log("Gemini smoke test");
console.log(`Loaded .env.local: ${loadedEnv ? "yes" : "no"}`);
console.log(`URL: ${redactedUrl}`);
console.log(`Model: ${model}`);
console.log(`Timeout: ${timeoutMs}ms`);
console.log(`Prompt chars: ${prompt.length}`);

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timer);

  const elapsedMs = Math.round(performance.now() - startedAt);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  console.log(`HTTP: ${response.status} ${response.statusText}`);
  console.log(`Elapsed: ${elapsedMs}ms`);

  if (!response.ok) {
    const message = json?.error?.message || text.slice(0, 1000);
    const status = json?.error?.status || "unknown";
    console.error(`Gemini error status: ${status}`);
    console.error(`Gemini error message: ${message}`);
    process.exit(1);
  }

  const output = json?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("") || "";

  console.log(`Output chars: ${output.length}`);
  console.log("Output preview:");
  console.log(output.slice(0, 1200));
} catch (error) {
  clearTimeout(timer);
  const elapsedMs = Math.round(performance.now() - startedAt);
  console.error(`Request failed after ${elapsedMs}ms`);
  if (error?.name === "AbortError") {
    console.error(`Timeout after ${timeoutMs}ms`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
