import fs from "node:fs";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

export function readPng(filePath) {
  const file = fs.readFileSync(filePath);
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Input must be a PNG file");
  }

  let pos = 8;
  let ihdr = null;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("ascii", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;

    if (type === "IHDR") {
      ihdr = {
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        height: data.readUInt32BE(4),
        interlace: data[12],
        width: data.readUInt32BE(0),
      };
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (!ihdr) {
    throw new Error("PNG is missing IHDR");
  }
  if (ihdr.bitDepth !== 8 || ihdr.compression !== 0 || ihdr.filter !== 0) {
    throw new Error("Only 8-bit standard PNG files are supported");
  }
  if (ihdr.interlace !== 0) {
    throw new Error("Interlaced PNG files are not supported");
  }

  const channels = channelsFor(ihdr.colorType);
  const rowBytes = ihdr.width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const filtered = Buffer.alloc(ihdr.height * rowBytes);
  const previous = Buffer.alloc(rowBytes);
  let inPos = 0;
  let outPos = 0;

  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[inPos];
    inPos += 1;
    const row = raw.subarray(inPos, inPos + rowBytes);
    const target = filtered.subarray(outPos, outPos + rowBytes);
    unfilterRow(row, target, previous, channels, filter);
    previous.set(target);
    inPos += rowBytes;
    outPos += rowBytes;
  }

  return {
    height: ihdr.height,
    pixels: toRgba(filtered, ihdr, palette, transparency),
    width: ihdr.width,
  };
}

export function writePng(filePath, image) {
  const rows = Buffer.alloc(image.height * (image.width * 4 + 1));
  let rowOffset = 0;
  let pixelOffset = 0;
  for (let y = 0; y < image.height; y += 1) {
    rows[rowOffset++] = 0;
    for (let x = 0; x < image.width * 4; x += 1) {
      rows[rowOffset++] = image.pixels[pixelOffset++];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  fs.writeFileSync(
    filePath,
    Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function channelsFor(colorType) {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type: ${colorType}`);
}

function unfilterRow(row, target, previous, bpp, filter) {
  for (let x = 0; x < row.length; x += 1) {
    const left = x >= bpp ? target[x - bpp] : 0;
    const up = previous[x] ?? 0;
    const upLeft = x >= bpp ? previous[x - bpp] : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) predictor = paeth(left, up, upLeft);
    else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
    target[x] = (row[x] + predictor) & 255;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function toRgba(data, ihdr, palette, transparency) {
  const rgba = new Uint8ClampedArray(ihdr.width * ihdr.height * 4);
  let src = 0;
  let dst = 0;
  const transparentGray = transparency?.length >= 2 ? transparency.readUInt16BE(0) : null;
  const transparentRgb = transparency?.length >= 6
    ? [transparency.readUInt16BE(0), transparency.readUInt16BE(2), transparency.readUInt16BE(4)]
    : null;

  for (let i = 0; i < ihdr.width * ihdr.height; i += 1) {
    if (ihdr.colorType === 0) {
      const gray = data[src++];
      rgba[dst++] = gray;
      rgba[dst++] = gray;
      rgba[dst++] = gray;
      rgba[dst++] = transparentGray === gray ? 0 : 255;
    } else if (ihdr.colorType === 2) {
      const r = data[src++];
      const g = data[src++];
      const b = data[src++];
      rgba[dst++] = r;
      rgba[dst++] = g;
      rgba[dst++] = b;
      rgba[dst++] = transparentRgb?.[0] === r && transparentRgb[1] === g && transparentRgb[2] === b ? 0 : 255;
    } else if (ihdr.colorType === 3) {
      const index = data[src++];
      const palettePos = index * 3;
      rgba[dst++] = palette?.[palettePos] ?? 0;
      rgba[dst++] = palette?.[palettePos + 1] ?? 0;
      rgba[dst++] = palette?.[palettePos + 2] ?? 0;
      rgba[dst++] = transparency?.[index] ?? 255;
    } else if (ihdr.colorType === 4) {
      const gray = data[src++];
      rgba[dst++] = gray;
      rgba[dst++] = gray;
      rgba[dst++] = gray;
      rgba[dst++] = data[src++];
    } else if (ihdr.colorType === 6) {
      rgba[dst++] = data[src++];
      rgba[dst++] = data[src++];
      rgba[dst++] = data[src++];
      rgba[dst++] = data[src++];
    }
  }
  return rgba;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
