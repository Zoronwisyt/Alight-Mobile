# GRAPH / EASING AUDIT — why imported shakes look wrong

**Scope:** the user reports that after importing an Alight Motion share link, *"some shakes are off."*
This document decides whether that comes from **(A) the easing graph**, **(B) the effect script math**,
or **(C) the share-link import path** — and gives the fix list with file:line anchors.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Reference APK | `C:\Users\jeduc\Downloads\AM Web 2\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Reference project | `CONQ SHAKE PACK #2`, authored on **6.2.36 (823)** — the user's share link |
| Companions | `ENGINE_PARITY.md`, `COMPAT_EFFECTS.md`, `PRODUCT_SPEC.md` |
| Date | 2026-11-19 |
| Verdict | **All three.** One import bug (largest effect), two easing-parser bugs, and an unverified script runtime. |

---

## 1. TL;DR — ranked, with confidence

| # | Finding | Where | Confidence | Blast radius on this pack |
| --- | --- | --- | --- | --- |
| **1** | `hidden="true"` is interpreted as **disabled** on import. It is not. AM uses it as a UI-collapse flag. | `amXmlCodec.ts:331` | **High** (evidence §5.1) | **79 of 101** hidden effect instances are keyframed — the whole shake stack is switched off |
| **2** | `parseEasingString` rewrites `x2`/`y2` to `1` when the real value is `0` (`parseFloat(...) \|\| 1`) | `animation.ts:333–334` | **Certain** | **25 keyframes** in this pack get the wrong curve |
| **3** | The easing vocabulary is 2 of 8 tokens. `cyclic`, `bounce`, `elastic`, `step`, `elasticStep`, `random` all parse to `undefined` → **silent linear** | `animation.ts:325–341` | **Certain** | 1 `cyclic` keyframe here, but any pack using the advanced easings goes flat |
| **4** | `AM_RUNTIME.triangle` / `AM.simplexNoise` are re-implementations with assumed constants; nothing pins them to the APK | `scriptRuntime.ts:122–136` | **Unverified** | Affects every wave-based shake — needs a probe, not a rewrite |
| **5** | `env.frame` is absolute scene frames; `env.time` is remapped layer time. Both plausible, neither proven | `renderer.ts:1060–1066` | **Unverified** | Phase offset on `shake` (uses `env.frame`) |

**What is *not* wrong** — do not "fix" these:

- Easing is read from the **segment-end keyframe** (`k1`). In this project **205 of 350** animated properties carry `e` on their last keyframe and only **3** on their first. The web's rule at `animation.ts:245–247` matches the data. Correct.
- `hz` / `rpm` parameter integration (`renderer.ts:1647–1650`) is present and is the reason `oscillate2/3` and `swing2` move at all — those scripts have no `env.time` term and depend on the host integrating the frequency.
- The share link itself resolves. See §6.

---

## 2. Evidence base (reproducible)

Everything below was measured, not assumed. The reference project was pulled from the user's share
link **without a token** — the Firebase object is public:

```powershell
# 1. project package (verified: HTTP 200, 1,947,809 bytes)
Invoke-WebRequest -OutFile $env:TEMP\conq.zip `
  "https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/share%2Fu%2FAg3FCK1BrMRkaE14LL4cPt6maoD3%2Fp%2FFRhSbZBAdz-ad1daa59dc2cf040%2Fprojectfiles.zip?alt=media"

# 2. unzip -> projectfiles.zip contains:
#    <ID>.xml (158,370 bytes) + <ID>_1.png + manifest.txt
```

Scene header as authored by AM 6.2.36:

```xml
<scene title="CONQ SHAKE PACK #2" width="1440" height="1800"
       exportWidth="1440" exportHeight="1800" bgcolor="#FF000000"
       totalTime="11066" fps="60" modifiedTime="1758155118535"
       amver="823" ffver="107" am="com.alightcreative.motion/6.2.36"
       amplatform="ios" precompose="dynamicResolution" retime="freeze">
