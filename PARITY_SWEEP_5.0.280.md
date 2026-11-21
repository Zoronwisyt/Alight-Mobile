# PARITY SWEEP — Alight Motion 5.0.280 APK vs `alight-motion-web`

**Purpose:** answer one question with evidence — *is the web build 1:1 with the APK, and if not, where
exactly does it diverge?* This pass re-checked every surface that has a machine-checkable answer and
fixed the one that was losing user data.

| Field | Value |
| --- | --- |
| APK | `Alight_Motion_5.0.280_1789568706_latestmodapks.com` (`com.alightcreative.motion`, versionCode `1028519`) |
| Web | `alight-motion-web`, `package.json` version `5.0.280` |
| Sweep date | 2026-11-21 |
| Method | APK assets + dex literals + `BlendingMode.<clinit>`; web source read end to end; four executable gates |
| Head commit at start | `07403a0` (Screen blend fix) |

| Marker | Meaning |
| --- | --- |
| ✅ verified | both sides read, and a gate asserts it |
| ⚠️ predicted | one side read, the other inferred — named in the row |
| ❌ open | needs a capture or a dialect the APK has not surrendered yet |

---

## 1. The headline

**The engine was already close. The save path was not.** `exportProjectToAmXml` wrote a document with
no shape geometry, no stroke, no shadow, no gradient, no media reference, no audio gain, no fog and no
visibility flag. A project made in the web build and exported as AM XML came back as coloured
rectangles at default size — the renderer was fine, the writer was half a document.

This pass rewrites the writer, adds a round-trip gate, and fixes five smaller defects found on the way.
A second pass the same day read the serializers and closed **O1** and **O2** — see §8. A third pass
imported a real shared project and closed **O5**, the clipping-mask binding that made a matte
rectangle stand in for the video it was supposed to clip — see §9.

| # | Defect | Where | Status |
| --- | --- | --- | --- |
| F1 | Exporter dropped fill colour, gradient, path, shape id, shape params, stroke, shadow, freehand strokes, media refs, playback speed, trim, gain, mute, fog, focus, visibility | `src/engine/amXmlCodec.ts:118` (`layerToXml`) | ✅ fixed |
| F2 | `type="string"` properties were parsed as floats, so an orthographic camera came back perspective | `amXmlCodec.ts:489` | ✅ fixed |
| F3 | `modifiedTime` was regenerated on import, so every export→import→export pass differed | `amXmlCodec.ts:1108` | ✅ fixed |
| F4 | A group with `fillType="none"` lost its `<fillColor>` (AM keeps one — see `beta_anim.xml:62`) | `amXmlCodec.ts:238` | ✅ fixed |
| F5 | Freehand layers were written as `<shape>`, discarding every stroke; AM's tag is `<drawing>` | `amXmlCodec.ts:130` | ✅ fixed |
| F6 | `<stroke endType="…">` was an **invented** element; AM writes stroke as `<path-stroke direction cap join …>` and shadow alpha as `opacity` | `amXmlCodec.ts:293`, `:305` | ✅ fixed (second pass) |

---

## 2. Surface matrix

