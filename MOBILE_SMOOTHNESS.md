# MOBILE_SMOOTHNESS

Why editing on a phone feels worse than editing on a desktop, and the smallest set of changes that
fixes it.

Scope: the **editor on a touch device** — input, per-frame cost, layout, playback. Not feature parity
(`FEATURE_GAPS_APK_VS_WEB.md`), not the preview cache (`PREVIEW_CACHE_DEFECTS.md`), not the
desktop editing store (`EDITING_PERFORMANCE.md`). Those documents already own their ground; this one
owns the hand.

| Marker | Meaning |
| --- | --- |
| ✅ verified | read out of the current tree in this session |
| ⚠️ predicted | mechanism read from the code, magnitude needs a device trace |
| ❌ open | needs a measurement on hardware |

> [!note] The one-sentence version
> On a touchscreen the stage pays a **full project clone, a 24-component React commit and a full-quality
> 5.4 MP render for every single `pointermove`** — and it has none of the three fixes the inspector's
> number scrubber already has: frame coalescing, pointer capture, and cancel handling.

---

## 0. TL;DR

| # | Defect | Symptom |
| --- | --- | --- |
| **MO-1** | Stage drag is not frame-coalesced — one store write per `pointermove` (`PreviewCanvas.tsx:335`) | dragging stutters; a 120 Hz screen does 2–4 writes per frame |
| **MO-2** | Each of those writes deep-clones the whole project (`mutateProject` → `structuredClone`) | cost grows with project size, not with the layer being dragged |
| **MO-3** | The stage gesture never handles `pointercancel` and never captures the pointer (`PreviewCanvas.tsx:336-343`) | a scroll takeover mid-drag leaves listeners attached and the layer still follows the finger |
| **MO-4** | The stage declares no `touch-action`, and the pinch handler cannot `preventDefault` (React registers `touchmove` passively) | page zoom fights canvas zoom; drags get eaten by scroll |
| **MO-5** | Transform handles are **12 px**, tool buttons **34 px** | scale/rotate are effectively unhittable; mis-taps everywhere |
| **MO-6** | Interactive frames render at **still** quality — `min(q·DPR, 4096/maxDim)` = 1.5, i.e. 5.4 MP | every drag frame is a full-quality render on a phone GPU |
| **MO-7** | 29 store subscriptions, ~24 components re-render on every `set`; Timeline maps layers twice | the React commit, not the GL work, is the long task |
| **MO-8** | The inspector sheet is allowed to cover the **entire stage** on a phone | adjust a value, see nothing; close, look, reopen |
| **MO-9** | No `visualViewport` handling anywhere | on-screen keyboard shoves the layout, the canvas reallocates mid-edit |
| **MO-10** | ⚠️ Playback has no frame-budget degrade on mobile | heavy projects play at whatever rate they manage, with no quality fallback |

Six of these ten are in **one 40-line function** (`startLayerDrag`) and its store path. That is the whole
argument of this document: mobile is not slow because of the renderer, it is slow because the stage was
built mouse-first and never got the treatment the inspector already got.

---

## 1. The interaction pipeline as it exists

```
pointerdown on gizmo      PreviewCanvas.tsx:465 / :495 / :511   startLayerDrag(mode)
                          ├─ no setPointerCapture
                          └─ window.addEventListener('pointermove' | 'pointerup')      :342-343

pointermove  (n Hz)       PreviewCanvas.tsx:335   applyUpdate(ev.clientX, ev.clientY, false)
                          └─ mutateProject(proj => …, record=false)     useEditorStore.ts:650
                             ├─ cloneProj → structuredClone(project)     :204-206, :655
                             ├─ durationMs recompute over all layers     :659-660
                             ├─ scheduleSave (debounced + idle)          :661
                             └─ set({ currentProject, past, future })    :663-667
                                ├─ ~24 subscribed components re-render
                                └─ EditorScreen paused-render effect fires  EditorScreen.tsx:203-219
                                   └─ renderProject(useCache:false) at scale = min(q·DPR, 4096/maxDim)
                                      = 1.5 at q 0.75, DPR 2 → 5.4 MP for 1080×1352
```

