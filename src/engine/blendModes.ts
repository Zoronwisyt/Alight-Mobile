import type { BlendModeId } from '../types/project';

/**
 * The 29 `BlendingMode` enum constants of Alight Motion 5.0.280, in ordinal order.
 * Source: `com.alightcreative.app.motion.scene.BlendingMode.<clinit>` — see
 * PLAYBACK_PREVIEW_DECOMPILED.md §10. `xmlId` is the attribute value AM itself writes;
 * `effectId` is the catalogue id, and it is NOT the CSS spelling.
 */
export interface BlendModeDef {
  /** APK enum constant name. */
  constant: string;
  /** Value AM writes into `blending="…"`. */
  xmlId: string;
  /**
   * Catalogue effect id, or `null` when the mode carries no `VisualEffectRef` and is therefore
   * composited inline by the renderer.
   *
   * Verified for 5.0.280 (`BlendingMode.<clinit>`): exactly five constants are built with a null
   * `blendEffect` — NORMAL, SCREEN, MASK, CLIPPING_MASK, EXCLUDE. The other 24 each name an asset
   * in `assets/effects/blend-*.xml`, and `public/am/effects.json` carries all 24. `SUBTRACT` is the
   * one whose id is not a plain dex string literal (its clinit reads an obfuscated static field);
   * `assets/effects/blend-subtract.xml` exists, so it is wired and treated as an effect mode.
   */
  effectId: BlendModeId | null;
  /** APK `usesBackingStore` — the group needs an offline buffer before compositing. */
  backingStore: boolean;
  label: string;
  group: BlendGroupName;
}

export type BlendGroupName =
  | 'Normal & Masking'
  | 'Darken'
  | 'Lighten'
  | 'Contrast'
  | 'Difference'
  | 'Color';