```

Measured facts:

| Metric | Value |
| --- | --- |
| Layers | 16 (`shape` + `text` pairs) |
| Effect instances | **387**, of **40** distinct effects |
| `oscillate3` / `oscillate2` / `oscillate` | 25 / 9 / 8 |
| `swing2` | 19 |
| `shake` / `shake2` | 18 / 10 |
| `fractalwarp4` / `exposure` / `tile` / `wavewarp2` / `motionblur3` / `motionblur4` | 37 / 41 / 21 / 18 / 24 / 18 |
| Animated `<property>` groups | **350** |
| Keyframes inside properties | **781** |
| Keyframes carrying `e` | **244** |
| Easing tokens used | `cubicBezier` ×243, `cyclic` ×1 |
| Keyframes with `t > 1` | **194** (max `47.122467`) |
| Keyframes with `t < 0` | **3** (min `-0.069199`) |
| Effects with `hidden="true"` | **101** of 387 |
| …of those, keyframed | **79** |
| `enabled` attribute in file | **0 occurrences** |

Reproduce:

```python
import xml.etree.ElementTree as ET, collections
p = r"...\E79A3DE6-36DA-4E7E-B7A8-95F406AB5A91.xml"
root = ET.parse(p).getroot()
print(collections.Counter(e.attrib["id"] for e in root.iter("effect")).most_common(10))
print("hidden:", sum(1 for e in root.iter("effect") if e.attrib.get("hidden") == "true"))
print("enabled attr:", sum(1 for e in root.iter("effect") if "enabled" in e.attrib))
print("e tokens:", collections.Counter(k.attrib["e"].split()[0] for k in root.iter("kf") if "e" in k.attrib))
print("t range:", min(float(k.attrib["t"]) for k in root.iter("kf")),
                max(float(k.attrib["t"]) for k in root.iter("kf")))
