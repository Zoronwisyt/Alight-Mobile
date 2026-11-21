/**
 * Minimal ISO-BMFF audio extractor.
 *
 * `decodeAudioData` is the right first move for anything, but it refuses an MP4 that carries a video
 * track on iOS and on some WebKit builds. When it does, the audio is still in the file: this module
 * walks `moov` → `trak`(soun) → `mdia/minf/stbl`, reads the AAC sample table, and re-wraps the raw
 * access units as ADTS so they can be handed back to `decodeAudioData` as a stream every decoder
 * accepts. No dependency, no demuxer library, no second download.
 *
 * Scope: AAC in MP4/MOV (`mp4a`, including `enca` with an AAC payload). Anything else - ALAC, AC-3,
 * Opus-in-MP4 - returns null and the caller falls back to the media element.
 *
 * Known limitation: an `elst` edit list that trims the encoder priming delay is ignored, so a
 * recovered track can lead by up to one AAC frame (1024 samples ≈ 21 ms at 48 kHz).
 */

export interface AdtsAudio {
  /** Concatenated ADTS frames, `decodeAudioData`-ready. */
  adts: Uint8Array;
  sampleRate: number;
  channels: number;
  frameCount: number;
}

const ADTS_FREQ_INDEX = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

interface Box {
  type: string;
  /** offset of the box body (after the size/type header, and after the 64-bit size when present) */
  bodyStart: number;
  /** exclusive end of the box */
  end: number;
}

function fourcc(view: DataView, at: number): string {
  if (at + 4 > view.byteLength) return '';
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3)
  );
}

function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = fourcc(view, p + 4);
    let bodyStart = p + 8;
    if (size === 1) {
      if (p + 16 > end) return;
      const hi = view.getUint32(p + 8);
      const lo = view.getUint32(p + 12);
      size = hi * 0x100000000 + lo;
      bodyStart = p + 16;
    } else if (size === 0) {
      size = end - p;
    }
    // A size that cannot advance the cursor is a corrupt file, not a box: stop rather than spin.
    if (size < 8 || bodyStart - p > size) return;
    yield { type, bodyStart, end: Math.min(p + size, end) };
    p += size;
  }
}

function findBox(view: DataView, start: number, end: number, type: string): Box | null {
  for (const b of boxes(view, start, end)) {
    if (b.type === type) return b;
  }
  return null;
}

function findAll(view: DataView, start: number, end: number, type: string): Box[] {
  const out: Box[] = [];
  for (const b of boxes(view, start, end)) {
    if (b.type === type) out.push(b);
  }
  return out;
}

/** Walks the ES descriptor tree inside `esds` and returns the AudioSpecificConfig bytes. */
function findAudioSpecificConfig(bytes: Uint8Array, from: number, to: number): Uint8Array | null {
  let i = from;
  while (i < to) {
    const tag = bytes[i++];
    let len = 0;
    let b = 0;
    let guard = 0;
    do {
      if (i >= to || guard++ > 4) return null;
      b = bytes[i++];
      len = (len << 7) | (b & 0x7f);
    } while (b & 0x80);
    const payloadEnd = Math.min(i + len, to);
    if (tag === 0x05) {
      return payloadEnd > i ? bytes.subarray(i, payloadEnd) : null;
    }
    if (tag === 0x03 || tag === 0x04) {
      let nested = i;
      if (tag === 0x03) {
        // ES_ID(2) + flags(1), then optional dependsOn(2) / URL(1+n) / OCR(2).
        if (i + 3 > payloadEnd) return null;
        const flags = bytes[i + 2];
        let skip = 3;
        if (flags & 0x80) skip += 2;
        if (flags & 0x40) {
          const urlLen = bytes[i + skip] ?? 0;
          skip += 1 + urlLen;
        }
        if (flags & 0x20) skip += 2;
        nested = Math.min(i + skip, payloadEnd);
      } else {
        // objectTypeIndication(1) streamType(1) bufferSizeDB(3) maxBitrate(4) avgBitrate(4)
        nested = Math.min(i + 13, payloadEnd);
      }
      const inner = findAudioSpecificConfig(bytes, nested, payloadEnd);
      if (inner) return inner;
    }
    i = payloadEnd;
  }
  return null;
}