export const BLEND_MODE_TABLE: readonly BlendModeDef[] = [
  { constant: 'NORMAL', xmlId: 'normal', effectId: null, backingStore: false, label: 'Normal', group: 'Normal & Masking' },
  { constant: 'MULTIPLY', xmlId: 'multiply', effectId: 'com.alightcreative.blend.colormultiply', backingStore: true, label: 'Multiply', group: 'Darken' },
  { constant: 'SCREEN', xmlId: 'screen', effectId: null, backingStore: false, label: 'Screen', group: 'Lighten' },
  { constant: 'MASK', xmlId: 'mask', effectId: null, backingStore: false, label: 'Mask', group: 'Normal & Masking' },
  { constant: 'CLIPPING_MASK', xmlId: 'clipping-mask', effectId: null, backingStore: false, label: 'Clipping Mask', group: 'Normal & Masking' },
  { constant: 'EXCLUDE', xmlId: 'exclude', effectId: null, backingStore: false, label: 'Exclude', group: 'Normal & Masking' },
  { constant: 'DIFF', xmlId: 'diff', effectId: 'com.alightcreative.blend.diff', backingStore: true, label: 'Difference', group: 'Difference' },
  { constant: 'EXCLUSION', xmlId: 'exclusion', effectId: 'com.alightcreative.blend.exclusion', backingStore: true, label: 'Exclusion', group: 'Difference' },
  { constant: 'LIGHTEN', xmlId: 'lighten', effectId: 'com.alightcreative.blend.lighten', backingStore: false, label: 'Lighten', group: 'Lighten' },
  { constant: 'DARKEN', xmlId: 'darken', effectId: 'com.alightcreative.blend.darken', backingStore: false, label: 'Darken', group: 'Darken' },
  { constant: 'LIGHTER_COLOR', xmlId: 'lighter-color', effectId: 'com.alightcreative.blend.lightercolor', backingStore: false, label: 'Lighter Color', group: 'Lighten' },
  { constant: 'DARKER_COLOR', xmlId: 'darker-color', effectId: 'com.alightcreative.blend.darkercolor', backingStore: false, label: 'Darker Color', group: 'Darken' },
  { constant: 'COLOR_BURN', xmlId: 'color-burn', effectId: 'com.alightcreative.blend.colorburn', backingStore: false, label: 'Color Burn', group: 'Darken' },
  { constant: 'LINEAR_BURN', xmlId: 'linear-burn', effectId: 'com.alightcreative.blend.linearburn', backingStore: false, label: 'Linear Burn', group: 'Darken' },
  { constant: 'COLOR_DODGE', xmlId: 'color-dodge', effectId: 'com.alightcreative.blend.colordodge', backingStore: false, label: 'Color Dodge', group: 'Lighten' },
  { constant: 'LINEAR_DODGE', xmlId: 'linear-dodge', effectId: 'com.alightcreative.blend.lineardodge', backingStore: false, label: 'Linear Dodge (Add)', group: 'Lighten' },
  { constant: 'OVERLAY', xmlId: 'overlay', effectId: 'com.alightcreative.blend.overlay', backingStore: false, label: 'Overlay', group: 'Contrast' },
  { constant: 'SOFT_LIGHT', xmlId: 'soft-light', effectId: 'com.alightcreative.blend.softlight', backingStore: false, label: 'Soft Light', group: 'Contrast' },
  { constant: 'HARD_LIGHT', xmlId: 'hard-light', effectId: 'com.alightcreative.blend.hardlight', backingStore: false, label: 'Hard Light', group: 'Contrast' },
  { constant: 'SOFT_OVERLAY', xmlId: 'soft-overlay', effectId: 'com.alightcreative.blend.softoverlay', backingStore: false, label: 'Soft Overlay', group: 'Contrast' },
  { constant: 'VIVID_LIGHT', xmlId: 'vivid-light', effectId: 'com.alightcreative.blend.vividlight', backingStore: false, label: 'Vivid Light', group: 'Contrast' },
  { constant: 'LINEAR_LIGHT', xmlId: 'linear-light', effectId: 'com.alightcreative.blend.linearlight', backingStore: false, label: 'Linear Light', group: 'Contrast' },
  { constant: 'PIN_LIGHT', xmlId: 'pin-light', effectId: 'com.alightcreative.blend.pinlight', backingStore: false, label: 'Pin Light', group: 'Contrast' },
  { constant: 'HUE', xmlId: 'hue', effectId: 'com.alightcreative.blend.hue', backingStore: false, label: 'Hue', group: 'Color' },
  { constant: 'SATURATION', xmlId: 'saturation', effectId: 'com.alightcreative.blend.saturation', backingStore: false, label: 'Saturation', group: 'Color' },
  { constant: 'COLOR', xmlId: 'color', effectId: 'com.alightcreative.blend.color', backingStore: false, label: 'Color', group: 'Color' },
  { constant: 'LUMINANCE', xmlId: 'luminance', effectId: 'com.alightcreative.blend.luminance', backingStore: false, label: 'Luminosity', group: 'Color' },
  { constant: 'SUBTRACT', xmlId: 'subtract', effectId: 'com.alightcreative.blend.subtract', backingStore: false, label: 'Subtract', group: 'Difference' },
  { constant: 'DIVIDE', xmlId: 'divide', effectId: 'com.alightcreative.blend.divide', backingStore: false, label: 'Divide', group: 'Difference' },
] as const;

/**
 * Modes the renderer composites itself instead of loading a catalogue effect.
 *
 * `BlendingMode.<clinit>` builds exactly these five constants with `blendEffect = null`, so
 * `getBlendEffect()` returns null, `renderWithEffectsInternal` injects no `VisualEffectRef`, and
 * the layer reaches the compositor unshaded. `mask` / `clipping-mask` / `exclude` resolve through
 * the stencil pass, `normal` is a premultiplied `over`, and `screen` needs a real blend pass —
 * which is why it is listed here rather than mapped to `com.alightcreative.blend.screen`, an id
 * that does not exist anywhere in the APK.
 */
export const NATIVE_BLEND_MODES: readonly BlendModeId[] = [
  'normal',
  'screen',
  'mask',
  'clipping-mask',
  'exclude',
];

