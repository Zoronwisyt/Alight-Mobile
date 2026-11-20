# PREVIEW CACHE · FONT IMPORT · MISSING-FONT POPUP

Three tickets, one file. Every claim is anchored to `file:line` or to a measured byte count in the
APK. Where something is a design decision rather than a verification, it says so.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Reference APK | `…\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Companions | `ENGINE_PARITY.md`, `TIMELINE_GROUPS_IMPORT.md`, `Z_DEPTH_AUDIT.md`, `GRAPH_EASING_AUDIT.md` |
| Date | 2026-11-19 |

Contents:

- **Part 1 — Preview cache** (`C-1` … `C-5`): why playback glitches, and the After Effects RAM-preview
  model rebuilt on WebGL2.
- **Part 2 — Font import** (`F-1` … `F-5`): what ships today, the APK's real font catalogue, and a
  user-font pipeline that survives reload, share and export.
- **Part 3 — Missing-font popup** (`M-1` … `M-4`): detection, the popup, the download resolver, and
  persistent substitution.

---

## 1. TL;DR

| # | Finding | Anchor | Confidence |
| --- | --- | --- | --- |
| **C-1** | There is **no preview cache of any kind**. Every frame re-rasterizes every shape/text/freehand layer into one shared 2D canvas, uploads it, and re-runs the whole effect stack | `renderer.ts:1443-1475`, `:2367-2375` | ✅ verified (no frame/layer cache in the class) |
| **C-2** | The playback clock is **wall-clock accumulation with a 100 ms clamp** — it cannot drop a frame cleanly, it swallows the hitch and jumps | `EditorScreen.tsx:130`, `:136` | ✅ verified |
| **C-3** | Video layers are **seeked from the render loop** whenever they drift > 0.28 s, and their texture is re-uploaded from the `<video>` element every frame regardless of seek state | `renderer.ts:784-790`, `:595` | ✅ verified |
| **C-4** | Text is **measured per character, per frame** (`measureText` in a loop) and re-rasterized every frame | `renderer.ts:2642-2667` | ✅ verified |
| **C-5** | `font-display: swap` with **no `document.fonts` gate anywhere** → text can rasterize with a fallback face and stay that way until something else forces a re-render | `tokens.css:1-77`, 0 `fonts.ready` hits in `src/` | ✅ verified |
| **F-1** | **11** `@font-face` rules cover 4 families, but **17 TTFs ship** — 5 files are unreachable, 2 are **0 bytes** (`serifpro_regular`, `serifpro_bold`) | `tokens.css:1-77`, `public/am/fonts/` | ✅ verified |
| **F-2** | AM's XML font token is a **family+weight compound** (`SpaceGrotesk-Bold`); the web matches none of them, because the registered family is `'Space Grotesk'` | `amXmlCodec.ts:656`, `renderer.ts:2635` | ✅ verified |
| **F-3** | `fontWeight` and `italic` are **never parsed**; the renderer hardcodes `td.fontWeight ?? 700`, so every imported text renders **bold**, weights ignored | `amXmlCodec.ts:649-664`, `renderer.ts:2634` | ✅ verified |
| **F-4** | No font picker, no import, no persistence — only a free-text `fontFamily` input | `TypeInspectors.tsx:136` | ✅ verified |
| **F-5** | The APK ships a **232-thumbnail, 27-family** font catalogue (`assets/fontthumb/*.webp`) — the picker should be built from it, not invented | `assets/fontthumb/` | ✅ verified |
| **M-1** | There is **no missing-font detection at all** — a fallback face is silently substituted | `renderer.ts:2635` | ✅ verified |

The single most important sentence: **the preview glitch and the font bugs are the same bug class —
non-deterministic frame content.** A frame must be a pure function of time, and today it is a function
of load timing, seek timing, and rAF scheduling.

---

# Part 1 — Preview cache (`C-*`)

## 2. What is actually happening on every play

Five independent sources of non-determinism, in the order they hurt. Each was read out of the code,
not guessed. Which one dominates on a given device needs the trace in §7 — do not "fix" all five blind.

### 2.1 The clock swallows hitches instead of dropping frames (C-2)

```ts
// src/ui/editor/EditorScreen.tsx:129-167
const tick = (now: number) => {
  const dt = Math.min(100, Math.max(0, now - lastTs));   // :130  clamp
  lastTs = now;
  ...
  playheadMs += dt;                                       // :136  wall clock, never audio
  ...
  renderer.syncVideosForPlayback(proj, playheadMs, true); // :155
  renderer.renderProject(proj, playheadMs, {...});        // :156
  store.setCurrentTimeMs(playheadMs);                     // :161
  rafId = requestAnimationFrame(tick);
};
```

`dt` is clamped to 100 ms, so a 400 ms stall advances the playhead by 100 ms and **drops 300 ms of
content silently**. Meanwhile `audioEngine.startPlayback` (`:125`) runs on `AudioContext`, which is a
hardware clock and does not stall — so every hitch desynchronises picture from sound, and the picture
never recovers because the playhead is the thing that got clamped.

`store.setCurrentTimeMs(playheadMs)` also fires **60 React commits per second** (`:161`), and
`currentTimeMs` is a dependency of the paused-frame effect (`:106`) — so the store is rewritten on
every rAF while the timeline, playbar and clock readout all re-render.

**Fix:** one clock. If the project has audio, the playhead is `audioCtx.currentTime`-derived. If not,
a fixed-step accumulator that renders *the nearest frame* and counts drops instead of eating them.

### 2.2 Every frame recomputes the entire scene (C-1)

```ts
// src/engine/renderer.ts:970-1020
public renderProject(project, sceneTimeMs, options) {
  ...
  const sceneFbo = this.acquireFbo(renderW, renderH);   // :1002
  this.clearFbo(sceneFbo, ...);                          // :1005
  this.renderLayerList(...);                             // :1007  full re-render
  this.blitTexture(sceneFbo.tex, null, ...);             // :1018
  this.releaseFbo(sceneFbo);                             // :1019
}
```

No memoization keyed by time, no layer raster reuse, no frame store. For each layer,
`rasterizeLayerToCanvas2D` (`:2346`) does:

```ts
if (this.canvas2d.width !== fboW || this.canvas2d.height !== fboH) {
  this.canvas2d.width = fboW;      // :2370  canvas resize → new backing store
  this.canvas2d.height = fboH;
}
ctx.clearRect(0, 0, fboW, fboH);   // :2375  full clear, every layer, every frame
```

then uploads the whole canvas to a texture:

```ts
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas2d); // :1474
```

A 1080×1350 project at the default `previewQuality = 0.75` (`useEditorStore.ts:315`) with DPR 2
computes `scale = min(0.75 × 2, 4096/1350) = 1.5` (`renderer.ts:989-995`) → a **1620×2025** backing
store. That is a **13.1 MB RGBA** canvas cleared and re-uploaded **once per layer per frame**. With 16
layers at 60 fps that is ~12.6 GB/s of bus traffic before any effect runs.

And a text layer pays `measureText` **per character, per frame**:

```ts
// renderer.ts:2642-2667
const measureRun = (txt: string) => {
  let w = 0;
  for (const ch of Array.from(txt)) w += ctx.measureText(ch).width + letterSp;  // :2644
  return w;
};
```

Wrapping loops over words and calls `measureRun` on every candidate (`:2659`), so a 40-word paragraph
costs hundreds of `measureText` calls per frame — all of them producing the same numbers as last frame.

### 2.3 Video is seeked from the render loop (C-3)

```ts
// src/engine/renderer.ts:784-790
} else if (!v.seeking && Math.abs(v.currentTime - targetSec) > 0.28) {
  try { v.currentTime = targetSec; } catch { }
}
```

Assigning `currentTime` **starts a seek**, which is asynchronous and can take 10–200 ms on a phone.
With a 0.28 s tolerance at 60 fps, a slow decode re-triggers a seek before the previous one lands, so
the element oscillates. Then, unconditionally, the frame texture is taken from the element:

```ts
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);  // :595
```

A `<video>` mid-seek presents either the old frame or a blank one. That is the **black flash / frozen
half-second** users describe as "glitches out".

The export path already knows better — it awaits an exact seek before rendering:

```ts
// src/engine/videoExporter.ts:327-328
await renderer.prepareMediaAtTime(project, tMs);
renderer.renderProject(project, tMs, {...});
```

`prepareMediaAtTime` (`renderer.ts:827`) is the deterministic contract. The preview path never uses it.

### 2.4 Canvas reallocation mid-playback (C-4)

```ts
// renderer.ts:997-1000
if (this.canvas.width !== renderW || this.canvas.height !== renderH) {
  this.canvas.width = renderW;
  this.canvas.height = renderH;
}
```

Changing a canvas's `width`/`height` reallocates the drawing buffer and clears it. Any path that
changes `previewQuality` or crosses a resize while playing (quality selector, DPR change on browser
zoom, orientation change) blank-frames the canvas. Should be gated during playback.

### 2.5 Fonts are swapped, not awaited (C-5)

```css
/* src/styles/tokens.css:1-7 */
@font-face {
  font-family: 'Space Grotesk';
  src: url('/am/fonts/spacegrotesk_regular.ttf') format('truetype');
  font-weight: 400;
  font-display: swap;      /* <- paints fallback first, swaps later */
}
```

`font-display: swap` is right for a document and wrong for a canvas. Canvas `ctx.font` is a **snapshot**:
glyphs rasterized before the font finishes downloading are baked with the fallback face and never
re-rasterize. So the first play-through of a text-heavy project can show completely different metrics
from the second — which reads as "the preview glitches every time I play", literally true.

There is **no `document.fonts.load` / `document.fonts.ready` anywhere in `src/`** (verified, 0 hits).
Part 2 fixes the root; Part 1 must still gate playback on `fonts.ready`.

---

## 3. The After Effects model, mapped to the browser

AE's preview does four things the web has none of:

| AE behaviour | What it means | Browser equivalent |
| --- | --- | --- |
| **RAM Preview** | frames rendered once, kept in memory, replayed instantly | GL textures + a frame store (L2) |
| **Layer cache** | an unanimated layer rasterizes once, its pixels reused across frames | per-layer texture cache keyed by a revision token (L1) |
| **Cache bar** under the timeline | green = cached, red = needs render | a strip in the ruler row |
| **Render-ahead on idle** | fills the cache while you are not playing | `requestIdleCallback` worker fill |

Two tiers, both required. L1 alone removes 90 % of the cost for the common case (static or slowly
animated layers). L2 alone gives instant replay but costs gigabytes. AE ships both; so should this.

### 3.1 L1 — layer raster cache

**Key:** `(layerId, layerRevision, quantizedTime)` where `quantizedTime = round(localTimeMs / frameMs)`
and `layerRevision` is a content hash of the layer's *visual* inputs.

A layer is **cacheable at a given frame** when all of the following hold:

- no enabled effect is `time`-dependent in a non-integral way (motion blur samples `t ± frameDt`;
  see `renderer.ts:1492-1499`),
- `normT` is not being used by an animated parameter that changed since the cached frame,
- the layer has no `<video>` fill, and
- the layer's transform did not change between the cached frame and the requested one (transform lives
  on the GPU; only the *raster* is cached, so transform animation still hits — this is the cheap win).

Store the rasterized `contentFbo` at its natural size, with a `lastUsedFrame` counter for LRU.

**Invalidation** — one `layerRevision` string, recomputed only on store mutation:

```
layerRevision = hash(layer.type, shapeId, svgPathD, textData.content, textData.fontFamily,
                     textData.fontSize, textData.color, textData.letterSpacing, textData.wrapWidth,
                     textData.fontWeight, textData.italic, mediaData.src, mediaData.trimStartMs,
                     effects.map(e => e.effectId + JSON.stringify(e.params)).join(),
                     fillColor, stroke, shadow, freehandStrokes.length)
