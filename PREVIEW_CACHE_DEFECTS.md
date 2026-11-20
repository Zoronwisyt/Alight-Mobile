# PREVIEW_CACHE_DEFECTS

Audit of the L2 preview frame cache as it stands **after** the offscreen-video-pool change landed. The
symptom reported: the cache makes the preview **flashy** and **stuttery** at the same time.

| Marker | Meaning |
| --- | --- |
| ✅ verified | read out of the current code in this session |
| ⚠️ predicted | hypothesis with a named test |
| ❌ open | needs a measurement or an APK capture |

> [!warning] The code moved since the last audit
> `PREVIEW_STATIC_GLITCH_COMPAT_FONTS.md` was written against `renderer.ts` at 3 053 lines. It is now
> **3 066 lines** and the G-1a (offscreen video pool) and G-3 (pump restart) fixes are **in**:
> `renderer.ts:443-445`, `:695-697`, `:1256-1282`; `EditorScreen.tsx:226-233`, `:298`.
> Every line number in this document is against the **current** tree. Anchors in the older document are
> stale by 5–13 lines and should be re-read before being quoted.

## 0. TL;DR

Five defects explain both symptoms. None of them is the shader work, and none is a torn read.

| # | Defect | Symptom |
| --- | --- | --- |
| **FL-1** | Playback renders at `playbackScale` (0.51–0.75); the paused render renders at `previewScale × DPR` (1.5). The paused path never reads the cache. | **flash** — a 2–3× sharpness pop on every play/pause |
| **FL-2** | Frames are baked with up to **120 ms** of video error but compared against a 33 ms live frame. | flash of a stale video frame at every hit→miss boundary |
| **ST-1** | The cache refuses to store once it is 88 % full, and the pump treats "refused" as "keep going", so coverage is **permanently partial**. | stutter that never goes away, however long you leave it |
| **ST-2** | At the coverage boundary the playback loop alternates `pauseAllVideos(true)` / `v.play()` per frame. | decoder thrash — repeated frames, then a jump |
| **ST-3** | Storing a frame during playback runs `copyTexSubImage2D` + LRU sort + stats + a throttled React re-render **on the playback thread**. | dropped frames during cold playback |

The single highest-value change is **FL-1**, because it is the only one the user *sees* on every
interaction. The single highest-value change for perceived smoothness is **ST-1**, because it is why the
stutter never settles.

---

## 1. The pipeline as it exists now

```
paused, any repaint      EditorScreen.tsx:203-213   renderProject(useCache:false)
                         renderer.ts:1343-1351      scale = min(q*DPR, 4096/maxDim)  → 1.5 at q=.75, DPR 2
                         renderer.ts:1415-1425      full render into FBO at 1.5, blit 1:1

playing                  EditorScreen.tsx:377-382   renderProject(useCache:true)
                         renderer.ts:1385           pbScale = resolvePlaybackScale(...)  → 0.51…0.75
                         renderer.ts:1389-1396      HIT  → blit cached 0.75 texture into a 1.5 canvas
                         renderer.ts:1399-1412      MISS → render at 0.75, blit into 1.5, then bake

idle (>350 ms)           EditorScreen.tsx:221-298   pump → precacheFrameAsync, offscreen video pool
                         renderer.ts:1249           88 % budget guard, permanent
```

Two scales, two purposes, and **no code that reconciles them.** That is the whole of FL-1.

### The numbers, for a 1080 × 1352 project at the default quality (0.75) on a DPR-2 display

| Case | Paused scale | Playback scale (`computeCacheScale`) | Pop |
| --- | --- | --- | --- |
| 4 s @ 30 fps (120 frames), desktop budget 1536 MiB | 1.50 | `sqrt(0.85·1536 / 668.6)` = 1.40 → capped to **0.75** | **2.0×** |
| 30 s @ 30 fps (900 frames), same budget | 1.50 | `sqrt(0.85·1536 / 5015)` = **0.51** | **2.94×** |
| 4 s @ 30 fps, ≤1024 px window (budget 384 MiB) | 1.50 | `sqrt(0.85·384 / 668.6)` = **0.70** | 2.15× |

