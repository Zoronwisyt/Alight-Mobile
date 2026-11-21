// Central FontFace registry, APK font catalogue loader, fontEpoch invalidation,
// and missing-font detection for Alight Motion Web Studio.

import type { Layer, Project } from '../types/project';
import {
  familyKey,
  humaniseFamily,
  normalizeFontWeight,
  registerCanonicalFamily,
  sameFamily,
} from './fontNames';

export type FaceStyle = 'normal' | 'italic';

export interface FaceSpec {
  family: string;
  file?: string;
  data?: ArrayBuffer;
  weight: number;
  style: FaceStyle;
  source?: 'bundled' | 'user' | 'google';
}

export interface CatalogFamily {
  family: string;
  weights: number[];
  styles: FaceStyle[];
  thumbs: Record<string, string>;
  google: boolean;
}

export interface MissingFontEntry {
  family: string;
  weights: number[];
  styles: FaceStyle[];
  layerIds: string[];
  sampleText: string;
  inCatalog: boolean;
}

const loadedFaces = new Map<string, { face: FontFace; spec: FaceSpec }>();
const catalogMap = new Map<string, CatalogFamily>();
const listeners = new Set<() => void>();

export const fontEpoch = { value: 0 };

let bootPromise: Promise<void> | null = null;

function faceKey(family: string, weight: number, style: FaceStyle): string {
  return `${family.toLowerCase()}|${weight}|${style}`;
}

export function onFontEpochChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function bumpEpoch(): void {
  fontEpoch.value++;
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  }
}

