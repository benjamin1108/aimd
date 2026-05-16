#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { readPng, writePng } from "./icon-png.mjs";

const options = parseArgs(process.argv.slice(2));

if (!options.input) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(options.input);
const outputPath = path.resolve(
  options.output ?? outputNameFor(inputPath, options.mode),
);

const image = readPng(inputPath);
let removed = 0;
let bg = null;

if (options.mode === "light") {
  const result = removeLightBackground(image, options);
  removed = result.removed;
  bg = result.background;
}

const output = options.keepSize
  ? image
  : renderToSquare(image, {
      noTrim: options.noTrim,
      padding: options.padding,
      target: options.target,
    });

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
writePng(outputPath, output);

console.log(`Wrote transparent icon: ${outputPath}`);
console.log(`Size: ${output.width}x${output.height}`);
if (bg) {
  console.log(
    `Background sample: rgb(${bg.r}, ${bg.g}, ${bg.b}), removed pixels: ${removed}`,
  );
}

function parseArgs(args) {
  const parsed = {
    edgeLuma: 178,
    fuzz: 42,
    keepSize: false,
    maxChroma: 34,
    mode: "light",
    noDefringe: false,
    noTrim: false,
    padding: 0.1,
    target: 1024,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
        break;
      case "--edge-luma":
        parsed.edgeLuma = readNumber(args, ++i, arg);
        break;
      case "--fuzz":
        parsed.fuzz = readNumber(args, ++i, arg);
        break;
      case "--keep-size":
        parsed.keepSize = true;
        break;
      case "--max-chroma":
        parsed.maxChroma = readNumber(args, ++i, arg);
        break;
      case "--mode":
        parsed.mode = readChoice(args, ++i, arg, ["light", "keep"]);
        break;
      case "--no-defringe":
        parsed.noDefringe = true;
        break;
      case "--no-trim":
        parsed.noTrim = true;
        break;
      case "--padding":
        parsed.padding = readNumber(args, ++i, arg);
        break;
      case "--target":
        parsed.target = readNumber(args, ++i, arg);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!parsed.input) {
          parsed.input = arg;
        } else if (!parsed.output) {
          parsed.output = arg;
        } else {
          throw new Error(`Unexpected argument: ${arg}`);
        }
    }
  }

  if (!Number.isInteger(parsed.target) || parsed.target < 16) {
    throw new Error("--target must be an integer >= 16");
  }
  if (parsed.padding < 0 || parsed.padding >= 0.45) {
    throw new Error("--padding must be >= 0 and < 0.45");
  }
  return parsed;
}

function readNumber(args, index, flag) {
  const value = Number(args[index]);
  if (!Number.isFinite(value)) {
    throw new Error(`${flag} requires a number`);
  }
  return value;
}

