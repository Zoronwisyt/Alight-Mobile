/**
 * Gate for `src/engine/mp4Audio.ts`.
 *
 * Builds an ISO-BMFF file in memory (ftyp / mdat / moov with one `soun` trak carrying two AAC
 * access units) and asserts that the extractor reproduces those units byte-for-byte behind valid
 * ADTS headers. This is the path that lets an exported MP4 keep its sound on a device whose
 * `decodeAudioData` refuses the container, so it is worth a real assertion rather than a smoke test.
 */
import { extractAacAdts } from '../../src/engine/mp4Audio';

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u8(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function u16(value: number): Uint8Array {
  return u8((value >> 8) & 0xff, value & 0xff);
}

function u32(value: number): Uint8Array {
  return u8((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function fourcc(text: string): Uint8Array {
  return new Uint8Array([0, 1, 2, 3].map((i) => text.charCodeAt(i)));
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(8 + body.length), fourcc(type), body]);
}

/** ES descriptor: tag, then length in 1 or 2 bytes (our payloads are all < 128). */
function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  if (payload.length >= 0x80) return concat([u8(tag, 0x81, payload.length - 0x80), payload]);
  return concat([u8(tag, payload.length), payload]);
}

const AUDIO_FRAMES = [u8(0x21, 0x10, 0x05, 0x60, 0x9c), u8(0x21, 0x10, 0x05, 0x40, 0x2c, 0x0a, 0xf0)];

function buildMp4(handler = 'soun'): ArrayBuffer {
  // AudioSpecificConfig: AAC-LC (objectType 2), frequency index 3 (48 kHz), 2 channels.
  const asc = u8(0x11, 0x90);
  const decSpecific = descriptor(0x05, asc);
  const decConfig = descriptor(
    0x04,
    concat([u8(0x40, 0x15), u8(0, 0x06, 0x00), u32(128000), u32(128000), decSpecific])
  );
  const es = descriptor(0x03, concat([u16(0x0001), u8(0x00), decConfig]));
  const esds = box('esds', u8(0, 0, 0, 0), es);

  const sampleEntry = box(
    'mp4a',
    u8(0, 0, 0, 0, 0, 0), // reserved
    u16(1), // data_reference_index
    u8(0, 0, 0, 0, 0, 0, 0, 0), // reserved
    u16(2), // channelcount
    u16(16), // samplesize
    u16(0), // pre_defined
    u16(0), // reserved
    u32(48000 << 16), // samplerate, 16.16
    esds
  );
  const stsd = box('stsd', u8(0, 0, 0, 0), u32(1), sampleEntry);

  const stts = box('stts', u8(0, 0, 0, 0), u32(1), u32(AUDIO_FRAMES.length), u32(1024));
  // One chunk holding both samples.
  const stsc = box('stsc', u8(0, 0, 0, 0), u32(1), u32(1), u32(AUDIO_FRAMES.length), u32(1));
  const stsz = box('stsz', u8(0, 0, 0, 0), u32(0), u32(AUDIO_FRAMES.length), ...AUDIO_FRAMES.map((f) => u32(f.length)));

  const mdatPayload = concat(AUDIO_FRAMES);
  const ftyp = box('ftyp', fourcc('isom'), u32(0x200), fourcc('isom'), fourcc('iso2'));
  const mdat = box('mdat', mdatPayload);
  // mdat data begins right after the ftyp and the mdat's own 8-byte header.
  const chunkOffset = ftyp.length + 8;
  const stco = box('stco', u8(0, 0, 0, 0), u32(1), u32(chunkOffset));

  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const minf = box('minf', stbl);
  const hdlr = box('hdlr', u8(0, 0, 0, 0), u32(0), fourcc(handler), u8(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), u8(0));
  const mdhd = box('mdhd', u8(0, 0, 0, 0), u32(0), u32(0), u32(48000), u32(1024 * AUDIO_FRAMES.length), u16(0x55c4), u16(0));
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', mdia);
  const moov = box('moov', trak);

  const file = concat([ftyp, mdat, moov]);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('check_mp4_audio: AAC track rescue from an ISO-BMFF container');

const track = extractAacAdts(buildMp4());
check('track recovered', track !== null);
if (track) {
  check('two access units', track.frameCount === 2, `got ${track.frameCount}`);
  check('sample rate from AudioSpecificConfig', track.sampleRate === 48000, `got ${track.sampleRate}`);
  check('channel count from AudioSpecificConfig', track.channels === 2, `got ${track.channels}`);
  const expectedLength = AUDIO_FRAMES.reduce((n, f) => n + 7 + f.length, 0);
  check('ADTS length', track.adts.length === expectedLength, `got ${track.adts.length} expected ${expectedLength}`);

  const first = track.adts;
  check('syncword 0xFF', first[0] === 0xff, `0x${first[0].toString(16)}`);
  check('MPEG-4, no CRC (0xF1)', first[1] === 0xf1, `0x${first[1].toString(16)}`);
  // profile = objectType-1 = 1, freqIndex = 3, channel config = 2
  check('header profile/freq/channels', first[2] === 0x4c, `0x${first[2].toString(16)}`);
  check('header frame length high bits', first[3] === 0x80, `0x${first[3].toString(16)}`);

  const firstLen = 7 + AUDIO_FRAMES[0].length;
  // frame_length is 13 bits: low 2 of byte 3, all of byte 4, top 3 of byte 5.
  check(
    'frame_length split across bytes 3-5',
    (first[3] & 0x03) === ((firstLen >> 11) & 0x03) &&
      first[4] === ((firstLen >> 3) & 0xff) &&
      (first[5] >> 5) === (firstLen & 0x07),
    `0x${first[3].toString(16)} 0x${first[4].toString(16)} 0x${first[5].toString(16)} for ${firstLen}`
  );

  const payload0 = first.subarray(7, 7 + AUDIO_FRAMES[0].length);
  check('access unit 0 bytes', payload0.every((b, i) => b === AUDIO_FRAMES[0][i]));
  const payload1 = first.subarray(firstLen + 7, firstLen + 7 + AUDIO_FRAMES[1].length);
  check('access unit 1 bytes', payload1.every((b, i) => b === AUDIO_FRAMES[1][i]));
}

check('non-sound trak is ignored', extractAacAdts(buildMp4('vide')) === null);
check('garbage input rejected', extractAacAdts(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).buffer) === null);
check('empty input rejected', extractAacAdts(new ArrayBuffer(0)) === null);
{
  // Truncated download: the sample table points past the end, so no frame may be emitted.
  const full = new Uint8Array(buildMp4());
  const cut = full.slice(0, 60);
  check('truncated file yields no frames', extractAacAdts(cut.buffer) === null);
}

if (failures > 0) {
  console.log(`\nFAIL — ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nPASS');