export async function registerFace(spec: FaceSpec): Promise<{ ok: boolean; error?: string }> {
  const family = spec.family.trim();
  const key = faceKey(family, spec.weight, spec.style);
  if (loadedFaces.has(key)) return { ok: true };

  registerCanonicalFamily(family);
  const src: string | BufferSource = spec.data
    ? spec.data
    : `url(/am/fonts/${spec.file})`;

  try {
    const face = new FontFace(family, src, {
      weight: String(spec.weight),
      style: spec.style,
      display: 'block',
    });
    await face.load();
    document.fonts.add(face);
    loadedFaces.set(key, { face, spec: { ...spec, family } });
    bumpEpoch();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function unregisterFace(family: string, weight: number, style: FaceStyle): void {
  const key = faceKey(family, weight, style);
  const entry = loadedFaces.get(key);
  if (!entry) return;
  try {
    document.fonts.delete(entry.face);
  } catch {
    // ignore
  }
  loadedFaces.delete(key);
  bumpEpoch();
}

export function isFaceRegistered(family: string, weight: number, style: FaceStyle): boolean {
  return loadedFaces.has(faceKey(family, weight, style));
}

export function getRegisteredFamilies(): string[] {
  const set = new Set<string>();
  for (const { spec } of loadedFaces.values()) {
    set.add(spec.family);
  }
  return Array.from(set).sort();
}

// Family identity index: `familyKey` → the registered families that share it.
//
// A project asks for "Hind"; a pack registers "Hind SemiBold" and "Hind Light". The
// old resolver compared strings, decided "Hind" was uninstalled and opened the
// substitution dialog while the glyphs sat right there in IndexedDB. The index makes
// the comparison about the family, not about how a foundry spelled its faces.
const familyIndex = new Map<string, string[]>();
let familyIndexStamp = -1;

function rebuildFamilyIndex(): void {
  familyIndex.clear();
  for (const { spec } of loadedFaces.values()) {
    const key = familyKey(spec.family);
    if (!key) continue;
    const bucket = familyIndex.get(key);
    if (!bucket) {
      familyIndex.set(key, [spec.family]);
    } else if (!bucket.includes(spec.family)) {
      bucket.push(spec.family);
    }
  }
  familyIndexStamp = fontEpoch.value;
}

function getFamilyIndex(): Map<string, string[]> {
  if (familyIndexStamp !== fontEpoch.value) rebuildFamilyIndex();
  return familyIndex;
}

/**
 * Every registered family that means the same family as `family`.
 *
 * Returns the exact spelling first, then same-key variants, sorted so the caller can
 * take the first as the canonical replacement name.
 */
export function findRegisteredFamilies(family: string): string[] {
  const exact = getRegisteredFamilies().filter((f) => f.toLowerCase() === family.trim().toLowerCase());
  const key = familyKey(family);
  const bucket = key ? (getFamilyIndex().get(key) ?? []) : [];
  const out = [...exact];
  for (const f of bucket) {
    if (!out.some((e) => e.toLowerCase() === f.toLowerCase())) out.push(f);
  }
  return out;
}

/** True when the family is installed under any spelling of its name. */
export function isFamilyAvailable(family: string): boolean {
  return findRegisteredFamilies(family).length > 0;
}

/** True when two names mean the same installed family (used by the import prompts). */
export function familiesMatch(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  if (sameFamily(a, b)) return true;
  return findRegisteredFamilies(a).some((f) => f.toLowerCase() === b.trim().toLowerCase());
}

export function getRegisteredFacesForFamily(family: string): FaceSpec[] {
  const low = family.toLowerCase();
  const out: FaceSpec[] = [];
  for (const { spec } of loadedFaces.values()) {
    if (spec.family.toLowerCase() === low) out.push(spec);
  }
  return out.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
}

export function getCatalogFamilies(): CatalogFamily[] {
  return Array.from(catalogMap.values()).sort((a, b) => a.family.localeCompare(b.family));
}

export function getCatalogFamily(family: string): CatalogFamily | undefined {
  const norm = humaniseFamily(family).toLowerCase();
  for (const entry of catalogMap.values()) {
    if (entry.family.toLowerCase() === norm) return entry;
  }
  return undefined;
}

export async function initFontRegistry(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    // Load bundled fonts.json + APK fontcatalog.json in parallel
    const [bundledRes, catalogRes] = await Promise.allSettled([
      fetch('/am/fonts/fonts.json').then((r) => (r.ok ? r.json() : [])),
      fetch('/am/fontcatalog.json').then((r) => (r.ok ? r.json() : { families: [] })),
    ]);

    if (catalogRes.status === 'fulfilled' && Array.isArray(catalogRes.value?.families)) {
      for (const fam of catalogRes.value.families as CatalogFamily[]) {
        catalogMap.set(fam.family.toLowerCase(), fam);
        registerCanonicalFamily(fam.family);
      }
    }

    if (bundledRes.status === 'fulfilled' && Array.isArray(bundledRes.value)) {
      const specs = bundledRes.value as FaceSpec[];
      await Promise.allSettled(
        specs.map((s) =>
          registerFace({
            family: s.family,
            file: s.file,
            weight: s.weight,
            style: s.style || 'normal',
            source: 'bundled',
          })
        )
      );
    }

    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
    bumpEpoch();
  })();
  return bootPromise;
}

export interface ResolvedFont {
  family: string;
  weight: number;
  style: FaceStyle;
  status: 'exact' | 'nearest' | 'substituted' | 'missing';
}

/**
 * Closest installed face to a requested weight/style.
 *
 * Exported because it is the whole of AM's "nearest weight" behaviour and is worth
 * asserting on its own. Style is worth 25 weight units: a genuine 600 beats a
 * synthesised-italic 600 when the caller asked for regular.
 */
export function nearestFace(faces: FaceSpec[], weight: number, style: FaceStyle): FaceSpec | null {
  let best: FaceSpec | null = null;
  let bestDiff = Infinity;
  for (const f of faces) {
    // An exact weight beats a closer-styled face: style is worth less than the weight.
    const diff = Math.abs(f.weight - weight) + (f.style === style ? 0 : 25);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }
  return best;
}

