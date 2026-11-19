/**
 * Lightweight pure-TypeScript animated GIF89a encoder with 6x6x6 RGB + grayscale palette & LZW compression.
 */
export function encodeAnimatedGif(
  frames: ImageData[],
  delayCs: number,
  width: number,
  height: number
): Blob {
  const bytes: number[] = [];
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const writeU16 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };

  // Build 256-color fixed palette (216 web-safe cube + 40 grays)
  const palette = new Uint8Array(256 * 3);
  let p = 0;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette[p++] = Math.round((r * 255) / 5);
        palette[p++] = Math.round((g * 255) / 5);
        palette[p++] = Math.round((b * 255) / 5);
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    const v = Math.round((i * 255) / 39);
    palette[p++] = v;
    palette[p++] = v;
    palette[p++] = v;
  }

  // Header
  writeStr('GIF89a');
  writeU16(width);
  writeU16(height);
  bytes.push(0xf7, 0, 0); // Global color table flag (8-bit = 256 colors)
  for (let i = 0; i < palette.length; i++) bytes.push(palette[i]);

  // Netscape 2.0 loop extension
  bytes.push(0x21, 0xff, 0x0b);
  writeStr('NETSCAPE2.0');
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const frame of frames) {
    // Graphic Control Extension
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    writeU16(Math.max(2, Math.round(delayCs)));
    bytes.push(0x00, 0x00);

    // Image Descriptor
    bytes.push(0x2c);
    writeU16(0);
    writeU16(0);
    writeU16(width);
    writeU16(height);
    bytes.push(0x00);

    // Quantize pixels to palette index
    const px = frame.data;
    const indices = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < indices.length; i++, j += 4) {
      const r = px[j];
      const g = px[j + 1];
      const b = px[j + 2];
      const ri = Math.round((r * 5) / 255);
      const gi = Math.round((g * 5) / 255);
      const bi = Math.round((b * 5) / 255);
      indices[i] = ri * 36 + gi * 6 + bi;
    }

    // LZW encode with minCodeSize = 8
    const minCodeSize = 8;
    bytes.push(minCodeSize);
    const lzw = lzwEncode(indices, minCodeSize);
    for (let i = 0; i < lzw.length; i += 255) {
      const len = Math.min(255, lzw.length - i);
      bytes.push(len);
      for (let k = 0; k < len; k++) bytes.push(lzw[i + k]);
    }
    bytes.push(0x00); // block terminator
  }

  bytes.push(0x3b); // Trailer
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

function lzwEncode(pixels: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map<string, number>();

  const resetDict = () => {
    dict = new Map();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  const out: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;

  const emit = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  };

  resetDict();
  emit(clearCode);

  if (pixels.length === 0) {
    emit(eoiCode);
    if (bitCount > 0) out.push(bitBuf & 0xff);
    return out;
  }

  let cur = String(pixels[0]);
  for (let i = 1; i < pixels.length; i++) {
    const ch = pixels[i];
    const nextKey = `${cur},${ch}`;
    if (dict.has(nextKey)) {
      cur = nextKey;
    } else {
      const code = cur.includes(',') ? dict.get(cur)! : Number(cur);
      emit(code);
      if (nextCode < 4096) {
        dict.set(nextKey, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        emit(clearCode);
        resetDict();
      }
      cur = String(ch);
    }
  }

  const lastCode = cur.includes(',') ? dict.get(cur)! : Number(cur);
  emit(lastCode);
  emit(eoiCode);
  if (bitCount > 0) out.push(bitBuf & 0xff);
  return out;
}