`fullBytes` is `frames × w × h × 4` (`renderer.ts:1131`); the budget comes from `renderer.ts:476-482`.
So **the longer the project, the worse the pop** — which matches "it got worse on the bigger project".

---

## 2. The flash

### FL-1 — ✅ confirmed: two render scales, no reconciliation

```ts
// renderer.ts:1345-1348  — the paused path
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const effectiveScale = Math.min(q * dpr, 4096 / Math.max(1, maxDim));

// renderer.ts:1129-1135  — the cache/playback path
const adaptive = Math.sqrt((this.cacheBudgetBytes * 0.85) / fullBytes);
const capped = Math.min(previewScale, 1.0);
return Math.max(0.25, Math.min(capped, adaptive));
```

`effectiveScale` is *never* limited by the budget. `computeCacheScale` *always* is, and additionally caps at
`min(previewScale, 1.0)` — so even on a tiny project it can never exceed the UI quality setting, while the
paused path multiplies it by DPR.

Note what does **not** happen: the canvas is not resized. `renderW` is computed the same way in both paths
(`:1349-1350`), so `canvas.width` stays at the sharp value; only the *content* FBO `cw × ch` shrinks
(`:1386-1387`) and gets upscaled by the blit at `:1393`. So the pop is pure blur — no layout jank, no
white flash, just the picture going soft. That reads as "flashy" because it is instantaneous and total.

The pump has already precached the parked frame, and the paused render **ignores it**:

```ts
// EditorScreen.tsx:208-213
renderer.renderProject(store.currentProject, store.currentTimeMs, {
  previewScale: store.previewQuality,
  selectedIds: store.selectedLayerIds,
  activeGroupStack: store.groupStack,
  useCache: false,          // ← the frame is almost certainly cached, and this throws it away
});
```

**Fix.** Two coherent options; pick one, never both:

| Option | Effect | Cost |
| --- | --- | --- |
| **A — one scale everywhere** — `useCache: true` on the parked render, accept `pbScale` as the preview scale | zero pop, instant pause | preview is 0.75-scale while parked |
| **B — split tiers** — keep playback at `pbScale`, and on pause render the **full-res still into a single-frame "still slot"** that is only re-rendered when the playhead moves or the project changes | zero pop on pause→play, full detail when still, one transition | +1 texture (≈6.5 MB at 1.5) and one render per park |

Option **B** is what After Effects actually does, and it is the only version where both requirements
("sharp while editing" and "no pop") are satisfiable. The transition still happens once, but it happens
*after* the picture has settled, not on the button press.

> [!danger] Do not do half of it
> Flipping `useCache: true` without the still slot gives you option A — that is fine. Flipping it *while*
> keeping a full-res paused path is the current bug. Adding the still slot without also passing
> `useCache: true` on the parked render leaves the re-render cost and the pop.

### FL-2 — ✅ confirmed: frames are baked with up to 120 ms of video error

```ts
// renderer.ts:1059-1060
if (v.seeking || !entry.hasFrame || Math.abs(v.currentTime - targetSec) > 0.12) {
  this.hadStaleVideoThisFrame = true;
}
```

The bake guard (`:1407-1409`) only refuses a frame when the video is **more than 120 ms** off target. At
30 fps a frame is **33 ms**. So a cached frame can hold a video image from three frames away and still be
declared clean — and `storeFrameInCache` bakes it.

Then, on replay, the live decoder is exact and the cached frame is not, so the boundary between them is a
visible jump in the video content. On a fast-moving clip that is indistinguishable from a glitch.

**Fix.** Make the tolerance frame-relative, not absolute:

```ts
const frameDurSec = 1 / Math.max(1, project.fps);
const tol = Math.max(0.004, frameDurSec * 0.5);   // half a frame
```

and use `tol` at `:1059`. A frame that cannot be decoded within half a frame should be **skipped**, not
baked wrong. The cache is allowed to have holes; it is not allowed to have lies.

### FL-3 — ⚠️ predicted: the hit→miss boundary shows the stale texture for one or more frames

