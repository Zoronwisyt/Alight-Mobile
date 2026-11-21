# ENGINE PARITY — `alight-motion-web` vs Alight Motion 5.0.280 (APK)

**Purpose:** a complete, evidence-backed list of everything that has to change for the web engine to be
*behaviorally identical* to the APK engine — written as a handoff document for Antigravity to verify,
dispute, or sign off.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` (`package.json` version `5.0.280`) |
| APK reference | `C:\Users\jeduc\Downloads\AM Web 2\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Audit date | 2026-11-19 |
| Audit method | Static read of `src/engine/*` + scripted parse of all 315 APK effect XMLs and `public/am/effects.json` |
| Verdict | **Effect layer: near-identical. Renderer substrate: equivalent in intent, divergent in mechanism. Gap list below.** |

---

## 0. Definition of "identical" (read this before disputing anything)

"Identical" is achievable in **three distinct senses**, and they are not the same bar:

1. **Data-identical** — same effects, params, IDs, presets, shapes. **Already true.** Verified in §1.
2. **Math-identical** — same GLSL bodies, same `animate()` scripts, same uniform semantics, same pass
   topology. **Almost true.** Gaps are pipeline semantics, not shader math (§2).
3. **Pixel-identical** — same output image. **Not achievable**, and it is not a failure of either
   implementation: the APK rasterizes vectors with native **nanovg** and lays out text with its own
   shaper; the web rasterizes with **Canvas2D** and lays out text with the browser. Two different
   rasterizers with different AA, hinting and font metrics cannot produce bit-identical pixels.

> **Recommended contract for sign-off:** "identical" = *data-identical + math-identical under a fixed
> tolerance, with every §2 item closed and the §6 harness passing at the stated thresholds.*
> Pixel-exactness is out of contract for vector/text layers and **in** contract for pure-shader
> effects, where GLSL is copied verbatim.

---

## 1. Confirmed identical — do not "fix" these

| Area | Evidence | Status |
| --- | --- | --- |
| Effect count | APK `assets/effects/*.xml` = **315**; web `public/am/effects.json` = **315** | ✅ |
| Effect IDs | every JSON `id` matches the XML `id` (`com.alightcreative.*`) | ✅ |
| Deprecated / compatibility effects | APK `deprecated="true"` = **86** of 315 (34 explicit `false`, 195 omit the attribute); all 86 present in JSON, IDs preserved, scripts + shaders intact, driven by the same pipeline | ✅ except the two dropped root attributes → **P0-07**, **P1-10** |
| Shader code | 307 shader bodies carried verbatim into JSON `shaders[].code` | ✅ |
| Effect scripts | 39 effects carry `lang="js"` scripts; JSON `script` carries them verbatim | ✅ |
| Script API used | only `AM.simplexNoise` (29), `AM.log` (11), `AM.triangle` (10) — all 3 present in `scriptRuntime.ts` `AM_RUNTIME` | ✅ |
| Script `env` fields used | `velocity, duration, time, scaleVelocity, angularVelocity, frame, editMode, selected, fps, inTime, absTime` — all 11 present in `EffectScriptEnv` (`scriptRuntime.ts:138`) | ✅ |
| Script `el` fields used | `transform, text, shaderGroups, alpha` — all 4 present in `EffectScriptElement` | ✅ |
| Param tags | 13 tags in XML (`spinner, texture, slider, switch, color, selector, point, section, xyz, tip, orient, hue-disc, float`) all mapped in `catalog.ts:96` | ✅ |
| Param attributes | 26 attributes in XML, 28 keys in JSON (adds `tag`, `choices`) — **superset, nothing lost** | ✅ |
| Pass attributes | `target, effect, blend, src` — `target/effect/src` handled in `runEffectPasses` (`renderer.ts:1680–1720`) | ⚠️ `blend` open → **P0-01** |
| Presets | 13 XML packs → 250 presets in `presets.json` | ✅ |
| Shapes | 20 XML → 20 in `shapes.json`, evaluated by real `getPath()` scripts via `evaluateShapePath` | ✅ |
| Blend modes | 29 `BlendingMode` constants → 24 catalogue effect ids + 5 native composites (`NATIVE_BLEND_MODES`, `blendModes.ts`) | ✅ verified → §4.5 |
| Overdraw | 49 `overdraw` + 37 `max-overdraw` + 8 `maxOverdraw` normalized to JSON `maxOverdraw`; applied via `overdrawPad` in `renderer.ts` | ✅ |
| Keyframe easing | `parseEasingString` + `evalEasing` implement linear / cubicBezier / steps / overshoot / bounce / elastic, and read easing from the **segment-end** keyframe to match APK `KeyableKt.valueAtTime` (`animation.ts:245`) | ✅ |
| Shader `precision` attr | XML only ever uses `precision="high"` (215 shaders); web hardcodes `highp` | ✅ no-op |
| Shader `fastMath` attr | XML only ever uses `fastMath="false"` (4 shaders); default is already off | ✅ no-op |

---

## 2. P0 — must fix for "identical" to mean anything

### P0-01 · Pass `blend` attribute is not implemented
- **Where (web):** `src/engine/renderer.ts:1738` — every pass draws with `gl.disable(gl.BLEND)`, i.e. the
  target is always **replaced**. `pass.blend` is never read.
- **Where (APK):** **5 passes across 3 effects** declare it — `mattefringe.xml` (1),
  `smoothedges.xml` (2), `spill-cleaner.xml` (2), all `blend="overwrite"`. Every other pass in the 315
  effects omits the attribute, which suggests AM's default is *not* overwrite (otherwise the attribute
  would be a no-op). That default is an inference and must be confirmed against a captured APK frame.
- **Symptom:** any effect whose shader outputs partial alpha into an accumulating buffer — the two-pass
  blur families most obviously — composites differently. Subtle colour bleed and edge weight drift in
  `smoothedges`, `spill-cleaner`, `mattefringe`.
- **Fix:** model pass blend as `'over' | 'overwrite' | 'add' | 'max'`; default `'over'`
  (`gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`), `"overwrite"` → `gl.disable(gl.BLEND)`.
  Confirm AM's default against a captured APK frame on `smoothedges`.
- **Acceptance:** `smoothedges` on a 1-px white square on transparent produces the same edge-profile
  ramp as the APK at 3 radii; ΔE < 2 on the ramp profile, alpha ramp within 2/255.

### P0-02 · `textrand` and `timecode` text effects are no-ops
- **Where (web):** `renderer.ts:2303` `drawTextLayer` hardcodes exactly four text effects —
  `counter` (2308), `textprogress`, `textspacing` (2326), `texttransform` (2331). Nothing else.