### The cost of one pointermove, on a mid-range phone

| Step | Work | Grows with |
| --- | --- | --- |
| `structuredClone(project)` | deep copy of every layer, effect, keyframe, stroke point, media blob ref | **whole project** |
| `set(...)` | 24 component renders, `Timeline` walks every layer **twice** (`Timeline.tsx:514`, `:634`) | whole project |
| `renderProject` | one full scene pass at 1.5× | whole project + GPU fill rate |

At 60 Hz that is 60 clones + 1 440 component renders + 60 full renders per second of dragging. At
120 Hz touch sampling it is 120. On desktop this hides behind a fast `structuredClone` and an idle GPU.
On a phone it is a long task every frame, which is exactly what "stuttery" means.

**The contrast is inside the repo.** `MoveTransformPanel.tsx` — the inspector's number scrubber — already
does all three things the stage does not:

```ts
// MoveTransformPanel.tsx:79 — pointer capture
e.currentTarget.setPointerCapture(e.pointerId);

// :108-120 — I-10: coalesce pointermove to 1 store write per animation frame
let dragRaf = 0;
const onMove = (ev: PointerEvent) => {
  lastX = ev.clientX; lastY = ev.clientY;
  if (dragRaf) return;
  dragRaf = requestAnimationFrame(() => { dragRaf = 0; apply(lastX, lastY, false); });
};

// :121-133 — commit final value on release, and treat cancel as release
const onUp = (ev: PointerEvent) => {
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
  apply(ev.clientX, ev.clientY, true);
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
};
```

Scrubbing a number in the inspector is smoother than dragging the layer on the canvas. That inversion is
the whole ticket.

---

## 2. Input layer

### MO-1 — ✅ stage drag is not frame-coalesced

```ts
// PreviewCanvas.tsx:335-343
const onMove = (ev: PointerEvent) => applyUpdate(ev.clientX, ev.clientY, false);
const onUp = (ev: PointerEvent) => { … };
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
```

Every event commits. Touch sampling on a modern phone is 120–240 Hz, i.e. **2–4 commits per displayed
frame**, each one triggering the full pipeline in §1. Desktop mice report at 60–125 Hz, which is why this
never showed up in desktop testing.

**Fix.** Port the I-10 pattern verbatim: keep `lastX/lastY`, schedule one `applyUpdate` per `rAF`, cancel
the pending frame on release and commit the final position with `record = true`.

### MO-2 — ✅ every move deep-clones the whole project

```ts
// useEditorStore.ts:204-206
function cloneProj(p: Project): Project { return structuredClone(p); }

// :650-668  mutateProject — the only write path the stage uses
const next = cloneProj(s.currentProject);
fn(next);
next.modifiedTime = Date.now();
const maxEnd = next.layers.reduce((m, l) => Math.max(m, l.endTime), next.durationMs);   // :659
next.durationMs = maxEnd;
```

`record = false` skips the undo snapshot, so it is **one** clone rather than two — but it is still a deep
clone of the entire project per frame. The inspector never pays this: `updateLayer` goes through
`cowReplaceLayer` (`:259-285`), which path-copies only the group spine and the changed layer.

A 400-layer project is ~4–8 MB of JS objects. `structuredClone` on that is single-digit milliseconds on
desktop, **tens** on a phone — per frame, on the main thread.

**Fix.** Give the stage a layer-scoped write: `updateLayer`-equivalent that takes `(groupStack, layerId,
mutator)`. `mutateProject` stays for structural edits (add/delete/reorder), which are one-per-gesture
anyway. This is also the prerequisite for MO-1 being worth anything: coalescing to 60 writes/s is no help
if each write is O(project).

