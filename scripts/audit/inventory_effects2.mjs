// Recount the corpus separating real effect definitions from preset/scene XML.
// The first inventory counted any <effect ...> tag, which also matches effect
// *instances* nested inside preset scenes.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2];
const outPath = process.argv[3];
const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.toLowerCase().endsWith('.xml')) files.push(p);
  }
})(root);

const rows = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const withoutProlog = src.replace(/^\s*<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const rootTag = /^<([a-zA-Z][\w:-]*)/.exec(withoutProlog)?.[1]?.toLowerCase() ?? 'unknown';
  const rootAttrs = {};
  const m = new RegExp(`^<${rootTag}\\b([^>]*)>`).exec(withoutProlog);
  if (m) {
    for (const a of m[1].matchAll(/([a-zA-Z_:-]+)\s*=\s*"([^"]*)"/g)) rootAttrs[a[1]] = a[2];
  }
  rows.push({ file: relative(root, f), root: rootTag, bytes: src.length, rootAttrs });
}

const effects = rows.filter((r) => r.root === 'effect');
const byRoot = new Map();
for (const r of rows) byRoot.set(r.root, (byRoot.get(r.root) ?? 0) + 1);

const attrCount = new Map();
const categories = new Map();
for (const e of effects) {
  for (const k of Object.keys(e.rootAttrs)) attrCount.set(k, (attrCount.get(k) ?? 0) + 1);
  const c = e.rootAttrs.category;
  if (c) categories.set(c, (categories.get(c) ?? 0) + 1);
}

const out = {
  generatedBy: 'scripts/audit/inventory_effects2.mjs',
  totalXml: rows.length,
  byRoot: Object.fromEntries([...byRoot.entries()].sort((a, b) => b[1] - a[1])),
  effectDefinitions: effects.length,
  effectBytesTotal: effects.reduce((n, e) => n + e.bytes, 0),
  rootAttributes: Object.fromEntries([...attrCount.entries()].sort((a, b) => b[1] - a[1])),
  categories: Object.fromEntries([...categories.entries()].sort((a, b) => b[1] - a[1])),
  effects: effects.map((e) => ({ file: e.file, bytes: e.bytes, ...e.rootAttrs })),
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('roots:', JSON.stringify(out.byRoot));
console.log('effect definitions:', out.effectDefinitions, 'bytes:', out.effectBytesTotal);
console.log('root attrs:', JSON.stringify(out.rootAttributes));
console.log('categories:', JSON.stringify(out.categories));