- **Where (APK):** 4 effects mutate `el.text` in script: `counter.xml`, `textprogress.xml`,
  `textrand.xml`, `timecode.xml`.
- **Symptom:** adding **Text Randomizer** or **Timecode** does nothing. Worse: `counter` and
  `textprogress` are re-implemented by hand rather than by running their script, so they will drift
  from the APK the moment the APK updates.
- **Fix:** drive text through the same `el.text` pipeline as the APK — run the effect script, take
  `out.text`, feed it to layout. Delete the four hardcoded branches (`textspacing`/`texttransform`
  stay as layout params only if their scripts really only emit metrics; verify against the XML).
- **Acceptance:** all 4 text-script effects produce the APK's string at 5 sampled times (e.g. timecode
  `00:00:02:14` at 2.5 s @ 30 fps).

### P0-03 · Vector fidelity — **AMENDED v1.1: demoted to P1, tiered plan** *(was: "not nanovg-equivalent")*
- **Where (web):** `renderer.ts:423` creates one scratch `canvas2d`, resized to the FBO (`2099–2101`),
  paths built via `buildVectorPath` / `buildCanvasPath` → `ctx.fill()` → uploaded as a texture.
- **Where (APK):** native `libalight-nanovg.so`, path geometry in float, AA computed analytically
  per frame at the actual device scale.
- **Amendment:** a full GPU tessellator is overkill for this product. Canvas2D already exposes the two
  knobs that matter most (`ctx.fill('evenodd' | 'nonzero')`, `ctx.miterLimit`), and the resolution gap
  closes with supersampling. Reach for tessellation only if the §6.2 golden-frame gate still fails
  after tiers 1 and 2.
- **Tier 1 — config parity (hours):**
  1. honour the shape's declared fill rule instead of Canvas2D's nonzero default (donut, ring,
     hollow star, `s3d-hollowbox` source geometry);
  2. set `ctx.miterLimit` to nanovg's value (measure it — do not guess);
  3. define dash accumulate order so `stroke-taper`, `drawing-progress`, `repeat-path` stop drifting.
- **Tier 2 — supersample (≈1 day):** rasterize vector/text layers into a 2× FBO and downsample on
  composite; expose the multiplier so export can use 2–3× while the preview stays 1×.
- **Tier 3 — tessellator (optional, 3–5 days):** ear-clip with explicit winding, stroke expand to
  polygons, emit through `acLayerToScreen`. Only if tier 1+2 fail the gate.
- **Acceptance:** `star` with 5 points, miter joins, at 400 % zoom — apex within 1 px of the APK
  capture; donut shape shows a hole; export at 2× supersample passes SSIM ≥ 0.99 against the APK.

### P0-04 · Text layout is browser layout, not AM layout
- **Where (web):** `drawTextLayer` sets `ctx.font = '700 {px} "{family}", "Space Grotesk", "Roboto", sans-serif'`
  — weight is **hardcoded 700**, no italic, `textBaseline = 'middle'`, `textAlign = 'center'`.
- **Where (APK):** `TextElementTypeImpl` + Kotlin text layout: selectable weight/style, per-family
  metrics, alignment (horizontal + vertical), letter/line/paragraph spacing, stroke, shadow,
  background, wrap width, autoshrink.
- **Where the model is short:** `TextData` (`types/project.ts`) carries only
  `content, fontFamily, fontSize, color, align, lineHeight, letterSpacing, wrapWidth`.
- **Symptom:** every bold text is 700 regardless of what the project asks; italic is impossible;
  vertical centring is a `middle` baseline guess rather than metric-correct; no text stroke or shadow,
  so `highlight-shadow` and the text-style panel can't match; no CJK/RTL/ligature shaping; line breaks
  fall wherever the browser puts them.
- **Fix:** extend `TextData` to the APK's text model, and implement a metrics-driven layout (measure via
  `OffscreenCanvas` per family, apply AM's line-height and letter-spacing rules, wrap on measured
  advance not browser wrapping), then render runs to a path for stroke/shadow parity.
- **Acceptance:** three reference projects (left/center/right, multi-line, mixed weight) match the APK
  within ±1 px per baseline and ±1 px per line-box.

### P0-05 · Script sandbox is the page
- **Where (web):** `scriptRuntime.ts:187` — `new Function('AM', script)` executed in the **main JS
  realm** on the UI thread; any throw is swallowed (`catch { return el; }`), any infinite loop freezes
  the editor, and a script can read `window`.
- **Where (APK):** V8 isolate via `libjavet-v8-android.v.3.0.3.so` (35 MB/ABI), per-effect context.
- **Symptom:** (a) a malformed effect silently renders as *bypassed* (`shaderGroups: []`) instead of
  erroring — today all 39 scripts pass, but the failure mode is invisible; (b) a bad user-authored
  script hard-locks the tab; (c) no isolation boundary between project scripts.
- **Fix:** run scripts in a `Worker` with a hard wall-clock budget (e.g. 8 ms/frame/effect, terminate on
  breach), revoke `window`/`document`/`fetch`, and **surface** script failures in `verifyAllEffects`
  rather than swallowing. Keep `AM_RUNTIME` identical (it already matches the 3 functions used).
- **Acceptance:** script that calls `while(true){}` is killed and logged, editor stays live; a script
  that throws is reported, and the effect is marked failed rather than silently bypassed.

### P0-06 · Video sampling is unverified, so export accuracy is unproven — **AMENDED v1.1 (mechanism corrected)**
- **Where (web):** two different paths, and the earlier claim lumped them together.
  - **Export** (`videoExporter.ts:325`, `444`) calls `await renderer.prepareMediaAtTime(...)`, which
    **does** await a `seeked` event (`renderer.ts:827–896`) — so "export doesn't wait for the seek" was
    wrong. The real defect is that the wait is **unverified**: a 300 ms `setTimeout(finish, 300)`
    resolves regardless, and nothing checks that the decoded frame's time actually matches the
    requested PTS. On a slow/fragmented source the export silently writes a stale frame.
  - **Preview** (`renderer.ts:740` `syncVideosForPlayback`, `uploadImageOrVideo` around `640–931`)
    assigns `currentTime` with a 30 ms tolerance and **no await at all** — correct for playback, but it
    is what makes scrubbing and export disagree.
- **Where (APK):** MediaCodec → `SurfaceTexture` external OES (`assets/shaders/tex2d_ext.*`), frame-exact
  PTS per output frame.
- **Symptom:** not a guaranteed 1–3 frame lag; it is an *unbounded* failure under load — the timeout
  path can emit any frame the decoder had, and nothing reports it.
- **Fix:** after each seek, validate `Math.abs(v.currentTime - targetSec) <= 0.5 / fps` **and**
  `readyState >= 2`; prefer `requestVideoFrameCallback` where available; scale the timeout with GOP
  size; and on breach, **fail the export loudly** with the frame index and source time instead of
  proceeding. Preview path stays as-is.
