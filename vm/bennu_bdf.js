// Experimental BennuGD-like BDF loader inspired by gr_load_bdf (file_fnt.c).

function parseIntToken(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBbx(line) {
  const parts = String(line).trim().split(/\s+/);
  return {
    width: parseIntToken(parts[1], 0),
    height: parseIntToken(parts[2], 0),
    xoffset: parseIntToken(parts[3], 0),
    yoffset: parseIntToken(parts[4], 0)
  };
}

function parseDwidth(line) {
  const parts = String(line).trim().split(/\s+/);
  return {
    xadvance: parseIntToken(parts[1], 0),
    yadvance: parseIntToken(parts[2], 0)
  };
}

function decodeBitmapRows(rows, width, height) {
  const out = new Uint8Array(Math.max(0, width * height));
  for (let y = 0; y < height; y++) {
    const row = String(rows[y] || '').trim();
    const bytes = [];
    for (let i = 0; i + 1 < row.length; i += 2) {
      const byte = Number.parseInt(row.slice(i, i + 2), 16);
      bytes.push(Number.isFinite(byte) ? byte : 0);
    }

    for (let x = 0; x < width; x++) {
      const byteIndex = x >> 3;
      const bitInByte = 7 - (x & 7);
      const byte = bytes[byteIndex] || 0;
      const on = (byte >> bitInByte) & 0x1;
      out[y * width + x] = on;
    }
  }
  return out;
}

export function parseBennuBdfFont(bdfText) {
  const lines = String(bdfText || '').replace(/\r/g, '').split('\n');
  const glyphs = new Array(256).fill(null);

  let defaultXAdvance = 0;
  let defaultYAdvance = 0;
  let minYOffset = 0;
  let maxWidth = 0;
  let maxHeight = 0;

  let inChar = false;
  let encoding = -1;
  let width = 0;
  let height = 0;
  let xoffset = 0;
  let yoffset = 0;
  let xadvance = 0;
  let yadvance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inChar && line.startsWith('DWIDTH ')) {
      const d = parseDwidth(line);
      defaultXAdvance = d.xadvance;
      defaultYAdvance = d.yadvance;
      continue;
    }

    if (line.startsWith('STARTCHAR')) {
      inChar = true;
      encoding = -1;
      width = 0;
      height = 0;
      xoffset = 0;
      yoffset = 0;
      xadvance = defaultXAdvance;
      yadvance = defaultYAdvance;
      continue;
    }

    if (line.startsWith('ENDCHAR')) {
      inChar = false;
      continue;
    }

    if (!inChar) {
      continue;
    }

    if (line.startsWith('ENCODING ')) {
      encoding = parseIntToken(line.slice(9), -1);
      continue;
    }

    if (line.startsWith('DWIDTH ')) {
      const d = parseDwidth(line);
      xadvance = d.xadvance;
      yadvance = d.yadvance;
      continue;
    }

    if (line.startsWith('BBX ')) {
      const box = parseBbx(line);
      width = Math.max(0, box.width);
      height = Math.max(0, box.height);
      xoffset = box.xoffset;
      yoffset = box.yoffset;
      continue;
    }

    if (line.startsWith('BITMAP')) {
      if (encoding < 0 || encoding > 255 || width <= 0 || height <= 0) {
        continue;
      }

      const bitmapRows = lines.slice(i + 1, i + 1 + height);
      i += height;

      const parsedYOffset = -yoffset - height;
      minYOffset = Math.min(minYOffset, parsedYOffset);
      maxWidth = Math.max(maxWidth, width);
      maxHeight = Math.max(maxHeight, height);

      glyphs[encoding] = {
        width,
        height,
        xoffset,
        yoffset: parsedYOffset,
        xadvance,
        yadvance,
        bitmap: decodeBitmapRows(bitmapRows, width, height)
      };
    }
  }

  for (let i = 0; i < glyphs.length; i++) {
    if (glyphs[i]) {
      glyphs[i].yoffset -= minYOffset;
    }
  }

  if (glyphs[32] && glyphs[32].xadvance === 0 && glyphs[106]) {
    glyphs[32].xadvance = glyphs[106].xadvance;
  }

  const fallbackAdvance =
    (glyphs[32] && glyphs[32].xadvance > 0 ? glyphs[32].xadvance : 0)
    || (glyphs[106] && glyphs[106].xadvance > 0 ? glyphs[106].xadvance : 0)
    || Math.max(1, maxWidth || 8);

  return {
    kind: 'bdf',
    glyphs,
    maxWidth,
    maxHeight,
    lineHeight: Math.max(1, maxHeight),
    fallbackAdvance
  };
}