### MO-3 — ✅ no `pointercancel`, no pointer capture on the stage

`setPointerCapture` appears in exactly four components (`SpinnerControl.tsx:45`, `ColorPicker.tsx:69`,
`Timeline.tsx:191`, `MoveTransformPanel.tsx:79`) and **never** in `PreviewCanvas.tsx`. `pointercancel` is
handled in exactly one place (`MoveTransformPanel.tsx:129-133`) and **never** in the stage.

On touch, `pointercancel` is normal: the browser fires it the moment it decides the gesture is a scroll or
a system gesture. The stage's `onUp` only listens for `pointerup`, so after a cancel:

- `snapGuide` stays lit (`setSnapGuide({x:false,y:false})` lives only inside `onUp`),
- the `pointermove` listener stays attached to `window`,
- the next pointer movement **anywhere in the app** keeps dragging the layer.

That is the "it jumped to a random place" complaint, and it is a leak, not a rendering artefact.

**Fix.** `setPointerCapture(e.pointerId)` on the handle, `pointercancel` aliased to `onUp`, and a
`snapGuide` clear in a `finally`-style path that runs on every exit.

### MO-4 — ✅ the stage has no `touch-action`

The stylesheet contains exactly two `touch-action` declarations (`app.css:1005`, `:1837`) and neither is
on the stage, canvas or wrap. Without `touch-action: none` on the drag surface, the browser is free to
interpret a one-finger drag as a scroll once it exceeds its slop threshold — which is what fires the
`pointercancel` in MO-3.

The pinch path has the mirror problem:

```ts
// PreviewCanvas.tsx:150-171 — two-finger pinch, no preventDefault anywhere
const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => { … };
const handleTouchMove  = (e: React.TouchEvent<HTMLDivElement>) => { … };
```

React 17+ attaches `touchmove` at the root **passively**, so a `preventDefault()` inside `onTouchMove`
would be ignored even if it were written. The canvas gesture and the browser's page zoom therefore both
claim the pinch, and the page wins half the time.

**Fix.** `touch-action: none` on `.am-stage-wrap` and the gizmo; drive the pinch from `pointerdown`/
`pointermove` with two active pointers (Pointer Events give you cancel semantics for free), and drop the
`onTouch*` handlers. If a native listener is unavoidable, it must be `addEventListener('touchmove', fn,
{ passive: false })` on the element itself, never through React.

### MO-5 — ✅ touch targets are below the floor

| Element | Size | Source | Floor |
| --- | --- | --- | --- |
| Scale / rotate handles | **12 × 12 px** | `PreviewCanvas.tsx:495-520` | 44 (iOS HIG) / 48 (Material) |
| Toolbar / icon buttons | **34 × 34 px** | `app.css:164-168` | same |
| Pivot dot | 8 × 8 px | `PreviewCanvas.tsx:478-489` | decorative, fine |

The 12 px handles are drawn at `right: -6; bottom: -6`, so their hit area extends 6 px past a 110 px box
that is itself fixed-size regardless of the layer's on-screen size. On a phone, hitting scale-on-purpose
is not realistic.

**Fix.** Keep the visuals; grow the hit areas — a 44 px transparent `::before` or a padded wrapper with
`pointer-events: auto` on the wrapper and `pointer-events: none` on the visual. Same for `.am-icon-btn`
under a coarse-pointer media query:

```css
@media (pointer: coarse) {
  .am-icon-btn { width: 44px; height: 44px; }
  .am-gizmo-handle::before { content: ''; position: absolute; inset: -16px; }
}
```

`@media (pointer: coarse)` is the right gate — it targets touch without touching the desktop density that
39 keybinds depend on.

---

## 3. Render layer

### MO-6 — ✅ interactive frames render at still quality

The paused render is triggered by any `currentProject` change and always renders at the still scale:

