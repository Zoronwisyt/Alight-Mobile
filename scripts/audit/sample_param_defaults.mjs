// Sample the literal default values used by point/xyz/orient/color params in the
// shipped corpus, so the guide documents the real syntax rather than a guess.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const kinds = ['color', 'point', 'xyz', 'orient', 'hue-disc'];
const seen = new Map(kinds.map((k) => [k, new Set()]));

for (const f of readdirSync(dir)) {
  if (!f.endsWith('.xml')) continue;
  const s = readFileSync(join(dir, f), 'utf8');
  for (const k of kinds) {
    for (const m of s.matchAll(new RegExp(`<${k}\\b[^>]*\\bdefault="([^"]+)"`, 'g'))) seen.get(k).add(m[1]);
  }
}
for (const k of kinds) {
  const vals = [...seen.get(k)];
  console.log(`${k} (${vals.length} distinct): ${vals.slice(0, 12).join('   ')}`);
}
