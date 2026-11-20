// Census of the attributes actually used on every param tag across the 328 shipped
// effect XMLs. The parser tells you what is legal; the corpus tells you what is used.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.toLowerCase().endsWith('.xml')) files.push(p);
  }
})(root);

const TAGS = ['spinner', 'slider', 'float', 'color', 'point', 'xyz', 'orient', 'hue-disc', 'hue-ring', 'selector', 'switch', 'texture', 'tip', 'section', 'text', 'image'];
const census = new Map(TAGS.map((t) => [t, new Map()]));
const values = new Map(); // "tag@attr" -> Map(value -> count)

for (const f of files) {
  const s = readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const re = new RegExp(`<(${TAGS.join('|')})\\b([^>]*)>`, 'g');
  for (const m of s.matchAll(re)) {
    const tag = m[1];
    for (const a of m[2].matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g)) {
      const c = census.get(tag);
      c.set(a[1], (c.get(a[1]) ?? 0) + 1);
      const key = `${tag}@${a[1]}`;
      if (!values.has(key)) values.set(key, new Map());
      values.get(key).set(a[2], (values.get(key).get(a[2]) ?? 0) + 1);
    }
  }
}

for (const [tag, m] of census) {
  if (m.size === 0) continue;
  const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n### <${tag}>  (${ranked.reduce((n, [, v]) => n + v, 0)} attributes)`);
  console.log('   ' + ranked.map(([k, v]) => `${k}(${v})`).join(' '));
  for (const [attr] of ranked) {
    const key = `${tag}@${attr}`;
    if (attr === 'id' || attr === 'label' || attr === 'text' || attr === 'default' || attr === 'value') continue;
    const vals = [...(values.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    if (vals.length) console.log(`      ${attr}: ${vals.map(([k, v]) => `${k}(${v})`).join(' ')}`);
  }
}
