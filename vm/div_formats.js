function toAscii(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    out += c >= 32 && c <= 126 ? String.fromCharCode(c) : '\0';
  }
  return out;
}

class BinReader {
  constructor(buffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.pos = 0;
    this.length = this.bytes.length;
  }

  remaining() {
    return this.length - this.pos;
  }

  seek(offset) {
    this.pos = Math.max(0, Math.min(this.length, offset));
  }

  skip(n) {
    this.seek(this.pos + n);
  }

  readBytes(n) {
    if (this.pos + n > this.length) {
      throw new Error('Unexpected EOF');
    }
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  readUInt8() {
    return this.readBytes(1)[0];
  }

  readUInt16() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readInt16() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readInt32() {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readUInt32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

function readHeader(reader) {
  const header = reader.readBytes(8);
  const magic = toAscii(header.subarray(0, 7)).replace(/\0/g, '');
  let bpp = header[7];
  if (bpp === 0) {
    bpp = 8;
  }
  return { magic: magic.toLowerCase(), bpp };
}

function widthBytes(width, bpp) {
  if (bpp === 1) return Math.ceil(width / 8);
  if (bpp === 8) return width;
  if (bpp === 16) return width * 2;
  if (bpp === 32) return width * 4;
  throw new Error(`Unsupported bpp: ${bpp}`);
}

function parsePalette768(rgbBytes) {
  const palette = new Array(256);
  for (let i = 0; i < 256; i++) {
    const r6 = rgbBytes[i * 3 + 0] || 0;
    const g6 = rgbBytes[i * 3 + 1] || 0;
    const b6 = rgbBytes[i * 3 + 2] || 0;
    palette[i] = {
      r: Math.min(255, r6 * 4),
      g: Math.min(255, g6 * 4),
      b: Math.min(255, b6 * 4)
    };
  }
  return palette;
}

function readPalette(reader, withGammaBlock) {
  if (reader.remaining() < 768) {
    throw new Error('Missing 8bpp palette data');
  }
  const paletteBytes = reader.readBytes(768);
  if (withGammaBlock && reader.remaining() >= 576) {
    reader.skip(576);
  }
  return parsePalette768(paletteBytes);
}

function decodePixelsToImageData(width, height, bpp, rowBytes, raw, palette) {
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const outBase = (y * width + x) * 4;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;

      if (bpp === 1) {
        const byte = raw[rowOffset + (x >> 3)] || 0;
        const bit = (byte >> (7 - (x & 7))) & 1;
        if (bit) {
          r = 255; g = 255; b = 255;
        } else {
          a = 0;
        }
      } else if (bpp === 8) {
        const idx = raw[rowOffset + x] || 0;
        const color = palette?.[idx] || { r: idx, g: idx, b: idx };
        r = color.r;
        g = color.g;
        b = color.b;
        if (idx === 0) {
          a = 0;
        }
      } else if (bpp === 16) {
        const p = rowOffset + x * 2;
        const v = (raw[p] || 0) | ((raw[p + 1] || 0) << 8);
        // RGB565 decode
        r = ((v >> 11) & 0x1f) * 255 / 31;
        g = ((v >> 5) & 0x3f) * 255 / 63;
        b = (v & 0x1f) * 255 / 31;
      } else if (bpp === 32) {
        const p = rowOffset + x * 4;
        const v = (raw[p] || 0) | ((raw[p + 1] || 0) << 8) | ((raw[p + 2] || 0) << 16) | ((raw[p + 3] || 0) << 24);
        a = (v >>> 24) & 0xff;
        r = (v >>> 16) & 0xff;
        g = (v >>> 8) & 0xff;
        b = v & 0xff;
        if (a === 0) {
          a = 255;
        }
      }

      out[outBase + 0] = r;
      out[outBase + 1] = g;
      out[outBase + 2] = b;
      out[outBase + 3] = a;
    }
  }

  return new ImageData(out, width, height);
}

function imageDataToCanvas(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function readCString(bytes) {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function decodeMapPixels(reader, width, height, bpp, palette) {
  const rowBytes = widthBytes(width, bpp);
  const totalBytes = rowBytes * height;
  const raw = reader.readBytes(totalBytes);
  const imageData = decodePixelsToImageData(width, height, bpp, rowBytes, raw, palette);
  const canvas = imageDataToCanvas(imageData);
  return { raw, imageData, canvas, rowBytes };
}

export function parseDivMapBuffer(buffer) {
  const reader = new BinReader(buffer);
  const { magic, bpp } = readHeader(reader);
  if (!magic.startsWith('map') && !magic.startsWith('m16') && !magic.startsWith('m32') && !magic.startsWith('m01')) {
    throw new Error(`Not a DIV MAP file (${magic})`);
  }

  const width = reader.readUInt16();
  const height = reader.readUInt16();
  const code = reader.readInt32();
  const name = readCString(reader.readBytes(32));

  let palette = null;
  if (bpp === 8) {
    // Real load_map() (src/runtime/f.c) reads npuntos from a fixed offset
    // of 1392 = 48 (header) + 768 (palette) + 576 - the same trailing DAC
    // gamma/reserved block FPG's palette carries (readPalette's
    // withGammaBlock), just never wired up for MAP. Skipping it was
    // shifting every byte after the palette by 576, which shows up as a
    // torn/shuffled-looking background once decoded as rows.
    palette = readPalette(reader, true);
  }

  const cpointCount = reader.readUInt16();
  const cpoints = [];
  for (let i = 0; i < cpointCount; i++) {
    const x = reader.readInt16();
    const y = reader.readInt16();
    // -1,-1 marks an undefined control point (DIV convention)
    cpoints.push(x === -1 && y === -1 ? { x: -1, y: -1, undefined: true } : { x, y });
  }

  const decoded = decodeMapPixels(reader, width, height, bpp, palette);
  return {
    format: 'map',
    magic,
    bpp,
    width,
    height,
    code,
    name,
    cpoints,
    palette,
    ...decoded
  };
}

export function parseDivFpgBuffer(buffer) {
  const reader = new BinReader(buffer);
  const { magic, bpp } = readHeader(reader);
  if (!magic.startsWith('fpg') && !magic.startsWith('f16') && !magic.startsWith('f32') && !magic.startsWith('f01')) {
    throw new Error(`Not a DIV FPG file (${magic})`);
  }

  let palette = null;
  if (bpp === 8) {
    palette = readPalette(reader, true);
  }

  const maps = [];
  // code(4) + regsize(4) + name[32] + fpname[12] + width(4) + height(4) + flags/ncpoints(4)
  const chunkSize = 64;

  while (reader.remaining() >= chunkSize) {
    const code = reader.readInt32();
    reader.skip(4); // regsize, unused when loading
    const name = readCString(reader.readBytes(32));
    reader.skip(12); // fpname, unused
    const width = reader.readInt32();
    const height = reader.readInt32();
    const cpointCount = reader.readInt32();

    if (code < 0 || code > 999 || width <= 0 || height <= 0 || cpointCount < 0 || cpointCount > 10000) {
      break;
    }

    const cpoints = [];
    for (let i = 0; i < cpointCount; i++) {
      if (reader.remaining() < 4) {
        throw new Error('Unexpected EOF in FPG cpoints');
      }
      const x = reader.readInt16();
      const y = reader.readInt16();
      // -1,-1 marks an undefined control point (DIV convention)
      cpoints.push(x === -1 && y === -1 ? { x: -1, y: -1, undefined: true } : { x, y });
    }

    const decoded = decodeMapPixels(reader, width, height, bpp, palette);
    maps.push({
      code,
      name,
      width,
      height,
      cpoints,
      ...decoded
    });
  }

  return {
    format: 'fpg',
    magic,
    bpp,
    palette,
    maps
  };
}

export function parseDivFntBuffer(buffer) {
  const reader = new BinReader(buffer);
  const { magic, bpp } = readHeader(reader);
  const isFnx = magic.startsWith('fnx');
  if (!magic.startsWith('fnt') && !isFnx) {
    throw new Error(`Not a DIV FNT/FNX file (${magic})`);
  }

  let palette = null;
  if (bpp === 8) {
    palette = readPalette(reader, true);
  }

  const types = reader.readInt32();
  const glyphMeta = new Array(256).fill(null);

  if (isFnx) {
    for (let i = 0; i < 256; i++) {
      glyphMeta[i] = {
        width: reader.readInt32(),
        height: reader.readInt32(),
        xadvance: reader.readInt32(),
        yadvance: reader.readInt32(),
        xoffset: reader.readInt32(),
        yoffset: reader.readInt32(),
        fileoffset: reader.readInt32()
      };
    }
  } else {
    for (let i = 0; i < 256; i++) {
      const width = reader.readInt32();
      const height = reader.readInt32();
      const yoffset = reader.readInt32();
      const fileoffset = reader.readInt32();
      glyphMeta[i] = {
        width,
        height,
        xadvance: width,
        yadvance: height + yoffset,
        xoffset: 0,
        yoffset,
        fileoffset
      };
    }
  }

  const glyphs = new Array(256).fill(null);
  let maxHeight = 0;

  for (let i = 0; i < 256; i++) {
    const meta = glyphMeta[i];
    if (!meta || meta.fileoffset <= 0 || meta.width <= 0 || meta.height <= 0) {
      continue;
    }

    const keep = reader.pos;
    reader.seek(meta.fileoffset);
    const decoded = decodeMapPixels(reader, meta.width, meta.height, bpp, palette);
    reader.seek(keep);

    glyphs[i] = {
      ...meta,
      ...decoded
    };

    if (meta.height > maxHeight) {
      maxHeight = meta.height;
    }
  }

  const fallbackAdvance = glyphs[32]?.xadvance || glyphs[106]?.xadvance || 8;
  return {
    format: 'fnt',
    magic,
    bpp,
    types,
    palette,
    glyphs,
    lineHeight: Math.max(1, maxHeight),
    fallbackAdvance
  };
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.arrayBuffer();
}

export async function loadDivMapFromUrl(url) {
  return parseDivMapBuffer(await fetchBuffer(url));
}

export async function loadDivFpgFromUrl(url) {
  return parseDivFpgBuffer(await fetchBuffer(url));
}

export async function loadDivFntFromUrl(url) {
  return parseDivFntBuffer(await fetchBuffer(url));
}

export function renderDivFontText(ctx, font, x, y, text, align = 0) {
  if (!ctx || !font) {
    return 0;
  }

  const lines = String(text).split('\n');
  const widths = lines.map((line) => {
    let w = 0;
    for (let i = 0; i < line.length; i++) {
      const glyph = font.glyphs[line.charCodeAt(i) & 0xff];
      w += glyph ? (glyph.xadvance || glyph.width || font.fallbackAdvance) : font.fallbackAdvance;
    }
    return w;
  });

  let drawn = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let penX = Number(x) || 0;
    const penY = (Number(y) || 0) + li * font.lineHeight;
    if (align === 1) penX -= Math.round(widths[li] * 0.5);
    else if (align === 2) penX -= widths[li];

    for (let i = 0; i < line.length; i++) {
      const glyph = font.glyphs[line.charCodeAt(i) & 0xff];
      if (!glyph || !glyph.canvas) {
        penX += font.fallbackAdvance;
        continue;
      }

      ctx.drawImage(glyph.canvas, penX + (glyph.xoffset || 0), penY + (glyph.yoffset || 0));
      penX += glyph.xadvance || glyph.width || font.fallbackAdvance;
      drawn += 1;
    }
  }

  return drawn;
}