interface AacSampleEntry {
  objectType: number;
  freqIndex: number;
  channels: number;
  sampleRate: number;
}

function readSampleEntry(view: DataView, entry: Box): AacSampleEntry | null {
  // AudioSampleEntry: 8 reserved + 2 data_reference_index + 8 reserved, then
  // channelcount(2) samplesize(2) pre_defined(2) reserved(2) samplerate(16.16)
  const base = entry.bodyStart;
  if (base + 28 > entry.end) return null;
  const declaredChannels = view.getUint16(base + 16);
  const declaredRate = view.getUint32(base + 24) >>> 16;

  const esds = findBox(view, base + 28, entry.end, 'esds');
  if (!esds) {
    // No descriptor tree: fall back to the sample entry's own fields with a plain AAC-LC profile.
    if (!declaredRate || !declaredChannels) return null;
    const freqIndex = ADTS_FREQ_INDEX.indexOf(declaredRate);
    if (freqIndex < 0) return null;
    return { objectType: 2, freqIndex, channels: declaredChannels, sampleRate: declaredRate };
  }

  const payload = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const asc = findAudioSpecificConfig(payload, esds.bodyStart + 4, esds.end);
  if (!asc || asc.length < 2) return null;

  const objectType = (asc[0] >> 3) & 0x1f;
  const freqIndex = ((asc[0] & 0x07) << 1) | (asc[1] >> 7);
  const channels = (asc[1] >> 3) & 0x0f;
  if (objectType === 0 || objectType === 31) return null;
  if (freqIndex >= ADTS_FREQ_INDEX.length) return null;
  return {
    objectType,
    freqIndex,
    channels: channels || declaredChannels || 2,
    sampleRate: ADTS_FREQ_INDEX[freqIndex],
  };
}

function readSampleSizes(view: DataView, stsz: Box): number[] {
  const sampleSize = view.getUint32(stsz.bodyStart + 4);
  const count = view.getUint32(stsz.bodyStart + 8);
  const sizes: number[] = [];
  if (sampleSize !== 0) {
    sizes.length = count;
    sizes.fill(sampleSize);
    return sizes;
  }
  let at = stsz.bodyStart + 12;
  for (let i = 0; i < count && at + 4 <= stsz.end; i++, at += 4) {
    sizes.push(view.getUint32(at));
  }
  return sizes;
}

function readChunkOffsets(view: DataView, box: Box, large: boolean): number[] {
  const count = view.getUint32(box.bodyStart + 4);
  const out: number[] = [];
  let at = box.bodyStart + 8;
  for (let i = 0; i < count; i++) {
    if (large) {
      if (at + 8 > box.end) break;
      out.push(view.getUint32(at) * 0x100000000 + view.getUint32(at + 4));
      at += 8;
    } else {
      if (at + 4 > box.end) break;
      out.push(view.getUint32(at));
      at += 4;
    }
  }
  return out;
}

interface StscEntry {
  firstChunk: number;
  samplesPerChunk: number;
}

function readSampleToChunk(view: DataView, box: Box): StscEntry[] {
  const count = view.getUint32(box.bodyStart + 4);
  const out: StscEntry[] = [];
  let at = box.bodyStart + 8;
  for (let i = 0; i < count; i++) {
    if (at + 12 > box.end) break;
    out.push({ firstChunk: view.getUint32(at), samplesPerChunk: view.getUint32(at + 4) });
    at += 12;
  }
  return out;
}

function writeAdtsHeader(out: Uint8Array, at: number, frameLen: number, profile: number, freqIndex: number, channels: number): void {
  out[at] = 0xff;
  // MPEG-4 (ID=0), layer 00, no CRC (protection_absent=1)
  out[at + 1] = 0xf1;
  out[at + 2] = ((profile & 0x03) << 6) | ((freqIndex & 0x0f) << 2) | ((channels >> 2) & 0x01);
  out[at + 3] = ((channels & 0x03) << 6) | ((frameLen >> 11) & 0x03);
  out[at + 4] = (frameLen >> 3) & 0xff;
  out[at + 5] = ((frameLen & 0x07) << 5) | 0x1f;
  out[at + 6] = 0xfc;
}