- **Acceptance:** export a 10 s clip with burned-in timecode, `ffprobe` every frame, zero mismatches at
  30 and 60 fps; a deliberately stalled source produces a named error, not a wrong frame.

---

### P0-07 · `compat` attribute is dropped entirely — 4 effects render in the wrong screen-space orientation
*(added v1.2)*
- **Where (web):** `scripts/extract_apk.py` never carries the root `compat` attribute — confirmed:
  `"compat" in effect` is **false for all 315** entries in `effects.json`. `shaderCompiler.ts` therefore
  builds one `acScreenNorm` convention for every effect:
  `acScreenNorm = (vec4(ac_internal_texcoord, 0.0, 1.0) * acTransform).xy`.
- **Where (APK):** 4 effects declare `compat="acScreenNorm-y"`:
  `chromatic-zoomblur.xml`, `colorbalance.xml`, `mattefringe.xml`, `omino-glass.xml`.
- **Why it matters — these are not decorative effects.** All four consume `acScreenNorm` as **both** a
  sample coordinate and screen-space geometry:
  - `colorbalance` → `texture2DCv(inputImg.texture, acScreenNorm.st)`
  - `mattefringe` → vertical pass indexed by `acScreenNorm.t`, plus `comp` sampling
  - `omino-glass` → `evaluatePixelXy(acScreenNorm * acScreenSize, texColor)` — the normal is literally
    derived from the Y orientation
  - `chromatic-zoomblur` → `acScreenNorm.st - (vec4(center,0,1) * acLayerToScreen).xy` — a Y flip
    mirrors the blur direction away from the centre
- **Symptom:** those four are vertically mirrored / inverted relative to the APK. Because the sample
  coordinate and the geometry are flipped together the result is not garbage — it is *consistently
  wrong*, which is exactly the kind of bug that survives casual review.
- **Fix:** carry `compat` into `effects.json`, then in `buildVertexSource` emit
  `acScreenNorm.y = -acScreenNorm.y` (confirm the sign against a captured APK frame — the attribute name
  reads "acScreenNorm minus y", i.e. the effect was authored against the older negated-Y convention).
  One uniform-space flip, one conditional.
- **Acceptance:** `chromatic-zoomblur` with the centre at `(0, 0)` and `omino-glass` at default params
  match the APK capture (ΔE p95 ≤ 2.0); the other 311 effects are bit-unchanged by the patch.

> **Note on scope:** this is the *only* render-mode difference between "compatibility" effects and
> modern ones. The 86 deprecated effects are **not aliases** of their replacements — `oscillate`,
> `oscillate2`, `oscillate3` are three distinct definitions (only `oscillate3` has `direction`), and 53
> stem families exist for exactly that reason. AM keeps old IDs alive by shipping the old definitions,
> and the web ships all 315, so old projects resolve correctly. The web also already mirrors AM's UI:
> deprecated effects are hidden behind "Show Legacy & Experimental" and badged **Compatibility**
> (`EffectBrowserDialog.tsx:29–30, 176–178`; `EffectsPanel.tsx:88–89`).

### P0-08 · XML export was lossy — the writer emitted half a document
*(added v1.4, 2026-11-21 — fixed in the same pass)*

- **Where (web):** `src/engine/amXmlCodec.ts`, `layerToXml`. Before this pass it wrote only the layer
  tag basics, `<transform>`, `<content>`, `<fov>`, effects and a nested `<scene>`. It never wrote
  `fillColor` for animated/gradient/media fills, `<gradient>`, `<path d>`, the shape id (`s`) or shape
  params, `<stroke>`, `<shadow>`, freehand `<drawing>` strokes, media `src` / `speed` / `inTime` / `gain` /
  `muted`, audio `<gain>`, camera fog/focus, or `hidden`.
- **Where (APK):** `assets/hometab/beta_anim.xml` shows the real dialect and the attributes the APK
  writes: `<fillColor value>`, `<gradient type startColor endColor start end>`, `<path d>`,
  `<embedScene><scene>`, `<content>`.
- **Consequence:** the renderer was correct and the save path was not. A shape saved as XML re-imported
  as a default rectangle; a stroke, shadow, gradient, image, video or audio layer re-imported without its
  defining data. This was the only defect in the sweep that *lost* a user's work on save.
- **Fix:** the writer now emits every field the model holds, plus four defects found alongside it:
  `type="string"` properties parsed as floats (orthographic camera → perspective), `modifiedTime`
  regenerated on import (no byte stability), group `<fillColor>` dropped when `fillType="none"`, and
  freehand exported as `<shape>` instead of `<drawing>`.
- **Acceptance:** `scripts/audit/check_xml_roundtrip.ts` — fixture across all ten layer types must survive
  `import(export(x))`, `export₂ == export₃`, and the APK's own `beta_anim.xml` must survive
  export→import→export byte-stable. ✅ passing.

### P0-09 · A clipping mask was read as the thing being clipped
*(added v1.6, 2026-11-21 — fixed in the same pass)*

- **Where (web):** `src/engine/amXmlCodec.ts:836` mapped `clippingMask="true"` onto
  `blendMode: 'mask'`, and `src/engine/renderer.ts:2300` composited `clipping-mask` as a mask.
- **Where (APK):** a real shared project (`i1MwzBcB9D`, exported
  `4801350B-54BD-4FF0-9371-3166CC342684.xml`) puts the two attributes on two different layers:
  the video carries `clippingMask="true"` and the rectangle above it carries `blending="mask"`.
- **Consequence:** the clipped video was treated as a clipper and masked the scene by its own alpha,
  so it vanished, while the matte rectangle composited over an untouched scene. The user saw the
  rectangle where the video should be.
- **Fix:** `Layer.clippedToMask` holds the flag, `blendMode` holds `blending`; the exporter writes
  `<clipped> clippingMask="true"` and `<clipper> blending="mask"|"exclude"`; `isMaskBlendMode` no
  longer claims `clipping-mask`; the renderer draws a clipped layer normally. On a clipper the flag
  is redundant, so it is only stored for layers that are themselves clipped — that is what makes
  `export₂ == export₃` hold on real projects.
- **Acceptance:** shared project round-trips 14/14 mask lines; re-import reports
  `clipped=6 clippers=8 wrongly-masked=0`; PS-11 in `PARITY_SWEEP_5.0.280.md` §9. ✅ passing.

## 3. P1 — capability gaps that change what the app can do

