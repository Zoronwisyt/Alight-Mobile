# PREVIEW_STATIC_GLITCH_COMPAT_FONTS

Three tickets, one audit. Every claim below is marked:

| Marker | Meaning |
| --- | --- |
| ✅ verified | read out of the code or measured off the APK, in this session |
| ⚠️ predicted | a hypothesis with a named test — do not treat it as fact |
| ❌ open | cannot be settled without an APK capture or a device measurement |

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Reference APK | `Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Reproducer | `scripts/audit/compat-parity.mjs` → `scripts/audit/out/compat-parity.json` |
| Date | 2026-11-19 |

## 0. TL;DR

| Ticket | Verdict |
| --- | --- |
| **1 — preview glitches when parked on one frame** | ✅ **Real, and it is one specific interaction**: the idle render-ahead pump seeks the *same* `<video>` elements the parked frame is displaying, and `seeked` fires `onMediaReady`, which redraws the parked frame, which seeks back. An oscillation, not a random flicker. |
| **2 — are all the compatibility effects the same?** | ✅ **Yes.** 315/315 effect definitions and 250/250 presets are byte-faithful to the APK: zero parameter-membership, order, default, min, max, step, type or shader-source differences. The only seams are metadata that no render path reads — **plus one attribute that is parsed, round-tripped and never used: `locallyApplied`, on 76 of 250 presets.** |
| **3 — do fonts save locally?** | ✅ Mostly. Fonts persist in IndexedDB and rehydrate at boot. **Two gaps:** no `navigator.storage.persist()` (evictable), and fonts are **not** embedded in the project document (media is) — so export or a second browser loses them. |

---

# 1. Ticket 1 — the parked-frame preview glitch

## 1.1 What "staying at one frame" actually runs

While paused, three independent things are live at once:

| # | What | Where |
| --- | --- | --- |
| 1 | A **parked render** — full `renderProject` at the playhead, `useCache: false` | `EditorScreen.tsx:198-218` |
| 2 | A **media-ready redraw** — the renderer calls back, the screen re-renders the parked frame | `EditorScreen.tsx:122-137` |
| 3 | An **idle render-ahead pump** — walks every frame in the project, baking them into the L2 cache | `EditorScreen.tsx:221-294` |

The pump starts 350 ms after the last playhead change (`:283-285`) and then sweeps **forward from the playhead** and wraps (`:227-229`).

## 1.2 G-1 — ✅ confirmed: the pump seeks the same `<video>` the parked frame is showing

The chain, all verified:

```
EditorScreen.tsx:268   renderer.precacheFrameAsync(project, frameIdx, previewQuality)
renderer.ts:1244       await this.prepareMediaAtTime(project, sceneTimeMs)
renderer.ts:986          v.currentTime = targetSec            // seeks the LIVE element
renderer.ts:993          this.uploadVideoTex(entry)            // overwrites the LIVE texture
renderer.ts:720-734    video 'seeked' -> handleFrameReady()
renderer.ts:714-716      if (uploadVideoTex(cur)) this.onMediaReady?.()
EditorScreen.tsx:124-136 requestAnimationFrame -> renderProject(parked, useCache:false)
renderer.ts:1024-1036    if (!isPlaybackActive && |v.currentTime - targetSec| > 0.03) v.currentTime = targetSec
renderer.ts:720-734    'seeked' -> onMediaReady -> redraw  (loop closes)
```

There is **one** `<video>` element per `layerId::src` (`renderer.ts:688-757`, `mediaVideos`). The parked frame and the precache frame are the same texture. Nothing copies it, nothing parks it.

And the drawn pixels are the *wrong* frame while this happens — `renderer.ts:1051-1053` returns `entry.tex` (whatever was last uploaded) even after `hadStaleVideoThisFrame` is set at `:1047`. So the parked canvas shows the *precached* frame's video content, not the parked one.

**Symptom, exactly as reported:** sit on one frame in a project with video → the video layer flips between the parked time and the frame the pump is currently baking, every few hundred milliseconds, with no input.

**Scope:** this needs at least one **visible video layer at the parked time**. A project with no video (or with the video out of range) has no `seeked`, no `onMediaReady`, and does not exhibit G-1. If a no-video project also glitches, it is G-4, not G-1 — measure before assuming.

### The fix, in the order that keeps it honest

**G-1a — isolate the offscreen video pool (the real fix).** Give the precache its own `<video>` per `layerId::src`, never the live ones. `getOrCreateVideoEntry(src, mediaId, layerId)` already keys by layer, so mirroring the map is mechanical:

```ts
// renderer.ts — beside `private mediaVideos`
private offscreenVideos = new Map<string, VideoMediaEntry>();

