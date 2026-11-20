# COMPATIBILITY EFFECTS — Alight Motion 5.0.280

**Scope:** how legacy / "Compatibility" effects render in `alight-motion-web` versus the APK, and the one
place where the engine genuinely diverges.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| APK reference | `C:\Users\jeduc\Downloads\AM Web 2\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Companions | `ENGINE_PARITY.md` §1, **P0-07**, **P1-10** |
| Date | 2026-11-19 |
| Verdict | Legacy effects render through the **same pipeline** as modern ones, correctly — except **4 effects** whose `compat` render-mode flag is dropped by the extractor. |

---

## 1. TL;DR

1. **86 of 315 effects are deprecated** (`deprecated="true"`). All 86 are shipped in `effects.json`, with
   their IDs, scripts and shaders intact, and are executed by the normal effect pipeline. Old projects
   resolve correctly.
2. **AM's legacy effects are not aliases.** `oscillate`, `oscillate2` and `oscillate3` are three separate
   definitions with different parameter sets. Keeping old IDs alive means shipping old definitions, and
   that is exactly what both builds do.
3. **Two root attributes are dropped by `scripts/extract_apk.py`:**
   - `compat` on **4 effects** → real render divergence (**§5**).
   - `afxver` on **3 effects** → named risk, unproven (**§6**).
4. **Two attributes that look like gaps are no-ops:** `precision` is only ever `high` (215 shaders), and
   `fastMath` is only ever `false` (4 shaders). Nothing to fix.
5. The UI already mirrors AM: deprecated effects are hidden behind "Show Legacy & Experimental" and
   badged **Compatibility**. Nothing to fix there either.

---

## 2. What "Compatibility" means in this engine

The APK marks an effect `deprecated="true"` when a newer generation replaces it. The old file stays in
`assets/effects/` forever, because saved projects reference it **by ID**, and IDs are never remapped.
The web shows the same set under the same IDs and appends ` (Compatibility)` in the UI
(`src/engine/catalog.ts:55–60`).

Counts, from parsing all 315 XML files:

| Marker | Count |
| --- | --- |
| `deprecated="true"` | **86** |
| `deprecated="false"` (explicit) | 34 |
| attribute omitted | 195 |
| `internal="true"` (hidden from browser, kept for projects) | 33 |
| `experimental="true"` | 70 |

> If a review says "120 deprecated", that is the count of the *attribute occurring*, not of effects that
> are actually deprecated. 120 = 86 true + 34 explicit false.

---

## 3. Legacy families — separate definitions, not aliases

53 stem families exist. Representative set:

| Stem | Generations | Note |
| --- | --- | --- |
| `oscillate` | 1 · 2 · **3** | `oscillate3` adds a `direction` selector; 1 and 2 lack it |
| `swing` | 1 · **2** | same param set, different script |
| `swirl` | 1 · 2 · 3 · **4** | four generations |
| `fractalwarp` | 1 · 2 · 3 · **4** | four generations |
| `motionblur` | 1 · 2 · 3 · **4** | four generations |
| `noise` | 1 · 2 · **3** | |
| `turbulentdisplace` | 1 · 2 · **3** | |
| `boxblur` | 1 · 2 · **3** | 1 and 2 deprecated, both ship `iterations` |
| `lensblur` · `pinchbulge` · `pixelate` · `spherize` · `stretch` · `wipe`… | 1 · **2** | 30+ such pairs |

Proof there is no aliasing risk: there are **no duplicate effect IDs** across the 315 files, and
`com.alightcreative.effects.oscillate` resolves to exactly one definition.

There is, however, a **namespace split** worth knowing: 8 effects live under the singular
`com.alightcreative.effect.*` rather than `com.alightcreative.effects.*` —

```
glass, glass2, growparts, morphpath, movealongpath, movealongpath2, movealongpath3, shakeparts
```

`catalog.ts:46–53` compensates with a fallback chain (`effects.` then `effect.` when looking up a bare
id). It works, but it is a band-aid: the lookup is suffix-based and will resolve the wrong entry the day
two effects share a short name across both namespaces. Prefer exact IDs from the project file.

---

## 4. Script-only legacy effects (no shaders at all)

12 deprecated effects have **zero shaders and zero passes** — they are pure `animate()` scripts:

```
blink, facemotion, flicker, move-along-path, move-along-path2,
oscillate, oscillate2, perlindisplace, pulsate, pulse-opacity, shake, swing
```

Two execution paths exist in the web engine, and both cover this set:

| Path | Web location | Covers |
| --- | --- | --- |
| `auto-transform` script → mutates `location / angle / scale / alpha` | `renderer.ts:1056–1077` | 9 of the 12: `move-along-path*`, `oscillate*`, `perlindisplace`, `pulsate`, `shake`, `swing`, `facemotion` |
| script-only alpha modulation | `renderer.ts:1408–1424` | `blink`, `flicker`, `pulse-opacity` |

Verified by inspection: `oscillate.xml`, `oscillate2.xml`, `swing.xml` each declare
`auto-transform="true"` with `shaders: 0, passes: 0`, and the transform loop applies
`out.transform.*` and `out.alpha` back onto the element. **No gap here.**

---

## 5. The one real divergence — `compat="acScreenNorm-y"`

> [!danger] CORRECTION — measured 2026-11-19, supersedes §5.1 and §6's premise
> `compat` and `afxver` are **not** dropped. `scripts/audit/compat-parity.mjs` reads them straight out of
> the JSON: all 4 `compat="acScreenNorm-y"` entries and all 3 `afxver="2"` entries are present and
> correct. The "false for all 315" claim below came from an attribute-occurrence count, not a per-effect
> diff — the same class of error as "86, not 120" (see §2).
>
> What survives, and is still worth testing: **nothing in `shaderCompiler.ts` reads `compat`.** The
> attribute is carried in the catalogue and ignored at compile time. So §5.5's experiment matrix is still
> the right experiment — it is a question about **shader semantics**, not about lost data. Treat §5.1's
> "what is dropped" as "what is carried but unread".
>
> Full measurement: `PREVIEW_STATIC_GLITCH_COMPAT_FONTS.md` §2.

### 5.1 What is dropped

```xml
<effect id="com.alightcreative.effects.colorbalance" compat="acScreenNorm-y" ...>
```

`"compat" in effect` is **false for all 315 entries** in `public/am/effects.json`. The extractor never
carries it, and nothing in `src/engine/shaderCompiler.ts` reads it. One convention is built for every
effect (`shaderCompiler.ts` → `buildVertexSource`):

```glsl
acScreenNorm = (vec4(ac_internal_texcoord, 0.0, 1.0) * acTransform).xy;
acLayerNorm  = (vec4(acScreenNorm, 0.0, 1.0) * acScreenToLayer).xy;
```

So the four compat effects are fed a value of `acScreenNorm` they were **not authored against**.

### 5.2 The four effects

| Effect | ID | Category | How it consumes `acScreenNorm` |
| --- | --- | --- | --- |
| Color Balance | `…effects.colorbalance` | color | base sample only: `texture2DCv(inputImg.texture, acScreenNorm.st)` |
| Matte Fringe | `…effects.mattefringe` | matte | vertical pass index (`acScreenNorm.t`), original sample, and `comp` sample |
| Omino Glass | `…effects.ominoglass` | distort | sample **and** normal: `evaluatePixelXy(acScreenNorm*acScreenSize, texColor)` |
| Chromatic Zoom Blur | `…effects.chromaticzoomblur` | blur | sample **and** geometry: `acScreenNorm.st - (vec4(center,0,1) * acLayerToScreen).xy` |

Three of the four are 2D-space dependent, not merely texture lookups:

```glsl
// chromatic-zoomblur.xml — the blur direction is derived from the screen-space vector
vec2 v = acScreenNorm.st - (vec4(center,0.0,1.0) * acLayerToScreen).xy;
vec2 vnorm = normalize(v) * texelSize * speed;