```

Gate: `useEditorStore.updateLayer` bumps a project-level `revision` counter. Nothing else does. Reading
a cached frame never bumps it.

### 3.2 L2 — frame cache

**Key:** `(quantizedTime, previewScale, projectRevision, cacheEpoch)`.

`cacheEpoch` increments on: project open, `previewScale` change, any project mutation, any font finish
loading, any media `readyState` transition. A stale epoch is *not* deleted — it is simply skipped.

**Store a GL texture, not an ImageData.** A cached frame is an FBO kept alive:

```ts
type CachedFrame = {
  tex: WebGLTexture;
  w: number;
  h: number;
  scale: number;      // the scale it was rendered at
  epoch: number;
  lastUsed: number;   // frame counter for LRU
  bytes: number;      // w * h * 4
};
```

Playback then becomes: **hit → one `blitTexture`; miss → render into a fresh FBO and insert.** The hit
path is a single quad, ~0.1 ms, which is the entire point.

**Render at a cache scale, not the preview scale.** This is the difference between a cache and a memory
leak:

| Project | previewScale × DPR | Frame bytes | 60 fps × 3.2 s |
| --- | --- | --- | --- |
| 1080×1350 | 0.75 × 2 = 1.5 → 1620×2025 | **13.1 MB** | **2.52 GB** |
| 1080×1350 | cache scale 0.5 → 540×675 | 1.46 MB | 280 MB |
| 1080×1350 | cache scale 0.35 → 378×473 | 0.71 MB | **137 MB** |

So: `cacheScale = min(previewScale, sqrt(cacheBudgetBytes / (frames × projectW × projectH × 4)))`,
clamped to `[0.25, previewScale]`, and **never** above 1.0. Display the cached frame scaled up to the
preview size — for a scrubbed preview the perceptual cost is small and the win is total.

### 3.3 Budget and eviction

| Device class | RAM budget | Disk tier |
| --- | --- | --- |
| Phone (≤ 4 GB reported) | **192 MB** | off |
| Tablet / iPad | **384 MB** | off |
| Desktop | **1.5 GB** | optional, OPFS, off by default |

- Budget is `min(classBudget, 0.12 × deviceMemoryGB × 1 GB)` when `navigator.deviceMemory` exists.
- Evict LRU until `used ≤ budget × 0.9`, then stop. Never evict the frame currently displayed.
- On `webglcontextlost`, drop L1 and L2 entirely and set `epoch++`.
- Hard cap per frame is `budget / 24`, so a single 4K project cannot occupy the whole store.

### 3.4 The clock (fixes C-2)

```ts
// src/ui/editor/EditorScreen.tsx — replace the accumulation in tick()
const audioClockMs = audioEngine.hasAudio(proj)
  ? audioEngine.positionMs()            // AudioContext.currentTime - startedAt
  : fixedStepAccumulate(now, lastTs);   // lastTs += frameMs, never `now`