function readAacTrack(view: DataView, stbl: Box, bytes: Uint8Array): AdtsAudio | null {
  const stsd = findBox(view, stbl.bodyStart, stbl.end, 'stsd');
  const stsz = findBox(view, stbl.bodyStart, stbl.end, 'stsz');
  const stsc = findBox(view, stbl.bodyStart, stbl.end, 'stsc');
  const stco = findBox(view, stbl.bodyStart, stbl.end, 'stco');
  const co64 = stco ? null : findBox(view, stbl.bodyStart, stbl.end, 'co64');
  if (!stsd || !stsz || !stsc || (!stco && !co64)) return null;

  // stsd: version/flags(4) entry_count(4) then the sample entries.
  const entryStart = stsd.bodyStart + 8;
  const first = findBox(view, entryStart, stsd.end, 'mp4a') ?? findBox(view, entryStart, stsd.end, 'enca');
  if (!first) return null;
  const cfg = readSampleEntry(view, first);
  if (!cfg) return null;

  const sizes = readSampleSizes(view, stsz);
  const chunkOffsets = readChunkOffsets(view, stco ?? co64!, co64 !== null);
  const stscEntries = readSampleToChunk(view, stsc);
  if (sizes.length === 0 || chunkOffsets.length === 0 || stscEntries.length === 0) return null;

  // Sample -> file offset, in decode order (for AAC each sample is one access unit).
  const offsets = new Array<number>(sizes.length);
  let sampleIndex = 0;
  for (let chunk = 0; chunk < chunkOffsets.length && sampleIndex < sizes.length; chunk++) {
    const chunkNumber = chunk + 1;
    let entry = stscEntries[0];
    for (const e of stscEntries) {
      if (e.firstChunk <= chunkNumber) entry = e;
      else break;
    }
    let cursor = chunkOffsets[chunk];
    for (let j = 0; j < entry.samplesPerChunk && sampleIndex < sizes.length; j++, sampleIndex++) {
      offsets[sampleIndex] = cursor;
      cursor += sizes[sampleIndex];
    }
  }

  let total = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    if (!(size > 0)) continue;
    const off = offsets[i];
    // A truncated download yields no frame rather than a garbage one.
    if (off === undefined || off + size > bytes.length) continue;
    total += 7 + size;
  }
  if (total === 0) return null;

  const adts = new Uint8Array(total);
  const profile = cfg.objectType - 1;
  let at = 0;
  let frameCount = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const off = offsets[i];
    if (!(size > 0) || off === undefined || off + size > bytes.length) continue;
    writeAdtsHeader(adts, at, 7 + size, profile, cfg.freqIndex, cfg.channels);
    adts.set(bytes.subarray(off, off + size), at + 7);
    at += 7 + size;
    frameCount++;
  }
  if (frameCount === 0) return null;
  return { adts, sampleRate: cfg.sampleRate, channels: cfg.channels, frameCount };
}

/** Returns the file's AAC track as an ADTS stream, or null when there is nothing to recover. */
export function extractAacAdts(buffer: ArrayBuffer): AdtsAudio | null {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const moov = findBox(view, 0, buffer.byteLength, 'moov');
  if (!moov) return null;

  for (const trak of findAll(view, moov.bodyStart, moov.end, 'trak')) {
    const mdia = findBox(view, trak.bodyStart, trak.end, 'mdia');
    if (!mdia) continue;
    const hdlr = findBox(view, mdia.bodyStart, mdia.end, 'hdlr');
    // hdlr: version/flags(4) pre_defined(4) handler_type(4)
    if (!hdlr || fourcc(view, hdlr.bodyStart + 8) !== 'soun') continue;
    const minf = findBox(view, mdia.bodyStart, mdia.end, 'minf');
    const stbl = minf ? findBox(view, minf.bodyStart, minf.end, 'stbl') : null;
    if (!stbl) continue;
    const out = readAacTrack(view, stbl, bytes);
    if (out) return out;
  }
  return null;
}
