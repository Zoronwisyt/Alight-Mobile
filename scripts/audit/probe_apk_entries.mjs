// List / extract APK entries by regex. The editor's mobile chrome is defined by
// res/layout XMLs, which are ordinary (binary) files inside the APK and can be read
// without touching resources.arsc.
//
//   node probe_apk_entries.mjs <apk> list <regex>
//   node probe_apk_entries.mjs <apk> extract <regex> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join, basename } from 'node:path';

const [apkPath, mode, pattern, outDir] = process.argv.slice(2);
const b = readFileSync(apkPath);

let eocd = -1;
for (let i = b.length - 22; i >= Math.max(0, b.length - 90000); i--) {
  if (b.readUInt32LE(i) === 0x06054b50) {
    eocd = i;
    break;
  }
}
if (eocd < 0) throw new Error('no end-of-central-directory record');

const count = b.readUInt16LE(eocd + 10);
let p = b.readUInt32LE(eocd + 16);
const entries = [];
for (let i = 0; i < count; i++) {
  if (b.readUInt32LE(p) !== 0x02014b50) break;
  const method = b.readUInt16LE(p + 10);
  const compSize = b.readUInt32LE(p + 20);
  const size = b.readUInt32LE(p + 24);
  const nameLen = b.readUInt16LE(p + 28);
  const extraLen = b.readUInt16LE(p + 30);
  const cmtLen = b.readUInt16LE(p + 32);
  const localOff = b.readUInt32LE(p + 42);
  const name = b.slice(p + 46, p + 46 + nameLen).toString('utf8');
  entries.push({ name, method, compSize, size, localOff });
  p += 46 + nameLen + extraLen + cmtLen;
}

const re = new RegExp(pattern, 'i');
const hits = entries.filter((e) => re.test(e.name));
console.log(`entries: ${entries.length}, matches: ${hits.length}`);
if (mode === 'list') {
  for (const e of hits) console.log(`${e.name}\t${e.size}`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const e of hits) {
    const nLen = b.readUInt16LE(e.localOff + 26);
    const xLen = b.readUInt16LE(e.localOff + 28);
    const start = e.localOff + 30 + nLen + xLen;
    const data = b.slice(start, start + e.compSize);
    let buf;
    try {
      buf = e.method === 0 ? data : inflateRawSync(data);
    } catch {
      continue;
    }
    writeFileSync(join(outDir, basename(e.name)), buf);
  }
  console.log(`extracted ${hits.length} → ${outDir}`);
}