| Surface | APK ground truth | Web implementation | Verdict |
| --- | --- | --- | --- |
| Effect catalogue | **315** `assets/effects/*.xml` | `public/am/effects.json` — 315 | ✅ `compat-parity.mjs`: 0 id drift, 0 param drift, 0 shader-body drift |
| Presets | **250** across 13 packs | `public/am/presets.json` — 250 | ✅ 0 missing, 0 prop drift, 0 keyframe drift |
| Shapes | 20 XML | `public/am/shapes.json` — 20, real `getPath()` scripts | ✅ (unchanged this pass) |
| Blend modes | 29 `BlendingMode` constants: 24 effect ids + 5 native (`NORMAL, SCREEN, MASK, CLIPPING_MASK, EXCLUDE`) | `BLEND_MODE_TABLE` (29) + `NATIVE_BLEND_MODES` (5) | ✅ `check_blend_modes.ts` |
| Clipping mask binding | `clippingMask="true"` marks the layer **being clipped**; the layer above carries `blending="mask"` (or `"exclude"`) | `Layer.clippedToMask` + `blendMode`, kept separate through import and export | ✅ **O5 closed** — §9 |
| XML **import** | `assets/hometab/beta_anim.xml` + dex attribute names | `amXmlCodec.ts:692` (`parseXmlLayer`), 59 attribute names read | ✅ imports the APK's own sample; 13/13 layers, gradients, nested scene, text |
| XML **export** | AM writes `fillColor`, `gradient`, `path`, `stroke`, `shadow`, `effect`, `content`, `embedScene` | `amXmlCodec.ts:118`–`:377` | ✅ after F1 — `check_xml_roundtrip.ts` |
| Fonts | `com.google.android.gms.fonts` tokens, `Roboto Black:…?weight=900` | `fontNames.ts` token codec + `check_font_match.ts` | ✅ gate PASS |
| Font archives | — (APK bundles none) | `fontZipImport.ts` + `check_font_zip.ts` | ✅ gate PASS |
| Easing | 10 easing classes | `EasingType` — same 10 | ✅ (unchanged; `GRAPH_EASING_AUDIT.md`) |
| Text metrics | stored size = 1/3 painted em (`textMetrics.ts` anchors) | `AM_TEXT_UNIT_PX = 3` | ✅ export/import round-trips at 1e-4 |
| Text line height / letter spacing | **No XML spelling exists.** `TextElementTypeImpl.serialize` writes exactly `size font wrapWidth align` plus `<content>`, and `StyledText` has only `align font fontSize text wrapWidth` — no spacing fields | `textData.lineHeight` / `.letterSpacing` render, and are **web-only state**; AM expresses spacing through the `text-spacing` effect's `letterspacing` / `linespacing` params | ✅ **O1 closed** |
| Stroke cap / join / dash | `<path-stroke direction cap join start end end-size>` (`EdgeDecorationKt.serialize`); ids `butt/round/square` and `miter/round/bevel`; **no dash attribute exists** | model has them; exporter now emits the real element | ✅ **O2 closed** |
| Nested scenes (elements) | `NestedSceneElementTypeImpl`, `PrecomposeType` | group copy, not a scene reference | ❌ known **A1** (`FEATURE_GAPS…`) |
| Re-timing | `ReTimingMethod` (5 modes) | `retime.method` round-trips; source window not modelled | ⚠️ partial — **A2** |
| Media transport | `.amproj` zip (project.xml + media) | XML export carries references only; no `.amproj` writer | ❌ **O3** |
| Pixel identity | nanovg rasteriser + native text shaper | Canvas2D + browser shaper | ❌ out of contract, by design (§0 `ENGINE_PARITY.md`) |

---

## 3. What the writer now emits

Every field below is written **and** re-read by the gate's fixture (`check_xml_roundtrip.ts`), which
covers all ten layer types in one project.

| Element / attribute | Written at | Read at |
| --- | --- | --- |
| `id`, `label`, `startTime`, `endTime`, `parent`, `is3D` | `amXmlCodec.ts:250` | `parseXmlLayer` |
| `hidden="true"` when `!visible` | `:244` | `:1004` |
| `s=".roundrect"` shape id + `<property name>` params | `:248`, `:293` | `:753`, `:791` |
| `fillType`, `fillColor`, `<fillColor value/kf>` | `:132`, `:238` | `:711` |
| `<gradient type startColor midColor endColor start end>` | `:243` | `:703` |
| `<path d>` for vector layers (mirrors `renderer.buildVectorPath`) | `:83`, `:285` | `:806` |
| `<path-stroke direction cap join end-size><color/><size/></path-stroke>` | `:293` | `:674` |
| `<shadow direction><color/><opacity/><size/><hardness/><offset/></shadow>` | `:305` | `:713` |
| `<drawing><stroke points color width opacity>` | `:131`, `:326` | `:518` |
| media `src`, `speed`, `inTime`, `gain`, `muted`, `fillImage` | `:206`–`:233` | `:893`–`:948` |
| `<gain>` for audio volume keyframes | `:340` | `:947` |
| camera `fov`, `cameraType`, `fogEnabled`, `<fogColor>`, `<fogNearZ>`, `<fogFarZ>`, `<focusDistance>`, `<focusBlurStrength>` | `:348` | `:1000` |
| `clippingMask="true"` (clipped layer) / `blending="mask"\|"exclude"` (clipper) | `:149`, `:150` | `:836`–`:910` |
| `retime`, `cropMode` | `:196` | `:1082` |
| nested `<scene width height bgcolor fps totalTime>` | `:369` | `:966` |
| project `title width height exportWidth exportHeight bgcolor totalTime fps modifiedTime` + `<bookmark t>` | `:379` | `:1045`, `:1089` |

