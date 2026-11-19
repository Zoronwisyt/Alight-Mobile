import type { Animatable, EasingSpec, Keyframe, Layer } from '../types/project';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Exact cubic-bezier(x1, y1, x2, y2) solver matching Alight Motion's easing curve format.
 * Uses Newton-Raphson iteration with bisection fallback for non-monotonic or steep curves.
 */
export function solveCubicBezier(u: number, x1: number, y1: number, x2: number, y2: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (x1 === y1 && x2 === y2) return u;

  const sampleX = (t: number) => ((1 - 3 * x2 + 3 * x1) * t * t * t + (3 * x2 - 6 * x1) * t * t + 3 * x1 * t);
  const sampleDX = (t: number) => (3 * (1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + 3 * x1);
  const sampleY = (t: number) => ((1 - 3 * y2 + 3 * y1) * t * t * t + (3 * y2 - 6 * y1) * t * t + 3 * y1 * t);

  let t = u;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - u;
    if (t >= 0 && t <= 1 && Math.abs(err) < 1e-6) return sampleY(t);
    const dx = sampleDX(t);
    if (Math.abs(dx) < 1e-6) break;
    t -= err / dx;
    if (t < 0 || t > 1) break;
  }

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    t = 0.5 * (lo + hi);
    const x = sampleX(t);
    if (Math.abs(x - u) < 1e-6) break;
    if (u > x) lo = t;
    else hi = t;
  }
  return sampleY(t);
}

export function evalEasing(u: number, easing?: EasingSpec): number {
  const t = clamp01(u);
  if (!easing || easing.type === 'linear') return t;

  switch (easing.type) {
    case 'cubicBezier':
      return solveCubicBezier(t, easing.x1, easing.y1, easing.x2, easing.y2);
    case 'steps': {
      const steps = Math.max(1, Math.round(easing.steps ?? 4));
      return Math.floor(t * steps) / steps;
    }
    case 'step': {
      const stepLen = Math.max(1e-4, easing.params?.[0] ?? 0.25);
      return Math.min(1, Math.floor(t / stepLen) * stepLen);
    }
    case 'elasticStep': {
      const stepLen = Math.max(1e-4, easing.params?.[0] ?? 0.25);
      const base = Math.floor(t / stepLen) * stepLen;
      const local = (t - base) / stepLen;
      const overshoot = local === 0 || local === 1 ? local : Math.pow(2, -8 * local) * Math.sin((local * 8 - 0.75) * ((2 * Math.PI) / 3)) + 1;
      return base + stepLen * overshoot;
    }
    case 'cyclic': {
      // AM CyclicEasing: params[0] is stepLength (normalized period in [0, 1])
      const stepLen = Math.max(1e-4, easing.params?.[0] ?? 0.25);
      const phase = easing.params?.[1] ?? 0;
      const cycles = t / stepLen + phase;
      return 0.5 - 0.5 * Math.cos(cycles * Math.PI * 2);
    }
    case 'random': {
      const freq = Math.max(1, easing.params?.[0] ?? 8);
      const idx = Math.floor(t * freq);
      const h = Math.sin(idx * 127.1 + 311.7) * 43758.5453;
      return h - Math.floor(h);
    }
    case 'overshoot': {
      const tension = 1.5 + Math.abs(easing.y1) * 2.0;
      const s = t - 1;
      return s * s * ((tension + 1) * s + tension) + 1;
    }
    case 'bounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) {
        const x = t - 1.5 / d1;
        return n1 * x * x + 0.75;
      }
      if (t < 2.5 / d1) {
        const x = t - 2.25 / d1;
        return n1 * x * x + 0.9375;
      }
      const x = t - 2.625 / d1;
      return n1 * x * x + 0.984375;
    }
    case 'elastic': {
      if (t === 0 || t === 1) return t;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    default:
      return t;
  }
}

export function parseColorArgb(hex: string): [number, number, number, number] {
  if (!hex || hex === 'transparent') return [0, 0, 0, 0];
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return [r, g, b, 1];
  }
  if (h.length === 8) {
    const a = parseInt(h.slice(0, 2), 16) / 255;
    const r = parseInt(h.slice(2, 4), 16) / 255;
    const g = parseInt(h.slice(4, 6), 16) / 255;
    const b = parseInt(h.slice(6, 8), 16) / 255;
    return [r, g, b, a];
  }
  return [1, 1, 1, 1];
}

export function rgbaToArgbHex(r: number, g: number, b: number, a: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${c(a)}${c(r)}${c(g)}${c(b)}`;
}

export function argbHexToCss(hex: string): string {
  const [r, g, b, a] = parseColorArgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a.toFixed(3)})`;
}

