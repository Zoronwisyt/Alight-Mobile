// parse_blend_table.mjs — decode BlendingMode.<clinit> smali into a table.
//
// The Kotlin enum is constructed with (name, ordinal, id, usesBackingStore, effectId)
// behind a DefaultConstructorMarker synthetic, so the register window varies per
// call site. Instead of matching fixed registers, follow each `new-instance` block
// and read the constants in declaration order.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(process.argv[2], 'utf8');
const lines = src.split(/\r?\n/);

const CONST_RE = /^\s*const(?:-string|\/4|\/16)?\s+(v\d+),\s*(.+)$/;
const NEW_RE = /^\s*new-instance\s+(v\d+),\s*Lcom\/alightcreative\/app\/motion\/scene\/BlendingMode;/;

function parseValue(raw) {
  const text = raw.trim();
  if (text.startsWith('"')) return JSON.parse(text);
  const hex = /^0x([0-9a-fA-F]+)$/.exec(text);
  if (hex) return parseInt(hex[1], 16) | 0;
  const dec = /^-?\d+$/.test(text) ? Number(text) : null;
  if (dec !== null) return dec;
  return text;
}

const modes = [];
let current = null;

for (const line of lines) {
  if (NEW_RE.test(line)) {
    current = { constants: [] };
    continue;
  }
  if (!current) continue;
  const c = CONST_RE.exec(line);
  if (c) {
    current.constants.push(parseValue(c[2]));
    continue;
  }
  if (/invoke-direct\/range|invoke-direct \{/.test(line) && /BlendingMode;-><init>/.test(line)) {
    // constants[0..2] are (name, ordinal, id); the rest is the optional tail:
    // when the synthetic marker overload is used the trailing marker values are
    // present, so take the first boolean as usesBackingStore and the next string
    // as the effect id.
    const [name, ordinal, id, ...tail] = current.constants;
    const bool = tail.find((v) => typeof v === 'boolean' || v === 0 || v === 1);
    const effectId = tail.find((v) => typeof v === 'string' && v.includes('.')) ?? null;
    modes.push({
      ordinal,
      kotlinName: name,
      xmlId: id,
      usesBackingStore: bool === true || bool === 1,
      effectId,
    });
    current = null;
  }
}

modes.sort((a, b) => a.ordinal - b.ordinal);
const out = process.argv[3];
if (out) writeFileSync(out, JSON.stringify(modes, null, 2), 'utf8');
console.log(`parsed ${modes.length} blend modes`);
for (const m of modes) {
  console.log(
    `${String(m.ordinal).padStart(2)}  ${String(m.kotlinName).padEnd(16)} xmlId=${String(m.xmlId).padEnd(20)} backingStore=${m.usesBackingStore ? 'Y' : 'n'}  effect=${m.effectId ?? '-'}`
  );
}