The two intentional normalisations:

1. **One settle pass.** Importing an effect fills that effect's declared default params, so the second
   export legitimately carries more `<property>` rows than the first. The gate asserts
   `export₂ == export₃`, not `export₁ == export₂`.
2. **Default rectangle.** `<shape>` with no `s` and a `<shape s=".rect">` are the same element to AM.
   The gate canonicalises them together instead of pretending the distinction exists.

---

## 4. Findings that are not defects

| Observation | Evidence | Reading |
| --- | --- | --- |
| 6 `shake2` presets carry a `speed` prop the effect does not declare | `compat-parity.json` → `presetPropsDroppedByRenderer: [["speed", 6]]`; `shake2` declares `mag, freq, evolution, seed, angle, slack, zshake` | The APK's own effect XML has no `speed` param either, so AM ignores it too. Parity, not a gap. ⚠️ inferred on AM's side |
| `fastMath` is `true` on 303 web shaders, absent in the APK XML, and never read by the renderer | `extract_apk.py:446` (`!= "false"`), `project.ts:393`, no consumer in `src/` | Inert data. The two extractors disagree on the default (`customEffects.ts:338` uses `=== 'true'`), but nothing compiles against it |
| `transform.skew` is evaluated by the renderer but no UI sets it | `renderer.ts:1628`; only initialisers elsewhere | Latent, not reachable — no codec work warranted |
| `groupMaskMode` is written by the store and read by nobody | `useEditorStore.ts:1041`; zero readers | Dead field inside the web build; not an APK concept |
| 395 `fastMath`, 52 `category`, 177 section/tip "drift" entries in the compat audit | `compat-parity.json` | Extraction defaults (`fastMath→true`, `category→other`) and non-param rows, not data loss |

---

## 5. Open items — each needs one specific thing

| ID | Open question | What settles it |
| --- | --- | --- |
| **O1** | ~~XML spelling for `lineSpacing` / `letterSpacing` / vertical alignment~~ **CLOSED — no spelling exists** | `TextElementTypeImpl.serialize` writes `size font wrapWidth align` + `<content>` only; `StyledText` has `align font fontSize text wrapWidth` and nothing else. Text spacing is the `text-spacing` effect (`letterspacing`, `linespacing` in `assets/effects/text-spacing.xml:6-7`). Nothing to invent; `textData.lineHeight` / `.letterSpacing` are web-only state |
| **O2** | ~~XML spelling for stroke cap / join / dash~~ **CLOSED** | `EdgeDecorationKt.serialize` (jadx, classes7): tag is `path-stroke` (or `border` / `shadow` / `glow`), attributes `direction cap join start end end-size`, and `cap` / `join` / `start` / `end` are written **only** when they differ from the caller's default (butt / miter / none). Ids from `<clinit>`: `StrokeCap` = `butt round square`, `StrokeJoin` = `miter round bevel`, `StrokeEnd` = 13 ids from `none` to `teardrop-filled`. **There is no dash attribute** — the APK's edge decorations carry no dash, so the model's `dash` fields are web-only |
| **O3** | `.amproj` export (project.xml **and** media bytes) | A scope decision — the writer half exists, the zip half does not |
| **O4** | Nested-scene reference (`<embedScene>` as a *reference*, not a copy) | The A1 ticket in `FEATURE_GAPS_APK_VS_WEB.md` |
| **O5** | ~~Which layer a `clippingMask` binds to~~ **CLOSED — see §9** | Settled by a real shared project, not a probe: in `i1MwzBcB9D` the video carries `clippingMask="true"` and the rectangle above it carries `blending="mask"` |

---

## 6. Reproduce