const playheadMs = audioClockMs;
const targetFrame = Math.round(playheadMs / frameMs);
```

- With audio: the audio clock is the master. Picture follows sound. No drift, ever.
- Without audio: a fixed-step accumulator advances by exactly `frameMs` per rendered frame, and reports
  `dropped` when it has to skip. Playback then runs slightly slow under load instead of jumping — the
  correct trade for a preview.
- `store.setCurrentTimeMs` is throttled to **every 4th frame** while playing (the store only drives the
  readout, the playhead and the cache bar; 15 Hz is plenty), and the canvas is not re-rendered by the
  paused-effect (`EditorScreen.tsx:106`) because `isPlaying` guards it.
- Both paths must call `await waitForFontsAndSeeks(proj, playheadMs)` before the first frame — the
  `prepareMediaAtTime` model (`renderer.ts:827`) applied to preview.

### 3.5 Video determinism (fixes C-3)

Two rules, both cheap:

1. **Never upload a texture from a video that is `seeking`, or whose `readyState < 2`.** Keep the last
   good texture; if there is none, draw the layer's last cached frame from L1/L2.
2. **Never seek from inside the render loop while playing.** Playback trusts `video.play()` and
   `playbackRate`; a correction seek is issued only when drift exceeds **0.5 s** *and* the element is
   not already seeking, and the correction is applied on the `seeked` event, not on assignment.

```ts
// renderer.ts:595 — guard the upload
if (!entry.video.seeking && entry.video.readyState >= 2) {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.video);
  entry.lastUploadedMs = performance.now();
} // else: leave the previous texture bound
```

Also skip the upload entirely when `currentTime` has not changed by a frame (paused scrubs), which
removes a large chunk of the bandwidth for stills.

### 3.6 The cache bar (AE's green bar)

A 6 px strip inside the ruler row (`app.css:990`), above the ticks:

- green = cached at current scale, amber = cached at a lower scale, red = not cached,
- triangles flag boundaries where `epoch` changed (i.e. "cache broke here" — invaluable for finding the
  invalidation bugs this doc cannot see),
- tap it → *Clear preview cache* / *Render whole preview now*.

Placement matters: it sits above the track content, never over it, and its width maps to
`contentOffset` the same way the ruler does (see `TIMELINE_GROUPS_IMPORT.md` R-3 — the cache bar must
translate with content, not with a moving playhead).

### 3.7 Render-ahead

On pause, on idle (`requestIdleCallback`, budget 8 ms/turn), and after import, walk frames outward from
the playhead and fill the cache until the budget is 90 % used or the user interacts. This is what makes
the **second** play-through instant, which is the request.

Must be cancellable on: any store mutation, `previewScale` change, seek, play press, tab blur.

---

## 4. Acceptance — Part 1

All tests at 1080×1350 / 60 fps / 16 layers / `previewScale 0.75`.

| # | Test | Pass condition |
| --- | --- | --- |
| C-A1 | Play once to completion, then play again | second pass has **0 frame-cache misses** after the first 3 frames; wall-clock length within 1 % of `durationMs` |
| C-A2 | `currentTimeMs` sampled vs `AudioContext.currentTime` at t = 1 s, 2 s, 3 s | max deviation **≤ 16 ms** (was: unbounded, audio-clock vs wall-clock) |
| C-A3 | Count `measureText` calls in one second of playback, 5 text layers | ≤ **`layers × chars × 1`** after L1 (was: `× 60`) |
| C-A4 | Frame time p95 during playback, desktop Chrome | **≤ 8 ms** with cache warm; record the cold number in the PR (no target, just a baseline) |
| C-A5 | Scrub a video layer across 2 s, audit frames for black | **0 black frames** (probe the canvas centre pixel; a black project must be excluded) |
| C-A6 | Seek a video layer while playing, 5 times | no `seeked` storm: ≤ 5 total seeks, no frame with an empty video texture |
| C-A7 | Toggle `previewQuality` mid-play | no blank frame; the canvas is not resized while `isPlaying` |
| C-A8 | Memory after filling the cache on a 15 s project | `used ≤ budget`; `performance.memory.usedJSHeapSize` growth ≤ budget + 20 % |
| C-A9 | Load a text project cold (throttled to 3 G) | first visible frame uses the **correct** face; no fallback-metric flash |
| C-A10 | Edit a layer, then play | the layer re-renders (epoch bumped); every other layer still hits |

Add a dev-only counter (`window.__previewCacheStats = { hits, misses, bytes, evictions, epoch }`) so
C-A1 is a one-liner and so regressions are visible.

---

# Part 2 — Font import (`F-*`)

## 5. What ships today — measured

### 5.1 Files vs registration

`public/am/fonts/` holds **17 TTFs**, copied verbatim from the APK's `res/font/` (identical byte counts):

| File | Bytes | Registered in `tokens.css`? |
| --- | --- | --- |
| `hind_light.ttf` | 279,588 | ❌ **dead** |
| `hind_regular.ttf` | 291,728 | ✅ 400 |
| `hind_medium.ttf` | 269,616 | ❌ **dead** |
| `hind_semibold.ttf` | 274,412 | ✅ 600 |
| `hind_bold.ttf` | 279,028 | ❌ **dead** |
| `roboto_regular.ttf` | 168,260 | ✅ 400 |
| `roboto_medium.ttf` | 168,644 | ✅ 500 |
| `roboto_bold.ttf` | 167,336 | ✅ 700 |
| `roboto_medium_numbers.ttf` | 3,316 | ❌ dead (tabular figures) |
| `spacegrotesk_light.ttf` | 86,556 | ❌ **dead** |
| `spacegrotesk_regular.ttf` | 86,504 | ✅ 400 |
| `spacegrotesk_medium.ttf` | 86,528 | ✅ 500 |
| `spacegrotesk_semibold.ttf` | 86,452 | ✅ 600 |
| `spacegrotesk_bold.ttf` | 86,400 | ✅ 700 |
| `serifpro_regular.ttf` | **0** | ✅ declared, **loads nothing** |
| `serifpro_semibold.ttf` | 100,956 | ❌ dead |
| `serifpro_bold.ttf` | **0** | ✅ declared, **loads nothing** |

`tokens.css:1-77` declares **11** faces across 4 families — `Space Grotesk` 400/500/600/700,
`Roboto` 400/500/700, `Hind` 400/600, `Serif Pro` 400/700. So:

- 5 real font files are downloaded-capable but unreachable → `fontWeight: 300` on Hind renders as
  synthesised, and `light` never appears.
- **Serif Pro is 0 bytes in the APK too** — verified identical in `res/font/`. This is an upstream /
  repack placeholder, not a web regression. Serif Pro must be re-sourced (Source Serif Pro is OFL) or
  removed from the picker. Do not "fix" it by touching the copy step.

### 5.2 The name mismatch (F-2, F-3)

AM serialises the font as one compound token:

```xml
<!-- src/engine/amXmlCodec.ts:97 -->
<content font="SpaceGrotesk-Bold" size="72" align="center" color="#FFFFFFFF">…</content>
```

Parsed verbatim into `textData.fontFamily` (`amXmlCodec.ts:656`), with a default of
`'SpaceGrotesk-Bold'` when the attribute is absent — which is the **wrong default** (see §6.1).

Then the renderer builds a CSS font shorthand:

```ts
// renderer.ts:2635
ctx.font = `${fontStyle}${fontWeight} ${fontSize}px "${td.fontFamily}", "Space Grotesk", "Roboto", sans-serif`;
```

`"SpaceGrotesk-Bold"` matches **no** registered family (the family is `'Space Grotesk'`, with a space),
so every AM text falls through to the fallback stack — always at `fontWeight 700`, because:

```ts
// renderer.ts:2634
const fontWeight = td.fontWeight ?? 700;
```

and `fontWeight` / `italic` are **never parsed**:

```ts
// amXmlCodec.ts:649-664 — the text branch sets content, fontFamily, fontSize, color, align,
// lineHeight, letterSpacing, wrapWidth. Nothing else.
```

`types/project.ts:159-161` already declares `fontFamily`, `fontWeight?`, `italic?` — the type has the
fields and the codec never fills them.

Net effect on import: **every text is bold, nothing is italic, and no string ever resolves to the
family the artist picked.** That alone reads as "fonts are broken".

### 5.3 No picker, no import (F-4)

The only font control in the app is a free-text input:

```tsx
// src/ui/editor/TypeInspectors.tsx:136
onChange={(e) => updateLayer((l) => { if (l.textData) l.textData.fontFamily = e.target.value; })}
```

There is no list, no preview, no weight selector, no upload, no persistence. A user cannot import a
font, and cannot see what is available.

### 5.4 The APK's real catalogue (F-5)

`assets/fontthumb/` holds **232 WebP previews**, named `"<Family> <Weight> [Italic]".webp`:

| Family | Files | Family | Files |
| --- | --- | --- | --- |
| Raleway | 18 | Merriweather | 8 |
| Montserrat | 18 | Ubuntu | 8 |
| Poppins | 18 | Roboto Condensed | 6 |
| Fira Sans | 18 | Playfair Display | 6 |
| Nunito | 14 | Oswald | 6 |
| Muli | 14 | Lora | 4 |
| Roboto | 12 | Roboto Slab | 4 |
| Source Sans Pro | 12 | Noto Sans | 4 |
| Titillium Web | 11 | Arimo | 4 |
| Roboto Mono | 10 | PT Sans | 4 |
| Open Sans | 10 | PT Serif | 4 |
| Lato | 10 | Nanum Gothic | 3 |
| | | Open Sans Condensed | 3 |
| | | PT Sans Narrow | 2 |
| | | Slabo 27px | 1 |

**27 families, 232 styles.** These are Google Fonts (OFL). The APK does not ship the TTFs — it ships
thumbnails and downloads on demand, which is precisely the model Part 3 implements. The picker must be
built from this list, so the web's font menu is the phone's font menu.

Note `fontthumb` also proves the weight vocabulary AM exposes: `Thin, Extra Light, Light, Regular,
Medium, Semi Bold, Bold, Extra Bold, Black`, each with an `Italic` variant. That is the suffix table
§6.2 needs.

---

## 6. Design — font pipeline (`F-1` … `F-5`)

### 6.1 `F-1` — register everything that ships, and stop shipping dead files

Replace the hand-written `tokens.css:1-77` with a generated registry, so a font file and its CSS
declaration can never drift again.

```
public/am/fonts/fonts.json
```

```json
[
  { "family": "Space Grotesk", "file": "spacegrotesk_light.ttf",    "weight": 300, "style": "normal" },
  { "family": "Space Grotesk", "file": "spacegrotesk_regular.ttf",  "weight": 400, "style": "normal" },
  { "family": "Space Grotesk", "file": "spacegrotesk_medium.ttf",   "weight": 500, "style": "normal" },
  { "family": "Space Grotesk", "file": "spacegrotesk_semibold.ttf", "weight": 600, "style": "normal" },
  { "family": "Space Grotesk", "file": "spacegrotesk_bold.ttf",     "weight": 700, "style": "normal" },
  { "family": "Roboto",        "file": "roboto_regular.ttf",        "weight": 400, "style": "normal" },
  { "family": "Roboto",        "file": "roboto_medium.ttf",         "weight": 500, "style": "normal" },
  { "family": "Roboto",        "file": "roboto_bold.ttf",           "weight": 700, "style": "normal" },
  { "family": "Hind",          "file": "hind_light.ttf",            "weight": 300, "style": "normal" },
  { "family": "Hind",          "file": "hind_regular.ttf",          "weight": 400, "style": "normal" },
  { "family": "Hind",          "file": "hind_medium.ttf",           "weight": 500, "style": "normal" },
  { "family": "Hind",          "file": "hind_semibold.ttf",         "weight": 600, "style": "normal" },
  { "family": "Hind",          "file": "hind_bold.ttf",             "weight": 700, "style": "normal" }
]
```

Rules:

- Registered at boot with the **FontFace API**, not CSS — so the loader can report per-face success and
  the cache can invalidate on completion:

```ts
// src/engine/fontRegistry.ts
export type FaceSpec = { family: string; file?: string; data?: ArrayBuffer; weight: number; style: 'normal' | 'italic' };