/** True when the mode is composited by the renderer rather than by a catalogue effect shader. */
export function isNativeBlendMode(id: BlendModeId): boolean {
  return NATIVE_BLEND_MODES.includes(canonicalizeBlendMode(id));
}

const BY_XML_ID = new Map<string, BlendModeId>();
const BY_EFFECT_ID = new Map<string, BlendModeId>();
for (const def of BLEND_MODE_TABLE) {
  const canonical: BlendModeId = def.effectId ?? (def.xmlId as BlendModeId);
  BY_XML_ID.set(def.xmlId, canonical);
  if (def.effectId) BY_EFFECT_ID.set(def.effectId, canonical);
}

/**
 * Pre-audit web spellings. Accepted on import so files written by older builds still resolve;
 * never emitted. Keys are the old value, values the 5.0.280 canonical id.
 */
const LEGACY_ALIASES: Record<string, BlendModeId> = {
  'com.alightcreative.blend.multiply': 'com.alightcreative.blend.colormultiply',
  'com.alightcreative.blend.difference': 'com.alightcreative.blend.diff',
  'com.alightcreative.blend.luminosity': 'com.alightcreative.blend.luminance',
  // `screen` is native, not a catalogue effect. Builds before the 5.0.280 blend audit emitted the
  // catalogue spelling on exported files; fold it back onto the native id.
  'com.alightcreative.blend.screen': 'screen',
  // CSS spellings on the `blending` attribute
  'color-multiply': 'com.alightcreative.blend.colormultiply',
  difference: 'com.alightcreative.blend.diff',
  luminosity: 'com.alightcreative.blend.luminance',
  // Underscored variants some exporters emit
  'soft_overlay': 'com.alightcreative.blend.softoverlay',
  'clipping_mask': 'clipping-mask',
};

/**
 * Resolve any spelling of a blend mode — AM xml id, catalogue effect id, or legacy web id —
 * into the canonical `BlendModeId`. Unknown input resolves to `'normal'`, never to an id the
 * catalogue cannot render.
 */
export function canonicalizeBlendMode(raw: string | null | undefined): BlendModeId {
  if (!raw) return 'normal';
  const trimmed = raw.trim();
  if (!trimmed) return 'normal';
  if (trimmed === 'normal') return 'normal';
  const alias = LEGACY_ALIASES[trimmed];
  if (alias) return alias;
  const byEffect = BY_EFFECT_ID.get(trimmed);
  if (byEffect) return byEffect;
  const byXml = BY_XML_ID.get(trimmed);
  if (byXml) return byXml;
  // Tolerate the `com.alightcreative.effects.` prefix used by some effect ids.
  const stripped = trimmed.replace(/^com\.alightcreative\.effects\./, 'com.alightcreative.blend.');
  const byStripped = BY_EFFECT_ID.get(stripped);
  if (byStripped) return byStripped;
  return 'normal';
}

/**
 * Value to write into `blending="…"`. AM writes the hyphenated xml id, never the effect id.
 * Returns `null` for `normal` (attribute omitted) and for the two mask dialects, which the
 * exporter emits as `clippingMask="true"` instead.
 */
export function blendModeToXml(id: BlendModeId): string | null {
  if (id === 'normal' || id === 'mask' || id === 'clipping-mask') return null;
  if (id === 'exclude') return 'exclude';
  const canonical = canonicalizeBlendMode(id);
  const def = BLEND_MODE_TABLE.find((d) => (d.effectId ?? d.xmlId) === canonical);
  return def ? def.xmlId : null;
}

/** True when the mode renders as a mask composite rather than a colour blend. */
export function isMaskBlendMode(id: BlendModeId): boolean {
  return id === 'mask' || id === 'clipping-mask';
}

/** True when the APK asks for an offline group buffer before compositing. */
export function blendModeNeedsBackingStore(id: BlendModeId): boolean {
  const canonical = canonicalizeBlendMode(id);
  const def = BLEND_MODE_TABLE.find((d) => (d.effectId ?? d.xmlId) === canonical);
  return def?.backingStore ?? false;
}