export function slerpQuat(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
): [number, number, number, number] {
  let ax = a[0], ay = a[1], az = a[2], aw = a[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];

  const aLen = Math.hypot(ax, ay, az, aw);
  if (aLen > 1e-8) { ax /= aLen; ay /= aLen; az /= aLen; aw /= aLen; }
  const bLen = Math.hypot(bx, by, bz, bw);
  if (bLen > 1e-8) { bx /= bLen; by /= bLen; bz /= bLen; bw /= bLen; }

  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }

  let rx: number, ry: number, rz: number, rw: number;
  if (dot > 0.9995) {
    rx = ax + (bx - ax) * t;
    ry = ay + (by - ay) * t;
    rz = az + (bz - az) * t;
    rw = aw + (bw - aw) * t;
  } else {
    const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
    const sinTheta0 = Math.sin(theta0);
    const theta = theta0 * t;
    const sinTheta = Math.sin(theta);
    const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
    const s1 = sinTheta / sinTheta0;
    rx = s0 * ax + s1 * bx;
    ry = s0 * ay + s1 * by;
    rz = s0 * az + s1 * bz;
    rw = s0 * aw + s1 * bw;
  }

  const rLen = Math.hypot(rx, ry, rz, rw) || 1;
  return [rx / rLen, ry / rLen, rz / rLen, rw / rLen];
}

export function interpolateValue<T>(a: T, b: T, alpha: number): T {
  if (typeof a === 'number' && typeof b === 'number') {
    return (a + (b - a) * alpha) as unknown as T;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (
      a.length === 4 &&
      b.length === 4 &&
      typeof a[0] === 'number' &&
      typeof b[0] === 'number'
    ) {
      return slerpQuat(
        a as unknown as [number, number, number, number],
        b as unknown as [number, number, number, number],
        alpha
      ) as unknown as T;
    }
    return a.map((v, i) => (typeof v === 'number' && typeof b[i] === 'number' ? v + (b[i] - v) * alpha : v)) as unknown as T;
  }
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('#') && b.startsWith('#')) {
    const [r1, g1, b1, a1] = parseColorArgb(a);
    const [r2, g2, b2, a2] = parseColorArgb(b);
    return rgbaToArgbHex(
      lerp(r1, r2, alpha),
      lerp(g1, g2, alpha),
      lerp(b1, b2, alpha),
      lerp(a1, a2, alpha)
    ) as unknown as T;
  }
  return (alpha < 0.5 ? a : b);
}

/**
 * Integrates a rate parameter (e.g. type="hz" cycles/sec or type="rpm" * 6 deg/sec)
 * over [0, normT * durSec] to match Alight Motion's native integrated frequency/RPM channels.
 */
export function integrateAnimatable(
  prop: Animatable<number> | undefined,
  normT: number,
  durSec: number,
  fallback = 0,
  scaleFactor = 1
): number {
  const t = clamp01(normT);
  if (t <= 0 || durSec <= 0) return 0;
  const elapsedSec = durSec * t;
  if (!prop || !prop.keyframes || prop.keyframes.length <= 1) {
    const v = prop?.keyframes?.length === 1 ? Number(prop.keyframes[0].v) : Number(prop?.value ?? fallback);
    return (Number.isFinite(v) ? v : fallback) * scaleFactor * elapsedSec;
  }
  // Matches Alight Motion APK UserParameterKt->valueAtTimeAccum (120 steps/sec discrete accumulator)
  const STEPS_PER_SEC = 120;
  const totalSteps = Math.round(durSec * STEPS_PER_SEC);
  const curSteps = Math.round(elapsedSec * STEPS_PER_SEC);
  if (curSteps <= 0 || totalSteps <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < curSteps; i++) {
    const u = i / totalSteps;
    const v = Number(evalAnimatable(prop, u, fallback));
    sum += ((Number.isFinite(v) ? v : fallback) * scaleFactor) / STEPS_PER_SEC;
  }
  return sum;
}

export function evalAnimatable<T>(prop: Animatable<T> | undefined, normT: number, fallback?: T): T {
  if (!prop) return fallback as T;
  const kfs = prop.keyframes;
  if (!kfs || kfs.length === 0) return prop.value;
  if (kfs.length === 1) return kfs[0].v;

  const sorted = kfs.length > 1 ? kfs : kfs;
  if (normT <= sorted[0].t) return sorted[0].v;
  const last = sorted[sorted.length - 1];
  if (normT >= last.t) return last.v;

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];
    if (normT >= k0.t && normT <= k1.t) {
      const span = k1.t - k0.t;
      if (span <= 1e-7) return k1.v;
      const rawU = (normT - k0.t) / span;
      // APK KeyableKt->valueAtTime reads easing strictly from k1 (segment end keyframe)
      const easing = k1.easing;
      const e = evalEasing(rawU, easing);
      return interpolateValue(k0.v, k1.v, e);
    }
  }
  return last.v;
}