export function resolveFontTriple(
  rawFamily: string,
  rawWeight: number | string = 400,
  italic = false,
  substitutions?: Record<string, string>
): ResolvedFont {
  const family = humaniseFamily(rawFamily);
  const weight = normalizeFontWeight(rawWeight);
  const style: FaceStyle = italic ? 'italic' : 'normal';

  // 1. Exact match in registry
  if (isFaceRegistered(family, weight, style)) {
    return { family, weight, style, status: 'exact' };
  }

  // 2. Same registered family, any installed weight. AM resolves a family and asks the
  //    platform for the closest weight, so a missing 600 is not a missing font.
  const familyFaces = getRegisteredFacesForFamily(family);
  if (familyFaces.length > 0) {
    const best = nearestFace(familyFaces, weight, style);
    if (best) return { family: best.family, weight: best.weight, style, status: 'nearest' };
  }

  // 3. Same family under a different spelling — "Hind" vs a pack that registered
  //    "Hind SemiBold", or "SpaceGrotesk" vs "Space Grotesk".
  const aliases = findRegisteredFamilies(family).filter((f) => f.toLowerCase() !== family.toLowerCase());
  if (aliases.length > 0) {
    const faces: FaceSpec[] = [];
    for (const alias of aliases) faces.push(...getRegisteredFacesForFamily(alias));
    const best = nearestFace(faces, weight, style);
    if (best) return { family: best.family, weight: best.weight, style, status: 'nearest' };
  }

  // 4. Project substitution — matched on family identity too, so a substitution
  //    recorded against "Hind" still applies when the file says "Hind Bold".
  if (substitutions) {
    const key = familyKey(family);
    let target: string | undefined;
    for (const [from, to] of Object.entries(substitutions)) {
      if (!to) continue;
      if (
        from === family ||
        from === rawFamily ||
        (key.length > 0 && familyKey(from) === key)
      ) {
        target = to;
        break;
      }
    }
    if (target) {
      const subFaces = getRegisteredFacesForFamily(target);
      if (subFaces.length > 0) {
        const best = nearestFace(subFaces, weight, style) ?? subFaces[0];
        return { family: best.family, weight: best.weight, style, status: 'substituted' };
      }
      const aliasFaces: FaceSpec[] = [];
      for (const alias of findRegisteredFamilies(target)) {
        aliasFaces.push(...getRegisteredFacesForFamily(alias));
      }
      if (aliasFaces.length > 0) {
        const best = nearestFace(aliasFaces, weight, style) ?? aliasFaces[0];
        return { family: best.family, weight: best.weight, style, status: 'substituted' };
      }
      return { family: target, weight, style, status: 'substituted' };
    }
  }

  // 5. Missing
  return { family: 'Roboto', weight: Math.min(700, Math.max(400, Math.round(weight / 100) * 100)), style, status: 'missing' };
}

function walkTextLayers(layers: Layer[], out: Layer[]): void {
  for (const l of layers) {
    if (l.type === 'text' && l.textData) {
      out.push(l);
    }
    if (l.groupLayers && l.groupLayers.length > 0) {
      walkTextLayers(l.groupLayers, out);
    }
  }
}

export function collectMissingFonts(project: Project): MissingFontEntry[] {
  const textLayers: Layer[] = [];
  walkTextLayers(project.layers, textLayers);

  const byFamily = new Map<
    string,
    { family: string; weights: Set<number>; styles: Set<FaceStyle>; layerIds: string[]; sampleText: string }
  >();

  for (const l of textLayers) {
    const td = l.textData!;
    const fam = humaniseFamily(td.fontFamily);
    const weight = normalizeFontWeight(td.fontWeight);
    const italic = Boolean(td.italic);
    const resolved = resolveFontTriple(fam, weight, italic, project.fontSubstitutions);
    if (resolved.status === 'missing') {
      const key = fam.toLowerCase();
      let entry = byFamily.get(key);
      if (!entry) {
        entry = {
          family: fam,
          weights: new Set(),
          styles: new Set(),
          layerIds: [],
          sampleText: (td.content || 'Sample text').slice(0, 24),
        };
        byFamily.set(key, entry);
      }
      entry.weights.add(weight);
      entry.styles.add(italic ? 'italic' : 'normal');
      entry.layerIds.push(l.id);
    }
  }

  return Array.from(byFamily.values())
    .map((e) => ({
      family: e.family,
      weights: Array.from(e.weights).sort((a, b) => a - b),
      styles: Array.from(e.styles),
      layerIds: e.layerIds,
      sampleText: e.sampleText,
      inCatalog: Boolean(getCatalogFamily(e.family)),
    }))
    .sort((a, b) => b.layerIds.length - a.layerIds.length || a.family.localeCompare(b.family));
}
