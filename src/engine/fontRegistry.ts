// Central FontFace registry, APK font catalogue loader, fontEpoch invalidation,
// and missing-font detection for Alight Motion Web Studio.

import type { Layer, Project } from '../types/project';
import { humaniseFamily, normalizeFontWeight, registerCanonicalFamily } from './fontNames';

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

  // 2. Same family, weight within 100 units (synthesised italic allowed if family has normal)
  const familyFaces = getRegisteredFacesForFamily(family);
  if (familyFaces.length > 0) {
    let best: FaceSpec | null = null;
    let bestDiff = Infinity;
    for (const f of familyFaces) {
      const diff = Math.abs(f.weight - weight) + (f.style === style ? 0 : 25);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = f;
      }
    }
    if (best && Math.abs(best.weight - weight) <= 100) {
      return { family: best.family, weight: best.weight, style, status: 'nearest' };
    }
  }

  // 3. Project substitution
  const sub = substitutions?.[family] ?? substitutions?.[rawFamily];
  if (sub) {
    const subFaces = getRegisteredFacesForFamily(sub);
    if (subFaces.length > 0) {
      let best = subFaces[0];
      let bestDiff = Math.abs(best.weight - weight);
      for (const f of subFaces) {
        const d = Math.abs(f.weight - weight);
        if (d < bestDiff) {
          bestDiff = d;
          best = f;
        }
      }
      return { family: best.family, weight: best.weight, style, status: 'substituted' };
    }
    return { family: sub, weight, style, status: 'substituted' };
  }

  // 4. Missing
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