// precacheFrameAsync / prepareMediaAtTime(project, t, { offscreen: true })
// must resolve entries through offscreenVideos, and uploadVideoTex must never
// be called on a live entry from an offscreen pass.
```

Cost: one extra decoder per distinct video. That is what an editor costs; After Effects keeps its own preview buffers for the same reason.

**G-1b — park guard (a ten-line stopgap if G-1a is too big today).**

```ts
// precacheFrameAsync: refuse to touch media the parked frame is using
if (this.isMediaVisibleAt(this.parkedTimeMs)) return false;
```

with `parkedTimeMs` set by every paused `renderProject` call. This makes the cache stop filling on video projects — correct, and no worse than the current state, which never reads the cache anyway (G-2).

**Do not** "fix" this by removing the `onMediaReady` redraw. That callback is what makes a first video frame appear at all (`renderer.ts:719` `loadeddata`).

## 1.3 G-2 — ✅ confirmed: the parked frame never reads the cache

```
EditorScreen.tsx:134   useCache: false     // media-ready redraw
EditorScreen.tsx:211   useCache: false     // parked render
EditorScreen.tsx:356   useCache: true      // only the playback loop
```

`renderer.ts:1348`:

```ts
const cacheEligible = Boolean(options.useCache) && !isExport && !hasGroupIsolation;
```

So the whole idle pump fills a cache that **only playback** consumes. That is why parked preview is not stable even for a project that has been fully precached: every repaint is a full re-render of every layer, shader and script, at preview scale.

This is the same finding as `PREVIEW_PERF_CHROMA_EXPORT.md` §P-1, now with a second consequence: it also means **parked frames cannot be stable**, because there is no path that ever serves a parked frame from the cache.

**Coupled constraint, restated because it still applies:** flipping `useCache: true` on the parked render without also unifying `playbackScale` will produce resolution pulsing — cached frames are stored at `resolvePlaybackScale` (`renderer.ts:1125-1131`, typically ≈0.55) while misses render at `previewScale × DPR` (`:1326-1329`, up to 1.5). `renderProject` already implements the unified path at `:1366-1385`; the parked caller just has to opt in, **in the same change as the uniform scale** — which `:1366` already provides, so this is now a one-line opt-in plus a removal of the `hasCachedFrame` asymmetry.

## 1.4 G-3 — ✅ confirmed: the pump restarts the whole sweep on every playhead move

```
EditorScreen.tsx:294   }, [currentProject, currentTimeMs, previewQuality, isPlaying, visibilityPaused]);
```

`currentTimeMs` is a dependency. Every arrow-key step, every scrub, every nudge tears the effect down and restarts the sweep at `startFrame` (`:225-229`). On a 4-second 30 fps project that is a 120-frame sweep restarted from zero by a single frame step — and each restarted sweep re-seeks every video layer (G-1).

`hasCachedFrame` (`renderer.ts:1198-1212`) already answers "is this frame covered", so the pump can skip covered frames instead of restarting blind.

## 1.5 G-4 — ⚠️ predicted: idle churn on projects without video

Every stored frame calls `onCacheChange` (`renderer.ts:1195`) → throttled to 180 ms (`EditorScreen.tsx:139-145`) → `setCacheVersion` → an `EditorScreen` re-render. On a long project that is ~5.5 React re-renders per second, forever, while the user is parked and doing nothing.

**Test:** with a 60-second, 30 fps project parked at frame 0, log `requestAnimationFrame` deltas in the console for 20 s. If p95 frame time exceeds ~20 ms while idle, this is contributing. Lowering it to a per-sweep notification is a two-line change.

## 1.6 Ruled out — do not chase these

| Suspect | Why it is not the cause |
| --- | --- |
| Wall-clock animation | ✅ no `Math.random`, `Date.now` or `performance.now` anywhere in `scriptRuntime.ts` or `renderer.ts` — every script is a function of scene time |
| Canvas resize flash | ✅ `renderProject` refuses to resize mid-playback (`:1335-1344`), and `previewQuality` only changes on an explicit user click (`PreviewCanvas.tsx:673`, `:730`) |
| Easing / keyframe evaluation | ✅ deterministic; `GRAPH_EASING_AUDIT.md` already covers its one real bug |
| Selection redraw | ✅ selection is DOM-only (`renderer.ts:1346` comment) |

## 1.7 Acceptance tests

| # | Test | Pass condition |
| --- | --- | --- |
| SG-A1 | Video project, park at t=1000 ms, no input for 30 s | the canvas hash at t=1000 is identical before and after the 30 s |
| SG-A2 | Same, with the console watching `video.currentTime` | `currentTime` stays within ±0.03 s of the parked target for the whole 30 s |
| SG-A3 | Same, count `onMediaReady` calls | 0 after the first settled frame |
| SG-A4 | Press the next-frame key once every 500 ms for 10 s | one render per keypress, not one per pump restart |
| SG-A5 | No-video project, parked, 30 s | canvas hash stable; if it fails, it is G-4 and must be reported as such |
| SG-A6 | Playback unchanged | `window.__previewCacheStats` hit rate on the second play ≥ 80 % on a no-video project |

The hash gate is the same contract as `EDITING_PERFORMANCE.md` §4: **an exact hash, not a perceptual diff.**

---

# 2. Ticket 2 — are the compatibility effects actually the same?

## 2.1 Method

`scripts/audit/compat-parity.mjs` parses the APK's own XML and the web's generated JSON and compares, field by field:

- **definitions** — `assets/effects/*.xml` (315 files) vs `public/am/effects.json` (315 entries)
- **presets** — `assets/effects/presets/*.xml` (13 packs, 250 preset effects) vs `public/am/presets.json` (250 presets across 108 effect keys)

It strips XML comments first. That matters: **two whole classes of false finding disappear when you do.** `bumpmap.xml` declares `texTwirl` and `mask` inside `<!-- -->`, and `coloradj.xml` declares `hue` the same way. A naive scanner reports 60 effects with "missing parameters" and is wrong every time.

Reproduce:

```
node scripts/audit/compat-parity.mjs
```

## 2.2 ✅ Result — the definitions are 1:1

| Axis | Drift |
| --- | --- |
| Effect count | 315 XML ↔ 315 JSON, **0** missing either way |
| Parameter membership | **0** |
| Parameter order | **0** |
| Parameter `default` / `min` / `max` / `step` / `type` / `style` / `srcType` / `invert` / `multiplier` / `ticks` / `snap` | **0** |
| Selector choice counts | **0** |
| `<iterations param=…>` | **0** |
| Shader count per effect | **0** |
| Shader **source** (whitespace-normalised) | **0** |
| Presets present | 250 ↔ 250, **0** drift |
| Preset property values | **0** |
| Preset keyframe times / values / easing strings | **0** |
| Preset `locallyApplied` flags | **0** |

> [!important] This is the headline
> "Some presets are different on the website" is **not** a catalogue problem. Every number that decides how an effect looks — its defaults, its ranges, its shader source, its preset keyframes and easings — is identical to the APK. Whatever he is seeing comes from the render path or the UI, not from the data.

## 2.3 The five seams, and why four of them cannot change a pixel

| Seam | Count | Consumed by | Verdict |
| --- | --- | --- | --- |
| `fastMath: null → true` | 303 | nothing — parsed in `customEffects.ts:319`, never read by `shaderCompiler.ts` | ✅ inert |
| `precision: null → high` | 92 | nothing — the compiler always emits its own `precision highp float` (`shaderCompiler.ts:139-140`, `:195-196`) | ✅ inert |
| `max-overdraw: null → 0.1 / 0.2` | 8 | nothing — the renderer computes `overdrawPad` from the transform and the GPU limit (`renderer.ts:1730-1739`); `maxOverdraw` appears only in `customEffects.ts:362` | ✅ inert |
| `category: null → "other"` | 44 | `EffectBrowserDialog.tsx:77` — a filter pill | ⚠️ cosmetic: those effects file under "Other" instead of a blend group |
| `<section>` / `<tip>` with **no `id`** | 177 | handled explicitly — `EffectSettingsPanel.tsx:107` and `:127`, and skipped when building defaults (`catalog.ts:140`) | ✅ correct |

So the catalogue carries **five** cosmetic/metadata seams and **zero** behavioural ones.

## 2.4 The one real gap — `locallyApplied` is parsed, stored, re-exported, and never read

```
amXmlCodec.ts:116     <effect id="…" locallyApplied="true|false" …>     // written on export
amXmlCodec.ts:352     locallyApplied: effEl.getAttribute('locallyApplied') === 'true'
project.ts:134, :390  the field exists on the type
catalog.ts:188        locallyApplied: preset?.locallyApplied ?? false
renderer.ts           grep "locallyApplied" → 0 hits
```

**76 of 250 presets** carry `locallyApplied="false"`, and **none** of those effects declares a `comp` texture (`reachability.presetsWithLocallyAppliedFalse = 76`, `ofThoseDeclaringCompTexture = 0`). So it is not the comp-texture path — that path *is* implemented (`renderer.ts:1728`, `:2308-2311`, and it correctly disables overdraw at `:1731`).

What `locallyApplied` means at the compositor level is ❌ **open** — see §4. What is certain is that the renderer behaves identically for all 250 presets, so any place AM distinguishes them, the web does not. This is the single most likely cause of "this preset looks the same as that one" or "this preset looks wrong compared to the app".

## 2.5 A correction to `COMPAT_EFFECTS.md`

That document states the extractor **drops** `compat` on 4 effects and `afxver` on 3. **It does not.** All seven survive intact:

| `compat="acScreenNorm-y"` | `afxver="2"` |
| --- | --- |
| `chromatic-zoomblur`, `colorbalance`, `mattefringe`, `omino-glass` | `brightness-contrast-2`, `colorize`, `fractalwarp4` |

The earlier finding came from an attribute-occurrence count, not a per-effect diff — the same class of error as "86, not 120". The experiment matrix in `COMPAT_EFFECTS.md` §5.5 still stands, but it is now an experiment about **shader semantics**, not about lost data.

## 2.6 Ranked causes for "this preset looks different", strongest first

| # | Cause | How to confirm in one minute |
| --- | --- | --- |
| 1 | **`locallyApplied` ignored** — 76 presets | apply a `locallyApplied="false"` preset (e.g. `blur-presets` "Focusing") and compare with the app |
| 2 | **`amode` on the three `streaks*` effects** — it *is* a declared param, so it reaches the shader as a uniform, but only the shader honours it | apply "Spin to Right" from `blur-presets` (which sets `amode=3`) and compare |
| 3 | **Group nesting** — a preset applied inside a group inherits `grpFbo` isolation (`renderer.ts:1770`) | apply the same preset to a top-level layer and to a grouped layer |
| 4 | **Text/font** — a preset on a text layer inherits the font problem in §3 | check the layer type first |
| 5 | **Blend order across groups** — depth sort cannot cross a group boundary (`Z_DEPTH_AUDIT.md` defect 5) | only applies to multi-group scenes |

Everything below those five is ruled out by §2.2.

## 2.7 Acceptance tests

| # | Test | Pass condition |
| --- | --- | --- |
| CF-A1 | `node scripts/audit/compat-parity.mjs` | `paramMembership`, `paramOrder`, `paramValue`, `shaderSource`, `selectorChoiceCount`, `kfDiff`, `propDiff` all **0** |
| CF-A2 | Apply all 250 presets to a solid-colour 1080×1080 layer, export each | a repeatable contact sheet; AM and web compared side by side |
| CF-A3 | Apply one `locallyApplied="false"` preset | after §2.4 lands, it must differ from its `locallyApplied="true"` sibling, and match AM |
| CF-A4 | Effect browser | no effect files under "Other" that AM shows elsewhere (§2.3, 44 effects) |

---

# 3. Ticket 3 — do the fonts save locally?

## 3.1 What already exists — and it is more than expected

| Piece | Where | Verified |
| --- | --- | --- |
| IndexedDB font store, `am-user-fonts-db` / store `fonts` | `fontStore.ts:6-8` | ✅ |
| Boot hydration before the editor mounts | `App.tsx:19` — `initFontRegistry().then(() => hydrateUserFonts())` | ✅ |
| Blob → `FontFace` → `document.fonts.add` | `fontRegistry.ts:74-80`, `document.fonts.ready` awaited at `:167` | ✅ |
| SHA-256 dedupe | `fontStore.ts:73-78`, `:216` | ✅ |
| Caps: 16 MB/file, 64 MB total | `fontStore.ts:10-11`, enforced `:206-214` | ✅ |
| Real `family` / `weight` / `italic` from the SFNT `name` + `OS/2` tables | `fontStore.ts:82-200` | ✅ |
| `.ttc` collections: face 0 only, with a warning | `fontStore.ts:104-110`, `:257` | ✅ |
| Delete unregisters the face and removes the record | `fontStore.ts:283-303` | ✅ |
| Media **is** stored as blobs | `storage.ts:105` `saveMediaBlob` | ✅ |

So the answer to "do the fonts save locally" is **yes, in this browser** — with two real holes.

## 3.2 F-1 — ✅ no `navigator.storage.persist()` anywhere

```
grep -rn "navigator.storage" src/  →  0 hits
```

Without it the origin's storage is **best-effort**. Chrome evicts best-effort origins under storage pressure; Safari evicts after seven days of no interaction for non-installed sites. When that happens the fonts vanish and every project keeps referencing families that no longer resolve — a mass "missing font" event with no explanation.

One line fixes the common case, and it should run **once, at boot**, before the user has invested in anything:

```ts
// App.tsx, next to initFontRegistry()
navigator.storage?.persist?.().catch(() => {});
```

It is a hint, not a guarantee, but it moves the origin from best-effort to persistent on Chromium and Firefox. Pair it with a `navigator.storage.estimate()` reading in the fonts panel so the 64 MB cap is visible rather than surprising.

## 3.3 F-2 — ✅ fonts are not embedded in the project

```
types/project.ts:159   fontFamily: string;
amXmlCodec.ts:103      <content font="${amFont}" size=… >…</content>
```

The project stores a **family name**, never the bytes. Consequences, all of them real:

| Situation | Result today |
| --- | --- |
| Reload the same browser | ✅ font registered from IDB, text renders |
| Open the project in a second browser | ❌ missing font, fallback face, `MissingFontsDialog` |
| Export the XML and open it in Alight Motion | ❌ AM has no font, falls back |
| Site data cleared / evicted | ❌ every imported font gone at once |

Media does not have this problem (`storage.ts:105`), which makes the asymmetry the thing to fix, not the storage engine.

**Design, smallest coherent version:** put a `fonts/` sidecar beside the media in the same IndexedDB, keyed by the same SHA-256 the font store already computes, and reference it from the project as `<content font="…" fontId="sha256:…">`. On open, a project with a `fontId` whose bytes are absent re-registers from the sidecar *before* the first render. Keep `font=` intact so the file stays valid in AM.

> [!warning] This is a compatibility extension, not a fidelity fix
> AM does not embed fonts. Adding a `fontId` attribute is a documented web-only extension — it must be listed as such in `PRODUCT_SPEC.md` Track A, and must never change what `font=` contains.

## 3.4 F-3 — the two zero-byte faces are upstream, not a regression

`public/am/fonts/serifpro_regular.ttf` and `serifpro_bold.ttf` are 0 bytes **because the APK's own `res/font/serifpro_*.ttf` are 0 bytes**. Repack artefact. `serifpro_semibold.ttf` is a real 100 KB face, so the family is half-alive. Either re-source Source Serif Pro (OFL) or drop the family from the catalogue — but do not "fix the copy step".

## 3.5 Acceptance tests

| # | Test | Pass condition |
| --- | --- | --- |
| FT-A1 | Import a TTF, reload the page | text renders in that face with no fallback flash — `collectMissingFonts` returns empty (`fontRegistry.ts:249`) |
| FT-A2 | Import the same file twice | one record, `duplicate: true` |
| FT-A3 | Import a 20 MB file | rejected with the 16 MB message (`fontStore.ts:212`) |
| FT-A4 | Delete a font in use | text falls back **and** `MissingFontsDialog` names the layer |
| FT-A5 | `navigator.storage.persisted()` after §3.2 | `true` (or documented as denied) |
| FT-A6 | Export, re-import into a fresh profile, after §3.3 | text renders without the user re-importing the file |
| FT-A7 | `document.fonts.ready` before the first canvas draw | no frame ever bakes the fallback face (`fontRegistry.ts:167` guard) |

---

# 4. Open questions

- ❌ **What does `locallyApplied` do in AM's compositor?** It is not the comp-texture path (none of the 76 presets declares `comp`). Candidates: (a) effects apply in layer-local space vs screen space, so a rotated/scaled layer distorts differently; (b) the effect is applied *after* the layer is composited, so it samples the backdrop. One APK capture of a rotated layer with a `locallyApplied="false"` preset decides it.
- ❌ **Does AM sort presets by `pack` or by effect?** The web keys by effect id; AM's preset sheet may be pack-first.
- ⚠️ **Is G-4 measurable on this machine?** Needs the rAF-delta trace described in §1.5.
- ❌ **Does the parked glitch also occur with image layers only?** `onMediaReady` fires from `img.onload` too (`renderer.ts:773-785`), but only once per image.

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[PREVIEW_STATIC_GLITCH_COMPAT_FONTS]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\PREVIEW_STATIC_GLITCH_COMPAT_FONTS.md` |
| Status | active |

Carry forward: the effect catalogue is 1:1 with the APK (0 behavioural drift, measured) — the parked glitch is a shared-`<video>` feedback loop, not a data problem, and `locallyApplied` is the one unimplemented attribute behind "presets look different".