```bash
# XML round-trip gate (fixture + the APK's own sample)
npx esbuild scripts/audit/check_xml_roundtrip.ts --bundle --platform=node \
  --format=esm --packages=external --outfile=scripts/audit/out/check_xml_roundtrip.mjs
node scripts/audit/out/check_xml_roundtrip.mjs \
  "C:/Users/jeduc/Downloads/AM Web 2/Alight_Motion_5.0.280_1789568706_latestmodapks.com/assets/hometab/beta_anim.xml"

# blend table
npx esbuild scripts/audit/check_blend_modes.ts --bundle --platform=node --format=esm \
  --outfile=scripts/audit/out/check_blend_modes.mjs && node scripts/audit/out/check_blend_modes.mjs

# effects + presets corpus
node scripts/audit/compat-parity.mjs

# fonts
npx esbuild scripts/audit/check_font_match.ts --bundle --platform=node --format=esm \
  --outfile=scripts/audit/out/check_font_match.mjs && node scripts/audit/out/check_font_match.mjs
npx esbuild scripts/audit/check_font_zip.ts --bundle --platform=node --format=esm \
  --outfile=scripts/audit/out/check_font_zip.mjs && node scripts/audit/out/check_font_zip.mjs

# type + bundle
npx tsc --noEmit
npx vite build
```

Expected: `PASS` from all three `check_*` gates, `EFFECTS {"xml":315,"json":315}` and
`PRESETS {"apkPresets":250,"jsonPresets":250}` from compat-parity, exit 0 from `tsc` and `vite build`.

---

## 7. Acceptance

