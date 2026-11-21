// PD-A1..PD-A5 resolver check. Runs against the real module, transpiled by esbuild.
import { readFileSync } from 'node:fs';
import {
  canonicalizeBlendMode,
  blendModeToXml,
  blendModeNeedsBackingStore,
  isNativeBlendMode,
  NATIVE_BLEND_MODES,
  BLEND_MODE_TABLE,
} from '../../src/engine/blendModes';
import type { BlendModeId } from '../../src/types/project';

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
eq('effect id count', BLEND_MODE_TABLE.filter((d) => d.effectId).length, 24);
eq(
  'native (no effect id) set',
  BLEND_MODE_TABLE.filter((d) => !d.effectId)
    .map((d) => d.xmlId)
    .sort()
    .join(','),
  'clipping-mask,exclude,mask,normal,screen',
);
eq('native set matches renderer contract', [...NATIVE_BLEND_MODES].sort().join(','), 'clipping-mask,exclude,mask,normal,screen');
eq(
  'no table row reaches the plain-blit fallback',
  BLEND_MODE_TABLE.filter((d) => !d.effectId && !isNativeBlendMode((d.effectId ?? d.xmlId) as BlendModeId)).length,
  0,
);
eq(
  'backing store set',
  BLEND_MODE_TABLE.filter((d) => d.backingStore)
    .map((d) => d.xmlId)
    .sort()
    .join(','),
  'diff,exclusion,multiply'
);

// PD-A6 - every wired effect id must exist in the shipped catalogue. A row naming a def the
// catalogue does not carry silently degrades to a plain blit and renders as Normal, which is
// exactly how `screen` was broken before this audit.
// cwd-relative on purpose: this runs from the repo root under esbuild, where a bundled
// `import.meta.url` points at the build artefact rather than the source tree.
const catalogue = JSON.parse(readFileSync('public/am/effects.json', 'utf8')) as Array<{ id: string }>;
const catalogueIds = new Set((Array.isArray(catalogue) ? catalogue : []).map((e) => e.id));
eq(
  'every effect id resolves in effects.json',
  BLEND_MODE_TABLE.filter((d) => d.effectId && !catalogueIds.has(d.effectId))
    .map((d) => `${d.constant}->${d.effectId}`)
    .join(' | '),
  ''
);
eq('effects.json blend defs', [...catalogueIds].filter((id) => id.includes('.blend.')).length, 24);

// PD-A7 - Screen is native. It must not import as a catalogue id and must export as AM's own
// `screen` attribute value.
eq('A7 screen xml', canonicalizeBlendMode('screen'), 'screen');
eq('A7 screen legacy effect id', canonicalizeBlendMode('com.alightcreative.blend.screen'), 'screen');
eq('A7 screen export', blendModeToXml('screen'), 'screen');
eq('A7 screen is native', isNativeBlendMode('screen'), true);
eq('A7 screen needs no backing store', blendModeNeedsBackingStore('screen'), false);

// PD-A8 - the internal shaders live as template literals in renderer.ts. A stray edit that joins the
// `#version` line with the first statement produces a source string that still type-checks and still
// bundles, but fails to compile on the GPU (seen once already as `#version 300 esprecision`). Assert
// every preamble is intact, and that the Screen pair actually made it into the module.
const rendererSrc = readFileSync('src/engine/renderer.ts', 'utf8');
for (const name of ['BLIT_VERT', 'BLIT_FRAG', 'MASK_FRAG', 'SCREEN_FRAG', 'COMPOSITE_BLEND_FRAG']) {
  const m = rendererSrc.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) {
    fail.push(`A8 ${name} not found in renderer.ts`);
    continue;
  }
  if (!m[1].startsWith('#version 300 es\n')) {
    fail.push(`A8 ${name} preamble corrupted: ${JSON.stringify(m[1].slice(0, 40))}`);
  }
}
eq('A8 screen shader samples uTop and uBot', /SCREEN_FRAG[\s\S]*?uniform sampler2D uBot;/.test(rendererSrc), true);


if (fail.length) {
  console.error('FAIL\n' + fail.join('\n'));
  process.exit(1);
}
console.log('OK - 29 modes: 24 catalogue effect ids, 5 native composites, all resolver assertions passed');