```ts
// EditorScreen.tsx:203-219 — deps include currentProject
renderer.renderProject(store.currentProject, store.currentTimeMs, {
  previewScale: store.previewQuality,   // 0.75
  useCache: false,
});
```

```ts
// renderer.ts:1383-1388
const q = options.previewScale ?? 1;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const effectiveScale = Math.min(q * dpr, 4096 / Math.max(1, maxDim));   // 1.5 at q .75, DPR 2
```

So a drag frame costs a **1.5× render** — 5.4 MP for a 1080 × 1352 project, i.e. 2.25× the pixels of the
preview the user actually selected. On a desktop GPU that is free. On a phone it is the frame.

Note this is *not* the FL-1 resolution pop from `PREVIEW_CACHE_DEFECTS.md` — that is about play→pause.
This is about **gesture frames specifically**, and it wants the opposite default: drop resolution *while
the finger is down*, restore it when the finger lifts. After Effects calls this adaptive resolution; every
mobile NLE does it.

**Fix.** A gesture-scoped interactive tier — new API, nothing here exists yet:

```ts
// proposed — renderer.ts
setInteractiveScale(scale: number | null): void   // null restores still quality

// EditorScreen / PreviewCanvas
onPointerDown  → renderer.setInteractiveScale(Math.min(q, 0.5))  // 0.5 × DPR = 1.0 → 2.4 MP
pointerup      → setTimeout(() => renderer.setInteractiveScale(null), 120)  // settle frame
```

Rules that keep it honest:
- the tier is a **render option**, never a project or cache mutation — no frame is baked at the
  interactive scale (the bake guard already refuses when `isPlaybackActive`, extend it to
  `isInteractive`),
- the settle frame is a single full-quality render, scheduled with `setTimeout(120)`, cancelled if a new
  gesture starts,
- the tier must not change the canvas element size (`canvas.width` stays at the still size), so there is
  no layout jank — only FBO resolution, exactly like the cache blit does today.

### MO-7 — ✅ the React commit is the long task, not the GL work

29 `useEditorStore(...)` calls across `ui/`, each selecting most of the store. One `set` from a drag
re-renders every one of them, and `Timeline` walks the layer list twice per render
(`Timeline.tsx:514` tracks, `:634` the second pass).

**Fix.** This is the same finding as `EDITING_PERFORMANCE.md` §I-*, so it is deliberately **not** duplicated
here: do the store-slicing work there, once. The only mobile-specific note is ordering — MO-1 and MO-2
must land first, because they cut the *number* of commits by 2–4× and the *cost* of each, and that makes
the store-slicing benefit measurable instead of buried.

---

## 4. Layout layer

### MO-8 — ✅ the inspector sheet can cover the entire stage on a phone

The timeline-occlusion bug from `TIMELINE_GROUPS_IMPORT.md` **is fixed** — the sheet now anchors above the
playbar (`app.css:664-681`, comment `R-2`). The stage was not.

At 390 × 844 (iPhone 14 class):

| Region | Height |
| --- | --- |
| Viewport minus top bar | 788 |
| Timeline (`--am-timeline-h: max(320px, 38vh)`) | 321 |
| Playbar | 46 |
| **Stage** | **421** |
| Inspector sheet, `max-height: calc(100% - var(--am-timeline-h) - 52px)` | **415** |

415 against a 421 px stage — the sheet is allowed to consume all of it. So the phone workflow is: open a
panel, lose the picture, guess the value, close the panel, look, reopen. Every value. That is not a
rendering cost but it is absolutely part of "smoother editing".

**Fix.** Give the sheet a **peek** state instead of an all-or-nothing height:

- collapsed = one row + a drag handle (~72 px), expanded = current behaviour;
- the sheet is inside the stage's grid area, not absolutely positioned over it, so the stage shrinks;
- the stage already re-fits itself on resize via `ResizeObserver` (`PreviewCanvas.tsx:111-132`), so a
  shrinking sheet re-fits the canvas for free — no new layout code;