`uploadVideoTex` returns `false` whenever `readyState < 2 || v.seeking` (`renderer.ts:657-664`), and
`uploadImageOrVideo` then returns the *previous* `entry.tex` (`:1063`). After a boundary the decoder is
restarted by `v.play()`, so the first frame or two of live playback after any hit shows the last cached
video image, then snaps. **Test:** park at a hit frame, play, and log `entry.lastUploadedTime` against
`video.currentTime` for the first 10 frames after the first miss — a gap of more than one frame duration
confirms it.

### FL-4 — ⚠️ conditional: `hasCachedFrame` does not verify the stored scale

```ts
// renderer.ts:1212-1226
if (this.lastCacheProjectId !== project.id ||
    this.lastCacheScale !== qKey ||          // qKey is previewScale × 100 — NOT the playback scale
    this.lastCacheFontEpoch !== fontEpoch.value) return false;
```

`qKey` is the *UI* quality, and `resolvePlaybackScale` (`:1137-1143`) additionally keys on
`project.durationMs`, `width × height`, `fps` and the budget. If any of those change while
`previewScale` stays fixed, `pbScale` changes, **the epoch does not**, and cached frames from the old scale
stay valid — so a single playback can blend two sharpnesses. In normal editing this is masked, because any
such change also bumps `modifiedTime` → `invalidatePreviewCache()` (`EditorScreen.tsx:178`). It becomes live
the moment anything mutates duration/fps/size without a `modifiedTime` bump (import path, project settings
dialog, programmatic edits).

**Fix.** Add the playback scale to the invalidation key:

```ts
const pbScale = this.resolvePlaybackScale(project, options.previewScale ?? 1);
if (this.lastCachePbScale !== pbScale) { this.lastCachePbScale = pbScale; this.clearPreviewCache(); this.cacheEpoch++; }
```

---

## 3. The stutter

### ST-1 — ✅ confirmed: the cache has a permanent dead band at 88 %

```ts
// renderer.ts:1249
if (this.cacheBytes >= this.cacheBudgetBytes * 0.88) return false;
```

and the pump:

```ts
// EditorScreen.tsx:270-274
while (cursor < order.length && !cancelled) {
  const frameIdx = order[cursor++];
  const didCache = await renderer.precacheFrameAsync(currentProject, frameIdx, previewQuality);
  if (didCache) break;          // only a SUCCESS yields
}
```

Once the cache crosses 88 %, every call returns `false`, so `break` never fires, the loop spins through
**every remaining frame in one idle slice** doing nothing, and the pump then exits for good. Meanwhile
`evictPreviewCache` only runs inside `storeFrameInCache`, which is never reached again — so the cache sits
frozen at 88 %, and **the frames beyond the freeze are never cached for the life of that epoch.**

That is why the stutter is systematic rather than occasional: coverage ends at a fixed frame, and playback
crossing that frame thrashes (ST-2) every single loop.

**Fix.** "Refused because full" and "refused because already cached" are different answers and must not
share a return value:

```ts
type PrecacheResult = 'stored' | 'present' | 'full' | 'blocked';

// pump
const r = await renderer.precacheFrameAsync(...);
if (r === 'stored') break;                 // one frame per idle slice, as intended
if (r === 'full' || r === 'blocked') break;  // stop the sweep; do not spin
// 'present' → advance to the next frame immediately
```

and let `storeFrameInCache` evict-and-store instead of `precacheFrameAsync` refusing: the cache should
**replace** the LRU frame, not stop improving. Currently `evictPreviewCache` targets 90 % (`:1146`) and the
guard refuses at 88 % — two thresholds, one below the other, so the eviction path is unreachable from the
pump. Either delete the guard or lower the eviction target below it; do not leave them inverted.

### ST-2 — ✅ confirmed: per-frame `pause()` / `play()` thrash at the boundary

```ts
// EditorScreen.tsx:369-376
const isHit = store.groupStack.length === 0 && renderer.hasCachedFrame(proj, playheadMs, store.previewQuality);
if (isHit) {
  renderer.pauseAllVideos(true);     // sets isPlaybackActive = true, pauses every live <video>
} else {
  renderer.syncVideosForPlayback(proj, playheadMs, true);   // may seek, then v.play()
}
```

