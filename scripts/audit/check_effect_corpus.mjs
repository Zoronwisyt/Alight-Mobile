// Static sweep of the three importer rules that were aligned to the APK in this
// change set: the param-tag allowlist, the texture srcType allowlist, and the
// present-but-empty <passes> rejection.
//
// No DOM parser here on purpose — the shipped corpus is XHTML-clean, so a tag
// scan answers the same question the browser DOMParser would, and the repo stays
// dependency-free.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node check_effect_corpus.mjs <apk>/assets/effects');
  process.exit(2);
}

const PARAM_TAGS = new Set([
  'spinner', 'slider', 'float', 'point', 'xyz', 'orient', 'color',
  'hue-disc', 'hue-ring', 'selector', 'switch', 'section', 'tip', 'texture',
]);
const TEX_SRC_TYPES = new Set(['content', 'buffer', 'comp', 'image', 'user']);

let files = 0;
const violations = [];
const stats = { paramTags: new Map(), srcTypes: new Map(), withPasses: 0, emptyPasses: 0, withIterations: 0 };

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

for (const name of readdirSync(dir)) {
  if (!name.toLowerCase().endsWith('.xml')) continue;
  const src = readFileSync(join(dir, name), 'utf8');
  const clean = src.replace(/<!--[\s\S]*?-->/g, '');
  if (!/^\s*<(\?xml[^>]*\?>\s*)?<effect\b/.test(clean)) continue;
  files++;

  const paramsBlock = /<params\b[^>]*>([\s\S]*?)<\/params>/.exec(clean);
  if (paramsBlock) {
    // Top-level param elements only — <choice> is a child of <selector>, not a param.
    const body = paramsBlock[1].replace(/<selector\b[^>]*>([\s\S]*?)<\/selector>/g, '<selector/>');
    for (const m of body.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
      const tag = m[1].toLowerCase();
      bump(stats.paramTags, tag);
      if (!PARAM_TAGS.has(tag)) violations.push(`${name}: param tag <${tag}> not in allowlist`);
      if (tag === 'texture') {
        const st = /srcType\s*=\s*"([^"]*)"/.exec(m[2])?.[1] ?? '(absent)';
        bump(stats.srcTypes, st);
        if (st !== '(absent)' && !TEX_SRC_TYPES.has(st)) {
          violations.push(`${name}: texture srcType "${st}" not allowed`);
        }
      }
    }
  }

  const passesBlock = /<passes\b[^>]*>([\s\S]*?)<\/passes>/.exec(clean);
  if (passesBlock) {
    stats.withPasses++;
    const passCount = [...passesBlock[1].matchAll(/<pass\b/g)].length;
    if (passCount === 0) {
      stats.emptyPasses++;
      violations.push(`${name}: <passes> present but empty (AM throws)`);
    }
  }
  if (/<iterations\b/.test(clean)) stats.withIterations++;
}

const ranked = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
console.log(`effect definitions: ${files}`);
console.log(`param tags: ${ranked(stats.paramTags).map(([k, v]) => `${k}(${v})`).join(' ')}`);
console.log(`texture srcTypes: ${ranked(stats.srcTypes).map(([k, v]) => `${k}(${v})`).join(' ')}`);
console.log(`with <passes>: ${stats.withPasses}  empty: ${stats.emptyPasses}  with <iterations>: ${stats.withIterations}`);
console.log(`violations: ${violations.length}`);
for (const v of violations.slice(0, 40)) console.log(`  ${v}`);
process.exit(violations.length === 0 ? 0 : 1);