```

---

## 3. The easing vocabulary — APK truth vs web parser

### 3.1 What the APK actually has

Extracted from the **5.0.280** dex string pools (so this is the target build, not a newer one).
`classes6.dex` @ `2051951` contains the token table; class constructors carry the field names:

| Token (as serialized) | Class | Field names from ctor `toString` | Arity |
| --- | --- | --- | --- |
| `linear` | `LinearEasing` | — | 0 |
| `cubicBezier ` | `CubicBezierEasing` | `p1x`, `p1y`, `p2x`, `p2y` | **4** (confirmed from a real file) |
| `cyclic` | `CyclicEasing` | `stepLength`, … | **5** (confirmed from a real file) |
| `bounce` | `BounceEasing` | `firstStepLength`, … | unknown |
| `elastic` | `ElasticEasing` | `stepLength`, … | unknown |
| `step` | `StepEasing` | `stepLength`, … | unknown |
| `elasticStep` | `ElasticStepEasing` | `stepLength`, … | unknown |
| `random` | `RandomEasing` | `frequency`, … | unknown |

Package: `com.alightcreative.app.motion.easing.*`. Class list confirmed in the 5.0.280 descriptor pool:
`Easing`, `EasingKt`, `EasingHandle`, `HandleStyle`, `LinearEasing`, `CubicBezierEasing`,
`CyclicEasing`, `BounceEasing`, `ElasticEasing`, `ElasticStepEasing`, `StepEasing`, `RandomEasing`.

Two of these appear verbatim in the user's project:

```
cubicBezier 0.42 0.0 0.58 1.0          <- 243 keyframes
cyclic 0.028997868 0.0 0.5 0.0 0.0    <- 1 keyframe
```

Note the **trailing space** in the dex token table (`"cubicBezier "`, `"elasticStep "`) — the
serializer is `token + " " + numbers`. That is exactly the format the web already expects for
`cubicBezier`. No comma, no parentheses.

### 3.2 What the web parser understands

```ts
// src/engine/animation.ts:325-341
export function parseEasingString(eStr?: string): EasingSpec | undefined {
  if (!eStr) return undefined;
  const parts = eStr.trim().split(/\s+/);
  if (parts[0] === 'cubicBezier' && parts.length >= 5) { ... }
  if (parts[0] === 'linear') { ... }
  return undefined;              // <- everything else
}
```

`undefined` is not an error — `evalEasing` treats it as **linear**:

```ts
// animation.ts:46-48
export function evalEasing(u: number, easing?: EasingSpec): number {
  const t = clamp01(u);
  if (!easing || easing.type === 'linear') return t;
```

So six of the eight APK easing types degrade to a straight line, with no warning, no log, no badge.
**That is the "graph looks different" symptom** in its purest form.

### 3.3 Fix — token-driven parser, fail loud

Extend the type (`src/types/project.ts:1–10`):

```ts
export type EasingType =
  | 'linear' | 'cubicBezier'
  | 'bounce' | 'elastic' | 'cyclic' | 'random' | 'step' | 'elasticStep';

export interface EasingSpec {
  type: EasingType;
  x1: number; y1: number; x2: number; y2: number;
  /** Raw numeric tail as written by AM, in order. Preserved verbatim. */
  params?: number[];
  /** Token as it appeared in the file, for diagnostics and lossless export. */
  token?: string;
  /** True when the token is known but its math is not yet implemented. */
  approximated?: boolean;
}
```

Replace the parser. **No `||` fallbacks on numbers — `0` is a legal control point.**

```ts
// src/engine/animation.ts
const EASING_ARITY: Record<string, number | null> = {
  linear: 0,
  cubicBezier: 4,
  cyclic: 5,          // confirmed against a real 6.2.36 export
  bounce: null,       // arity not yet proven -> keep the tail, do not guess
  elastic: null,
  step: null,
  elasticStep: null,
  random: null,
};

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

export function parseEasingString(eStr?: string): EasingSpec | undefined {
  if (!eStr) return undefined;
  const parts = eStr.trim().split(/\s+/);
  const token = parts[0];
  if (!(token in EASING_ARITY)) {
    // Unknown token: keep it verbatim so export is lossless, and say so.
    console.warn(`[easing] unrecognized token "${token}" in "${eStr}" — held verbatim, rendered linear`);
    return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token, params: [], approximated: true };
  }
  if (token === 'linear') return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token };

  const tail = parts.slice(1).map(num);
  const params = tail.filter((n): n is number => n !== null);

  if (token === 'cubicBezier') {
    if (params.length < 4) {
      console.warn(`[easing] malformed cubicBezier "${eStr}" — rendered linear`);
      return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token, params, approximated: true };
    }
    const [x1, y1, x2, y2] = params;
    return { type: 'cubicBezier', x1, y1, x2, y2, token };
  }

  const arity = EASING_ARITY[token];
  if (arity !== null && params.length < arity) {
    console.warn(`[easing] "${token}" expected ${arity} params, got ${params.length} — rendered linear`);
    return { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, token, params, approximated: true };
  }
  // Known token, math pending (see §3.4). Never silent.
  return { type: token as EasingSpec['type'], x1: 0, y1: 0, x2: 1, y2: 1, token, params, approximated: true };
}
```

`evalEasing` must then be explicit about the pending types instead of `default: return t`:

```ts
case 'bounce': case 'elastic': case 'cyclic': case 'random': case 'step': case 'elasticStep': {
  // TODO(graph): implement from APK semantics (see §3.4). Until then this is
  // visible in the UI as "approximated", never silently linear.
  if (import.meta.env.DEV) {
    console.warn(`[easing] ${easing.type} not implemented — rendering linear`);
  }
  return t;
}
```

### 3.4 How to nail the remaining math (do not guess)

The arities are recoverable without reverse engineering the whole VM:

1. Build a 2-keyframe project in AM 6.2.36 (or 5.0.280) for a single `location.x` channel:
   `t=0 v=0`, `t=1 v=100`, easing set to each advanced type at **three** different parameter values.
2. Export the XML. The number of values after the token **is** the arity; the parameter that moves
   when you drag the slider **is** that field.
3. Sample the exported render at 21 frames, read `x(t)`, and fit. That gives the curve shape, the
   period convention (`stepLength` is a *length in normalized time*, not a count), and the phase.

Record the fitted formula next to the implementation, naming the capture it came from.

---

## 4. The `x2` / `y2` corruption — proven, 25 keyframes

```ts
// src/engine/animation.ts:328-335
return {
  type: 'cubicBezier',
  x1: parseFloat(parts[1]) || 0,
  y1: parseFloat(parts[2]) || 0,
  x2: parseFloat(parts[3]) || 1,   // <-- 0 becomes 1
  y2: parseFloat(parts[4]) || 1,   // <-- 0 becomes 1
};
```

`0` is falsy, so a perfectly legal control point of `0` is replaced with `1`. In this one project:

| Written by AM | Parsed by web | Effect on the curve |
| --- | --- | --- |
| `cubicBezier 0.0 1.0 0.0 1.0` ×11 | `(0, 1, 1, 1)` | fast-out curve becomes a near-linear glide |
| `cubicBezier 0.28691405 0.0 1.0 0.0` ×5 | `(0.287, 0, 1, 1)` | hard snap-out becomes smooth ease-out |
| `cubicBezier 0.80136716 0.0 1.0 0.0` ×4 | `(0.801, 0, 1, 1)` | same |
| `cubicBezier 0.42000002 0.0 1.0 0.0` ×2 | `(0.42, 0, 1, 1)` | same |
| `cubicBezier 0.0 0.73157895 0.0 1.0` ×1 | `(0, 0.732, 1, 1)` | same |
| `cubicBezier 0.30525407 0.0 1.0 0.0` ×1 | `(0.305, 0, 1, 1)` | same |
| `cubicBezier 0.42 0.0 1.0 0.0` ×1 | `(0.42, 0, 1, 1)` | same |
| **total** | **25 keyframes** | |

Why it hits shakes specifically: `oscillate2/3` and `swing2` compute
`m = sin((freq*2 + phase*2) * π)`. The frequency is **integrated** (`renderer.ts:1647`), so `freq`
is literally accumulated phase. A curve that reaches the target sooner or later changes *when* the
sine crosses zero, and the whole shake lands early or late. Easing error is amplified by `2π`, not
damped by it.

`cubicBezier 0.0 1.0 0.0 1.0` is genuinely steep — `x(t) = t³`, `y(t) = 1 - (1-t)³` — not degenerate.
It must survive parsing intact.

**Fix:** covered by §3.3 (`Number(...)` + `Number.isFinite`, never `||`).

**Regression test (exact):**

```ts
expect(parseEasingString('cubicBezier 0.0 1.0 0.0 1.0'))
  .toMatchObject({ type: 'cubicBezier', x1: 0, y1: 1, x2: 0, y2: 1 });