`pauseAllVideos` (`renderer.ts:913`) pauses **every** entry in `mediaVideos`. `play()` on the
next miss restarts the decoder. Alternating hit/miss therefore alternates decoder stop/start every frame —
which is exactly the "stuttering" texture: repeated frames followed by a jump.

Because ST-1 makes coverage permanently partial, this is not a rare edge case; it happens once per loop
crossing, and **every** time the user edits (FL-1/C-2 wipe the cache).

**Fix.** Pausing decoders on a hit is a legitimate optimisation, but it needs hysteresis — pause only after
*k* consecutive hits, resume only after *k* consecutive misses (k ≈ 4). One decoder transition per boundary
instead of one per frame.

### ST-3 — ✅ confirmed: cache maintenance runs on the playback thread

On every miss during playback (`renderer.ts:1399-1412`) the same tick performs:

1. a full `renderLayerList` into a pooled FBO,
2. `storeFrameInCache` → `gl.createTexture` + `copyTexSubImage2D` (GPU-to-GPU, but still a sync point),
3. `evictPreviewCache` → **`Array.from(map).filter().sort()` over the whole cache** (`:1148-1150`) whenever
   the budget is exceeded,
4. `publishCacheStats()` → a fresh object + a write to `window.__previewCacheStats` (`:1110-1122`),
5. `onCacheChange?.()` → throttled to 180 ms in React (`EditorScreen.tsx:139-146`) → `setCacheVersion` →
   `EditorScreen` and `Timeline` re-render, and `Timeline.tsx:132` re-walks `getCachedFrameMap` while
   `Timeline` maps every layer twice per render.

On a 60 fps display that is a budget of 16.6 ms per frame, and steps 3–5 are unbounded in project size.
**`publishCacheStats` also runs on every *hit*** (`:1394`), i.e. 60 allocations + 60 window writes per second
on the hot path.

**Fix.**
- `publishCacheStats` → once per animation frame, not per render (or only when a listener exists).
- Eviction → an index/amortised structure, or run it on the idle pump only, never during playback.
- Do not store frames during playback at all: playback should be **read-only** against the cache. If a frame
  is missing, play it live and let the idle pump fill it later. That single change removes steps 2–5 from
  the playback path entirely.

### ST-4 — ⚠️ predicted: the offscreen video pool is unbounded

```ts
// renderer.ts:443-445
private offscreenVideos = new Map<string, VideoMediaEntry>();
```

Cleared only in `dispose()` (`:3269-3277`). One decoder **and** one full-resolution texture per
`layerId::src` for the life of the session, across every project opened. Twenty video layers at 1080p is
~20 decoders and ~160 MB of texture on top of the L2 budget. On a memory-tight GPU that shows up as
eviction stalls mid-playback.

**Fix.** Mirror the live pool's lifecycle: evict offscreen entries when a project closes, and cap the pool
at `min(4, activeVideoLayers)` with LRU reuse. The pool exists to protect the live textures, not to keep a
second copy of every video in memory forever.

---

## 4. Correctness

### CR-1 — ✅ `precacheFrame` (the synchronous variant) still uses the live video pool

`renderer.ts:1285-1317` is the pre-G-1a implementation: it never sets `isOffscreenPass`, so it seeks the
live `<video>` elements and re-arms the exact bug the recent change fixed. It currently has **zero callers**
(verified by grep), which is the only reason it is dormant. Delete it, or forward it to the async path.

### CR-2 — ✅ the per-frame size cap is silently lossy

```ts
// renderer.ts:1174
if (bytes > this.cacheBudgetBytes / 12) return;
```

On a 192 MiB mobile budget that is 16 MiB per frame — fine for 1080×1352, but a 4 K project at `pbScale`
0.5 is 1920×2160×4 = 16.6 MB, i.e. **every frame is silently refused** and the cache looks "built but
empty". The guard needs to *lower the scale* rather than drop the frame, or at minimum report the condition
through `getPreviewCacheStats` so the cache bar can say "too large" instead of showing nothing.

---

## 5. Ruled out — do not chase