function readChoice(args, index, flag, choices) {
  const value = args[index];
  if (!choices.includes(value)) {
    throw new Error(`${flag} must be one of: ${choices.join(", ")}`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  node scripts/make-icon-transparent.mjs [options] <input.png> [output.png]

Options:
  --mode light|keep       light removes border-connected light background; keep only fits PNG alpha.
  --fuzz <0-255>          Background color tolerance. Default: 42.
  --edge-luma <0-255>     Only flood-fill bright background candidates. Default: 178.
  --max-chroma <0-255>    Reject saturated pixels from background fill. Default: 34.
  --target <px>           Output square size. Default: 1024.
  --padding <0-0.45>      Transparent padding after trim. Default: 0.10.
  --keep-size             Keep original dimensions instead of producing a square icon source.
  --no-trim               Fit the full canvas instead of trimming non-transparent bounds.
  --no-defringe           Disable edge alpha cleanup.

Examples:
  node scripts/make-icon-transparent.mjs ~/Desktop/aimd-icon.png src-tauri/icons/app-icon.source.png
  node scripts/make-icon-transparent.mjs --fuzz 34 --padding 0.08 input.png output.png
  node scripts/make-icon-transparent.mjs --mode keep transparent-input.png output.png`);
}

function outputNameFor(filePath, mode) {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, ext ? -ext.length : undefined);
  return `${base}.${mode === "light" ? "transparent" : "prepared"}.png`;
}

function removeLightBackground(image, opts) {
  const bg = sampleBackground(image);
  const total = image.width * image.height;
  const mask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const index = y * image.width + x;
    if (mask[index] || !isBackgroundCandidate(image, index, bg, opts)) return;
    mask[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < image.width; x += 1) {
    push(x, 0);
    push(x, image.height - 1);
  }
  for (let y = 0; y < image.height; y += 1) {
    push(0, y);
    push(image.width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  for (let i = 0; i < total; i += 1) {
    if (!mask[i]) continue;
    const offset = i * 4;
    image.pixels[offset] = 0;
    image.pixels[offset + 1] = 0;
    image.pixels[offset + 2] = 0;
    image.pixels[offset + 3] = 0;
  }

  if (!opts.noDefringe) {
    defringeEdges(image, mask, bg, opts);
  }
  return { background: bg, removed: tail };
}

function sampleBackground(image) {
  const sample = Math.max(4, Math.min(24, Math.floor(Math.min(image.width, image.height) / 30)));
  const colors = [];
  const addSquare = (x0, y0) => {
    for (let y = y0; y < y0 + sample; y += 1) {
      for (let x = x0; x < x0 + sample; x += 1) {
        const offset = (y * image.width + x) * 4;
        if (image.pixels[offset + 3] < 8) continue;
        colors.push([
          image.pixels[offset],
          image.pixels[offset + 1],
          image.pixels[offset + 2],
        ]);
      }
    }
  };

  addSquare(0, 0);
  addSquare(image.width - sample, 0);
  addSquare(0, image.height - sample);
  addSquare(image.width - sample, image.height - sample);
  if (colors.length === 0) return { r: 255, g: 255, b: 255 };

  colors.sort((a, b) => luma(b) - luma(a));
  const bright = colors.slice(0, Math.max(1, Math.floor(colors.length * 0.4)));
  return {
    b: Math.round(avg(bright, 2)),
    g: Math.round(avg(bright, 1)),
    r: Math.round(avg(bright, 0)),
  };
}

function isBackgroundCandidate(image, index, bg, opts) {
  const offset = index * 4;
  const a = image.pixels[offset + 3];
  if (a < 8) return true;
  const color = [
    image.pixels[offset],
    image.pixels[offset + 1],
    image.pixels[offset + 2],
  ];
  const chroma = Math.max(...color) - Math.min(...color);
  return (
    colorDistance(color, [bg.r, bg.g, bg.b]) <= opts.fuzz &&
    luma(color) >= opts.edgeLuma &&
    chroma <= opts.maxChroma
  );
}

function defringeEdges(image, mask, bg, opts) {
  const total = image.width * image.height;
  for (let index = 0; index < total; index += 1) {
    if (mask[index]) continue;
    if (!touchesMask(index, image.width, image.height, mask)) continue;
    const offset = index * 4;
    const color = [
      image.pixels[offset],
      image.pixels[offset + 1],
      image.pixels[offset + 2],
    ];
    const distance = colorDistance(color, [bg.r, bg.g, bg.b]);
    if (distance >= opts.fuzz * 2.2 || luma(color) < opts.edgeLuma - 24) continue;
    const alphaRatio = clamp((distance - opts.fuzz * 0.55) / (opts.fuzz * 1.65), 0, 1);
    const nextAlpha = Math.min(image.pixels[offset + 3], Math.round(alphaRatio * 255));
    image.pixels[offset + 3] = nextAlpha;
    if (nextAlpha <= 0) {
      image.pixels[offset] = 0;
      image.pixels[offset + 1] = 0;
      image.pixels[offset + 2] = 0;
    } else if (nextAlpha < 255) {
      decontaminate(image.pixels, offset, bg, nextAlpha / 255);
    }
  }
}

function touchesMask(index, width, height, mask) {
  const x = index % width;
  const y = Math.floor(index / width);
  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
      if (mask[yy * width + xx]) return true;
    }
  }
  return false;
}

function decontaminate(pixels, offset, bg, alpha) {
  pixels[offset] = clampByte((pixels[offset] - bg.r * (1 - alpha)) / alpha);
  pixels[offset + 1] = clampByte((pixels[offset + 1] - bg.g * (1 - alpha)) / alpha);
  pixels[offset + 2] = clampByte((pixels[offset + 2] - bg.b * (1 - alpha)) / alpha);
}

function renderToSquare(image, opts) {
  const bounds = opts.noTrim
    ? { maxX: image.width - 1, maxY: image.height - 1, minX: 0, minY: 0 }
    : alphaBounds(image);
  const cropW = bounds.maxX - bounds.minX + 1;
  const cropH = bounds.maxY - bounds.minY + 1;
  const inner = Math.max(1, Math.round(opts.target * (1 - opts.padding * 2)));
  const scale = Math.min(inner / cropW, inner / cropH);
  const dstW = Math.max(1, Math.round(cropW * scale));
  const dstH = Math.max(1, Math.round(cropH * scale));
  const dstX = Math.floor((opts.target - dstW) / 2);
  const dstY = Math.floor((opts.target - dstH) / 2);
  const pixels = new Uint8ClampedArray(opts.target * opts.target * 4);

  for (let y = 0; y < dstH; y += 1) {
    for (let x = 0; x < dstW; x += 1) {
      const srcX = bounds.minX + ((x + 0.5) / dstW) * cropW - 0.5;
      const srcY = bounds.minY + ((y + 0.5) / dstH) * cropH - 0.5;
      const color = samplePremultiplied(image, srcX, srcY);
      const offset = ((dstY + y) * opts.target + dstX + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
  return { height: opts.target, pixels, width: opts.target };
}

function alphaBounds(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.pixels[(y * image.width + x) * 4 + 3];
      if (alpha <= 4) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) {
    throw new Error("No non-transparent pixels left after background removal");
  }
  return { maxX, maxY, minX, minY };
}

function samplePremultiplied(image, x, y) {
  const x0 = clamp(Math.floor(x), 0, image.width - 1);
  const y0 = clamp(Math.floor(y), 0, image.height - 1);
  const x1 = clamp(x0 + 1, 0, image.width - 1);
  const y1 = clamp(y0 + 1, 0, image.height - 1);
  const fx = clamp(x - x0, 0, 1);
  const fy = clamp(y - y0, 0, 1);
  const samples = [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const [sx, sy, weight] of samples) {
    const offset = (sy * image.width + sx) * 4;
    const alpha = image.pixels[offset + 3] * weight;
    r += image.pixels[offset] * alpha;
    g += image.pixels[offset + 1] * alpha;
    b += image.pixels[offset + 2] * alpha;
    a += alpha;
  }
  if (a <= 0) return [0, 0, 0, 0];
  return [
    clampByte(r / a),
    clampByte(g / a),
    clampByte(b / a),
    clampByte(a),
  ];
}

function avg(values, channel) {
  return values.reduce((sum, value) => sum + value[channel], 0) / values.length;
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function luma(color) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampByte(value) {
  return Math.round(clamp(value, 0, 255));
}