export function animatable<T>(value: T, keyframes: Keyframe<T>[] = []): Animatable<T> {
  return { value, keyframes };
}

/**
 * Computes layer normalized time t in [0, 1], applying Speed / Time Remapping and Time Quantization.
 */
export function evalRemappedTime(layer: Layer, sceneTimeMs: number): {
  localTimeMs: number;
  normT: number;
  remappedNormT: number;
} {
  const dur = Math.max(1, layer.endTime - layer.startTime);
  const localTimeMs = sceneTimeMs - layer.startTime;
  const normT = clamp01(localTimeMs / dur);

  let remappedNormT = normT;
  const speedProp = layer.speed;
  if (speedProp && (speedProp.keyframes.length > 0 || Math.abs(speedProp.value - 1) > 1e-4)) {
    // Numerical integration of speed(u) over [0, normT] normalized so speed=1 maps 0..1
    const samples = 24;
    let sum = 0;
    const dt = normT / samples;
    for (let i = 0; i < samples; i++) {
      const u = (i + 0.5) * dt;
      sum += Math.max(0.01, evalAnimatable(speedProp, u, 1));
    }
    remappedNormT = clamp01(sum * dt);
  }

  // Time Quantization effect if present
  const tq = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.timequant');
  if (tq) {
    const stepsPerSec = Math.max(1, Number(evalAnimatable(tq.params.stepsPerSecond, remappedNormT, 5)) || 5);
    const sec = (remappedNormT * dur) / 1000;
    const quantSec = Math.floor(sec * stepsPerSec) / stepsPerSec;
    remappedNormT = clamp01((quantSec * 1000) / dur);
  }

  return { localTimeMs, normT, remappedNormT };
}

export function evalLayerVelocities(
  layer: Layer,
  sceneTimeMs: number,
  fps: number
): {
  velocity: [number, number];
  angularVelocity: number;
  scaleVelocity: number;
} {
  const dur = Math.max(1, layer.endTime - layer.startTime);
  const dtMs = 1000 / Math.max(1, fps);
  const t0 = clamp01((sceneTimeMs - dtMs * 0.5 - layer.startTime) / dur);
  const t1 = clamp01((sceneTimeMs + dtMs * 0.5 - layer.startTime) / dur);
  const spanSec = Math.max(1e-4, ((t1 - t0) * dur) / 1000);

  const p0 = evalAnimatable(layer.transform.location, t0, [0, 0, 0]);
  const p1 = evalAnimatable(layer.transform.location, t1, [0, 0, 0]);
  const r0 = evalAnimatable(layer.transform.rotation, t0, 0);
  const r1 = evalAnimatable(layer.transform.rotation, t1, 0);
  const s0 = evalAnimatable(layer.transform.scale, t0, [1, 1]);
  const s1 = evalAnimatable(layer.transform.scale, t1, [1, 1]);

  return {
    velocity: [(p1[0] - p0[0]) / spanSec, (p1[1] - p0[1]) / spanSec],
    angularVelocity: (r1 - r0) / spanSec,
    scaleVelocity: Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) / spanSec,
  };
}

const EASING_ARITY: Record<string, number | null> = {
  linear: 0,
  cubicBezier: 4,
  cyclic: 5,
  bounce: null,
  elastic: null,
  step: null,
  elasticStep: null,
  random: null,
};

function parseFiniteNum(s: string | undefined): number | null {
  if (s === undefined) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function parseEasingString(eStr?: string): EasingSpec | undefined {
  if (!eStr) return undefined;
  const parts = eStr.trim().split(/\s+/);
  const token = parts[0];
  if (!token) return undefined;

  if (!(token in EASING_ARITY)) {
    console.warn(`[easing] unrecognized token "${token}" in "${eStr}" — held verbatim, rendered linear`);
    const tail = parts.slice(1).map(parseFiniteNum).filter((n): n is number => n !== null);
    return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token, params: tail, approximated: true };
  }

  if (token === 'linear') {
    return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token };
  }

  const params = parts.slice(1).map(parseFiniteNum).filter((n): n is number => n !== null);

  if (token === 'cubicBezier') {
    if (params.length < 4) {
      console.warn(`[easing] malformed cubicBezier "${eStr}" — rendered linear`);
      return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token, params, approximated: true };
    }
    // Never use `|| 1` here — 0.0 is a legal and common control point for x2/y2.
    const [x1, y1, x2, y2] = params;
    return { type: 'cubicBezier', x1, y1, x2, y2, token };
  }

  const arity = EASING_ARITY[token];
  if (arity !== null && params.length < arity) {
    console.warn(`[easing] "${token}" expected ${arity} params, got ${params.length} — rendered linear`);
    return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token, params, approximated: true };
  }

  return {
    type: token as EasingSpec['type'],
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    token,
    params,
    approximated: true,
  };
}