### P1-01 · `env.editMode` is hardcoded; selection state is wired in one of two script call sites
`renderer.ts:1046` and `1396` both pass `editMode: 'none'` — never the real editor mode.
`selected` is honest in the pixel-effect env (`1397`, `selectedIds.includes(layer.id)`) but hardcoded
`false` in the auto-transform env (`1047`), so transform effects never learn they are selected.
APK passes real editor state to every element. Effects with edit-time branches (`facemotion`,
`parenting_helper`, `scaleassist`, `test*.xml`) render differently while editing than the phone does.
**Fix:** plumb editor mode through both envs and mirror selection into the transform env.
**Acceptance:** `parenting_helper` shows its guide in the editor and not on export; a transform effect
that branches on `env.selected` takes the selected branch in the editor.

### P1-02 · `autoTransform` effects cannot return text or shader groups
`renderer.ts:1408` skips the pixel path entirely for `autoTransform`, and the earlier transform pass
(`1056–1080`) applies `location/angle/scale/alpha` but drops `out.text` and `out.shaderGroups`.
Today's 17 auto-transform effects only move the element, so this is latent — but it is a real semantic
divergence from the APK. **Fix:** keep the returned element from the transform pass and feed
`text`/`shaderGroups` forward.

### P1-03 · Font inventory
Both builds bundle the **same 17 TTFs** (`res/font` ↔ `public/am/fonts`), but the APK browser indexes
**232** families (`assets/fontthumb`, 232 entries) and downloads the rest on demand. The web has no
font-fetch path and no font list beyond the 17. **Fix:** font manifest + lazy load; `@font-face` per
family. **Acceptance:** picking a non-bundled family in an imported project renders it, not a fallback.

### P1-04 · Export codec/container parity
- `videoExporter.ts` supports H.264 baseline→high and VP9/VP8 only; **no HEVC, no AV1**, no alpha-channel
  export, `bitrateMode: 'variable'` only, no 2-pass, no rotation/colour-primaries metadata, no image
  sequence or APNG.
- APK: MediaCodec (device-dependent HEVC/AV1), hardware encode, image sequence, PNG, GIF, project
  package.
- **Fix:** add HEVC/AV1 probes with graceful fallback, `latencyMode: 'quality'`, constant-bitrate option,
  and an image-sequence exporter. **Acceptance:** capability matrix documented per browser; a 10 s
  1080p30 export from each container passes a PSNR ≥ 40 dB against the APK encode.

