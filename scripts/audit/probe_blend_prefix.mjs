// Is `com.alightcreative.blend.` used as a *prefix* anywhere in the dex string pool?
//
// Dex MUTF-8 strings are length-prefixed (uleb128) and NUL-terminated. A prefix used for
// concatenation (e.g. "com.alightcreative.blend." + mode.id) appears as a standalone pool entry
// with a NUL right after the dot. A suffix of a longer id appears without that NUL. So counting
// NUL-terminated occurrences of the bare prefix settles whether AM builds blend effect ids at
// runtime — which is the only way Screen could reach a shader that does not exist as an asset.
import { readFileSync } from 'node:fs';

const apkPath = process.argv[2];
const hay = readFileSync(apkPath);
const needle = Buffer.from('com.alightcreative.blend.\0', 'latin1');

let terminated = 0;
const at = [];
for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
  terminated++;
  at.push(i);
}

console.log(`NUL-terminated bare prefix occurrences: ${terminated}`);
for (const i of at.slice(0, 6)) {
  const back = hay.slice(Math.max(0, i - 4), i);
  const fwd = hay.slice(i, i + 60);
  console.log(`  @${i} prefixbytes=${back.toString('hex')} str=${JSON.stringify(fwd.toString('latin1').replace(/\0/g, '\\0'))}`);
}

// Control: the full id for subtract must be NUL-terminated (it is a complete pool entry).
for (const id of ['com.alightcreative.blend.subtract', 'com.alightcreative.blend.colormultiply', 'com.alightcreative.blend.screen']) {
  const b = Buffer.from(id + '\0', 'latin1');
  console.log(`${id.padEnd(38)} NUL-terminated entries: ${hay.indexOf(b) === -1 ? 0 : 'yes'}`);
}

// Enumerate complete blend ids that are proper pool entries.
const prefix = Buffer.from('com.alightcreative.blend.', 'latin1');
const ids = new Set();
for (let i = hay.indexOf(prefix); i !== -1; i = hay.indexOf(prefix, i + 1)) {
  const end = hay.indexOf(0, i);
  if (end < 0) continue;
  const s = hay.slice(i, end).toString('latin1');
  if (/^com\.alightcreative\.blend\.[A-Za-z0-9_]+$/.test(s)) ids.add(s);
}
console.log(`\ncomplete pool-entry blend ids: ${ids.size}`);
console.log([...ids].sort().join('\n'));
