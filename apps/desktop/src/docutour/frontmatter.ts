import type { DocuTourScript } from "../core/types";

const TOUR_KEY = "aimd_docu_tour";

type FrontmatterParts = {
  found: boolean;
  yaml: string;
  body: string;
  newline: string;
};

function splitFrontmatter(markdown: string): FrontmatterParts {
  const source = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { found: false, yaml: "", body: markdown, newline: "\n" };
  }
  const newline = source.startsWith("---\r\n") ? "\r\n" : "\n";
  let pos = 3 + newline.length;
  while (pos <= source.length) {
    const next = source.indexOf(newline, pos);
    const lineEnd = next === -1 ? source.length : next;
    const line = source.slice(pos, lineEnd);
    if (line === "---" || line === "...") {
      const bodyStart = next === -1 ? lineEnd : next + newline.length;
      const body = source.slice(bodyStart).replace(/^\r?\n/, "");
      return {
        found: true,
        yaml: source.slice(3 + newline.length, pos),
        body,
        newline,
      };
    }
    if (next === -1) break;
    pos = next + newline.length;
  }
  return { found: false, yaml: "", body: markdown, newline };
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function readBlockScalar(yaml: string): string | null {
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== `${TOUR_KEY}: |`) continue;
    const chunks: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.startsWith("  ") && line.trim()) break;
      if (line.startsWith("  ")) chunks.push(line.slice(2).trim());
    }
    return chunks.join("");
  }
  return null;
}

function removeTourKey(yaml: string): string {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === `${TOUR_KEY}: |` || trimmed.startsWith(`${TOUR_KEY}:`)) {
      i += 1;
      while (i < lines.length && (!lines[i].trim() || lines[i].startsWith("  "))) i += 1;
      i -= 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n+$/, "");
}

export function extractDocuTour(markdown: string): DocuTourScript | null {
  const parts = splitFrontmatter(markdown);
  if (!parts.found) return null;
  const encoded = readBlockScalar(parts.yaml);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeUtf8Base64(encoded)) as DocuTourScript;
    if (parsed?.version !== 1 || !Array.isArray(parsed.steps)) return null;
    return {
      ...parsed,
      steps: parsed.steps.filter((step) => step.targetId && step.narration),
    };
  } catch {
    return null;
  }
}

export interface FrontmatterSummary {
  hasFrontmatter: boolean;
  yamlLineCount: number;
  hasDocuTour: boolean;
  docuTourSteps: number;
}

export function summarizeFrontmatter(markdown: string): FrontmatterSummary {
  const parts = splitFrontmatter(markdown);
  if (!parts.found) {
    return { hasFrontmatter: false, yamlLineCount: 0, hasDocuTour: false, docuTourSteps: 0 };
  }
  const yamlLineCount = parts.yaml.split(/\r?\n/).filter((line) => line.length > 0).length;
  const tour = extractDocuTour(markdown);
  return {
    hasFrontmatter: true,
    yamlLineCount,
    hasDocuTour: Boolean(tour),
    docuTourSteps: tour?.steps.length ?? 0,
  };
}

export function upsertDocuTour(markdown: string, script: DocuTourScript): string {
  const parts = splitFrontmatter(markdown);
  const encoded = encodeUtf8Base64(JSON.stringify(script));
  const wrapped = encoded.match(/.{1,92}/g)?.map((line) => `  ${line}`).join("\n") || `  ${encoded}`;
  const tourYaml = `${TOUR_KEY}: |\n${wrapped}`;
  if (!parts.found) {
    return `---\n${tourYaml}\n---\n\n${markdown}`;
  }
  const cleaned = removeTourKey(parts.yaml);
  const yaml = [cleaned, tourYaml].filter((part) => part.trim()).join("\n");
  return `---${parts.newline}${yaml}${parts.newline}---${parts.newline}${parts.newline}${parts.body}`;
}