| Suspect | Why not |
| --- | --- |
| Torn frames / half-drawn canvas | every draw is synchronous on one GL context; `blitTexture` disables blend for the final blit (`renderer.ts:623-656`) so the quad fully replaces the viewport |
| White flash on canvas resize | `:1354-1363` refuses to resize while `isPlaybackActive` |
| Easing / keyframe evaluation | deterministic, and `GRAPH_EASING_AUDIT.md` already owns that bug |
| The G-1 parked-video feedback loop | ✅ fixed — `isOffscreenPass` is set/restored in a `try/finally` (`:1256-1282`) and offscreen entries never call `onMediaReady` (`:721-722`) |
| Font-epoch invalidation | only fires on font changes, not per frame |

---

## 6. Fix order

1. **ST-1** — separate the four precache outcomes and stop the sweep on `full`. One function, one enum.
   Without this, nothing else can be measured, because coverage is never complete.
2. **ST-3** — make playback read-only against the cache; move storing and eviction to the idle pump.
3. **FL-1** — pick option A or B and unify the scale. This is the visible fix.
4. **ST-2** — hysteresis on `pauseAllVideos` / `syncVideosForPlayback`.
5. **FL-2** — frame-relative stale tolerance.
6. **FL-4 / CR-1 / ST-4 / CR-2** — hygiene, in any order.

Do **not** ship 3 before 1. Unifying the scale while coverage is permanently partial just makes every
boundary both a stutter *and* a sharpness pop.

---

## 7. Instrumentation and acceptance

Add to `getPreviewCacheStats` before starting: `pbScale`, `budgetUsedPct`, `lastPrecacheResult`,
`consecutiveHits`, `consecutiveMisses`, `storeMsP50/P95`. The existing hooks are
`window.__previewCacheStats` (`renderer.ts:1110-1122`), `window.__rendererRef` and
`window.__verifyAllShaders` (`EditorScreen.tsx:147-148`).

| # | Test | Pass condition |
| --- | --- | --- |
| PC-A1 | Park on frame 0 of a 30 s video project, wait 60 s, read `cachedCount` | equals `min(totalFrames, budget/frameBytes)` — **not** 88 % of it |
| PC-A2 | Play the 30 s project start to finish, twice | second pass: 0 misses; no decoder state change more than once per boundary |
| PC-A3 | Play, pause, compare canvas hashes at 0 ms and 400 ms after pause | identical (no after-the-fact re-render), **or** documented as the single intended sharpening transition |
| PC-A4 | Play a project entirely from cache, measure frame times | p95 ≤ 16.6 ms, 0 long frames |
| PC-A5 | Same project, count `storeFrameInCache` calls during playback | **0** |
| PC-A6 | Render a frame live, bake it, then compare against a live render at the same time | max per-channel delta ≤ 1 LSB at the video layer |
| PC-A7 | Play across the coverage boundary, log `video.paused` transitions | ≤ 1 pause→play transition, not one per frame |

PC-A3 is the one that decides whether FL-1 is fixed. It is an **exact hash**, same contract as
`EDITING_PERFORMANCE.md` §4.

## 8. Open questions

- ❌ Which scale does the user actually want to edit at? If `previewQuality` is meant to *be* the preview
  resolution, then `previewScale × DPR` (1.5) is a bug at `:1345-1348` — no GPU should be asked for 2× a
  3/4 preview on a retina display. Option A becomes free, and FL-1 disappears without a still slot.
- ❌ Is `computeCacheScale`'s `min(previewScale, 1.0)` intentional? It means a full-quality preview
  (`q = 1`) never caches above 1.0 while rendering at 2.0 — a 2× pop by construction.
- ⚠️ Does the mobile budget (192 MiB) ever actually fill, or does `CR-2`'s per-frame cap refuse everything
  first? Measure on the smallest target before tuning the budget.

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[PREVIEW_CACHE_DEFECTS]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\PREVIEW_CACHE_DEFECTS.md` |
| Status | active |

Carry forward: the flash is two render scales with no reconciliation (FL-1) and the stutter is a permanent
88 % dead band (ST-1) — fix ST-1 first, and make playback read-only against the cache before touching the
scale.