const loaded = new Map<string, FontFace>();          // key: family|weight|style
export const fontEpoch = { value: 0 };               // bumped on every successful load → cache epoch++

export async function registerFace(spec: FaceSpec): Promise<boolean> {
  const key = `${spec.family}|${spec.weight}|${spec.style}`;
  if (loaded.has(key)) return true;
  const src = spec.data ? spec.data : `url(/am/fonts/${spec.file})`;
  const face = new FontFace(spec.family, `url(${src})`, { weight: String(spec.weight), style: spec.style });
  try {
    await face.load();
    document.fonts.add(face);
    loaded.set(key, face);
    fontEpoch.value++;
    return true;
  } catch {
    return false;
  }
}
```

- **Serif Pro**: both files are 0 bytes. Either re-source Source Serif Pro (OFL) into `public/am/fonts/`
  as `serifpro_regular.ttf` / `serifpro_bold.ttf`, or delete the two `@font-face` rules and the family
  from the picker. Shipping a 0-byte font is worse than not shipping it: the browser logs a decode
  failure and silently falls back.
- Delete or register `roboto_medium_numbers.ttf` — it is a 3 KB tabular-figures subset, not a family
  member. Register it as a separate family (`Roboto Numbers`) or drop it.
- Startup gate: `await document.fonts.ready` before the first `renderProject`, and bump `epoch` after.
  That is the C-5 fix.

### 6.2 `F-2` — normalise AM's compound font token

One function, used by the codec and the picker:

```ts
// src/engine/fontNames.ts
const WEIGHTS: [RegExp, number][] = [
  [/extra\s*light|ultra\s*light/i, 200],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/thin|hairline/i, 100],
  [/light/i, 300],
  [/medium/i, 500],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/book|regular|normal/i, 400],
];

