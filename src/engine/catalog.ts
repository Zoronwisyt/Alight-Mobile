import type {
  Animatable,
  EffectDef,
  EffectParamDef,
  EffectPreset,
  LayerEffectInstance,
  ShapeDef,
} from '../types/project';
import { animatable, parseEasingString } from './animation';

let cachedEffects: EffectDef[] | null = null;
let cachedEffectMap: Map<string, EffectDef> | null = null;
let cachedPresets: Record<string, EffectPreset[]> | null = null;
let cachedShapes: ShapeDef[] | null = null;
let cachedShapeMap: Map<string, ShapeDef> | null = null;
let loadPromise: Promise<void> | null = null;

export async function ensureCatalogLoaded(): Promise<void> {
  if (cachedEffects && cachedPresets && cachedShapes) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      const base = import.meta.env.BASE_URL;
      const [effRes, preRes, shpRes] = await Promise.all([
        fetch(`${base}am/effects.json`),
        fetch(`${base}am/presets.json`),
        fetch(`${base}am/shapes.json`),
      ]);
      cachedEffects = (await effRes.json()) as EffectDef[];
      cachedPresets = (await preRes.json()) as Record<string, EffectPreset[]>;
      cachedShapes = (await shpRes.json()) as ShapeDef[];

      cachedEffectMap = new Map();
      for (const e of cachedEffects) cachedEffectMap.set(e.id, e);

      cachedShapeMap = new Map();
      for (const s of cachedShapes) cachedShapeMap.set(s.id, s);
    })();
  }
  await loadPromise;
}

export function getEffects(): EffectDef[] {
  return cachedEffects ?? [];
}

export function getEffectById(id: string): EffectDef | undefined {
  if (!cachedEffectMap) return undefined;
  return (
    cachedEffectMap.get(id) ??
    cachedEffectMap.get(`com.alightcreative.effects.${id}`) ??
    cachedEffectMap.get(`com.alightcreative.effect.${id}`)
  );
}

export function formatEffectDisplayName(def?: EffectDef | null, fallbackId?: string): string {
  if (!def) return fallbackId || 'Effect';
  if (def.deprecated && !def.name.includes('(Compatibility)')) {
    return `${def.name} (Compatibility)`;
  }
  return def.name;
}

export function getPresetsForEffect(id: string): EffectPreset[] {
  return cachedPresets?.[id] ?? [];
}

export function getShapes(): ShapeDef[] {
  return cachedShapes ?? [];
}

export function getShapeById(id: string): ShapeDef | undefined {
  return cachedShapeMap?.get(id);
}

export function parseDefaultParamValue(param: EffectParamDef): any {
  const raw = param.default ?? param.value;
  switch (param.tag) {
    case 'spinner':
    case 'slider':
    case 'float': {
      const n = raw !== undefined ? parseFloat(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    }
    case 'point': {
      if (!raw) return [0, 0];
      const parts = raw.split(',').map((s) => parseFloat(s.trim()));
      return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
    }
    case 'xyz':
    case 'hue-disc':
    case 'orient': {
      if (!raw) return [0, 0, 0];
      const parts = raw.split(',').map((s) => parseFloat(s.trim()));
      return [
        Number.isFinite(parts[0]) ? parts[0] : 0,
        Number.isFinite(parts[1]) ? parts[1] : 0,
        Number.isFinite(parts[2]) ? parts[2] : 0,
      ];
    }
    case 'color': {
      return raw || '#FFFFFFFF';
    }
    case 'selector': {
      const v = raw !== undefined ? parseInt(raw, 10) : 0;
      return Number.isFinite(v) ? v : 0;
    }
    case 'switch': {
      return raw === 'true' || raw === '1';
    }
    default:
      return raw ?? null;
  }
}

export function createEffectInstance(
  effectDef: EffectDef,
  preset?: EffectPreset
): LayerEffectInstance {
  const params: Record<string, Animatable<any>> = {};
  for (const p of effectDef.params) {
    if (!p.id || p.tag === 'texture' || p.tag === 'section' || p.tag === 'tip') continue;
    params[p.id] = animatable(parseDefaultParamValue(p));
  }

  if (preset) {
    for (const pr of preset.props) {
      const pDef = effectDef.params.find((d) => d.id === pr.name);
      const parseVal = (raw: string | null | undefined) => {
        if (raw == null) return undefined;
        if (pr.type === 'float' || pDef?.tag === 'spinner' || pDef?.tag === 'slider') {
          return parseFloat(raw) || 0;
        }
        if (pr.type === 'int' || pDef?.tag === 'selector') {
          return parseInt(raw, 10) || 0;
        }
        if (pr.type === 'bool' || pDef?.tag === 'switch') {
          return raw === 'true' || raw === '1';
        }
        if (pr.type === 'vec2' || pDef?.tag === 'point') {
          const a = raw.split(',').map((x) => parseFloat(x.trim()) || 0);
          return [a[0] ?? 0, a[1] ?? 0];
        }
        if (pr.type === 'vec3' || pDef?.tag === 'xyz' || pDef?.tag === 'hue-disc' || pDef?.tag === 'orient') {
          const a = raw.split(',').map((x) => parseFloat(x.trim()) || 0);
          return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
        }
        return raw;
      };

      if (pr.kfs && pr.kfs.length > 0) {
        const kfs = pr.kfs
          .map((k) => ({
            t: k.t,
            v: parseVal(k.v),
            easing: parseEasingString(k.e),
          }))
          .sort((a, b) => a.t - b.t);
        params[pr.name] = animatable(kfs[0].v, kfs);
      } else if (pr.value != null) {
        params[pr.name] = animatable(parseVal(pr.value));
      }
    }
  }

  return {
    uid: `eff_${Math.random().toString(36).slice(2, 10)}`,
    effectId: effectDef.id,
    enabled: true,
    locallyApplied: preset?.locallyApplied ?? false,
    params,
  };
}

export function getDefaultShapeParams(shape: ShapeDef): Record<string, Animatable<any>> {
  const out: Record<string, Animatable<any>> = {};
  for (const p of shape.params) {
    if (!p.id) continue;
    out[p.id] = animatable(parseDefaultParamValue(p));
  }
  return out;
}

export const EFFECT_CATEGORIES: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'color', label: 'Color & Light' },
  { id: 'drawing', label: 'Drawing & Edge' },
  { id: 'blur', label: 'Blur' },
  { id: 'distort', label: 'Distortion / Warp' },
  { id: 'procedural', label: 'Procedural' },
  { id: '3d', label: '3D' },
  { id: 'transform', label: 'Move / Transform' },
  { id: 'repeat', label: 'Repeat' },
  { id: 'matte', label: 'Matte / Mask / Key' },
  { id: 'opacity', label: 'Opacity / Visibility' },
  { id: 'text', label: 'Text' },
  { id: 'other', label: 'Other' },
];
