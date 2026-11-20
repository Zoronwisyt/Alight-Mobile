// Extract the attribute names the spinner/slider readers actually query, plus the
// string literals they compare against (type values, defaults). The two bodies are
// 67 KB and 87 KB of smali-derived Java, so reading them by eye is not viable.
import { readFileSync } from 'node:fs';

const dir = 'scripts/audit/out/rea/methods/';
for (const f of ['param.readSpinnerParam.txt', 'param.readSliderParam.txt']) {
  const s = readFileSync(dir + f, 'utf8');
  const attrs = [...s.matchAll(/getAttributeValue\(xmlPullParser, str, "([^"]+)"\)/g)].map((m) => m[1]);
  const uniqAttrs = [...new Set(attrs)];
  const lits = [...s.matchAll(/"([a-zA-Z][a-zA-Z0-9_\-:. ]{1,28})"/g)].map((m) => m[1]);
  const counts = new Map();
  for (const l of lits) counts.set(l, (counts.get(l) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.log(`### ${f}`);
  console.log(`  attrs: ${uniqAttrs.join(', ')}`);
  console.log(`  literals: ${ranked.map(([k, v]) => `${k}(${v})`).join(' ')}`);
}