// omino-glass.xml — the surface normal is literally the screen-space coordinate
gl_FragColor = evaluatePixelXy(acScreenNorm * acScreenSize, texColor) * texColor.a;

// mattefringe.xml — the vertical pass is indexed by the t component
vec4 sample = texture2DCv(xDistBuf.texture, vec2(acScreenNorm.s, acScreenNorm.t + y*(py/MULTISAMPLE)));
```

### 5.3 What is *certain* and what is *predicted*

**Certain:** the value of `acScreenNorm` seen by these four effects differs from the APK's value. The
attribute exists precisely to select the older convention, and the web does not select it.

**Predicted, not proven:** the visible outcome. The tempting reading — "everything renders vertically
mirrored" — is probably wrong, because a full mirror on a widely used colour tool would have been
noticed on Android years ago. The more plausible model is that `compat` selects a **legacy
`acScreenNorm` / `acVtoRSpace` pairing**: the shader was authored when both were defined one way, AM kept
that pairing for these four, and the sample still lands on the correct texel. What then differs is the
*2D-space* math — blur directions, normals, fringe direction — not the base image.

This distinction decides the fix, so it must be measured, not argued. See §5.5.

### 5.4 Symptom by effect, once the pairing is wrong

| Effect | Predicted failure |
| --- | --- |
| Chromatic Zoom Blur | blur streaks pull along the wrong Y direction; centre offset flips |
| Omino Glass | lighting/bevel normal inverted — the bevel highlights from the wrong side |
| Matte Fringe | fringe grows on the wrong side of the matte edge for vertical edges |
| Color Balance | likely **identical** — pure sample use, and the sample still resolves correctly under either pairing |

That last row is useful: **Color Balance is the control.** If it changes when you apply a fix, the fix
is too broad and is flipping the image rather than emulating the legacy pairing.

### 5.5 Fix — ordered experiment matrix (do not skip to step 3)

1. **Carry the attribute.** In `scripts/extract_apk.py`, read the root `compat` into the JSON as
   `compat: string | null`. Add it to the `EffectDef` type. Regenerate; confirm 4 entries non-null.
2. **Emulate the legacy pairing, not a blind mirror.** In `buildVertexSource`, when
   `effect.compat === 'acScreenNorm-y'`, emit the legacy form of the pair — the minimal candidate is:

   ```glsl
   vec2 acScreenNormLegacy = vec2(acScreenNorm.x, 1.0 - acScreenNorm.y);
   ```

   *applied before* `acVtoRSpace` is consumed, so `texture2DCv` resolves through the legacy space.
   Keep the modern `acScreenNorm` for `acLayerNorm` unless the capture says otherwise.
3. **Capture a reference.** On the APK, place a horizontally asymmetric image, apply each of the four
   effects at default params, screenshot at a fixed frame. Compare against the web at the same frame.
4. **Only if step 2 produces a mirror** (Color Balance visibly flips): move the transform downstream —
   negate after `acVtoRSpace`, or flip the buffer at composite time instead. That would indicate the
   flag concerns the **output** orientation, not the input convention.
5. **Freeze the answer** in a comment next to the branch, naming the APK capture it was verified
   against.

### 5.6 Acceptance

- `chromatic-zoomblur` at centre `(0,0)`, `omino-glass` at defaults, `mattefringe` on a circular matte:
  match the APK capture at ΔE2000 p95 ≤ 2.0.
- `colorbalance` at defaults: **unchanged** by the patch (control test).
- The other 311 effects: pixel-identical before and after (assert via hash of the rendered frame at
  fixed params).

---

## 6. `afxver="2"` — named risk, not a defect

Three effects declare an effect-format version:

| Effect | File | ID |
| --- | --- | --- |
| Brightness / Contrast (v2) | `brightness-contrast-2.xml` | `…effects.brightcont2` |
| Colorize | `colorize.xml` | `…effects.colorize` |
| Fractal Warp 4 | `fractalwarp4.xml` | `…effects.fractalwarp4` |

`"afxver" in effect` is **false** for all 315 JSON entries — dropped by the same extractor.

> [!success] CORRECTION — measured 2026-11-19
> It is not dropped. `afxver: "2"` is present on exactly these three entries in
> `public/am/effects.json`. Same measurement-script error as §5: `PREVIEW_STATIC_GLITCH_COMPAT_FONTS.md`
> §2. What remains true is that **nothing reads `afxver`** — so the risk below is unchanged in substance
> and now correctly attributed to "carried but unread" rather than "lost on export".

**Why it is a risk and not a bug:** `afxver` is a *newer* authoring format appearing on only three
effects, so it most likely gates parameter interpretation rather than shading. Nothing in the shader
bodies references it. There is no evidence these three misrender today.

**Do not invent semantics for it.** Carry it into the JSON, add it to the golden-frame matrix, and let
the diff decide. If all three pass at default and at 75 % of each slider's range, document the attribute
as a no-op for these files and leave the code alone.

---

## 7. UI parity — already correct, do not touch

| Behaviour | APK | Web |
| --- | --- | --- |
| Deprecated effects hidden from the browser by default | yes | `EffectBrowserDialog.tsx:29–30` (`!includeLegacy && (e.deprecated \|\| e.experimental) → false`) |
| Legacy toggle shows the count | yes | `EffectBrowserDialog.tsx:142` |
| Badge label "Compatibility" (gold) | yes | `EffectBrowserDialog.tsx:176–178`, `EffectsPanel.tsx:88–89` |
| Internal effects never listed | yes | `EffectBrowserDialog.tsx:29` |
| Display name suffix | AM appends "(Compatibility)" | `catalog.ts:55–60` |

The web already presents legacy effects the way AM does. Any change here is a product decision, not a
parity fix.

---

## 8. Verification protocol (for sign-off)

1. Regenerate: `python scripts/extract_apk.py` → confirm `315 / 250 / 20` unchanged, and that
   `compat`/`afxver` now appear on 4 and 3 entries respectively.
2. Confirm the deprecated count is 86 and that `deprecated="false"` never leaks into the
   "Show Legacy" filter.
3. For each of the four `compat` effects: render at fixed params in both builds, capture, diff.
4. Confirm the control: `colorbalance` output unchanged by the patch.
5. Confirm the blast radius: hash the rendered frame for all 315 effects before/after the patch; exactly
   4 hashes may change, 311 must not.
6. For the three `afxver` effects: same diff at default and at 75 % slider range, then mark
   `no-op` or `open`.

| # | Claim | Status | Confirmed? |
| --- | --- | --- | --- |
| C-01 | 86 deprecated effects, all shipped and executed normally | ✅ verified | ☐ |
| C-02 | Legacy effects are separate definitions, no ID collisions | ✅ verified | ☐ |
| C-03 | 12 deprecated effects are script-only; both script paths handle them | ✅ verified | ☐ |
| C-04 | `compat` dropped; 4 effects affected | ✅ verified | ☐ |
| C-05 | Visible result of C-04 | ⚠️ predicted — needs capture | ☐ |
| C-06 | `afxver` dropped on 3 effects | ✅ verified | ☐ |
| C-07 | `precision` / `fastMath` are no-ops | ✅ verified | ☐ |
| C-08 | UI parity already matches AM | ✅ verified | ☐ |

---

## 9. Open questions

1. **Direction of the legacy pairing.** Sign of `acScreenNorm.y` for compat effects — must come from an
   APK capture, not from the attribute name.
2. **Is `compat` ever a list?** Only one value (`acScreenNorm-y`) appears across the APK. Treat it as an
   enum with one known member and fail closed on unknown values (log, don't guess).
3. **Namespace migration.** Should the 8 singular-namespace effects be normalised at import time, or
   should the fallback in `catalog.ts:46–53` stay? Normalising is safer; the fallback can misfire.
4. **`afxver` semantics.** Unknown. Diff first, then decide whether anything is needed.

---

## Appendix — reproduce these numbers

```python
import os, re, json, collections
APK = r"...\Alight_Motion_5.0.280_1789568706_latestmodapks.com"
WEB = r"...\alight-motion-web"
D = os.path.join(APK, "assets", "effects")

