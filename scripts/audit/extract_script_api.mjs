// Pull the JS-visible property names out of runScriptsInternal by scanning its
// string literals. The body is 55 KB of smali-derived Java; the literals it puts on
// the script objects are the actual API an effect script sees.
import { readFileSync } from 'node:fs';

const s = readFileSync('scripts/audit/out/rea/methods/script.runScriptsInternal.txt', 'utf8');
const counts = new Map();
for (const m of s.matchAll(/"([A-Za-z][A-Za-z0-9_.]{1,24})"/g)) {
  const k = m[1];
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log('### literals in runScriptsInternal');
console.log(ranked.map(([k, v]) => `${k}(${v})`).join('  '));
