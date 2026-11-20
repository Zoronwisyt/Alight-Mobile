// PD-A1..PD-A5 resolver check. Runs against the real module, transpiled by esbuild.
import { canonicalizeBlendMode, blendModeToXml, BLEND_MODE_TABLE } from '../../src/engine/blendModes';

const fail: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => {
  if (got !== want) fail.push(`${name}: got ${String(got)}, want ${String(want)}`);
};

// PD-A1 — AM xml id
eq('A1 multiply xml', canonicalizeBlendMode('multiply'), 'com.alightcreative.blend.colormultiply');
eq('A1 diff xml', canonicalizeBlendMode('diff'), 'com.alightcreative.blend.diff');
eq('A1 luminance xml', canonicalizeBlendMode('luminance'), 'com.alightcreative.blend.luminance');
eq('A1 soft-overlay xml', canonicalizeBlendMode('soft-overlay'), 'com.alightcreative.blend.softoverlay');

// PD-A2 — legacy web spellings
eq('A2 legacy multiply', canonicalizeBlendMode('com.alightcreative.blend.multiply'), 'com.alightcreative.blend.colormultiply');
eq('A2 legacy difference', canonicalizeBlendMode('com.alightcreative.blend.difference'), 'com.alightcreative.blend.diff');
eq('A2 legacy luminosity', canonicalizeBlendMode('com.alightcreative.blend.luminosity'), 'com.alightcreative.blend.luminance');

// PD-A3 — clipping mask dialect
eq('A3 clipping-mask', canonicalizeBlendMode('clipping-mask'), 'clipping-mask');
eq('A4 mask', canonicalizeBlendMode('mask'), 'mask');
eq('A4 exclude', canonicalizeBlendMode('exclude'), 'exclude');
eq('junk -> normal', canonicalizeBlendMode('not-a-mode'), 'normal');
eq('empty -> normal', canonicalizeBlendMode(null), 'normal');

// PD-A5 — every table entry survives a canonicalise round-trip
for (const def of BLEND_MODE_TABLE) {
  const canonical = def.effectId ?? def.xmlId;
  eq(`round-trip ${def.constant}`, canonicalizeBlendMode(def.xmlId), canonical);
  eq(`round-trip effect ${def.constant}`, canonicalizeBlendMode(canonical), canonical);
}

// PD-A5b — export never emits a legacy id and never emits a prefixed id
for (const def of BLEND_MODE_TABLE) {
  const canonical = def.effectId ?? def.xmlId;
  const xml = blendModeToXml(canonical);
  if (xml && (xml.includes('com.alightcreative') || xml === 'difference' || xml === 'luminosity')) {
    fail.push(`export emitted non-AM id for ${def.constant}: ${xml}`);
  }
  if (xml !== null) eq(`export reimport ${def.constant}`, canonicalizeBlendMode(xml), canonical);
}

// Table shape — 29 constants, 25 wired effect ids (24 in the APK + `subtract`, whose effect
// ships in the catalogue but is not wired into BlendingMode), 3 backing-store modes
eq('table length', BLEND_MODE_TABLE.length, 29);
eq('effect id count', BLEND_MODE_TABLE.filter((d) => d.effectId).length, 25);
eq(
  'backing store set',
  BLEND_MODE_TABLE.filter((d) => d.backingStore)
    .map((d) => d.xmlId)
    .sort()
    .join(','),
  'diff,exclusion,multiply'
);

if (fail.length) {
  console.error('FAIL\n' + fail.join('\n'));
  process.exit(1);
}
console.log('OK — 29 modes, 25 wired effect ids, all resolver assertions passed');