/** "SpaceGrotesk-Bold" → { family: "Space Grotesk", weight: 700, style: "normal" }
 *  "FiraSans-SemiBoldItalic" → { family: "Fira Sans", weight: 600, style: "italic" } */
export function parseAmFontToken(token: string) {
  const style = /italic|oblique/i.test(token) ? 'italic' : 'normal';
  const cleaned = token.replace(/[-_]+/g, ' ').replace(/(italic|oblique)/gi, ' ').trim();
  let weight = 400;
  let familyPart = cleaned;
  for (const [re, w] of WEIGHTS) {
    if (re.test(cleaned)) { weight = w; familyPart = cleaned.replace(re, ' ').trim(); break; }
  }
  const family = humaniseFamily(familyPart);  // camelCase / no-space → canonical display name
  return { family, weight, style };
}
```

`humaniseFamily` resolves against the registered + catalogued family list first (`SpaceGrotesk` →
`Space Grotesk`), and only falls back to inserting spaces at case boundaries. **Do not invent a name
that is not in the registry** — that is how you get a second, invisible fallback path.

Then `amXmlCodec.ts:649-664` becomes:

```ts
const { family, weight, style } = parseAmFontToken(contentEl?.getAttribute('font') || '');
return {
  content: contentEl?.textContent || 'Text',
  fontFamily: family,
  fontWeight: weight,
  italic: style === 'italic',
  ...
};
```

**Fix the default.** `'SpaceGrotesk-Bold'` for a missing `font=` attribute is a guess. In the
`CONQ SHAKE PACK` sample, all 16 `<content>` elements carry **no** `font` attribute, so this default
decides how an entire pack renders. AM's default is a plain regular face; use `Roboto 400` until
§9-q1 settles it, and log the count of defaults applied in the import report.

### 6.3 `F-3` — import a user's own fonts

Browsers have no filesystem, so "import" means: read bytes → `FontFace` → `IndexedDB`.

```ts
// src/store/fontStore.ts
export type UserFont = {
  id: string;                 // sha-256 of the bytes
  family: string;             // read from the font's name table
  weight: number;
  style: 'normal' | 'italic';
  fileName: string;
  bytes: number;
  addedAt: number;
};
```

Pipeline:

1. **Input** — `<input type="file" accept=".ttf,.otf,.woff,.woff2" multiple>`, plus drag-drop onto the
   font panel, plus a paste handler for a file from the clipboard.
2. **Read** — `await file.arrayBuffer()`, cap at **16 MB** per file and **64 MB** total (reject with a
   named error, not a generic failure).
3. **Identify** — parse the `name` table for family / subfamily / weight class rather than trusting the
   filename. A small reader is enough: SFNT header → `name` table → IDs 1 (`family`), 2
   (`subfamily`), 16 (`typographic family`), 17 (`typographic subfamily`), and `OS/2.usWeightClass`.
   Handle `ttcf` (collection) by taking face 0 only, and say so.
4. **Register** — `registerFace({ family, data, weight, style })`. If `face.load()` throws, the file is
   rejected with the browser's reason shown in the row.
5. **Persist** — `IndexedDB` store `am-user-fonts`, record `{ id, bytes: ArrayBuffer, meta }`. Blobs are
   fine; ArrayBuffer keeps it simple.
6. **Hydrate** — on boot, read all records and register them **before** the first render, in parallel.
   This is the reload-safety the CSS `@font-face` path cannot give.
7. **Remove** — delete the record, `document.fonts.delete(face)`, bump `epoch`, and mark any text layer
   using it as *missing* (Part 3). Warn only if layers use it.

Duplicate handling: same `sha-256` → reuse, don't duplicate. Same family+weight, different bytes →
suffix the display family (`My Font (2)`) rather than silently shadowing.

### 6.4 `F-4` — the picker

Replace `TypeInspectors.tsx:136` with a real picker:

```
┌─ Font ─────────────────────────────────┐
│ [ search… ]                            │
│ ── Project fonts ──                    │
│  Aa  Space Grotesk        Regular  ▾   │   <- weights expand on tap
│  Aa  Roboto               Medium   ▾   │
│ ── My fonts  (+ Import…) ──            │
│  Aa  Amatic SC            Regular  ▾   │
│ ── All fonts (27) ──                    │
│  Aa  Raleway  18 styles   ↓            │   <- ↓ = needs download
│  Aa  Montserrat 18 styles ↓            │
└────────────────────────────────────────┘
```

- Each row renders its **sample string in the actual face** — the sample is the layer's current text
  (truncated to 18 chars), so the preview is the artwork, not lorem ipsum.
- Multi-weight families expand to a weight list; unavailable weights show a download affordance.
- Thumbnail source: the APK's `assets/fontthumb/*.webp` (232 files) copied into
  `public/am/fontthumb/`. Do **not** generate thumbnails with `canvas.measureText` as a substitute —
  the APK's are the phone's own previews and cost nothing to ship.
- Virtualised list (50 rows rendered max), keyboard navigable, `Enter` applies, `Esc` closes.
- Applying a font writes `fontFamily` + `fontWeight` + `italic` together, so the triple can never
  disagree.

### 6.5 `F-5` — text metrics must not change under the user

Three small things that make text *stable*:

1. **`ctx.font` is set once per layer per frame** (already true, `renderer.ts:2635`) but the *family
   string* must be the canonical registered name. Never interpolate the raw AM token.
2. **`fontDisplay` equivalent for canvas:** before rasterizing a text layer, check
   `document.fonts.check(`${style} ${weight} 16px "${family}"`)`. If false, register a pending mark,
   skip rasterization for that layer this frame, and re-render when the load resolves
   (`fontEpoch` bump → `onMediaReady`-style redraw, `EditorScreen.tsx:66-80`). No fallback-metric frames,
   ever.
3. **Cache the wrap layout** — `lines[]` + `lineH` + total width only change when text, family, size,
   letterSpacing or wrapWidth change. Memoize on `layerRevision`, which Part 1 already computes. That
   removes the per-character `measureText` storm (§2.2) as a side effect.

---

## 7. Acceptance — Part 2

| # | Test | Pass |
| --- | --- | --- |
| F-A1 | Boot, then `document.fonts.check('300 16px "Hind"')` | `true` — light is registered |
| F-A2 | Boot, then `document.fonts.check('400 16px "Serif Pro"')` | `false` **and** the family is absent from the picker (0-byte rule enforced) |
| F-A3 | Import an AM project whose text is `SpaceGrotesk-Medium` | `textData` = `{fontFamily:'Space Grotesk', fontWeight:500, italic:false}`; rendered face is Medium, not Bold |
| F-A4 | `FiraSans-SemiBoldItalic` | `{family:'Fira Sans', weight:600, italic:true}` |
| F-A5 | Import `Amatic SC` `.ttf` → reload → select the text layer | family present, glyphs render, `fontFamily` preserved through save/load |
| F-A6 | Import a `.otf` and a `.woff2` | both register; both survive reload |
| F-A7 | Import a corrupt 4 KB file | rejected with a readable reason; no font added; no crash |
| F-A8 | Import the same file twice | one entry (same sha-256) |
| F-A9 | Font picker with 27 families | every row renders its sample in its own face; scrolling stays at 60 fps |
| F-A10 | Text layer using a deleted user font | marked missing, Part 3 popup offers it, no silent fallback |

---

# Part 3 — Missing-font popup (`M-*`)

## 8. Detection (`M-1`)

A font is **missing** when the requested `(family, weight, style)` triple is not registered after
hydration and cannot be satisfied by a weight within 100 units of the requested one in the same family.

Resolution order, first hit wins:

1. exact `(family, weight, style)` in the registry,
2. same family, nearest weight, synthesised italic allowed if the family has no italic (mark the layer
   `fontSynthesised: true`),
3. a user substitution recorded for this project (`project.fontSubstitutions[family]`),
4. **missing** → fallback render + a visible marker.

`fontFamily` reaches the renderer as a string, so detection is one lookup — but it must run **before**
the first frame, not during it, or the first frame is already wrong:

```ts
// after the project is parsed, before renderProject
const missing = collectMissingFonts(project);   // Set<{family,weights:Set<number>,styles:Set}>> 
if (missing.size) showFontPopup(missing);
```

`collectMissingFonts` walks `project.layers` recursively — including `groupLayers` — and only text
layers (`layer.type === 'text'`). It must run on: import, project open, user-font deletion, and manual
"Check fonts" in project settings.

## 9. The popup (`M-2`)

Shown **after import** and **on demand**, never mid-playback. It is a dialog, and it may also appear as
a badge on text layers in the timeline so the state is visible later.

```
┌──────────────────────────────────────────────────────────┐
│  Missing fonts                                     ✕     │
│  3 fonts used in "Null 1" are not available.             │
│  Preview falls back until they are installed.            │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Aa  Amatic SC           Regular, Bold   7 layers     │ │
│ │     [ Download ]  [ Locate file… ]  [ Substitute ▾ ] │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ Aa  Bebas Neue          Regular         2 layers     │ │
│ │     [ Download ]  [ Locate file… ]  [ Substitute ▾ ] │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ Aa  Poppins             Medium          1 layer      │ │
│ │     [ Download ]  [ Locate file… ]  [ Substitute ▾ ] │ │
│ └──────────────────────────────────────────────────────┘ │
│  [ Download all (3) ]   [ Use substitutes ]  [ Ignore ]  │
└──────────────────────────────────────────────────────────┘
```

Rules:

- Each row shows a **live sample** (the layer's text) rendered in the best available substitute, so the
  user sees the damage before choosing.
- `Download` resolves one font; `Download all` runs them with per-row progress and independent failure
  (one 404 must not abort the batch).
- `Locate file…` opens a file picker and applies the result only if the parsed family/subfamily matches
  the requested family; otherwise offer *Import anyway as* `<name>`.
- `Substitute ▾` lists families that **have** every requested weight, sorted by metric affinity
  (x-height ratio, then average advance). Store the choice in `project.fontSubstitutions[family]` so it
  is stable across reload and survives export/import of the project JSON.
- `Ignore` dismisses but leaves the timeline badge on affected layers. Never a silent fallback.
- The dialog is reachable later from *Project → Missing fonts* and from any text layer's badge, and the
  count also lands in the import report (`TIMELINE_GROUPS_IMPORT.md` §R-5).
- Never block the editor. Fonts resolve while the user works.

## 10. The download resolver (`M-3`)

AM's own catalogue is Google Fonts, and the phone downloads on demand — so the popup's `Download` is
the same operation.

### 10.1 Primary path — Google Fonts CSS API

```ts
// src/engine/fontDownload.ts
const GF_BASE = 'https://fonts.googleapis.com/css2';

export async function downloadFamily(family: string, weights: number[], styles: ('normal'|'italic')[]): Promise<FontFace[]> {
  const fam = family.trim().replace(/\s+/g, '+');
  const axis = styles.includes('italic') ? 'ital,wght@' : 'wght@';
  const tuples = styles.flatMap((s) => weights.map((w) => `${s === 'italic' ? 1 : 0},${w}`));
  const url = `${GF_BASE}?family=${fam}:${axis}${tuples.join(';')}&display=block`;
  const css = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then((r) => r.text());
  // parse: @font-face { font-family: 'X'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/...) format('woff2'); }
  ...
}
```

Notes that matter:

- `display=block`, never `swap` — a preview must not paint a fallback it cannot repaint.
- Request **only the weights the project uses**, so Poppins Medium does not download 18 files.
- `fonts.gstatic.com` serves `Access-Control-Allow-Origin: *`, so `fetch` → `ArrayBuffer` → `FontFace`
  works and lets us **cache the bytes ourselves** (a `<link>` stylesheet would not).
- The Google CSS response varies by `User-Agent` (woff2 for modern, ttf otherwise). Send a modern UA and
  parse whatever comes back; do not assume a format.
- Persist the downloaded bytes in the same IndexedDB store as user fonts, tagged
  `source: 'google'`. A project that needed a font once must not need the network twice.

### 10.2 Offline / blocked path — local catalogue

A project opened on a locked-down network must not dead-end. Ship a **static map** generated at build
time from the APK's own family list (§5.4):

```
public/am/fontcatalog.json
{ "families": [ { "family": "Amatic SC", "weights": [400,700], "styles": ["normal"], "google": true }, … ] }
```

- If `family` is in the catalogue and the network fails, the row says *Download failed — retry* and
  keeps `Locate file…` available. No modal, no crash.
- If `family` is **not** in the catalogue, the row omits `Download` entirely and offers
  `Locate file…` + `Substitute` — promising a download that cannot exist is worse than not offering it.
- `fonts.googleapis.com` may be unreachable in some regions. Optional: a mirror list in
  `fontcatalog.json` (`["google", "cdn.jsdelivr.net/npm/@fontsource/…"]`), tried in order. Fontsource
  packages are byte-identical OFL releases, so the substitution is honest.

### 10.3 What "installed" means

A downloaded font is a project asset, not a system font. It lives in IndexedDB under
`(family, weight, style)` and is re-registered at boot. There is no OS install, no permission prompt,
and no way to leak it outside the browser profile — say so in one line in the dialog so nobody hunts for
a system setting.

### 10.4 Sharing a project with imported fonts

The AM XML references fonts by name only — there is no font payload in the format. So a shared project
that used a user font will show as missing on the other machine. Options, in order of preference:

1. **Import report warning** on export: *"This project uses 2 fonts that are not in Alight's catalogue.
   Recipients will see a substitute."* — honest, zero-format-risk. **Do this first.**
2. **Sidecar assets** — write `fonts/<sha8>.ttf` next to the XML inside the project zip, mirroring the
   existing `amproj:` media convention (`amXmlCodec.ts` media handling). Import reads them if present
   and registers them. This is an **extension** to AM's format, not a copy of it: mark it
   `<!-- amweb:fonts -->` and never write it into a `.xml` destined for the phone, where it would be
   ignored at best. ⚠️ *Design proposal, not AM-verified — see §12-q3.*

---

## 11. Acceptance — Part 3

| # | Test | Pass |
| --- | --- | --- |
| M-A1 | Import a project using an unregistered family | popup appears **before** the first visible frame; affected layer count matches a manual count |
| M-A2 | `Download` on a catalogue family | font registers, `epoch++`, the popup row disappears, affected layers re-render with correct metrics |
| M-A3 | `Download all` with one family that 404s | others succeed; failed row shows *retry*; no unhandled rejection |
| M-A4 | Network blocked | rows fall back to `Locate file…` + `Substitute`; no modal dead-end |
| M-A5 | `Substitute` Poppins → Montserrat | choice persists through reload and through project JSON round-trip |
| M-A6 | `Locate file…` with the wrong family's file | rejection message names both families; *Import anyway* path works |
| M-A7 | Text layer with a missing font, popup ignored | timeline badge present; no silent fallback; export report lists it |
| M-A8 | Delete a user font that 3 layers use | popup reopens for that family only; those 3 layers marked |
| M-A9 | Download once with the network up, then go offline and reload | font still renders (bytes cached in IndexedDB) |

---

## 12. Sequencing

| Phase | Items | Why this order |
| --- | --- | --- |
| **1** | `F-1` registry + `F-2` token parse + font gate, then **C-5** | Smallest diff, fixes the "every text is bold" class of wrongness and the swap flash. Everything else measures against a stable baseline. |
| **2** | `C-1` L1 layer cache + wrap-layout memo | The biggest single win, and it is layer-scoped so invalidation is local. |
| **3** | `C-2` clock + `C-3` video gate | Determinism. Do this before L2, or the cache stores the glitches. |
| **4** | `C-4` L2 frame cache + cache bar + render-ahead | The instant second play-through. |
| **5** | `F-3` import + `F-4` picker | Independent of the cache work; can run in parallel with 1–4 by a second agent. |
| **6** | `M-1`…`M-4` | Depends on the registry (`F-1`) and the import path (`F-3`). |

The cache must not ship before the clock fix. A frame cache filled from a wall-clock-driven
non-deterministic frame pipeline caches the wrong pixels — the bug becomes sticky, which is worse than
slow.

---

## 13. Open questions

1. **AM's default font when `<content font>` is absent.** All 16 `<content>` elements in
   `CONQ SHAKE PACK` omit it (§6.2). One APK capture with a default text layer, or a jadx read of the
   text-element default, settles it. Until then `Roboto 400` is the placeholder and the import report
   counts defaults applied.
2. **Is `fontthumb`'s family list the whole catalogue, or only the visible page?** 232 thumbs / 27
   families; AM may paginate or fetch a remote list. If remote, `fontcatalog.json` must be generated
   from the app's own endpoint, not scraped from the APK.
3. **Does AM embed fonts in a project at all?** Determines whether §10.4 option 2 is a compatibility
   extension or a divergence. Check for a `fonts/` or `fontfiles/` entry inside a real `.amproj`, and
   grep the dex for `fontFile`/`assetFont`.
4. **`serifpro_*.ttf` are 0 bytes upstream.** Decides whether Serif Pro is a live AM family at all. If
   the phone renders it, the APK is a bad repack and the real files must be sourced; if the phone does
   not, remove it from the picker.
5. **Cache scale policy.** Fixed (`0.5`) or adaptive (budget-derived)? Adaptive fills more frames;
   fixed is predictable. Recommend adaptive with a floor of `0.25` and a visible indicator in the cache
   bar.
6. **Should the L2 cache persist across reloads (OPFS)?** AE persists disk cache. For a web app the
   browser can evict under storage pressure, so the honest answer is *no by default, opt-in later*.

---

## 14. Sign-off

| # | Claim | Status |
| --- | --- | --- |
| S-01 | No preview frame or layer cache exists | ✅ verified (class members `renderer.ts:396-408`) |
| S-02 | Playback clock is wall-clock with a 100 ms clamp | ✅ verified (`EditorScreen.tsx:130,136`) |
| S-03 | Video is seeked from the render loop and uploaded mid-seek | ✅ verified (`renderer.ts:784-790`, `:595`) |
| S-04 | Text measured per character, rasterized per frame | ✅ verified (`renderer.ts:2642-2667`) |
| S-05 | Export path already awaits seeks; preview does not | ✅ verified (`videoExporter.ts:327` vs `EditorScreen.tsx:155`) |
| S-06 | 17 TTFs ship, 11 faces are registered, 2 files are 0 bytes | ✅ verified (byte counts, `tokens.css:1-77`) |
| S-07 | AM font token never resolves to a registered family | ✅ verified (`amXmlCodec.ts:656` vs `tokens.css:2`) |
| S-08 | `fontWeight`/`italic` parsed nowhere; 700 hardcoded | ✅ verified (`amXmlCodec.ts:649-664`, `renderer.ts:2634`) |
| S-09 | 232 font thumbnails, 27 families in the APK | ✅ verified (`assets/fontthumb/`) |
| S-10 | No `document.fonts` gate anywhere in `src/` | ✅ verified (0 hits) |
| S-11 | Which of C-1…C-5 *dominates* the user's glitch | ⚠️ **unmeasured** — needs the trace in §15 |
| S-12 | Google Fonts CSS API returns usable woff2 for the 27 families | ⚠️ unverified from this bench (network policy) — verify on first run |
| S-13 | AM's default font for a missing attribute | ⚠️ unknown — §13-q1 |

---

## 15. Repro — measure before changing

Run this once on the user's own glitchy project; it decides which of C-1…C-5 gets fixed first.

```js
// paste in the devtools console while the editor is open
(() => {
  const R = window.__rendererRef?.current;      // expose this in dev if absent
  if (!R) return console.warn('expose rendererRef for profiling');
  const s = { frames: 0, slow: 0, seeks: 0, uploads: 0, renders: 0, maxDt: 0 };
  const origRender = R.renderProject.bind(R);
  R.renderProject = (...a) => { s.renders++; const t = performance.now(); origRender(...a); const d = performance.now() - t;
    if (d > 8) s.slow++; s.maxDt = Math.max(s.maxDt, d); return d; };
  const origSync = R.syncVideosForPlayback.bind(R);
  R.syncVideosForPlayback = (...a) => { s.seeks++; return origSync(...a); };
  let last = performance.now();
  const loop = (now) => { s.frames++; last = now; if (s.frames < 600) requestAnimationFrame(loop); else console.table(s); };
  requestAnimationFrame(loop);
  window.__s = s;
})();
```

Read it like this:

- `maxDt` ≫ 16 ms with `renders` ≈ `frames` → **C-1** (per-frame cost) dominates.
- `seeks` ≫ `frames × videoLayers` → **C-3** (seek storm).
- `renders` ≈ `frames` and `slow`/`renders` > 0.3 → L1 cache is the lever.
- neither, yet the picture stutters → **C-2** (clock) — check `currentTimeMs` against
  `AudioContext.currentTime`.

Then, one command for the font side:

```js
['300 16px "Hind"','500 16px "Hind"','400 16px "Serif Pro"','700 16px "Space Grotesk"']
  .forEach((f) => console.log(f, document.fonts.check(f)));
```

Expected today: `true, false, false, true` — which is F-1 and F-2 in one line.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[PREVIEW_CACHE_FONTS]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\PREVIEW_CACHE_FONTS.md` |
| Status | partially-implemented |

Carry forward: This design shipped, but the L2 frame cache is written and never read - see PREVIEW_PERF_CHROMA_EXPORT.md P-1.