| Test | Pass condition | Result |
| --- | --- | --- |
| PS-01 | Every modelled field survives `import(export(x))` across all ten layer types | ✅ |
| PS-02 | `export(import(export(x)))` is byte-identical to `export(import(x))` | ✅ |
| PS-03 | The APK's own `beta_anim.xml` survives export→import→export byte-stable | ✅ |
| PS-04 | The clipper writes `blending="mask"` (or `blending="exclude"`); the clipped layer writes `clippingMask="true"` with no blend mode | ✅ |
| PS-05 | Keframed effect params and their easing survive | ✅ |
| PS-06 | Effect and preset corpora show zero drift | ✅ |
| PS-07 | `tsc --noEmit` and `vite build` exit 0 | ✅ |
| PS-08 | Stroke exports as `<path-stroke>` with AM's direction/cap/join ids, never as an invented `<stroke endType>` | ✅ |
| PS-09 | Shadow alpha exports as `<opacity>`, offset as a keyable child | ✅ |
| PS-10 | The text element writes only AM's five fields — no invented line-height or letter-spacing attribute | ✅ |
| PS-11 | A clipped layer survives `import(export(x))` as `clippedToMask`, and the flag never lands on a clipper | ✅ |

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[PARITY_SWEEP_5.0.280]]` |
| Gate | `scripts/audit/check_xml_roundtrip.ts` |
| Graph | `graphify-out/` — rebuilt after this pass |
| Status | active |

Carry forward: the engine surfaces (effects, presets, blend, fonts, easing) hold. The **codec** was the
weak seam and is now gated. The remaining real gaps are the ones already named in
`FEATURE_GAPS_APK_VS_WEB.md` — nested scenes, re-timing, and a `.amproj` writer so media can travel.

---

## 8. O1 and O2, closed from the APK (second pass, same day)

Both open items were closed by reading the **serializer**, not by finding a sample. The method to look
for is `serialize(SceneElement, String, XmlSerializer)`, which dispatches per element type:

| Question | APK anchor | Answer |
| --- | --- | --- |
| Where are text line spacing and letter spacing written? | `TextElementTypeImpl.serialize` (jadx) | **Nowhere.** It writes `size`, `font`, `wrapWidth`, `align` and a `<content>` child — five things. `StyledText` declares `align font fontSize text wrapWidth` and no spacing field at all. AM expresses spacing as the `text-spacing` effect, whose params are literally `letterspacing` / `linespacing` (`assets/effects/text-spacing.xml:6-7`). |
| Where are stroke cap / join / dash written? | `EdgeDecorationKt.serialize` (jadx, classes7) | On `<path-stroke>`, as `cap` / `join` / `start` / `end`. **Not** on `<stroke>` — that tag is the freehand drawing stroke (`color width type points`, where `type` is the pen/eraser tool). **There is no dash attribute.** |
| What are the legal ids? | `StrokeCap.<clinit>`, `StrokeJoin.<clinit>`, `StrokeEnd.<clinit>` | `butt \| round \| square`; `miter \| round \| bevel`; and 13 end styles from `none` to `teardrop-filled`. `EdgeDecorationDirection.<clinit>` gives `INSIDE \| OUTSIDE \| CENTERED`, lowercased on write. |

Two consequences the exporter now honours:

1. **`<stroke endType="…">` was an invented element.** It is replaced by AM's real
   `<path-stroke direction="…">`, with `cap` and `join` emitted only when they differ from the
   defaults (`butt`, `miter`) because that is exactly what `EdgeDecorationKt.serialize` does.
   The old form is still **read** on import, so projects saved by the previous build do not break.
2. **A shadow's alpha is `opacity`,** and its offset is a keyable child element, never an attribute.
   Both spellings are now written the AM way and both are read back.

A keyable value in AM is `<tag value="…"/>` when unkeyed and `<tag><kf t v e s/></tag>` when keyed —
already the shape this writer used. One small gap noted and left alone: AM can also write a `s`
(smoothing) attribute on `<kf>`; the codec does not emit it because the model has no smoothing field.

---

## 9. O5, closed by a shared project (third pass)

**Symptom.** Importing a shared link project and pressing play showed the mask *rectangle* where the
video should be. The video was gone; the matte was on screen.

**Ground truth.** Shared project `i1MwzBcB9D-df4e7c0a0523a237`
(`share/u/A7E1PHfBOLbjchmAEUBK2IOSYu32/p/i1MwzBcB9D.../projectfiles.zip`, 7,040,080 bytes →
`4801350B-54BD-4FF0-9371-3166CC342684.xml`, 75.7 KB):

```xml
<shape id="8"  startTime="0" endTime="633" fillType="media" clippingMask="true" s=".rect">   <!-- the video -->
<shape id="13" startTime="0" endTime="633" fillType="color" blending="mask"    s=".rect">   <!-- Rectangle 1 -->
```

The same pair repeats in `Group 1` (`6`/`11`) and in the `Group and Mask 1 Copy` copies (`7`/`12`).
Video first, clipper second — the clipper sits **above** the thing it clips and composites over the
accumulated scene.

**The reading.** `clippingMask` and `blending` are two attributes for two concepts, and the codec
had them fused:

| Attribute | On which layer | Meaning |
| --- | --- | --- |
| `clippingMask="true"` | the layer **being** clipped | a flag; it has no blend behaviour of its own |
| `blending="mask"` | the **clipper** | this layer multiplies what is beneath it by its alpha |
| `blending="exclude"` | the **clipper** | inverse mask |

**What was wrong.** `parseXmlLayer` mapped `clippingMask="true"` onto `blendMode: 'mask'`, and the
exporter derived the same attribute back out of the blend mode. So:

1. the **video** became a clipper — it masked the scene by its own alpha instead of drawing;
2. the **rectangle** was also a clipper, so its opaque alpha passed the scene through the matte,
   and the rectangle's own fill was what you saw.

That is exactly "the rectangle instead of the video".

**The fix.**

| File | Change |
| --- | --- |
| `src/types/project.ts` | `Layer.clippedToMask?: boolean` — the flag, separate from `blendMode` |
| `src/engine/amXmlCodec.ts` | import stores `clippingMask` in `clippedToMask` and leaves `blendMode` to `blending`; export writes `clipFlag` from `clippedToMask \|\| 'clipping-mask' \|\| 'exclude'` |
| `src/engine/blendModes.ts` | `isMaskBlendMode` is `mask` only; `blendModeToXml` maps `mask → "mask"`, `exclude → "exclude"`, `clipping-mask → null` |
| `src/engine/renderer.ts:2297` | `clipping-mask` is no longer a mask composite — it draws normally |

One normalisation falls out of the split: on a clipper the flag is redundant, because `blending`
already identifies it. The importer therefore stores `clippedToMask` only when
`blendMode ∉ {mask, exclude}`, which is what makes `export₂ == export₃` hold on real projects.

**Verification.** Round-tripping the shared project's own XML:

```
original mask lines: 14  exported: 14
re-imported: clipped layers=6  mask clippers=8  wrongly-masked=0
```

`scripts/audit/check_xml_roundtrip.ts` now covers it: the fixture carries a `clippedLayer`
(video, `clippedToMask: true`), the canon includes `clippedToMask`, and PS-08…PS-11 assert the two
attributes stay on their own layers. `beta_anim.xml` still round-trips byte-stable.

**Still open on masks:** whether AM 5.0.280 treats `Screen` as a no-op needs a device capture, and a
mask that is itself animated (a keyed matte) has not been compared frame-by-frame against a device
recording. Neither blocks the fix above.