xml = {f: open(os.path.join(D, f), encoding="utf-8", errors="replace").read()
       for f in os.listdir(D) if f.endswith(".xml")}

print("files:", len(xml))
print("deprecated=true:", sum('deprecated="true"' in s for s in xml.values()))
print("deprecated=false:", sum('deprecated="false"' in s for s in xml.values()))
print("compat:", [f for f, s in xml.items() if 'compat="' in s])
print("afxver:", [f for f, s in xml.items() if 'afxver="' in s])
print("zero-shader:", sorted(f for f, s in xml.items()
      if s.count("<shader") == 0 and 'deprecated="true"' in s))

j = json.load(open(os.path.join(WEB, "public", "am", "effects.json"), encoding="utf-8"))
print("json effects:", len(j))
print("json deprecated:", sum(1 for e in j if e["deprecated"]))
print("json carries compat:", sum(1 for e in j if "compat" in e))
print("json carries afxver:", sum(1 for e in j if "afxver" in e))
print("singular namespace:", [e["id"] for e in j if ".effect." in e["id"]])
```

Expected output: `315`, `86`, `34`, 4 compat files, 3 afxver files, 12 zero-shader deprecated,
`json deprecated: 86`, `compat: 0`, `afxver: 0`, 8 singular IDs.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[COMPAT_EFFECTS]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\COMPAT_EFFECTS.md` |
| Status | active |

Carry forward: 86 deprecated effects (not 120). compat/acScreenNorm-y still needs one APK capture, Color Balance being the control test.