- remember the peek/expanded choice per tab in the store, not in component state (it is a preference).

### MO-9 — ✅ no `visualViewport` handling

Zero hits for `visualViewport` in `src/`. Consequences on iOS Safari and Android Chrome:

- the on-screen keyboard opens over the text inspector and the layout does not shift to keep the field
  visible;
- the visible height change can fire a resize into the renderer, which reallocates the drawing buffer
  mid-edit (`renderer.ts:1354-1363` refuses only while `isPlaybackActive`, not while typing);
- `100vh`-derived `--am-timeline-h` is measured against the **layout** viewport, not the visual one, so
  the timeline is partially off-screen while the keyboard is up.

**Fix.** One listener on `window.visualViewport` `resize`/`scroll` → a CSS custom property
(`--vvh`) and a `keyboardOpen` store flag; while it is true, skip renderer resize entirely and let the
canvas scale down with CSS (`transform: scale()` on the wrap, never `canvas.width`).

---

## 5. Playback

### MO-10 — ⚠️ no frame-budget degrade on mobile

The playback loop renders once per `rAF` unconditionally (`EditorScreen.tsx:307-408`) and its clock is
time-based, so it never accumulates drift — but it also never drops quality. On a phone, a project that
takes 40 ms/frame plays at 25 fps with every frame late, and the user has no lever except the quality pill.

**Predicted, not proven**: needs a device trace (`performance.now()` deltas across 300 frames) on the
test project before anyone touches this. If it is real, the fix is a 30-frame rolling average with two
thresholds (> 1.25 × frame budget for 30 frames → step the preview scale down one notch; < 0.75 × for 120
frames → step back up), and it must be **visible** — the quality pill already exists as the indicator.

---

## 6. Already correct — do not "fix" these

| Thing | Where | Why it is right |
| --- | --- | --- |
| DPR clamp to 2 | `renderer.ts:1384` | phones report 3; rendering a 3/4 preview at 3× is 12 MP and pointless |
| `playsInline` + `muted` on video elements | `renderer.ts:710-711`, `:883`, `:898` | without them iOS fullscreens video on play and the preview dies |
| `AudioContext.resume()` on the gesture | `audioEngine.ts:50-51` | iOS suspends the context until a user gesture; this is the gesture |
| `user-select: none` globally | `app.css:21` | stops the iOS selection callout eating long-press |
| `overscroll-behavior: contain` on scroll panels | `app.css:92`, `:99` | prevents rubber-band and the iOS back-swipe |
| `content-visibility` + `IntersectionObserver` fallback | `PreviewCanvas.tsx:86-108` | correct: uses the state event where supported, the observer otherwise |
| Stage re-fits on resize | `PreviewCanvas.tsx:111-132` | `ResizeObserver`, no manual dispatch — a peek sheet will reuse it |
| R-2 inspector anchoring | `app.css:664-681` | the timeline is no longer covered; do not regress this while fixing MO-8 |
| `pointercancel` in the inspector drag | `MoveTransformPanel.tsx:129-133` | the reference implementation for MO-3 |
| Idle-debounced save | `useEditorStore.ts:327-343` | drags do not hit IndexedDB |

---

## 7. Fix order

1. **MO-2** — layer-scoped write for the stage. Everything else is measured against it.
2. **MO-1** — rAF coalescing on the stage drag. Port `MoveTransformPanel.tsx:108-120` verbatim.
3. **MO-3** — pointer capture + `pointercancel` alias + guaranteed `snapGuide` clear.
4. **MO-4** — `touch-action: none` on the stage, pinch moved to Pointer Events.
5. **MO-5** — 44 px hit areas behind `@media (pointer: coarse)`.
6. **MO-6** — interactive render tier with a 120 ms settle.
7. **MO-8** — inspector peek sheet.
8. **MO-9** — `visualViewport` + `--vvh`, keyboard-aware resize refusal.
9. **MO-7** — store slicing, *in `EDITING_PERFORMANCE.md`*, not here.
10. **MO-10** — only after a device trace proves it.