### P1-05 · Video source fidelity
10-bit/HDR sources, rotation metadata, non-square pixels and variable frame rate are handled by
MediaCodec and dropped by `<video>`. Also `tex2d_ext` (external OES) has no web counterpart; the web
uploads RGBA and flips in-shader (`renderer.ts:589`). **Fix:** read `videoWidth/videoHeight` +
`getVideoPlaybackQuality`, honour rotation, and document that HDR/10-bit is tone-mapped by the browser —
then decide whether that is acceptable for "identical" (it isn't, strictly).

### P1-06 · Audio engine parity
`audioEngine.ts` runs a live `AudioContext` graph; export uses `OfflineAudioContext` at 2 ch /
`AudioEncoder` AAC 192 kbps fixed (`videoExporter.ts:115–167`).
APK uses AAudio with **SoX resampler coefficient tables** (`high_qual_coeffs.txt` 8.6 MB,
`mid_qual_coeffs.txt`, `low_qual_coeffs.txt`).
**Gap:** sample-rate conversion quality/summation order differs (audible on resampled or heavily
layered audio), no per-clip fades/gain envelope parity, no mono/stereo layout control, fixed 192 kbps.
**Fix:** measure — render the same 3-layer mix through both, compare spectra and null-difference; if
Δ > −60 dBFS, implement an explicit resampler or pre-resample assets to the project rate.

### P1-07 · Residual scene-graph gaps — **AMENDED v1.1 (nested scenes were stale)**
`layer.type === 'group'` **is** rendered into a nested FBO (`renderer.ts:1260–1296`: `grpFbo`, own
coordinate space, `renderLayerList` into it, then transformed onto the parent) — the earlier "nested
scenes missing" claim was wrong. What actually remains:

| APK construct | Evidence | Web state |
| --- | --- | --- |
| Nested scene as render target | `NestedSceneElementTypeImpl` | ✅ implemented (`grpFbo`) |
| Group bounds driving effect space | `groupWidth`/`groupHeight` in `amXmlCodec.ts` | ⚠️ present but partly stubbed |
| Camera object + 3D projection | `cameraObject` premium flag, `RenderEnvironment` 3D | ⚠️ parallax-only (`1160`) |
| Null/parent objects with docked UV angle | `LayerParentingKt$getDockedUVAngle` | ⚠️ transform inheritance only (`1078–1097`), no skew/3D inheritance |
| Drawing element (freehand) | `DrawingElementTypeImpl` | ❓ verify |
| Nested scene timing offset | `RenderEnvironmentTimeOffset` | ❓ verify |

**Fix:** camera object and docked parenting are the two that change output; group bounds matter for
group-level effects. Acceptance: a project with a camera-parented layer and a remote-angled child
matches the APK at three rotations.

### P1-08 · `iterations` clamp
`renderer.ts:1681` clamps iterations to `min(10, …)`. AM has no such cap in the XML, and
`boxblur/boxblur2/fastboxblur/feather/innerblur` expose `iterations`. **Fix:** clamp to a
memory-derived ceiling instead of a magic 10, and log when clamped.

### P1-09b · Blending modes — what the APK actually does *(added v1.3)*

Full reverse of `com.alightcreative.app.motion.scene.BlendingMode` and the compositor behind it.
Everything below is from the 5.0.280 APK; the parsing scripts are `scripts/audit/probe_blend_clinit.mjs`,
`probe_blend_prefix.mjs`, `rea_am_batch28..35.mjs`, and the regression gate is
`scripts/audit/check_blend_modes.ts`.

**Enum shape** (`BlendingMode.<clinit>`, 29 constants, ordinal order). Constructor is
`(name, ordinal, id, usesBackingStore, blendEffect)`; the synthesised Kotlin default-args bridge is used
whenever `blendEffect` is defaulted, which is visible in smali as a 7-arg call whose 5th slot is an `int 0`
instead of a `const-string`:

| | |
|---|---|
| constants with a `blendEffect` | **24** — MULTIPLY, DIFF, EXCLUSION, LIGHTEN, DARKEN, LIGHTER_COLOR, DARKER_COLOR, COLOR_BURN, LINEAR_BURN, COLOR_DODGE, LINEAR_DODGE, OVERLAY, SOFT_LIGHT, HARD_LIGHT, SOFT_OVERLAY, VIVID_LIGHT, LINEAR_LIGHT, PIN_LIGHT, HUE, SATURATION, COLOR, LUMINANCE, SUBTRACT, DIVIDE |
| constants with `blendEffect = null` | **5** — NORMAL, SCREEN, MASK, CLIPPING_MASK, EXCLUDE |
| `usesBackingStore = true` | **3** — MULTIPLY, DIFF, EXCLUSION |

`SUBTRACT` is the one constant whose id is not a plain dex string literal: its clinit reads
`sget-object ... Lkotlin/reflect/jvm/internal/impl/load/kotlin/header/mvrG/AwJYQfheLi;->UNDVzbazpBDML`
(an obfuscated string pool), and `com.alightcreative.blend.subtract` is **not** a NUL-terminated dex
pool entry. `assets/effects/blend-subtract.xml` exists and carries the id inside the XML, so the asset
registry supplies it. ⚠️ *predicted* — the encrypted field was not decrypted.

**SCREEN has no shader anywhere.** Four independent checks:
1. `<clinit>` builds SCREEN with `blendEffect = null` (`const/4 v6, 0x0` in the 7-arg bridge).
2. `com.alightcreative.blend.screen` is **not** a NUL-terminated dex string (0 occurrences); the bare
   prefix `com.alightcreative.blend.` is also absent (0 occurrences), so AM cannot concatenate it either.
3. No `assets/effects/blend-screen.xml`. The asset set is 24 `blend-*.xml`, matching the 24 wired ids.
4. Every `glBlendFunc` in the compositor is `(1, 771)` = premultiplied `over` or `(0, 771)` = knockout.
   `(774, 1)` = `(GL_ONE_MINUS_DST_COLOR, GL_ONE)`, the exact screen formula, appears nowhere.

❌ **open:** whether AM 5.0.280 renders Screen as a no-op (i.e. identical to Normal) or composites it in a
code path not yet located. Resolving it needs a device capture of a two-layer Screen project. The web port
implements the standard `top + bot*(1-top.a)`-style screen formula rather than mirroring a suspected AM
regression, because a mode that silently renders as Normal is the reported bug.

**Web port contract** (`src/engine/blendModes.ts`, `src/engine/renderer.ts`):
- 24 modes carry a `com.alightcreative.blend.*` id and are drawn through
  `registry.getEffectProgram(def)` sampling `comp` (the scene FBO) as a uniform — matching
  `blend-*.xml`, whose params are `inputImg` (`srcType="content"`) and `comp` (`srcType="comp"`).
- 5 modes are in `NATIVE_BLEND_MODES` and never touch `effects.json`: `mask` / `exclude` via the
  stencil-style `MASK_FRAG` pass, `normal` via premultiplied `over`, `screen` via `SCREEN_FRAG` +
  `COMPOSITE_BLEND_FRAG`. `clipping-mask` is the fifth native constant but has no composite of its
  own — it names the layer being clipped, so it draws normally (see P0-09).
- A table row that names an id the catalogue does not carry now logs once instead of silently blitting:
  that fallback is exactly how Screen was rendering as Normal.

**Bug closed:** `BLEND_MODE_TABLE` mapped SCREEN to `com.alightcreative.blend.screen`. That id does not
exist in `public/am/effects.json`, so `getEffectById()` returned undefined, `blendDef` was null, and
`renderer.ts` fell to the plain-blit `else` — Screen rendered byte-identical to Normal. SCREEN now carries
`effectId: null` and routes to the native branch (`blendModes.ts:48`, `renderer.ts:2321`).

**Acceptance:** `scripts/audit/check_blend_modes.ts` asserts 29 rows / 24 effect ids / 5 native, that the
native set equals `NATIVE_BLEND_MODES`, that no row can reach the plain-blit fallback, and that every
`effectId` resolves in `effects.json`. Two-layer Screen project must differ from Normal by more than 2/255
on a mid-grey backdrop.

### P1-09 · Premultiplied alpha and colour pipeline
Web: `premultipliedAlpha: true` context (`renderer.ts:414`), RGBA8 FBOs, `top + bot*(1-top.a)` in
`COMPOSITE_BLEND_FRAG`, straight-alpha blending assumed elsewhere. APK composites in GLES with its own
premultiplication rules per pass.
**Symptom:** dark or light halos on soft edges (`glow`, `shadow`, `blur`) over transparency, and blend
modes that read un-premultiplied colour.
**Fix:** audit every `blendFunc` and enforce one convention end-to-end; add a premultiply/unpremultiply
pass at texture boundaries. **Acceptance:** `glow` on black text over transparency has no grey halo at
the alpha edge (channel delta ≤ 2/255).

### P1-10 · `afxver` attribute is dropped — 3 effects may use v2 parameter semantics
*(added v1.2)*
- **Where (web):** `"afxver" in effect` is false for all 315 JSON entries — the extractor drops it, and
  nothing reads it.
- **Where (APK):** `brightness-contrast-2.xml` (`brightcont2`), `colorize.xml`, `fractalwarp4.xml`
  declare `afxver="2"`. Everything else has no version attribute, so v2 is a *newer* authoring format
  appearing on only three effects.
- **Suspected meaning:** v2 effects are authored against the current param/units conventions; the
  attribute tells the renderer how to interpret params for older projects. If the web applies one
  interpretation to all 315, these three are the ones most likely to read a value wrong — a
  brightness/contrast curve, a colourise mix, or a fractal zoom scale.
- **Status: unknown, not "broken".** No evidence yet that they misrender; this is a named risk that the
  §6.2 golden-frame diff must clear explicitly rather than a proven defect.
- **Fix:** carry `afxver` into `effects.json`, then diff those three against APK captures before
  changing anything. Do **not** invent semantics for it.
- **Acceptance:** the three v2 effects pass the golden-frame gate at default and at 75 % of each
  slider's range; if they pass, the attribute is documented as a no-op and left alone.

---

## 4. P2 — polish / performance / robustness

| ID | Gap | Where | Fix |
| --- | --- | --- | --- |
| P2-01 | No device capability tiers. APK ships `assets/data/device_capabilities.csv` (76 KB) and downgrades overdraw/quality per GPU tier. | `renderer.ts` has fixed overdraw only | tier table → max FBO size, overdraw budget, downsample floors |
| P2-02 | FBO pool never shrinks; each effect allocates per-pass buffers (`renderer.ts:1663–1677`) | `acquireFbo`/`releaseFbo` | LRU cap + peak memory log; assert < 512 MB on a 4-layer 4K project |
| P2-03 | GIF encoder is JS (`gifEncoder.ts`) vs native `libalight-giflib.so` | — | match palette (256, median-cut), dithering, frame disposal; assert byte-count within 5 % |
| P2-04 | `verifyAllEffects` compiles everything on demand but no CI gate | `shaderCompiler.ts:348` | run it headless (SwANGLE) on PRs; fail build if < 315/315 |
| P2-05 | No shader cache across sessions (browser caches JS, not GLSL) | `ShaderRegistry.cache` | warm-start via CSS/JS preload of the program list; measure first-frame time |
| P2-06 | `Math.random()` used for effect UIDs and any unseeded noise | `catalog.ts:166`, `mulberry32` exists but unused for effects | seed all randomness from project id for deterministic exports |
| P2-07 | No colour management: sRGB assumed end-to-end | whole pipeline | expose working space + output primaries in export options |
| P2-08 | Text has no `italic`, no per-run styling, no vertical align, no autoshrink | `TextData` | see P0-04 |

---

## 5. Explicitly out of scope for "engine identical"

The APK is a **product**; the web build is an **engine**. These are product-shell features, not engine
behaviour, and should be listed as *deliberately absent*, not as bugs:

- Monetization: `assets/crisper/mnt.js` (paywall/survey/ad funnel), premium feature gating
  (`advancedEasing`, `layerParenting`, `cameraObject`, `watermarkRemoval`, `premiumEffect/*`).
- Watermark rendering and removal purchase flow.
- Accounts, cloud backup, Firebase auth/analytics, Crashlytics, Play Integrity (`libpairipcore.so`,
  `libstub.so`).
- Template marketplace, tutorials, creator program, hometab Lottie spinner.
- Android-specific I/O: SAF project picker, share sheet, notification export service.

Antigravity should **confirm** this list rather than treat omissions as defects. If any of these is
required, it is a product decision, not a parity fix.

---

## 6. Build the proof — parity harness (required before signing off "identical")

You cannot claim parity without a rig, and today there is none.

**6.1 Shader conformance (cheap, do first)**
```
npm run build
npx vite --port 4173
# in-page: registry.verifyAllEffects(getEffects())
```
Gate: **315/315 shader programs compile**, 0 failures. Current known-fix code paths
(`shaderCompiler.ts:40–94`) exist precisely because some fail without them — the gate protects them.

**6.2 Golden-frame diff (the real test)**
1. Build a **parity project** containing: one shape layer, one text layer, one image layer, one video
   layer, and a stack of one instance of every non-internal, non-deprecated effect at default params.
2. Render frame N at 1080×1080 in the APK (deterministic: pause, seek, screenshot) and in the web
   (deterministic: fixed clock, seeded RNG, `preserveDrawingBuffer` readback).
3. Compare: PSNR + SSIM + ΔE2000 on the layer-only region.
4. Thresholds by class:
   - **Pure-shader effects:** PSNR ≥ 45 dB, ΔE2000 p95 ≤ 1.0 (they share identical GLSL — anything
     worse is a pipeline bug, not rasterizer noise).
   - **Shape layers:** SSIM ≥ 0.99, boundary Δ ≤ 1 px.
   - **Text layers:** baseline Δ ≤ 1 px, advance Δ ≤ 0.5 px per glyph run (rasterizer differences are
     allowed inside the glyph, not in the layout).
5. Publish a per-effect table. Any effect below threshold opens a ticket with its frame.

**6.3 Project round-trip**
`AM XML → web import → export AM XML → diff`. Expect attribute-level equality except for normalised
`maxOverdraw`/`max-overdraw`, and document every tolerated diff.

**6.4 Video determinism**
Burn a frame counter into a source, export 10 s at 30 and 60 fps, `ffprobe`-extract every frame,
assert index equality (currently expected to fail → P0-06).

**6.5 Audio null test**
Same 3-layer mix through the APK export and the web export; align by first non-zero sample; assert
null-difference ≤ −60 dBFS.

---

## 7. Confirmation protocol for Antigravity

Read this document, **do not implement yet**. Your job is to confirm or dispute each claim with
evidence, then return a signed table.

### 7.1 Steps
1. Re-derive the numbers in §1 yourself:
   - `python scripts/extract_apk.py` (regenerates `effects.json`, `presets.json`, `shapes.json`) and
     confirm 315 / 250 / 20 unchanged.
   - Parse `assets/effects/*.xml` for root attrs, param tags, pass attrs, script API usage, and
     confirm this document's counts.
2. Open every `file:line` cited in §2–§4 and confirm the code is as described.
3. For each P0 item, state whether the described symptom is **real**, **real-but-cosmetic**, or
   **not real**, with a reproduction.
4. Run §6.1 and attach the pass/fail count.
5. Dispute anything you disagree with — especially **P0-03** (whether a tessellator is genuinely
   required or whether higher-resolution rasterization + `evenodd` handling is sufficient) and
   **P1-06** (whether the resampler delta is audible). Those are the two judgement calls.
6. Propose the implementation order you would actually run, with rough effort, and flag anything the
   list missed.

### 7.2 Sign-off table

| ID | Claim | Severity | Confirmed? | Evidence / reproduction | Notes |
| --- | --- | --- | --- | --- | --- |
| P0-01 | Pass `blend` unimplemented; AM default is not overwrite | high | ☐ | | |
| P0-02 | `textrand`, `timecode` no-op; `counter`/`textprogress` hardcoded | high | ☐ | | |
| P0-03 | Vector fidelity — tiered: fill rule + miter + dash, then 2× supersample; tessellator only if the gate fails | medium | ☐ | | amended v1.1 |
| P0-04 | Text model + layout divergence (weight hardcoded 700, no italic/stroke/shadow/shaping) | high | ☐ | | |
| P0-05 | Scripts run unsandboxed on main thread; failures silently bypass effects | high | ☐ | | |
| P0-06 | Video seek on export is awaited but unverified (300 ms timeout, no PTS check) | high | ☐ | | amended v1.1 |
| P0-07 | `compat="acScreenNorm-y"` dropped — 4 effects (chromatic-zoomblur, colorbalance, mattefringe, omino-glass) render Y-inverted | high | ☐ | | added v1.2 |
| P1-01 | `editMode`/`selected` hardcoded | medium | ☐ | | |
| P1-02 | `autoTransform` drops `text`/`shaderGroups` | low | ☐ | | |
| P1-03 | Font inventory 17 vs 232 | medium | ☐ | | |
| P1-04 | Export codec/container parity (no HEVC/AV1/alpha/image-sequence) | medium | ☐ | | |
| P1-05 | 10-bit/HDR/rotation/VFR video sources unhandled | medium | ☐ | | |
| P1-06 | Audio resampler parity vs SoX coefficient tables | medium | ☐ | | |
| P1-07 | Residual scene-graph gaps (camera object, docked parenting, group bounds) — nested scenes already work | high | ☐ | | amended v1.1 |
| P1-08 | `iterations` hard cap at 10 | low | ☐ | | |
| P1-09 | Premultiplied-alpha pipeline inconsistency | medium | ☐ | | |
| P1-10 | `afxver="2"` dropped — 3 effects (brightcont2, colorize, fractalwarp4); unmodelled param-format version | low | ☐ | | added v1.2 |
| P2-01…08 | Polish list | low | ☐ | | |
| §5 | Out-of-scope list is correct and complete | — | ☐ | | |

### 7.3 What "confirmed" means
- **Confirmed** → the item is real as written; you have a file:line or a reproduction.
- **Amended** → real but different root cause or severity; write the corrected version.
- **Rejected** → not real; show the code that already handles it.
- **Blocked** → needs a decision from Olivia (e.g. "is browser tone-mapping of HDR acceptable?").

---

## 8. Decisions that need a human, not an agent

1. **Pixel-identity contract.** Is §0's "math-identical + tolerance" acceptable, or is bit-exactness
   required for pure-shader effects only? (Recommend: shader-only bit-exact at ΔE p95 ≤ 1.0.)
2. **P0-03 scope.** **Resolved v1.1:** tiered — config parity, then supersampling, tessellator only if
   the golden-frame gate still fails. Re-open only if tier 1+2 miss SSIM ≥ 0.99.
3. **HDR/10-bit.** Accept browser tone-mapping, or restrict import to 8-bit SDR with a warning?
4. **Product shell.** Confirm §5 stays deliberately absent (no paywall/watermark/cloud), or state which
   of them must be rebuilt.

---

## 9. Execution order (v1.2 — approved start)

Sequenced so every fix is **verifiable before the next** one lands, and so nothing masks anything else.

| Phase | Items | Effort | Why this order |
| --- | --- | --- | --- |
| **0** | §6.1 shader gate (`315/315 compile`) + a `verifyAllEffects` failure report in the UI | 2 h | Tells you immediately when a later change breaks a shader. Without it you are flying blind. |
| **1** | **P0-01** pass blend · **P0-02** text scripts · **P0-06** verified seek | ~1 day | Three small, self-contained, high-confidence diffs. Touching different subsystems, so they parallelise safely. **This is the agreed start.** |
| **2** | **P0-05** worker sandbox + surface script errors · **P1-09** premultiplied-alpha audit · **P0-07** `compat` flip | ~2 days | **Pull P0-05 forward.** Until script failures are visible instead of silently bypassing effects, P0-02's fix and every effect change after it are unverifiable — you'd be shipping blind. P1-09 is one convention pass that kills halos across `glow`/`shadow`/`blur` at once. P0-07 lands here because the sign of the flip must be *measured* against a captured APK frame, which needs the phase-0 harness. |
| **3** | **P0-04a** text model: real weight/italic, stroke, shadow, vertical align (layout shaping deferred) · **P0-03 tier 1** fill rule / miter / dash | ~2 days | Both are model+rasterizer work in the same file region; do them together while the context is hot. |
| **4** | **P0-03 tier 2** 2× supersample on export · **P1-04** HEVC/AV1/alpha/image-sequence | ~2 days | Quality work on top of a correct base. Gate: §6.2 golden-frame diff at the stated thresholds. |
| **5** | §3 remainder: P1-01, P1-03, P1-05, P1-06, P1-07, P1-08 · then §4 | — | Capability, not correctness. |

**Non-negotiable gate:** nothing in phase 3+ ships without the §6.2 harness producing a per-effect table.

---

## Changelog

**v1.6 (2026-11-21)** — P0-09: the clipping-mask binding, closed by a real shared project.
- `clippingMask="true"` is a **flag on the layer being clipped**, not a blend mode. The clipper is a
  separate layer above it carrying `blending="mask"` (or `"exclude"`). Importing shared project
  `i1MwzBcB9D` proved it: video `id="8"` has the flag, rectangle `id="13"` has `blending="mask"`.
- The codec had the two fused, so the clipped video masked the scene and the matte rectangle showed
  through — "the rectangle instead of the video".
- **Model:** `Layer.clippedToMask?: boolean`, stored only when `blendMode ∉ {mask, exclude}` (on a
  clipper the flag is redundant, so the round trip settles).
- **Codec:** import reads the flag separately; export writes `clippingMask="true"` from
  `clippedToMask || 'clipping-mask' || 'exclude'` and `blending="mask"|"exclude"` from the blend mode.
- **Renderer:** `clipping-mask` is no longer a mask composite; only `mask` and `exclude` composite.
  `isMaskBlendMode` returns true for `mask` alone; `blendModeToXml('mask')` now returns `"mask"`.
- Gate extended with PS-11 and a `clippedLayer` fixture; the shared project round-trips 14/14 mask
  lines and re-imports with `clipped=6 clippers=8 wrongly-masked=0`. See `PARITY_SWEEP_5.0.280.md` §9.
- Still open: whether AM 5.0.280 treats `Screen` as a no-op (needs a device capture), and a keyed
  matte has not been compared frame-by-frame against a device recording.

**v1.5 (2026-11-21)** — O1 and O2 closed by reading the serializer.
- **O1 closed — no spelling exists.** `TextElementTypeImpl.serialize` writes `size`, `font`, `wrapWidth`,
  `align` and `<content>`; `StyledText` has no spacing field. AM's text spacing is the `text-spacing`
  effect (`letterspacing` / `linespacing`). The codec's `1.2` / `0` defaults are therefore correct
  behaviour, not a gap, and no attribute was invented.
- **O2 closed — stroke is an edge decoration.** `EdgeDecorationKt.serialize` writes
  `<path-stroke direction cap join start end end-size>`; `<stroke>` is the freehand drawing stroke
  (`color width type points`, where `type` is the pen/eraser tool). The exporter now emits the real
  element, with `cap`/`join` only when they differ from AM's defaults, and still reads the old
  `<stroke endType>` form. `<shadow>` alpha is `<opacity>`, offset is a keyable child.
  **No dash attribute exists** — the model's dash fields are web-only.
- Vocabulary from `<clinit>`: `StrokeCap` = `butt|round|square`, `StrokeJoin` = `miter|round|bevel`,
  `StrokeEnd` = 13 ids, `EdgeDecorationDirection` = `INSIDE|OUTSIDE|CENTERED`.
- Gate extended with PS-08…PS-10 in `PARITY_SWEEP_5.0.280.md`; `check_xml_roundtrip.ts` asserts all three.

**v1.4 (2026-11-21)** — parity sweep against the APK, codec focus.
- **P0-08 added and fixed:** XML export dropped fill colour, gradients, paths, shape ids/params, strokes,
  shadows, freehand strokes, media references, audio gain, camera fog/focus and visibility. The writer now
  covers the whole model; `scripts/audit/check_xml_roundtrip.ts` gates it, including the APK's own
  `assets/hometab/beta_anim.xml`.
- **Three codec defects fixed alongside:** `type="string"` parsed as float (orthographic camera reset),
  `modifiedTime` regenerated on import (unstable exports), group `<fillColor>` dropped when
  `fillType="none"`.
- **New:** `PARITY_SWEEP_5.0.280.md` — the full surface matrix with per-row evidence and the open list.
- Audited and left alone: 6 `shake2` presets carry an undeclared `speed` prop (AM's own XML has no such
  param either); `fastMath` is carried but never compiled; `transform.skew` has no UI; `groupMaskMode` is
  written by the store and read by nobody.

**v1.3 (2026-11-20)** — blend mode reverse (`P1-09b`): 29 `BlendingMode` constants, 24 catalogue effect
ids, 5 native composites; `screen` corrected from catalogue id to native composite.

**v1.2 (2026-11-19)** — compatibility / legacy effect audit.
- **P0-07 added:** the `compat` root attribute is dropped by the extractor (`"compat" in effect` is false
  for all 315). Four effects — `chromatic-zoomblur`, `colorbalance`, `mattefringe`, `omino-glass` — declare
  `compat="acScreenNorm-y"` and read `acScreenNorm` as both a sample coordinate and screen-space geometry,
  so they render Y-inverted relative to the APK. One conditional flip in `buildVertexSource`.
- **P1-10 added:** `afxver="2"` is dropped on `brightcont2`, `colorize`, `fractalwarp4`. Named as a risk,
  not a defect; the golden-frame gate must clear it.
- **§1 corrected:** deprecated count is **86** (`deprecated="true"`), not 120 — 34 effects explicitly say
  `deprecated="false"` and 195 omit the attribute. All 86 ship and run through the normal pipeline.
- Documented that AM's deprecated effects are **separate definitions, not aliases** of their replacements
  (53 same-stem families; `oscillate3` adds `direction` that `oscillate`/`oscillate2` lack).
- Added P0-07 to phase 2 of §9.

**v1.1 (2026-11-19)** — after external review by Gemini.
- **P0-03 amended:** demoted from high to medium; full tessellator replaced with a three-tier plan
  (Canvas2D config parity → supersampling → tessellator only if the gate fails). Reviewer was right that
  a GPU ear-clipping tessellator is overkill for ~90 % of the visual gap.
- **P0-06 amended:** mechanism corrected. `prepareMediaAtTime` (`renderer.ts:827`) **does** await a
  `seeked` event on the export path — the defect is that the wait is *unverified* (300 ms timeout, no
  PTS check), not that it is absent. The preview path genuinely does not await, and that stays as-is.
- **P1-07 amended:** "nested scenes missing" was stale — `layer.type === 'group'` already renders into
  `grpFbo` (`renderer.ts:1260–1296`). Item narrowed to camera object, docked parenting, group bounds.
- **P0-01 corrected:** 5 passes across **3** effects (`mattefringe` 1, `smoothedges` 2,
  `spill-cleaner` 2), not 4 effects.
- Added §9 execution order and this changelog.
---

## Appendix A — how this audit was produced

Two throwaway Python scripts parsed the APK assets and the generated JSON. Re-run them to reproduce
every count in §1:

```python
# A.1 effect inventory
import json, os, re, collections, xml.etree.ElementTree as ET
APK = r"...\Alight_Motion_5.0.280_1789568706_latestmodapks.com"
D = os.path.join(APK, "assets", "effects")
root_attrs, param_tags, pass_attrs = collections.Counter(), collections.Counter(), collections.Counter()
am_api, env_fields, el_fields = collections.Counter(), collections.Counter(), collections.Counter()
for f in [x for x in os.listdir(D) if x.endswith(".xml")]:
    r = ET.parse(os.path.join(D, f)).getroot()
    root_attrs.update(r.attrib.keys())
    for p in r.iter("params"):
        for c in p:
            param_tags[c.tag] += 1
    for ps in r.iter("passes"):
        for c in ps:
            pass_attrs.update(("pass",) + tuple(c.attrib.keys()))
    for sc in r.iter("script"):
        code = sc.text or ""
        am_api.update(m.group(1) for m in re.finditer(r"\bAM\s*\.\s*(\w+)", code))
        env_fields.update(m.group(1) for m in re.finditer(r"\benv\s*\.\s*(\w+)", code))
        el_fields.update(m.group(1) for m in re.finditer(r"\bel\s*\.\s*(\w+)", code))
print(len(os.listdir(D)), root_attrs, param_tags, pass_attrs, am_api, env_fields, el_fields)
```

```python
# A.2 dex class surface (engine subsystems actually present in the APK)
import re, os
APK = r"...\Alight_Motion_5.0.280_1789568706_latestmodapks.com"
pat = re.compile(rb"L?com/alightcreative/[A-Za-z0-9_/$]{2,70}")
found = set()
for f in [x for x in os.listdir(APK) if x.endswith(".dex")]:
    found.update(m.group().decode() for m in pat.finditer(open(os.path.join(APK, f), "rb").read()))
for s in sorted(s for s in found if any(k in s.lower() for k in ("rendering", "visualeffect", "gl/", "scene/"))):
    print(s)
```

---

## Appendix B — file map of the web engine (for reviewers)

| File | Lines | Role |
| --- | --- | --- |
| `src/engine/renderer.ts` | 2,475 | everything: WebGL2 setup, FBO pool, layer rasterization, effect passes, compositing, video sync, text |
| `src/engine/shaderCompiler.ts` | 393 | GLSL ES 1.00 → 300 es transpile, uniform layout, program cache, `verifyAllEffects` |
| `src/engine/scriptRuntime.ts` | 275 | `AM_RUNTIME`, `runEffectScript`, shape `getPath`/`getHandles` |
| `src/engine/catalog.ts` | 197 | effect/preset/shape load, param defaults, instance creation |
| `src/engine/animation.ts` | ~330 | keyframe eval, easing solver, hz/rpm integration |
| `src/engine/videoExporter.ts` | ~430 | WebCodecs + mp4/webm muxers, offline audio |
| `src/engine/audioEngine.ts` | ~150 | live `AudioContext` graph, buffers, analyser |
| `src/engine/gifEncoder.ts` | ~120 | JS GIF encoder |
| `src/engine/amXmlCodec.ts` | ~600 | AM project XML import/export |
| `src/engine/amLinkImporter.ts` | ~370 | AM share-link import |
| `src/engine/mediaReplace.ts` | ~90 | media relink |

---

*End of document. Do not amend the claims without evidence; add an "Amended" note and re-issue.*

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[ENGINE_PARITY]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\ENGINE_PARITY.md` |
| Status | active |

Carry forward: P0 backlog v1.2 - re-read the P0 list against current code before scheduling anything.
