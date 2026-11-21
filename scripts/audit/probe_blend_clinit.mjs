// Parse BlendingMode.<clinit> smali into {ordinal, constant, xmlId, backingStore, blendEffect}.
//
// Two constructor shapes appear in the obfuscated output:
//   <init>(String,int,String,Z,String)V                                     -- 5 args, fully explicit
//   <init>(String,int,String,Z,String,int,DefaultConstructorMarker)V         -- 7 args, Kotlin
//                                                                             default-args bridge
// The 7-arg form is emitted whenever a trailing argument is defaulted. The trailing `int` is the
// Kotlin default-argument bitmask: bit 4 (0x8 -> blendEffect) set means blendEffect is the default
// `null`. So a constant built with the 7-arg form and mask 0x6 never has a blend effect, and its
// `usesBackingStore` is the boolean it did pass.
//
// Registers are not stable between blocks (the compiler reassigns v0..v16), so each
// `new-instance ... BlendingMode;` starts a fresh register->value map and the invoke's register
// range is read back in order.
import { readFileSync } from 'node:fs';

const src = readFileSync(process.argv[2], 'utf8');

const regs = new Map();
const parsed = [];

const valueOf = (token) => {
  const s = regs.get(token);
  return s === undefined ? undefined : s;
};

for (const rawLine of src.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line) continue;

  if (/^new-instance \S+, Lcom\/alightcreative\/app\/motion\/scene\/BlendingMode;$/.test(line)) {
    regs.clear();
    continue;
  }

  let m = line.match(/^const-string(?: \/jumbo)? (v\d+), "(.*)"$/);
  if (m) {
    regs.set(m[1], m[2]);
    continue;
  }

  m = line.match(/^const(?:\/4|\/16|\/high16)? (v\d+), (0x[0-9a-fA-F]+|-?\d+)$/);
  if (m) {
    regs.set(m[1], parseInt(m[2], 0));
    continue;
  }

  // invoke-direct/range {v0 .. v7}, ...<init>(...)V    or   {v9 .. v14}
  m = line.match(/^invoke-direct\/range \{(v\d+) \.\. (v\d+)\}, Lcom\/alightcreative\/app\/motion\/scene\/BlendingMode;-><init>\((.*)\)V$/);
  if (m) {
    const first = parseInt(m[1].slice(1), 10);
    const last = parseInt(m[2].slice(1), 10);
    const args = [];
    for (let r = first; r <= last; r++) args.push(valueOf(`v${r}`));
    const sig = m[3];
    const sevenArg = /DefaultConstructorMarker/.test(sig);
    // args[0] is the receiver (`this`), written by the `move-object vN, vX` just before the invoke.
    // Then: name, ordinal, xmlId, usesBackingStore, blendEffect[, defaultMask, marker].
    // The 7-arg bridge passes the Kotlin default-arg bitmask where a 5-arg call passes nothing, and
    // the blendEffect slot holds an int (0) rather than a string, so a non-string 5th arg means
    // "defaulted to null".
    const name = args[1];
    const ordinal = args[2];
    const xmlId = args[3];
    const backing = args[4];
    const blendEffect = typeof args[5] === 'string' ? args[5] : null;
    parsed.push({
      ordinal,
      name,
      xmlId,
      backing,
      blendEffect,
      sevenArg,
      defaultMask: sevenArg ? args[6] : 0,
    });
    continue;
  }

  m = line.match(/^sput-object v\d+, Lcom\/alightcreative\/app\/motion\/scene\/BlendingMode;->([A-Z_]+):/);
  if (m && parsed.length) {
    parsed[parsed.length - 1].constant = m[1];
  }
}

console.log(`parsed ${parsed.length} constants\n`);
console.log(
  'ord'.padEnd(4),
  'constant'.padEnd(16),
  'xmlId'.padEnd(16),
  'backing'.padEnd(8),
  'effectId',
);
console.log('-'.repeat(88));
for (const p of parsed) {
  console.log(
    String(p.ordinal).padEnd(4),
    String(p.constant).padEnd(16),
    String(p.xmlId).padEnd(16),
    String(p.backing === 1).padEnd(8),
    p.blendEffect ?? 'null',
  );
}

const withEffect = parsed.filter((p) => p.blendEffect);
console.log(`\nwith effectId: ${withEffect.length}`);
console.log(
  `null effectId: ${parsed.length - withEffect.length} -> ${parsed.filter((p) => !p.blendEffect).map((p) => p.constant).join(', ')}`,
);
console.log(
  `usesBackingStore=true: ${parsed.filter((p) => p.backing === 1).map((p) => p.constant).join(', ') || '(none)'}`,
);

// Emit TS-ready rows so the table can be regenerated from evidence, not memory.
console.log('\n// --- generated rows ---');
for (const p of parsed) {
  const constant = p.constant ?? p.name;
  console.log(
    `{ constant: '${constant}', xmlId: '${p.xmlId}', effectId: ${p.blendEffect ? `'${p.blendEffect}'` : 'null'}, backingStore: ${p.backing === 1} },`,
  );
}
