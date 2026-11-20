# PREVIEW PERFORMANCE · CHROMA KEY · SCALE ASSIST · EXPORT INTEGRITY

Four tickets. Everything below was read out of the current tree, not remembered from an older version —
the preview cache and the font registry have **already shipped** since the last audit, so this file
starts from what exists now and names what is still broken.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Reference APK | `…\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Companions | `PREVIEW_CACHE_FONTS.md`, `ENGINE_PARITY.md`, `TIMELINE_GROUPS_IMPORT.md`, `Z_DEPTH_AUDIT.md` |
| Date | 2026-11-19 |

| Part | Scope | IDs |
| --- | --- | --- |
| 1 | Preview still flickers with shakes and effects | `P-1` … `P-7` |
| 2 | Green screen / chroma key must reveal the layer beneath | `K-1` … `K-5` |
| 3 | Scale Assist renders nothing | `S-1` … `S-3` |
| 4 | Export must be complete — no freezes, flashes, dropped frames | `X-1` … `X-6` |

---

## 1. TL;DR

| # | Finding | Anchor | Confidence |
| --- | --- | --- | --- |
| **P-1** | The L2 frame cache **is never read**. `renderProject` gates every lookup behind `options.useCache` — and **no caller in the repo passes it**. The cache is filled by `precacheFrame` and then ignored. Every visible frame goes down the uncached path | declared `renderer.ts:1190`, read `:1224`, **0 call sites** | ✅ verified (grep `useCache` → 2 hits, both in `renderer.ts`) |
| **P-2** | Cached frames are stored at `computeCacheScale` ≤ `previewScale`, but a miss renders at the **full** preview scale. Wire the cache naively and playback alternates sharp/soft frames — a new, worse flicker | `:1079-1085`, `:1245` vs `:1256` | ✅ verified |
| **P-3** | The cache key is `frameIdx` only. Selection (`selectedIds`) and `activeGroupStack` are ignored, yet both change rasterized output | `:1241` vs `:1252-1256`, `:1524`, `:1791` | ✅ verified |
| **P-4** | Any project with a video **cannot cache a frame while that video is seeking** — and playback seeks on drift > 0.5 s, so cache and need are mutually exclusive exactly when it matters | `:1103-1108`, `:1259` | ✅ verified |
| **P-5** | Video decode time and playhead time are two independent clocks; `renderLayerList` samples whatever the element holds at that instant. Shake multiplies the visible error because the layer moves every frame | `syncVideosForPlayback`, `:992-1010` | ⚠️ predicted (needs the §9 trace) |
| **K-1** | Chroma Key's shader is correct premultiplied math, and the compositor is correct premultiplied-over (`ONE, ONE_MINUS_SRC_ALPHA`). Green surviving means the **pass never ran** or **never composited** — not a math error | `renderer.ts:2144-2148`, `:1996-2005` | ✅ verified |
| **K-2** | A failed shader compile is silent in normal use: `verifyAllEffects()` is only reachable through the manual `window.__verifyAllShaders` hook — nothing calls it on import or project open, so one broken program means "the effect does nothing" | `shaderCompiler.ts:356`, `renderer.ts:3074`, `EditorScreen.tsx:126` — no automatic caller | ✅ verified |
| **K-3** | With `hasActiveSeekingVideo()`, a chroma-keyed **video** is the exact case the cache refuses to store — so the layer below shows a stale frame while the keyed layer updates | `:1174`, `:1259` | ✅ verified |
| **S-1** | **Scale Assist never runs.** It is a script-only, transform-mutating effect with `autoTransform: false` in the catalogue, and the transform-script loop skips anything where `!def.autoTransform` | `effects.json`, `renderer.ts:1352` | ✅ verified (root cause) |
| **S-2** | `shake` / `shake2` have `autoTransform: true` and do run — so the gate is a **per-effect flag**, not a rule. `scaleassist` is a false negative in that flag | `effects.json` | ✅ verified |
| **X-1** | The MediaRecorder fallback records **in real time** and writes **no audio**. Any stall becomes a frozen frame in the file; the output is silent | `videoExporter.ts:412-475`, `:473` | ✅ verified |
| **X-2** | The WebCodecs path is deterministic (awaits seeks, CFR timestamps) and is the only path that can promise "no freezes" | `videoExporter.ts:319-363` | ✅ verified |

One sentence: **the preview cache exists, is being written, and is never read; the export is already
deterministic on one of its two paths and structurally cannot be on the other; and three "effects don't
work" reports are one flag, one silent compile, and one compositor contract.**

---

# Part 1 — Preview flicker with shakes and effects (`P-*`)

## 2. The cache as shipped — and the one-line reason it does nothing

```ts
// src/engine/renderer.ts:1181-1249
public renderProject(project, sceneTimeMs, options: {...; useCache?: boolean } = {}) {   // :1190
  ...
  const cacheEligible = Boolean(options.useCache) && !isExport;                          // :1224
  if (cacheEligible) {
    ...
    const frameIdx = Math.max(0, Math.round((sceneTimeMs / 1000) * fps));                // :1240
    const cached = this.frameCache.get(frameIdx);                                        // :1241
    if (cached && cached.epoch === this.cacheEpoch) {
      this.cacheHits++;
      this.blitTexture(cached.tex, null, renderW, renderH, 1.0, false);                  // :1245
      return;
    }
    ...
```

```
$ grep -rn "useCache" src/
src/engine/renderer.ts:1190:      useCache?: boolean;
src/engine/renderer.ts:1224:    const cacheEligible = Boolean(options.useCache) && !isExport;
```

**Two hits. Both inside `renderer.ts`.** No call site passes the flag, so `cacheEligible` is always
false, so the block at `:1225-1274` never executes. That is the whole of P-1.

Meanwhile `EditorScreen.tsx:209` *does* fill it:

```ts
renderer.precacheFrame(currentProject, frameIdx, previewQuality);
```

So the app spends idle GPU time rendering frames into a texture map that the render path then ignores.
The user sees no benefit and pays the cost.

### 2.1 The trap — do not just pass `useCache: true`

`computeCacheScale` chooses the *storage* resolution:

```ts
// renderer.ts:1079-1085
const totalFrames = Math.max(1, Math.ceil((project.durationMs / 1000) * Math.max(1, project.fps)));
const fullBytes = Math.max(1, totalFrames * project.width * project.height * 4);
const adaptive = Math.sqrt((this.cacheBudgetBytes * 0.85) / fullBytes);
const capped = Math.min(previewScale, 1.0);
return Math.max(0.25, Math.min(capped, adaptive));
```

For a 3.2 s / 60 fps / 1080×1350 project on an iPad-class budget (384 MB):

```
fullBytes = 192 × 1080 × 1350 × 4 = 1.120 GB
adaptive  = sqrt(0.85 × 384 MB / 1.120 GB) = 0.553
cached scale ≈ 0.55    → 594×743 per frame
live   scale = 0.75 × 2 (DPR) = 1.5 → 1620×2025 per frame
```

A cache **hit** therefore draws a 594×743 texture stretched to 1620×2025; a **miss** draws a native
1620×2025 frame. Flip the flag today and playback becomes an alternating soft/sharp pulse — a flicker
that is more objectionable than the original stutter, and one that will be misdiagnosed as a shader bug.

**Both halves must land together:** the lookup and the *uniformity* of whatever comes out.

## 3. Fix — one playback scale, one key, one read path

### 3.1 `P-1` — wire the cache, and make hit and miss identical

Introduce a single `playbackScale` that is the **same for cached and freshly-rendered frames**, chosen
once per (project, quality, budget) and reused until one of those changes:

```ts
// renderer.ts
private playbackScale = 0;
private playbackScaleKey = '';

private resolvePlaybackScale(project: Project, previewScale: number): number {
  const key = `${project.id}|${project.width}x${project.height}|${previewScale}|${this.cacheBudgetBytes}|${project.durationMs}|${project.fps}`;
  if (key === this.playbackScaleKey) return this.playbackScale;
  this.playbackScaleKey = key;
  this.playbackScale = this.computeCacheScale(project, previewScale);
  return this.playbackScale;
}
```

Then in `renderProject`, when playing with the cache:

```ts
const cacheEligible = Boolean(options.useCache) && !isExport;
if (cacheEligible) {
  const fps = Math.max(1, project.fps);
  const frameIdx = Math.max(0, Math.round((sceneTimeMs / 1000) * fps));
  const pbScale = this.resolvePlaybackScale(project, options.previewScale ?? 1);
  const cw = Math.max(16, Math.round(project.width * pbScale));
  const ch = Math.max(16, Math.round(project.height * pbScale));

  const cached = this.frameCache.get(frameIdx);
  if (cached && cached.epoch === this.cacheEpoch) {
    cached.lastUsed = ++this.cacheTick;
    this.cacheHits++;
    this.blitTexture(cached.tex, null, this.canvas.width, this.canvas.height, 1.0, false);
    this.publishCacheStats();
    return;
  }
  this.cacheMisses++;

  // Miss: render at the SAME scale the cache would store, so every frame matches.
  const sceneFbo = this.acquireFbo(cw, ch);
  this.clearFbo(sceneFbo, cw, ch, ...);
  this.renderLayerList(project, project.layers, sceneTimeMs, sceneFbo, cw, ch, pbScale, key.selectedIds);
  this.blitTexture(sceneFbo.tex, null, this.canvas.width, this.canvas.height, 1.0, false);
  if (!this.hasActiveSeekingVideo()) {
    this.storeFrameInCache(frameIdx, sceneFbo, cw, ch, pbScale);
  }
  this.releaseFbo(sceneFbo);
  return;
}
```

Note the destination size: blit to `this.canvas.width/height`, **not** `renderW/renderH`. During
playback the canvas keeps its allocated size (that guard already exists at `:1211-1221`) and everything
is displayed at one fixed backing resolution. No pulsing, ever.

Callers:

```ts
// EditorScreen.tsx — playback tick (:287)
renderer.renderProject(proj, playheadMs, {
  previewScale: store.previewQuality,
  selectedIds: store.selectedLayerIds,
  activeGroupStack: store.groupStack,
  useCache: true,                        // <-- the missing line
});
```

The paused single-frame render (`EditorScreen.tsx:167`) keeps `useCache` **false** — a scrub must always
be exact, and it must not spend budget. Only the playback loop opts in.

### 3.2 `P-3` — the key must cover what the frame contains

Selection and the group stack change the rasterized result (`isSelected` at `:1524`, `selected: …` at
`:1791`). A frame rendered with a layer selected is not the same picture as one without.

Either **never cache while anything is selected** (simplest, and correct: playback with a selection is
exactly when you want live feedback) or key on the selection:

```ts
const key = {
  frameIdx,
  selHash: options.selectedIds?.length ? options.selectedIds.slice().sort().join(',') : '',
  grpHash: options.activeGroupStack?.join('>') ?? '',
};
```

Recommendation: **skip the cache entirely when `selectedIds.length > 0`**, and render playback at the
full preview scale in that state. Selection is a short-lived interaction; correctness beats the few
milliseconds.

### 3.3 `P-4` — the video/cache deadlock

```ts
private hasActiveSeekingVideo(): boolean {
  for (const entry of this.mediaVideos.values()) {
    if (entry.video.seeking) return true;      // :1105
  }
  return false;
}
```

One seeking video anywhere disables caching for the **whole frame**. During playback
`syncVideosForPlayback` has already corrected drift once, and any correction starts a seek — so a
40-layer shake project with one video can go an entire play-through storing nothing.

Two changes:

1. **Scope it.** Refuse to store only if a video *that is visible in this frame* is seeking. A video
   behind a `wipe2` at 0 % opacity still blocks the cache today.
2. **Snapshot instead of skipping.** When a visible video is mid-seek, use its **last good frame** (a
   per-entry `lastGoodTex` updated on every successful upload) as the cache content. A frame with a
   one-frame-stale video is *better* than no cached frame, and it is what AE does when a footage
   frame is still being read.

```ts
// per VideoMediaEntry
lastGoodMs: 0,
lastGoodTex: WebGLTexture | null,

// upload site
if (v.readyState >= 2 && !v.seeking) {
  gl.texImage2D(..., v);
  entry.lastGoodMs = v.currentTime * 1000;
  // copy into lastGoodTex, or ping-pong two textures
}
```

`hasActiveSeekingVideo()` then returns `true` only when **no** good frame exists at all (first frame of
the project, or a seek right after a trim change) — a rare condition instead of a permanent one.

### 3.4 `P-5` — two clocks, one picture

`syncVideosForPlayback` (`renderer.ts:806-871`) issues a corrective seek on drift > 0.5 s
(`:843`), and the render pass samples the element whenever `readyState >= 2 && !seeking`
(`:1007`). So the visible video advances on **decode time**, while the playhead advances on **audio or
wall time**. For a static layer that is invisible. For a shaken layer it is not:

- every frame re-samples the video at a decode position that does not correspond to that frame's
  playhead,
- shake moves the layer tens of pixels per frame, so the mismatch shows up as *content* sliding under a
  moving window — the eye reads it as flicker,
- motion blur variants (`motionblur*`, 3 passes) sample the same element at `t ± frameDt` offsets, so
  a single frame can contain **three different decode times**.

Fixes, in order of preference:

1. **Freeze the source per rendered frame.** At the top of a playback frame, latch
   `entry.frameToken = ++entry.decodeToken` and do not re-upload mid-frame; all passes of that frame
   sample one texture generation. This alone removes the intra-frame tearing motion blur creates.
2. **`requestVideoFrameCallback` pacing.** Drive video advancement from
   `video.requestVideoFrameCallback` and only render a frame when the required generation has arrived;
   otherwise reuse the last cached composite for that playhead position. This is the exact mechanism
   AE's footage cache replaces, and the browser gives it to you for free.
3. **Pre-seek on scrub, play on play.** Already partly present (park at `trimStart` when
   `startTime - sceneTimeMs < 500`, `:853`). Extend the parking window to 1 s and park with
   `preload="auto"`.

## 4. `P-6` — idle precache must not steal the frame

`precacheFrame` (`:1151`) renders through `renderLayerList` on the main GL context. If it runs during
idle it competes with the user's next interaction, and if it is invoked while `isPlaybackActive` is
true it just burns time (`:1156` already returns early — good). Two requirements:

- Fill only in `requestIdleCallback` slices with a hard `timeRemaining() > 6` check, and abandon the
  slice immediately on any pointer/key event.
- Never precache frames while a video in range is seeking (it will store a stale composite).

## 5. `P-7` — cache bar honesty

`getCachedFrameMap` (`:1068`) returns `0 = uncached, 1 = lower scale, 2 = full scale`. With §3.1 there is
only one scale, so always report `2` for a hit and drop the ambiguous middle state; instead flag
`epoch`-broken regions distinctly (that is the diagnostic that finds invalidation bugs).

---

# Part 2 — Chroma key must reveal the layer beneath (`K-*`)

## 6. What the shader does (and why the math is not the suspect)

`assets/effects/chromakey.xml`, group 0 — the operative lines:

```glsl
vec3 keyYUV = keyColor.rgb * rgb2yuv;
vec4 texColor = texture2DCv(inputImg.texture, acScreenNorm);
vec3 texYUV = (texColor.a <= 0.0 ? vec3(0.0) : texColor.rgb / texColor.a) * rgb2yuv;
float dist = length((keyYUV - texYUV) * vec3(0.25, 1.0, 1.0));
float alpha = smoothstep(threshold-feather/2., threshold+feather/2., dist);
if(invert) alpha = 1.-alpha;
if(defringe) texColor -= (keyColor*(1.0-alpha));
...
gl_FragColor = vec4(texColor.rgb, 1.0) * alpha*texColor.a;
```

Three things worth naming:

- The output is **premultiplied** (`vec4(rgb,1) * a`). Correct for the compositor.
- The shader is **luma-weighted** (`* vec3(0.25, 1.0, 1.0)` on YUV), which is why green keys more
  forgivingly than red — do not "improve" it to plain RGB distance; that breaks 1:1.
- The script picks group 0 vs group 1 from `env.editMode`:

```js
function animate(env,el,p) {
  if( env.editMode=="eyedropper-drag" && env.selected ) el.shaderGroups = [1];
  else el.shaderGroups = [0];
  return el;
}
```

`renderer.ts:1837-1839` honours `out.shaderGroups`. Good.

And the compositor is right:

```ts
// renderer.ts:2144-2148 — effect pass default blend
gl.enable(gl.BLEND);
gl.blendEquation(gl.FUNC_ADD);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);      // premultiplied over

// :1996-2005 — layer onto scene
this.blitTexture(currentSlot.tex, sceneFbo, renderW, renderH, finalAlpha, true, ...);
```

`alpha = 0` where the green was, blended premultiplied-over the scene → **whatever is already in
`sceneFbo` shows through**. Since layers composite in list order, that is the media layer below. The
contract already works *if the pass runs*.

## 7. Ranked causes — with the one command that discriminates

### `K-2` — the pass never runs (compile failure, silent) — **most likely**

`verifyAllEffects()` exists in `shaderCompiler.ts` and nothing in the import/open path calls it
(verified: no caller). A GLSL failure in `chromakey` therefore becomes "the effect does nothing", which
is indistinguishable from "the green stayed".

Note what this shader needs that others do not: `texture2DCv`, `getTexSize`, `rgb2yuv`/`yuv2rgb` as
`mat3`, and `inputImg.size` — plus `defringe` subtracting a `vec4` from `texColor`. The `mat3`
constructor overload is a known WebGL2/ANGLE sore point when the body is pasted into a `#version 300 es`
translation unit.

**Test (30 seconds)** — the hook already exists (`EditorScreen.tsx:126-127`):

```js
const r = window.__verifyAllShaders();          // -> AlightRenderer.verifyAllShaders() (:3074)
// r is shaderCompiler.verifyAllEffects(getEffects()) (:356): find the entry for
// com.alightcreative.effects.chromakey and read its log.
const r2 = window.__rendererRef?.current;       // the live renderer, for anything else
```

Whatever the shape, the acceptance for this ticket is: **`com.alightcreative.effects.chromakey` and
`chromakey-adv` both report a compiled program.** If they fail, the fix is the transpiler
(`shaderCompiler.ts:40-94`), not the effect — and the failure must become a visible import-report row
instead of a silent skip.

### `K-3` — the keyed layer is a video, and the layer below is stale

`hasActiveSeekingVideo()` blocks the cache exactly when a chroma-keyed video exists (§3.3). If the
*background* layer were cached and the keyed layer live, you would see the background frozen — which
reads as "the key doesn't show the layer behind, it shows a still". §3.3 fixes this.

### `K-1` — module isolation: the key is applied to a group, not a layer

`chromakey` needs **the layer behind it in scene order**. If the effect is on an `<embedScene>` group,
the group is rendered into `grpFbo` (`:1364-1403`) and the key operates on the flattened group image —
which includes the transparent background of the group, so the key sees `alpha == 0` pixels and the
shader's `texColor.a <= 0.0` branch feeds `vec3(0.0)` into the distance test. Black keys against nothing
and the `alpha` smoothstep lands at 1, i.e. **opaque everywhere**. Result: no visible keying.

Requirement: **chroma key is valid on a leaf layer, not a group.** Detect it on import and surface it
in the import report (`TIMELINE_GROUPS_IMPORT.md` §R-5 report), rather than silently doing nothing.

### `K-5` — defringe/edge clamp

The final block zeroes alpha at the sampled texture's edge:

```glsl
vec2 halfFragSize = vec2(1.0)/getTexSize(inputImg.size)/2.;
if(acLayerNorm.x <= halfFragSize.x || ... ) alpha = 0.0;
```

`inputImg.size` is bound to the **FBO size** (`:2184-2185`, `:2216`), and `acLayerNorm` comes from
`acScreenToLayer`, both as the pass builder supplies them. If `acScreenToLayer` is identity for a given
pass, `acLayerNorm` is screen-space and this clamp eats the **screen** border instead of the layer
border — a 1-pixel halo, not the reported failure. Verify with a 1 px border probe; low priority.

## 8. Required behaviour — the contract to test against

| # | Contract | Test |
| --- | --- | --- |
| K-A1 | Green (or the chosen key) becomes fully transparent, not black | sample a keyed pixel → equals the background layer's pixel, not `#000` |
| K-A2 | The media layer below is visible **and animating** | background video playing; sample two frames 200 ms apart → both match the background, values differ |
| K-A3 | Feather is a soft ramp, not a binary cut | 5 samples across the feather band → monotonically increasing alpha |
| K-A4 | `invert` flips the matte | with `invert` on, the subject disappears and the green survives |
| K-A5 | `defringe` removes green spill | mean `G - max(R,B)` on subject edges drops ≥ 40 % with defringe on |
| K-A6 | Applied to a group → reported, not silently inert | import report row: *"Chroma Key on a group is not supported"* |
| K-A7 | Alpha is premultiplied at output | `gl_FragColor.rgb <= gl_FragColor.a` for every pixel (sample via `readPixels` on the layer FBO) |
| K-A8 | Works with the layer beneath being a video that is mid-playback | 0 frames where the background shows a stale frame (compare against a paused scrub of the same time) |

K-A2 and K-A8 are the user's actual complaint, and both depend on Part 1 shipping first.

---

# Part 3 — Scale Assist (`S-*`)

## 9. Root cause — confirmed, one flag

`assets/effects/scaleassist.xml` is a **script-only** effect with no shaders:

```js
function animate(env,el,p) {
    if( p.axis == 0 ) { el.transform.scale.x *= p.scale; }
    else if( p.axis == 1 ) { el.transform.scale.y *= p.scale; }
    else if( p.axis == 2 ) { el.transform.scale.x *= p.scale; el.transform.scale.y *= (p.scale * p.damp); }
    else if( p.axis == 3 ) { el.transform.scale.x *= p.scale; el.transform.scale.y *= 1.0-((p.scale-1.0) * p.damp); }
    return el;
}
```

The catalogue says:

```
com.alightcreative.effects.scaleassist    autoTransform=False  shaders=0  script=True
```

And the only place transformation scripts run is gated on that flag:

```ts
// renderer.ts:1349-1352
for (const effInst of layer.effects) {
  if (!effInst.enabled) continue;
  const def = getEffectById(effInst.effectId);
  if (!def || !def.script || !def.autoTransform) continue;    // <-- scaleassist dies here
```

So `scaleassist` is skipped in the transform pass, contributes no shaders, and — because it is not
text-mutating and has no opacity output — also does nothing at `:1802` or `:2879`. **It is a complete
no-op. Confirmed root cause.**

The flag is not a rule, it is a hand-maintained list. `autoTransform: true` appears on exactly **17**
effects:

```
facemotion · jitter · movealongpath · movealongpath2 · movealongpath3
oscillate · oscillate2 · oscillate3 · pulsate · pulsate2
perlindisplace · randomdisplace · shake · shake2 · spin · swing · swing2
```

All 17 genuinely mutate the transform — so the flag is *usually* right, which is exactly why nobody
noticed `scaleassist` missing from it. Note what is **not** in the list and does not need to be:
`com.alightcreative.effects.transform` (a shader effect, `autoTransform: false`, `shaders: 1`) and the
fade family (handled through the opacity path at `:1802`). `scaleassist` is a **false negative** — its
script writes `el.transform.scale`, which is precisely what the transform pass exists to apply.

## 10. `S-1` — derive the gate, don't trust the flag

Three options; take the second.

**Option A — add `scaleassist` to a hardcoded allow-list.** One line, no risk, but the next false
negative is invisible until a user reports it.

**Option B — detect transform mutation from the script source (recommended).** The extracted script text
is already in the catalogue (`effects.json.script`), so a one-time static scan is exact enough:

```ts
// renderer.ts — module scope
const TRANSFORM_SCRIPT_RE = /\bel\s*\.\s*transform\s*\.|\btransform\s*\.\s*(scale|location|angle)\b/;
const transformScriptCache = new Map<string, boolean>();

function scriptMutatesTransform(effectId: string): boolean {
  const hit = transformScriptCache.get(effectId);
  if (hit !== undefined) return hit;
  const def = getEffectById(effectId);
  const result = Boolean(def?.script) && TRANSFORM_SCRIPT_RE.test(def.script!);
  transformScriptCache.set(effectId, result);
  return result;
}
```

Then:

```ts
if (!def || !def.script) continue;
if (!def.autoTransform && !scriptMutatesTransform(effInst.effectId)) continue;
```

This admits `scaleassist` (and any future transform script) while still excluding `chromakey`,
`motionblur*`, `textprogress` and everything else whose script only picks shader groups or text.

**Option C — run every script and diff the returned element.** Correct in principle, but it would run
scripts that mutate nothing, and the scripts are not all idempotent. Reject.

### 10.1 `S-2` — audit the other side of the flag

`com.alightcreative.effect.shakeparts` (singular namespace) is `script=False, shaders=0`. As an effect
that ships in the APK and can be dropped on a layer, it currently does nothing by construction. Either
it is a pure metadata/UI effect (verify against AM) or the extractor dropped its payload. Add a
**startup consistency assertion** for the whole catalogue so this class of no-op is caught by a test
rather than by a user:

```ts
for (const def of allEffects()) {
  const inert = !def.shaders.length && !def.script && !def.passes?.length;
  if (inert) console.debug(`[catalog] ${def.id} is inert (no shader, no script, no passes)`);
}
```

Ship it as a test assertion with an allow-list of effects that are *legitimately* inert.

## 11. `S-3` — acceptance

| # | Test | Pass |
| --- | --- | --- |
| S-A1 | Drop Scale Assist on a 100 %-scale image, `axis = X, -Y`, `scale = 1.5` | frame differs from baseline; measured bounding box 1.5× wide **and** 0.25× short (Y is `1-((1.5-1)×1) = 0.5`) |
| S-A2 | Same, `axis = X` | only width changes |
| S-A3 | `damp = 0.5`, `axis = X,Y` | `sx ×= 1.5`, `sy ×= 0.75` |
| S-A4 | Keyframe `scale` 1 → 2 over the clip | size animates monotonically; matched against the APK at 3 timestamps |
| S-A5 | Parent/child rig | the transform composes through the parent (`:1374-1385`) exactly once — assert no double-application |
| S-A6 | `verifyAllEffects()` sweep | 0 non-allow-listed inert effects |

---

# Part 4 — Export integrity (`X-*`)

## 12. Two export paths, two very different promises

### `X-3` — the WebCodecs path is already deterministic

```ts
// videoExporter.ts:319-350
for (let f = 0; f < totalFrames; f++) {
  const tMs = (f * 1000) / fps;
  await renderer.prepareMediaAtTime(project, tMs);                 // exact seek awaited
  renderer.renderProject(project, tMs, { renderWidth: width, renderHeight: height });
  const timestampUs = Math.round((f * 1_000_000) / fps);           // CFR, integer µs
  const frame = new VideoFrame(renderer.canvas, { timestamp: timestampUs, duration: durationUs });
  videoEncoder.encode(frame, { keyFrame: f === 0 || f % keyFrameInterval === 0 });
  frame.close();
  while (videoEncoder.encodeQueueSize > 8) { ... }                  // backpressure
}
```

- Frame times are **exact and independent of wall clock** → no freeze is possible in the container.
- `preserveDrawingBuffer: true` (`renderer.ts:470`) makes `new VideoFrame(canvas)` safe — without it,
  capturing outside the paint task returns a cleared buffer, which is the classic intermittent-black
  export. **Already correct; keep it.**
- Exports bypass the frame cache (`cacheEligible` is false for `isExport`) → correct, never render from
  a preview-resolution texture.

So: **export freezes/flashes come from (a) the fallback path, (b) un-awaited seeks, (c) encoder errors
detected late.** In that order.

### `X-1` — the MediaRecorder fallback cannot be deterministic

```ts
// videoExporter.ts:429-459
const stream = renderer.canvas.captureStream(0);
recorder.start(100);                       // real-time recording
for (let f = 0; f < totalFrames; f++) {
  await renderer.prepareMediaAtTime(project, tMs);
  renderer.renderProject(project, tMs, { renderWidth: width, renderHeight: height });
  track.requestFrame?.();
  const targetWall = startWall + (f + 1) * frameMs;
  const wait = targetWall - performance.now();
  if (wait > 1) await new Promise((r) => setTimeout(r, wait));   // sleeps when early, never compensates when late
}
```

Defects, all structural:

1. **Wall-clock timestamps.** MediaRecorder timestamps by real time. When rendering a frame takes
   longer than `frameMs`, the gap is filled by repeating the previous frame → **a freeze in the file**.
   The `wait` only ever sleeps; it never catches up.
2. **`hasAudio: false`** (`:473`) — the fallback **silently exports a silent video**. That is a
   complete-data loss, not a cosmetic one.
3. **`requestFrame` may be absent.** `captureStream(0)` with no `requestFrame` (some Safari builds)
   emits frames only when the canvas is composited; a background tab emits nothing → a stalled or empty
   recording.
4. **No `recorder.onerror` handler**, and `recorder.start(100)` chunks can be emitted after `stop()`
   resolves `stopped` — a race on the final chunk.

### `X-2` — un-awaited seek fallbacks

`prepareMediaAtTime` has three exits (`:915`, `:936`, `:955`): `readyState < 1`, the `rVFC` path, and a
`loadeddata` fallback. Any path that resolves **without** the frame actually matching `targetSec`
(within ~2 ms, `:927`) hands the renderer a stale frame — a flash in the output. Requirement: on
timeout, **do not render a stale video frame**; use the last good frame *and* mark the export report row
so the defect is visible instead of silent.

### `X-4` — encoder errors are only checked at the top of the loop

```ts
if (encoderError) throw encoderError;    // :323, before the frame
```

An error raised *during* `encode()`/`flush()` on frame N is not seen until N+1 — and if it happens on
the last frame it is never seen at all because `videoEncoder.close()` runs first (`:363`). Check
`encoderError` after `flush()` **before** `close()`, and again after encoding audio.

### `X-5` — pre-warm everything before frame 0

A shader compiled on demand during an export stalls that frame. Under WebCodecs that only costs time;
under MediaRecorder it costs a **freeze**. Before the loop:

```ts
renderer.verifyAllEffects();              // compile every program the project references
await renderer.prepareMediaAtTime(project, 0);
renderer.renderProject(project, 0, { renderWidth: width, renderHeight: height });  // warm FBO pool
await new Promise((r) => requestAnimationFrame(() => r(null)));
```

### `X-6` — export must not depend on the preview cache or the preview clock

Assert in code (and in a test): the export loop never reads `previewQuality`, never touches
`frameCache`, and never calls `syncVideosForPlayback(..., true)`.

## 13. Required behaviour — export contract

| # | Contract | Test |
| --- | --- | --- |
| X-A1 | **No frozen frames.** Every frame differs from the previous by the expected amount | compute per-frame mean abs diff; no run of ≥ 2 identical frames in a moving project |
| X-A2 | **No black/flash frames** | after decode, no frame whose mean luma deviates > 40 % from both neighbours |
| X-A3 | **Exact duration and frame count** | `probe.duration ≈ totalFrames / fps` within 1 frame; `probe.nb_frames == totalFrames` |
| X-A4 | **CFR timestamps** | `ffprobe -show_frames` → all `pkt_duration_time` equal (1/fps ± 1 µs) |
| X-A5 | **Audio present exactly when the project has audio** | stream count 2; `hasAudio` in the result matches |
| X-A6 | **Chroma-keyed video exports like the preview** | frame 30 of the export vs frame 30 of the APK capture at the same size |
| X-A7 | **No stale-seek flash on a video with 4+ cuts** | scrub the exported file at each cut ±1 frame; no frame shows the wrong shot |
| X-A8 | **Abort is clean** | cancel mid-export → no partial blob returned, encoder closed, no leaked GL objects |
| X-A9 | **Long export is memory-flat** | 60 s @ 1080×1350: `usedJSHeapSize` growth < 100 MB, `encodeQueueSize` never > 8 |

Gate the fallback explicitly: if `VideoEncoder.isConfigSupported` fails for every candidate
(`:223-232`), **warn before exporting** — "this browser cannot export deterministically; audio will be
dropped and long renders may freeze" — and prefer to disable the button on Mobile Safari rather than
ship a broken file. A blocked export is honest; a frozen one is not.

---

## 14. Sequencing

| Phase | Items | Why |
| --- | --- | --- |
| 1 | **S-1** | One gate, one effect, zero risk to anything else. Ships immediately and proves the transform-script path works. |
| 2 | **P-3 + P-1 §3.1** (playback scale + key + `useCache: true`) | The cache becomes real only when hit and miss produce the same resolution. Must be one change. |
| 3 | **P-4** (scoped seek check + last-good-frame snapshot) | Makes the cache usable on video projects, which is the whole reported case. |
| 4 | **K-2** (compile verification on import/open) | Turns "the effect does nothing" into a visible error. Then fix whatever the log names. |
| 5 | **P-5** (frame-generation latch + rVFC) | Removes the shake × video tearing. Biggest visible-quality win. |
| 6 | **X-2 / X-4 / X-5** | Export hygiene; independent of the rest. |
| 7 | **X-1** fallback hardening, or gate it off | Last, because it is a portability path, not the main one. |

Phases 1 and 6 are independent and can run in parallel. Phase 4 must precede phase 5: you cannot judge
a chroma-key fix on a pipeline that is still silently dropping passes.

---

## 15. Open questions

1. **Why is `scaleassist` flagged `autoTransform: false` when its script mutates the transform?** Two
   possibilities: the flag means something else entirely in AM (e.g. "applies its own transform maths"),
   or the extractor mismapped it. §10's detection makes the question moot for rendering, but the answer
   belongs in `COMPAT_EFFECTS.md` before anyone "fixes" the flag globally and re-breaks `chromakey`.
2. **Is chroma key legal on a group in AM?** If yes, the group FBO must preserve the underlying scene
   so the key can see through it — that is a different (and much larger) fix than `K-1`'s report-only.
   One APK test with the effect on a group settles it.
3. **Does AM cache footage frames independently of the composite?** If so, Part 1's L2 frame cache is
   the wrong shape long-term and an L1 footage cache is the thing to build next.
4. **`chromakey-adv`'s 31 params** — the extractor has them, but has anyone verified the script's
   `shaderGroups` selection for its extra modes (spill suppression, matte-only)? A no-op in group 1
   looks identical to a compile failure.
5. **Does the fallback export need to exist at all?** If WebCodecs covers Chrome/Edge/Firefox/Safari 17+,
   the honest move is a capability gate plus a clear message, not a real-time recorder that fakes a
   deterministic export.

---

## 16. Sign-off

| # | Claim | Status |
| --- | --- | --- |
| C-01 | L2 cache is written and never read (`useCache` has no caller) | ✅ verified (grep, 2 hits in `renderer.ts`) |
| C-02 | Cached frames are stored below preview scale, misses render at full scale | ✅ verified (`:1079-1085`, `:1245` vs `:1256`) |
| C-03 | Cache key omits selection and group stack | ✅ verified (`:1241` vs `:1252-1256`) |
| C-04 | One seeking video disables caching for the whole frame | ✅ verified (`:1103-1108`, `:1259`) |
| C-05 | Chroma key output is premultiplied and the compositor is premultiplied-over | ✅ verified (shader text, `:2144-2148`, `:1996-2005`) |
| C-06 | Chroma-key compile failures are silent in normal use (`verifyAllEffects` is only exposed as a manual hook) | ✅ verified (`shaderCompiler.ts:356`, `renderer.ts:3074`, `EditorScreen.tsx:126`) |
| C-07 | Scale Assist is skipped because `autoTransform` is false | ✅ verified (`:1352` + catalogue row) |
| C-08 | `shake` / `shake2` carry `autoTransform: true` and do run | ✅ verified (catalogue) |
| C-09 | WebCodecs export uses awaited seeks and CFR timestamps | ✅ verified (`videoExporter.ts:319-350`) |
| C-10 | MediaRecorder fallback records real time and drops audio | ✅ verified (`:429-459`, `:473`) |
| C-11 | Which of P-5 / K-2 dominates the reported flicker | ⚠️ **unmeasured** — run §17 |
| C-12 | Chroma key actually fails to compile on the user's GPU | ⚠️ unknown — §7's 30-second test answers it |
| C-13 | AM allows chroma key on a group | ⚠️ unknown |

---

## 17. Repro — decide before you patch

**Preview flicker.** In devtools, with the glitchy project open:

```js
// 1. does the cache ever hit?
window.__previewCacheStats
// expect: hits: 0  -> P-1 confirmed. hits > 0 but still flickering -> P-2.

// 2. are the shaders all compiling?
window.__verifyAllShaders && window.__verifyAllShaders()

// 3. per-frame cost while playing
(() => {
  const s = { renders: 0, slow: 0 };
  const R = window.__rendererRef?.current;
  if (!R) return 'expose __rendererRef';
  const orig = R.renderProject.bind(R);
  R.renderProject = (...a) => { s.renders++; const t = performance.now(); orig(...a); if (performance.now() - t > 8) s.slow++; };
  setTimeout(() => console.table(s), 3000);
})();
```

Read it like this:

- `hits: 0` → **P-1**. Nothing else matters until the cache is read.
- `hits > 0` and the picture pulses sharp/soft → **P-2**.
- `hits: 0` *and* a video layer present → **P-4**.
- `slow / renders > 0.3` with the cache already wired → the per-frame cost is the problem, not the cache.

**Scale Assist.** One line proves it:

```js
const R = window.__rendererRef.current;
console.log(R.getEffectById ? '' : '');
// drop the effect on a layer, then compare bounding boxes with and without it
```

If the layer's rendered bounds are identical with the effect at `scale = 2`, **S-1** is confirmed
(the script never ran) rather than "the shader is wrong" (there is no shader).

**Export.** Measure the file, don't eyeball it:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames,r_frame_rate,duration \
        -show_entries frame=pkt_dts_time,pkt_duration_time -of csv out.mp4 | head -20
# freeze detector: count consecutive identical frame hashes
ffmpeg -v error -i out.mp4 -vf "mpdecimate=hi=64*12:lo=64*5:frac=0.33" -f null - 2>&1 | tail -5
```

`mpdecimate` reporting drops for a project that moves every frame is the freeze, quantified.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[PREVIEW_PERF_CHROMA_EXPORT]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\PREVIEW_PERF_CHROMA_EXPORT.md` |
| Status | active |

Carry forward: Wire useCache and a uniform playbackScale in the SAME change, or the cache introduces a new flicker.