Steps 1–5 are one PR and one file each. Do not ship 1 without 2: coalescing to 60 writes/s while each
write still clones the project is a third of the win for all of the risk.

---

## 8. Instrumentation and acceptance

Add to `window` before starting (one object, dev-only, same pattern as `__previewCacheStats`):

```ts
window.__mobilePerf = {
  lastGesture: { events: 0, commits: 0, frames: 0, cloneMsP50: 0, cloneMsP95: 0,
                 renderMsP50: 0, renderMsP95: 0, cancelled: 0 },
  playback: { frames: 0, avgMs: 0, overBudget: 0 },
};
```

Reference device for every number below: **390 × 844, DPR 3, 6 GB RAM class, 200-layer project,
30 s duration**. Record the same run on desktop as the control.

| # | Test | Pass condition |
| --- | --- | --- |
| MS-A1 | 60 s continuous drag of one layer, `__mobilePerf.lastGesture` | `commits ≤ frames` — never more than one commit per painted frame |
| MS-A2 | Same drag, `cloneMsP95` | **0 ms** — no `structuredClone` on the gesture path at all (MO-2 landed) |
| MS-A3 | Same drag, input-to-paint latency sampled every 10th frame | p95 ≤ 33 ms, no task > 50 ms |
| MS-A4 | Drag, then flick the page to scroll mid-drag | layer stops following the finger; `snapGuide` clears; `getEventListeners(window).pointermove` is empty |
| MS-A5 | One-finger drag near the canvas edge | the page does not scroll; the layer moves |
| MS-A6 | Two-finger pinch on the stage | canvas zoom changes; page zoom does not; `visualViewport.scale` stays 1 |
| MS-A7 | Tap each gizmo handle 20× | ≥ 18 hits; scale and rotate both reachable one-handed |
| MS-A8 | Sample the canvas while dragging vs 400 ms after release | the interactive frame is softer, the settle frame matches the still hash exactly |
| MS-A9 | Open the text inspector on a phone | field stays visible with the keyboard up; canvas buffer size unchanged |
| MS-A10 | Open any inspector panel | stage remains at least 40 % of the editor height (peek state) |
| MS-A11 | Play the 200-layer project 30 s | `playback.overBudget` reported, and if MO-10 ships, the quality pill reflects the downgrade |

MS-A8 is the one that guards the "do not change how it looks" requirement — the still frame must hash
identically before and after the interactive tier, same contract as `EDITING_PERFORMANCE.md` §4.

## 9. Open questions

- ❌ Is `structuredClone` the dominant cost on the target device, or is it the React commit? Trace before
  choosing between MO-2 and MO-7 as the first lever. (Both are worth doing; the order is the question.)
- ❌ Does iOS Safari fire `pointercancel` on a stage drag today, or only when `touch-action` is auto? MO-3
  and MO-4 may be one bug seen twice.
- ❌ How many concurrent `<video>` decoders does the target device actually give us? `renderer.ts` creates
  one per layer plus the offscreen pool (`ST-4` in `PREVIEW_CACHE_DEFECTS.md` caps nothing) — if the limit
  is low, the media path needs its own budget, not a bigger one.
- ⚠️ MO-10's magnitude is unmeasured. Do not tune playback quality on a hunch.

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[MOBILE_SMOOTHNESS]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\MOBILE_SMOOTHNESS.md` |
| Status | active |

Carry forward: the stage drag is the only hot path in the app that has none of the three things the
inspector's scrubber has — coalescing, capture, cancel — and it additionally pays a full project clone per
event and a 1.5×-DPR render per frame. Fix the write path (MO-2) and the commit rate (MO-1) together;
everything else on this list is secondary.
