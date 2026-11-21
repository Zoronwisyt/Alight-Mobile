// Cross-check: classNames used in the UI that have no rule in app.css / tokens.css.
// A className with no rule is not styled at all — it renders as a plain block, which
// is exactly how a dialog ends up laid out in the document flow instead of over it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const srcDir = process.argv[2];
const cssFiles = [join(srcDir, 'styles', 'app.css'), join(srcDir, 'styles', 'tokens.css')];
const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

const defined = new Set();
for (const m of css.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) defined.add(m[1]);

const used = new Map();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!['.tsx', '.ts'].includes(extname(p))) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const raw = m[1] ?? m[2] ?? '';
      for (const token of raw.split(/[\s${}?:'"`]+/)) {
        if (!token || !/^am-/.test(token)) continue;
        if (!used.has(token)) used.set(token, new Set());
        used.get(token).add(p.replace(srcDir, '').replace(/\\/g, '/'));
      }
    }
  }
}
walk(srcDir);

const missing = [...used.entries()].filter(([cls]) => !defined.has(cls)).sort((a, b) => a[0].localeCompare(b[0]));
console.log(`classes used: ${used.size}, defined in css: ${defined.size}`);
console.log(`used but never styled: ${missing.length}`);
for (const [cls, files] of missing) {
  console.log(`  ${cls}  ← ${[...files].slice(0, 3).join(', ')}`);
}
