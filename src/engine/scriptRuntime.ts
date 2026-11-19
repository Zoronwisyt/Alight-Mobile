import type { EffectDef, ShapeDef } from '../types/project';

// 2D/3D Simplex Noise implementation matching standard Stefan Gustavson / Alight Motion AM.simplexNoise
const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const PERM = new Uint8Array(512);
const PERM_MOD12 = new Uint8Array(512);
(() => {
  const p = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37,
    240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177,
    33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146,
    158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25,
    63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100,
    109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206,
    59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153,
    101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246,
    97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192,
    214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114,
    67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
  ];
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
    PERM_MOD12[i] = PERM[i] % 12;
  }
})();

function simplex2D(xin: number, yin: number): number {
  let n0 = 0, n1 = 0, n2 = 0;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1.0 + 2.0 * G2;
  const y2 = y0 - 1.0 + 2.0 * G2;
  const ii = i & 255;
  const jj = j & 255;
  const gi0 = PERM_MOD12[ii + PERM[jj]];
  const gi1 = PERM_MOD12[ii + i1 + PERM[jj + j1]];
  const gi2 = PERM_MOD12[ii + 1 + PERM[jj + 1]];

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    t0 *= t0;
    n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    t1 *= t1;
    n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    t2 *= t2;
    n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2);
  }
  return 70.0 * (n0 + n1 + n2);
}

function simplex3D(xin: number, yin: number, zin: number): number {
  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);
  let i1 = 0, j1 = 0, k1 = 0, i2 = 0, j2 = 0, k2 = 0;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;
  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  const gi0 = PERM_MOD12[ii + PERM[jj + PERM[kk]]];
  const gi1 = PERM_MOD12[ii + i1 + PERM[jj + j1 + PERM[kk + k1]]];
  const gi2 = PERM_MOD12[ii + i2 + PERM[jj + j2 + PERM[kk + k2]]];
  const gi3 = PERM_MOD12[ii + 1 + PERM[jj + 1 + PERM[kk + 1]]];
  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0 + GRAD3[gi0][2] * z0); }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1 + GRAD3[gi1][2] * z1); }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2 + GRAD3[gi2][2] * z2); }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 >= 0) { t3 *= t3; n3 = t3 * t3 * (GRAD3[gi3][0] * x3 + GRAD3[gi3][1] * y3 + GRAD3[gi3][2] * z3); }
  return 32.0 * (n0 + n1 + n2 + n3);
}

export const AM_RUNTIME = {
  simplexNoise(x: number, y = 0, z?: number): number {
    if (z !== undefined) return simplex3D(x, y, z);
    return simplex2D(x, y);
  },
  triangle(x: number): number {
    const f = ((x % 1) + 1) % 1;
    if (f < 0.25) return f * 4;
    if (f < 0.75) return 2 - f * 4;
    return f * 4 - 4;
  },
  log(..._args: unknown[]): void {
    // quiet in production
  },
};

export interface EffectScriptEnv {
  time: number;
  absTime: number;
  duration: number;
  inTime: number;
  fps: number;
  frame: number;
  editMode: string;
  selected: boolean;
  velocity: { x: number; y: number };
  angularVelocity: number;
  scaleVelocity: number;
}

export interface EffectScriptElement {
  alpha: number;
  shaderGroups: number[] | null;
  text: string;
  transform: {
    location: { x: number; y: number; z: number };
    angle: number;
    scale: { x: number; y: number };
  };
}

type AnimateFn = (
  env: EffectScriptEnv,
  el: EffectScriptElement,
  params: Record<string, any>
) => EffectScriptElement | void;

type ShapeScripts = {
  getPath: ((params: Record<string, any>) => any[]) | null;
  getHandles: ((params: Record<string, any>) => Record<string, [number, number]>) | null;
};

const effectFnCache = new Map<string, AnimateFn | null>();
const shapeFnCache = new Map<string, ShapeScripts>();

export function runEffectScript(
  effect: EffectDef,
  env: EffectScriptEnv,
  el: EffectScriptElement,
  rawParams: Record<string, any>
): EffectScriptElement {
  if (!effect.script) return el;
  let fn = effectFnCache.get(effect.id);
  if (fn === undefined) {
    try {
      const factory = new Function(
        'AM',
        `${effect.script}\nreturn typeof animate === "function" ? animate : null;`
      );
      fn = (factory(AM_RUNTIME) as AnimateFn | null) ?? null;
    } catch {
      fn = null;
    }
    effectFnCache.set(effect.id, fn);
  }
  if (!fn) return el;

  // Convert [x,y] point params to {x, y} objects for scripts that read p.param.x
  const pObj: Record<string, any> = {};
  for (const pd of effect.params) {
    if (!pd.id) continue;
    const val = rawParams[pd.id];
    if (pd.tag === 'point' && Array.isArray(val)) {
      pObj[pd.id] = { x: val[0] ?? 0, y: val[1] ?? 0 };
    } else if ((pd.tag === 'xyz' || pd.tag === 'hue-disc') && Array.isArray(val)) {
      pObj[pd.id] = { x: val[0] ?? 0, y: val[1] ?? 0, z: val[2] ?? 0 };
    } else {
      pObj[pd.id] = val;
    }
  }

  try {
    const res = fn(env, el, pObj);
    return (res as EffectScriptElement) || el;
  } catch {
    return el;
  }
}

function wrapShapeParams(shape: ShapeDef, rawParams: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const pd of shape.params) {
    if (!pd.id) continue;
    const val = rawParams[pd.id];
    if (pd.tag === 'point') {
      if (Array.isArray(val)) out[pd.id] = { x: val[0] ?? 100, y: val[1] ?? 100 };
      else if (val && typeof val === 'object') out[pd.id] = val;
      else out[pd.id] = { x: 100, y: 100 };
    } else {
      out[pd.id] = val;
    }
  }
  return out;
}

export function getShapeCompiled(shape: ShapeDef): ShapeScripts {
  let cached = shapeFnCache.get(shape.id);
  if (!cached) {
    try {
      const factory = new Function(
        'AM',
        `${shape.script}\nreturn { getPath: typeof getPath === "function" ? getPath : null, getHandles: typeof getHandles === "function" ? getHandles : null };`
      );
      cached = factory(AM_RUNTIME) as ShapeScripts;
    } catch {
      cached = { getPath: null, getHandles: null };
    }
    shapeFnCache.set(shape.id, cached);
  }
  return cached;
}

export function evaluateShapePath(shape: ShapeDef, rawParams: Record<string, any>): any[] {
  const compiled = getShapeCompiled(shape);
  if (!compiled.getPath) return [];
  try {
    return compiled.getPath(wrapShapeParams(shape, rawParams)) || [];
  } catch {
    return [];
  }
}

export function evaluateShapeHandles(
  shape: ShapeDef,
  rawParams: Record<string, any>
): Record<string, [number, number]> {
  const compiled = getShapeCompiled(shape);
  if (!compiled.getHandles) return {};
  try {
    return compiled.getHandles(wrapShapeParams(shape, rawParams)) || {};
  } catch {
    return {};
  }
}
