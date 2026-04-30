export function fileStem(path: string): string {
  if (!path) return "";
  const file = path.split(/[\\/]/).pop() || "";
  return file.replace(/\.aimd$/i, "").replace(/\.[^.]+$/, "");
}

export function suggestAimdFilename(input: string): string {
  const stem = fileStem(input) || "untitled";
  return `${stem}.aimd`;
}

export function extractHeadingTitle(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "";
}
