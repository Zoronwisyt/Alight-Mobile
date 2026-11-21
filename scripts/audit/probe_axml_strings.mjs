// Minimal Android binary-XML (AXML) string-pool reader.
//
// Android compiles res/layout/*.xml into a chunked binary form. Getting the element
// and attribute names back only needs the string pool, which is the first chunk —
// enough to inventory a screen's widgets and ids without a full AXML decoder.
//
//   node probe_axml_strings.mjs <file.axml>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const b = readFileSync(file);

if (b.readUInt16LE(0) !== 0x0003) {
  console.log('not an AXML file');
  process.exit(1);
}

// Chunk header: type(u16) headerSize(u16) size(u32). The string pool follows.
const poolType = b.readUInt16LE(8);
if (poolType !== 0x0001) {
  console.log(`unexpected first chunk 0x${poolType.toString(16)}`);
  process.exit(1);
}
const poolHeaderSize = b.readUInt16LE(10);
const poolSize = b.readUInt32LE(12);
const stringCount = b.readUInt32LE(16);
const flags = b.readUInt32LE(24);
const stringsStart = b.readUInt32LE(28);
const isUtf8 = (flags & 0x100) !== 0;

const offsets = [];
for (let i = 0; i < stringCount; i++) {
  offsets.push(b.readUInt32LE(16 + poolHeaderSize + i * 4));
}

const base = 8 + stringsStart;
const out = [];
for (const off of offsets) {
  let p = base + off;
  let s;
  if (isUtf8) {
    // char count (1-2 bytes), byte count (1-2 bytes), then bytes, NUL
    p += (b[p] & 0x80) ? 2 : 1;
    let len = b[p];
    if (len & 0x80) {
      len = ((len & 0x7f) << 8) | b[p + 1];
      p += 2;
    } else {
      p += 1;
    }
    s = b.slice(p, p + len).toString('utf8');
  } else {
    let len = b.readUInt16LE(p);
    p += 2;
    if (len & 0x8000) {
      len = ((len & 0x7fff) << 16) | b.readUInt16LE(p);
      p += 2;
    }
    s = b.slice(p, p + len * 2).toString('utf16le');
  }
  out.push(s);
}

console.log(`strings: ${out.length} (${isUtf8 ? 'utf8' : 'utf16'}), pool ${poolSize} B`);
for (const s of out) {
  if (s.trim()) console.log(s);
}