expect(parseEasingString('cubicBezier 0.28691405 0.0 1.0 0.0'))
  .toMatchObject({ y2: 0 });
```

---

## 5. Import path — what actually breaks the shakes

### 5.1 P0 — `hidden="true"` is not "disabled"

```ts
// src/engine/amXmlCodec.ts:331
enabled: effEl.getAttribute('enabled') !== 'false' && effEl.getAttribute('hidden') !== 'true',
```

Two problems:

1. **`enabled` does not exist in AM's format.** The user's project has **0** occurrences of an
   `enabled` attribute on 387 effect elements. Neither do the APK's own presets.
2. **`hidden="true"` does not mean disabled.** The APK ships an official preset whose wipe effect is
   `hidden="true"` *and* keyframed — it has to run for the preset to do anything:

   ```xml
   <!-- assets/effects/presets/v3-matte-mask-key-presets.xml:76 (5.0.280 APK) -->
   <effect id="com.alightcreative.effects.wipe" hidden="true" locallyApplied="true">
     <property name="end" type="float">
       <kf t="0.017509" v="0.500000"/>
   ```

   `hidden` is the **collapsed-in-the-effect-list** flag. It is UI state, not render state.

**Consequence in this pack:** 101 of 387 instances are `hidden="true"`; **79 of those carry
keyframes**. Dropped instances by effect:

| Effect | hidden / total |
| --- | --- |
| `shake` | **18 / 18** |
| `textspacing` | 16 / 16 |
| `texttransform` | 16 / 16 |
| `wavewarp2` | 16 / 18 |
| `exposure` | 13 / 41 |
| `swing2` | **5 / 19** |
| `oscillate2` | **4 / 9** |
| `oscillate` | **2 / 8** |
| `gaussianblur`, `transform` | 2 / 2 each |
| `sharpen`, `rays`, `softglow`, `fractalwarp4`, `pinchbulge2`, `lensblur2`, `pinchbulge` | 1 each |

Every one of the 18 `shake` effects in a pack called *SHAKE PACK* is currently imported as
**disabled**. That is the single largest reason the motion looks wrong.

**Fix — import:**

```ts
effects.push({
  uid: `eff_${crypto.randomUUID().slice(0, 8)}`,
  effectId: eid,
  enabled: true,                                   // AM has no per-effect enable flag
  hidden: effEl.getAttribute('hidden') === 'true',  // UI collapse state, preserved
  locallyApplied: effEl.getAttribute('locallyApplied') === 'true',
  params,
});
```

Add `hidden?: boolean` to `LayerEffectInstance` (`src/types/project.ts`). The effects panel uses it to
start that row collapsed; the renderer ignores it entirely.

**Fix — export** (`amXmlCodec.ts:95–96`):

```ts
const hiddenAttr = eff.hidden ? ' hidden="true"' : '';
parts.push(`${indent}  <effect id="${escapeXml(eff.effectId)}" locallyApplied="${eff.locallyApplied ? 'true' : 'false'}"${hiddenAttr}>`);
```

Drop `enabled="…"` entirely — it is not an AM attribute and its presence makes exports non-conformant.

**Verification (settles it in one run):** in AM, apply two effects to a layer, collapse one row in the
effects list, export, diff. If the collapsed row is the one wearing `hidden="true"`, the reading above
is confirmed. If instead `hidden="true"` tracks the *bypassed* row, invert §5.1 and keep `enabled`.
**Do not ship this fix without that diff** — it flips 79 effects.

### 5.2 `locallyApplied` — read, but check it is honoured

387/387 instances carry `locallyApplied`. The importer stores it
(`amXmlCodec.ts:332`); the render path must branch on it:

- `locallyApplied="true"` → effect runs in **layer space**, before the layer's parent transform.
- `locallyApplied="false"` → effect runs in **parent/precompose space** (to be confirmed with a probe).

In this pack the split is **295 `false` / 92 `true`** — the non-local case is the *majority*, not the
exception (every `rays` is `false`). If the renderer ignores the flag, those warp in the wrong space —
and a wrong-space shake reads as "off" rather than "missing".

### 5.3 Keyframe `t` is not clamped to `[0,1]` — and that is fine

Real AM files carry `t` from **-0.069199 to 47.122467** (194 above 1.0). AM does not renormalise when
a layer is shortened; stray keyframes are simply never reached.

`evalAnimatable` (`animation.ts:234–251`) already handles this the same way AM does: clamp before the
first and after the last, interpolate inside. **No change.** Do add a dev-only diagnostic so a future
bug is visible:

```ts
if (import.meta.env.DEV && kfs.some((k) => k.t < -1 || k.t > 8)) {
  console.debug('[kf] times outside expected range — kept verbatim', layer?.id);
}
```

### 5.4 Keyframe order — web sorts, AM does not

AM writes keyframes **out of order**:

```xml
<kf t="0.633267" v="2.750000"/>
<kf t="0.300601" v="3.310000" e="cubicBezier 0.0 0.0 1.0 1.0"/>
<kf t="0.000000" v="4.810000"/>
<kf t="1.000000" v="5.020000" e="cubicBezier 0.0 1.0 0.17812502 1.0"/>
```

`parsePropElement` sorts by `t` (`amXmlCodec.ts:166`) — correct and required. **No change.**

### 5.5 Effect parameter defaults are seeded, then overwritten

`amXmlCodec.ts:304–323` seeds every declared param from the effect definition, then
`parseDirectProperties` overwrites the ones present in the file (`:324–327`). Correct — a missing
parameter keeps AM's default rather than `0`. Keep.

---

## 6. The share link — it is not the cause

The user's hypothesis ("maybe importing the link causes it") is answered directly:

| Check | Result |
| --- | --- |
| `parseAlightShareUrl` matches `…/am/share/u/{uid}/p/{pid}` | ✅ (`amLinkImporter.ts:85`) |
| Firebase object reachable **without a token** | ✅ HTTP 200, `1,947,809` bytes |
| Package layout | `projectfiles.zip` → `<ID>.xml` + media + `manifest.txt` |
| XML parses | ✅ 158,370 bytes, 16 layers, 387 effects |
| Scene `width`/`height` present | ✅ 1440×1800, plus `exportWidth`/`exportHeight` |
| Effect scripts differ between 5.0.280 and 6.2.36 | ❌ none — all 12 shake-family scripts are byte-identical |

So the link resolves, the file is well-formed, and the size is declared. **The link is not the bug.**
The defects are all downstream of a successful fetch, in parsing (§3, §4, §5.1).

One genuine version-skew item to note, not fix: the project is authored on **6.2.36 (823)** while the
web targets **5.0.280**. New-looking scene attributes are ignored by the importer —
`ffver="107"`, `amver="823"`, `precompose="dynamicResolution"`, `retime="freeze"`. `retime="freeze"`
in particular may change how speed/keyframe remap behaves; log it as an unknown rather than guessing.

---

## 7. Script animation math — what is confirmed, what is not

### 7.1 `env` contract

Web (`renderer.ts:1060–1072`) exposes the same field set the APK's dex string pool contains
(`absTime`, `inTime`, `editMode`, `angularVelocity`, `scaleVelocity` all present in the 5.0.280
classes):

```ts
time: remappedNormT,                   // 0..1 after speed/retime remap
absTime: sceneTimeMs / 1000,
duration: (layer.endTime - layer.startTime) / 1000,
inTime: layer.startTime / 1000,
fps,
frame: Math.floor((sceneTimeMs / 1000) * fps),
velocity, angularVelocity, scaleVelocity,
```

Consistency checks against the scripts:

| Script | Formula | Requires | Web supplies |
| --- | --- | --- | --- |
| `oscillate` | `sin(t * env.duration * freq * π)` | `time` normalized 0..1, `duration` in **seconds** | ✅ `665 ms → 0.665` |
| `shake` | `absTimeSeconds = env.frame / env.fps` | `frame` and `fps` in the same unit | ✅ |
| `shake2` | same | same | ✅ |
| `oscillate2/3`, `swing2` | no `env.time` term at all | host **integrates** `type="hz"` | ✅ `integrateAnimatable`, 120 steps/s |

**Note on layer times:** this project's `startTime`/`endTime` are **milliseconds** (max 11,066 vs
`totalTime="11066"`). The web already parses them as ms. No bug — but state it, because it is the
first thing anyone will suspect.

### 7.2 `env.frame` — unverified, and it matters

`shake` and `shake2` derive their whole evolution from `env.frame`. Two readings:

- **absolute scene frame** (what the web does) → the shake is one continuous noise field across the
  timeline; layers share phase.
- **layer-local frame** → every layer restarts the shake at its own `startTime`.

In a 16-layer pack where layers start at 0, 650, 1333, 2083 ms …, these look completely different:
continuous vs stuttering. **Probe it**: two layers starting 1 s apart, both with `shake`, same params,
one seeded by location. Compare at 1.0 s on the APK. If the noise values match the web's absolute
reading, done; if not, switch `frame` to `floor((sceneTimeMs - layer.startTime)/1000*fps)` and re-check
`absTime` too.

### 7.3 `AM_RUNTIME.triangle` — assumption, not evidence

```ts
// src/engine/scriptRuntime.ts:127-132
triangle(x) {
  const f = ((x % 1) + 1) % 1;
  if (f < 0.25) return f * 4;
  if (f < 0.75) return 2 - f * 4;
  return f * 4 - 4;
}
```

This is period **1**, range **±1**, zero at `x = 0`, peak at `0.25`. The **period** is forced by the
callers and is correct:

```
sine path:     sin(t*dur*freq*π)          -> period 2 in u
triangle path: AM.triangle(t*dur*freq/2)  -> u/2 has period 1 *if* triangle has period 1  ✔
swing's (m+1)/2 normalisation             -> range must be ±1                              ✔
```

The **phase** is an assumption. If AM's triangle starts at its peak (`m(0) = ±1`) instead of zero,
every triangle-wave shake starts at a different point in its cycle, and the motion reads as "off"
while still being the right speed and amplitude. Probe with a triangle `swing` at `t=0` and compare
the first frame's angle to `(a1 + a2)/2` (zero-phase reading) vs `a1` or `a2`.

### 7.4 `AM.simplexNoise` — assumption, not evidence

`scriptRuntime.ts:37–120` is the standard Gustavson 2D/3D simplex with its canonical permutation table
and the usual `70.0` / `32.0` scalings. AM's runtime is native (Kotlin/Swift), exposed to the script
VM — the noise field is *its* implementation, not a published reference.

Mismatch here does not break the shake, it **changes it**: same magnitude, same speed, different
shape per frame. That is precisely "some shakes are off."

Probe, don't rewrite:

1. One layer, `shake`, `mag=100`, `slack=1`, `speed=0`, `evolution=0`, `seed=0`, `angle=0`, at a
   location of `(0,0)`.
2. Sample `location.x` at 21 frames on the APK.
3. Compare against `AM.simplexNoise(0, 0, k)` for the same frames on the web.

If the sequences match → keep the implementation, delete the doubt from the doc. If they do not,
the cheapest correct fix is to fit the APK samples and only then touch the constant or the hash.

### 7.5 Effect-chaining is sequential and mutating — correct by design

`renderer.ts:1074–1097` runs auto-transform scripts in list order, feeding each effect the output of
the previous one. This is what makes `18 × shake + 10 × shake2 + 19 × swing2` compose into a stack
rather than overwrite. Keep. It also means an early disabled effect (§5.1) changes every later effect
in the chain — one more reason §5.1 is P0.

---

## 8. Fix list, ordered

| Order | Fix | File | Why first |
| --- | --- | --- | --- |
| 1 | `hidden` → UI flag, not `enabled`; drop `enabled` from export | `amXmlCodec.ts:95–96`, `:328–334`; `types/project.ts` | Restores 79 animated effect instances, incl. all 18 `shake` |
| 2 | Numeric parse without `\|\|` | `animation.ts:328–335` | 25 corrupted curves in one project |
| 3 | Full token table + fail-loud parser + lossless export | `animation.ts:325`; `amXmlCodec.ts:23–29` | 6 of 8 APK easing types currently vanish |
| 4 | `evalEasing`: explicit branch per type, `approximated` surfaced in the UI | `animation.ts:50–84` | Removes the silent-linear default |
| 5 | Probe `env.frame`, `AM.triangle` phase, `AM.simplexNoise` (§7.2–7.4) | `renderer.ts:1066`, `scriptRuntime.ts:122–136` | Only after 1–4; otherwise you are tuning against a broken input |
| 6 | Honour `locallyApplied` in the render path (§5.2) | `renderer.ts` effect pass | Affects **295 of 387** instances here |

Export side, in the same pass:

```ts
// amXmlCodec.ts:23-29 — never emit a token AM cannot parse
function formatEasingAttr(e?: EasingSpec): string {
  if (!e || e.type === 'linear') return '';
  if (e.approximated && e.token) {
    // Preserve exactly what was imported, so a round-trip is lossless even for
    // types this build does not implement yet.
    return ` e="${escapeXml([e.token, ...(e.params ?? [])].join(' '))}"`;
  }
  if (e.type === 'cubicBezier') {
    // Six decimals matches AM's own writer. Do not round to 2 — that changes curves.
    return ` e="cubicBezier ${e.x1.toFixed(6)} ${e.y1.toFixed(6)} ${e.x2.toFixed(6)} ${e.y2.toFixed(6)}"`;
  }
  return ''; // unknown -> omit rather than write an invalid token
}
```

Delete `e="overshoot"`, `e="bounce"`, `e="elastic"`, `e="steps"` from the current writer — AM's
`bounce`/`elastic`/`step` require numeric tails, and `overshoot` is not an APK token at all.

UI, in the same pass (`EasingCurvePanel.tsx:8–16`): the preset list offers `Overshoot`, `Bounce`,
`Elastic`, `Steps (4)` using CSS-style math. Either implement the APK semantics (§3.4) or relabel them
as approximations. The panel only draws handles for `cubicBezier` (`:113`), so a user picking "Bounce"
today gets a graph that does not describe what renders.

---

## 9. Acceptance tests

### 9.1 Unit (must pass before anything visual)

| # | Test | Expect |
| --- | --- | --- |
| U-1 | `parseEasingString('cubicBezier 0.0 1.0 0.0 1.0')` | `x2 === 0 && y2 === 1` |
| U-2 | `parseEasingString('cubicBezier 0.28691405 0.0 1.0 0.0')` | `y2 === 0` |
| U-3 | `parseEasingString('cyclic 0.028997868 0.0 0.5 0.0 0.0')` | `type === 'cyclic'`, `params.length === 5`, `token === 'cyclic'` |
| U-4 | `parseEasingString('bounce 0.5 0.5')` | `approximated === true`, params preserved |
| U-5 | `parseEasingString('whoKnows 1 2 3')` | `approximated === true`, `token === 'whoKnows'`, warns once |
| U-6 | round-trip `U-3` through export | identical `e="cyclic 0.028997868 0.0 0.5 0.0 0.0"` |
| U-7 | Import the CONQ XML | **387** effects imported, **387 enabled**, 101 `hidden` |
| U-8 | Import → export → import | same effect count, same `hidden` count, same easing strings |

### 9.2 Visual, against the APK

Render both builds at the same frame with the same project. ΔE2000 p95 ≤ 2.0 on the layer crop.

| # | Case | Pass condition |
| --- | --- | --- |
| V-1 | frame 0, layer 1 | silhouette edges within ±1 px |
| V-2 | frame 30, layer 1 (peak shake displacement) | same sign and magnitude of displacement as APK |
| V-3 | frame 0 → 60, sample `location.x` every 5 frames | correlation with APK ≥ 0.995 |
| V-4 | Easing probe project (2 kf, `cubicBezier 0.0 1.0 0.0 1.0`) | 21-sample curve matches APK to 1e-3 |
| V-5 | Same probe with `cyclic` | matches once §3.4 is implemented; until then, marked `approximated` in the UI |
| V-6 | Toggle one effect off in AM → export → import | exactly one instance disabled, `hidden` unchanged |

### 9.3 Regression guard

Hash the parsed easing string of all 244 eased keyframes in the sample project before and after the
patch. Expected: **25 hashes change** (the `x2`/`y2` fixes) and 219 stay identical. Any other delta
means the parser is being creative.

---

## 10. Sign-off

| # | Claim | Status | Confirmed by |
| --- | --- | --- | --- |
| C-01 | Easing vocabulary is 8 tokens in 5.0.280 | ✅ verified | dex string pool + `easing` class descriptors |
| C-02 | `cubicBezier` is 4 params, `cyclic` is 5 | ✅ verified | real 6.2.36 export |
| C-03 | Web parses 2 of 8; the rest become linear | ✅ verified | `animation.ts:325–341` |
| C-04 | `x2`/`y2 == 0` is corrupted to `1` | ✅ verified | `animation.ts:333–334` + 25 real keyframes |
| C-05 | Easing belongs to the **end** keyframe | ✅ verified | 205 last vs 3 first across 350 properties |
| C-06 | `hidden` is not an enable flag | ⚠️ **strong evidence, needs one diff** | APK preset with keyframed `hidden="true"` wipe |
| C-07 | `enabled` is not an AM attribute | ✅ verified | 0 / 387 + 0 in APK presets |
| C-08 | Link import works for this URL | ✅ verified | HTTP 200, 1,947,809 bytes |
| C-09 | 5.0.280 and 6.2.36 shake scripts are identical | ✅ verified | 12-file byte diff |
| C-10 | `env.frame` is absolute scene frames | ⚠️ unverified | §7.2 |
| C-11 | `AM.triangle` has zero at `x = 0` | ⚠️ unverified | §7.3 |
| C-12 | `AM.simplexNoise` matches the APK field | ⚠️ unverified | §7.4 |

---

## 11. Open questions (need a capture, not an opinion)

1. **`hidden` semantics.** One export diff settles it (§5.1). Everything in fix #1 depends on it.
2. **Arity and math of `bounce`, `elastic`, `step`, `elasticStep`, `random`.** The dex gives the field
   *names* (`firstStepLength`, `stepLength`, `frequency`) but not the formulas or how many numbers are
   serialized. Probe per §3.4; do not infer from CSS or After Effects — AM's "step" uses a
   **length in normalized time**, not a step count, which is why `steps: 4` in the current UI is wrong.
3. **`env.frame` base** (§7.2) — absolute or layer-local. Changes phase across a 16-layer stack.
4. **`locallyApplied` render space** (§5.2) — **295 of 387** instances are `false`; needs a capture to
   define "parent space" precisely.
5. **`retime="freeze"` and `precompose="dynamicResolution"`** — ignored on import. Unknown whether they
   alter keyframe remap. Log as unknown; do not guess a behaviour.

---

## Appendix — where each number came from

| Number | Source |
| --- | --- |
| 8 easing tokens | 5.0.280 dex string pools, `classes6.dex` @ `2051951` / `2058543`; class descriptors `com.alightcreative.app.motion.easing.*` |
| ctor field names | dex `toString` literals: `CubicBezierEasing(p1x=`, `CyclicEasing(stepLength=`, `BounceEasing(firstStepLength=`, `RandomEasing(frequency=`, `StepEasing(stepLength=`, `ElasticEasing(stepLength=`, `ElasticStepEasing(stepLength=` |
| 387 / 40 / 781 / 244 | `xml.etree` walk of the share-link XML |
| 101 hidden / 79 animated | same walk |
| 25 corrupted curves | `Token.attrib['e']` split, `float(parts[3]) == 0 or float(parts[4]) == 0` |
| 205 vs 3 easing placement | per-`<property>` min/max-`t` keyframe scan |
| 1,947,809 bytes | `Invoke-WebRequest` on the Firebase object |
| 12 identical scripts | normalized CDATA diff, APK `assets/effects` vs IPA `BuiltinEffects` |

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[GRAPH_EASING_AUDIT]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\GRAPH_EASING_AUDIT.md` |
| Status | active |

Carry forward: hidden needs one AM export diff; cyclic arity and triangle phase remain unproven.
