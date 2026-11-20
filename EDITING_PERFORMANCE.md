# EDITING PERFORMANCE — core ideas, zero visual change

The rule for this file: **every optimisation must be provably invisible.** Identity, reuse, scheduling and
memory — never math, never order, never a pixel. §4 is the list of things that are *not* allowed to move,
and §5 is the gate that proves nothing moved.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Reference APK | `…\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Companions | `PREVIEW_PERF_CHROMA_EXPORT.md` (playback), `PREVIEW_CACHE_FONTS.md`, `ENGINE_PARITY.md` |
| Date | 2026-11-19 |

This file is about **editing** latency — dragging a slider, typing a number, moving a layer, selecting,
scrubbing. Playback and export are covered by `PREVIEW_PERF_CHROMA_EXPORT.md`.

---

## 1. TL;DR — the six things that cost you the frame

| # | Finding | Anchor | Confidence |
| --- | --- | --- | --- |
| **I-1** | Every property edit deep-clones the **entire project twice** (`structuredClone`), then rebuilds the `projects` array | `useEditorStore.ts:518-519`, `:529` | ✅ verified |
| **I-2** | History stores **full project clones**, up to 60 of them — and one is pushed **per pointer move** during a drag | `:530`, `:518`, `useSelectedLayer.ts:18-29` | ✅ verified |
| **I-3** | **26 components** subscribe to the whole store with a bare `useEditorStore()`; only **5** use a selector | grep, 26 vs 5 | ✅ verified |
| **I-4** | `Timeline` re-renders **60×/second during playback** and maps over every layer **twice**, unvirtualised and unmemoised | `Timeline.tsx:87`, `:485`, `:605` | ✅ verified |
| **I-5** | Every mutation runs an **O(n) duration scan** and replaces the `projects` array, so background screens re-render too | `:523`, `:529` | ✅ verified |
| **I-6** | Every mutation re-arms a 350 ms debounce that eventually serialises the whole project into IndexedDB | `:250-256`, `:525` | ✅ verified |

None of these touch rendering. All six are about **how many objects get copied, how many React trees get
re-mounted, and how often**.

Rough per-edit cost model for a 60-layer project (2 effects and ~30 keyframes per layer). Estimates from
structure, not a profiler run — measure with §5 before quoting them:

| Piece | Per edit |
| --- | --- |
| `structuredClone` × 2 | ~4–12 ms |
| history clone retained | ~2–6 ms + 60 × project memory |
| 26 component trees re-render | ~6–20 ms |
| `Timeline` rows (×2 passes) | ~8–25 ms at 60 layers |
| **Total** | **far past the 16.6 ms frame** |

At 60 pointer moves/second during a drag this compounds: the queue never drains, so the drag lags behind
the pointer — which is exactly what "editing feels heavy" means.

---

## 2. Principle — what "optimise without changing the looks" actually buys you

There are only four levers that cannot change an output pixel:

1. **Identity** — produce fewer new objects, so unchanged subtrees compare equal and skip work.
2. **Reuse** — keep a previous result when its inputs are equal.
3. **Scheduling** — do the same work fewer times per second, and never twice in one frame.
4. **Allocation** — retain less, so the GC stops interrupting the frame.

Everything below is one of those four. Anything that changes *which* pixels a frame contains is out of
scope, including: shader order, effect pass count, blend order, DPR, preview scale, easing evaluation,
keyframe selection, text metrics, and the resolve order of transforms.

---

## 3. Core ideas

### `I-1` — Replace `structuredClone` with copy-on-write along the path

Today:

```ts
// src/store/useEditorStore.ts:515-533
mutateProject: (fn, recordHistory = true) => {
  const s = get();
  const prev = recordHistory ? cloneProj(s.currentProject) : null;   // :518  full clone
  const next = cloneProj(s.currentProject);                          // :519  full clone
  fn(next);                                                          // mutate the copy
  next.modifiedTime = Date.now();                                    // :521
  const maxEnd = next.layers.reduce((m, l) => Math.max(m, l.endTime), next.durationMs);  // :523
  next.durationMs = maxEnd;
  scheduleSave(next);                                                // :525
  set((st) => ({
    currentProject: next,
    projects: st.projects.map((p) => (p.id === next.id ? next : p)),  // :529
    past: prev ? [...st.past.slice(-59), prev] : st.past,             // :530
    future: prev ? [] : st.future,
  }));
},
```

`fn(next)` is written by 61 call sites and always mutates **one layer** (sometimes a handful). So the two
full clones are almost entirely waste.

**Idea:** keep the same ergonomics — a mutable draft handed to the callback — but clone only the spine to
the touched layers, and share everything else by reference.

```ts
/** Copy-on-write spine: clones only the ancestors of the ids in `dirty`, shares the rest. */
function cowProject(proj: Project, dirty: Set<string>): Project {
  const walk = (layers: Layer[], insideDirty: boolean): Layer[] => {
    let changed = false;
    const out = layers.map((l) => {
      const isDirty = dirty.has(l.id);
      const childDirty = Boolean(l.groupLayers?.some((c) => subtreeHas(c, dirty)));
      if (!isDirty && !childDirty) return l;                 // shared by reference
      changed = true;
      const shadow: Layer = { ...l };
      if (isDirty) shadow.__draft = true;                    // allow in-place body edits
      if (l.groupLayers && childDirty) shadow.groupLayers = walk(l.groupLayers, true);
      return shadow;
    });
    return changed ? out : layers;
  };
  const layers = walk(proj.layers, false);
  return layers === proj.layers ? proj : { ...proj, layers };
}
```

The callback then works **in place** on the cloned layer:

```ts
mutateLayer: (layerId, fn, opts) => {
  const s = get();
  const proj = s.currentProject!;
  const next = cowProject(proj, new Set([layerId]));
  fn(findLayer(next, layerId)!);          // same signature the 61 call sites already use
  // ... history, save, set
}
```

**Cost:** O(depth × siblings) instead of O(project). A one-layer edit in a 60-layer project becomes a
shallow copy of ~60 array slots plus a handful of objects — microseconds, not milliseconds.

**Key property for the no-visual-change rule:** the resulting object graph is **value-identical**. Objects
are shared, not different. Rendering reads the same numbers.

**Compatibility note:** components that memoise on `layer` identity *gain* here — a layer that did not
change is now `===` to itself, which is what makes the Timeline memo in `I-9` possible at all.

### `I-2` — History as patches, not snapshots

```ts
past: prev ? [...st.past.slice(-59), prev] : st.past     // :530  full project clone per edit
```

60 full project clones is both a memory floor (60 × the project's object graph, which grows with keyframes)
and a GC hazard during a drag. But snapping **no** history would break undo, which is a behaviour change.

**Idea:** record an *inverse patch* per edit instead of a snapshot. Undo semantics stay 1:1 —
including per-pointer-move granularity, if you want to keep it — at a tiny fraction of the cost.

```ts
type Patch = { layerId: string; path: (string | number)[]; before: unknown; after: unknown }[];
```

- Capture `before` by reading the touched path **before** the callback runs (the draft already tells you
  which layer; a `Proxy`-based recorder or an explicit `updatePath(...)` helper gives the path).
- Cheap middle ground if a Proxy feels heavy: snapshot **only the touched layer** (`structuredClone(layer)`)
  before mutation, not the project. For a 60-layer project that is 1/60th of the current cost, and it is a
  true inverse for that layer.
- Store `past: { layerId, before: Layer }[]` with the same 60-entry cap; 60 layers of history then costs
  the same as 1 project clone today.
- Keep a byte budget (`≤ 64 MB`) in addition to the count cap, evicting oldest first — mirrors what the
  preview cache already does (`renderer.ts:1087-1101`).

**Do not** switch to coalesced (one-entry-per-gesture) history as the default. It is a genuine
behaviour change — one undo would revert an entire drag. Ship it as `I-3`, opt-in, and let the user pick.

### `I-3` — Gesture transactions (opt-in, and the only semantic change on this list)

A drag emits `recordHistory: true` on every pointer move (`useSelectedLayer.ts:18-29`; `recordHistory`
defaults to `true`). That means a 2-second drag pushes ~120 entries and discards 60 of them.

```ts
beginGesture: (label: string) => void;   // snapshot once
endGesture:   () => void;                // push one history entry for the whole gesture
```

- Between `beginGesture` and `endGesture`, `mutateProject` is called with `recordHistory: false`.
- Panels call `beginGesture` on `pointerdown` and `endGesture` on `pointerup` / `pointercancel`.
- If the gesture ends where it started (no net change), push nothing.

**Flagged:** this changes undo granularity from per-pixel to per-drag. It is *better*, and it is the only
item in this file that a user could notice. Gate it behind a setting, default on, and document it. If the
answer is "keep 1:1", use `I-2` alone — that still removes most of the cost.

### `I-4` — Stop subscribing to the whole store

```
$ grep -c "useEditorStore()" src/ui/**/*.tsx    →   26 components
$ grep -c "useEditorStore((s|st)"              →    5 components
```

A bare `useEditorStore()` subscribes to **every** field. Any `set({ audioLevel })`, any
`set({ currentTimeMs })` during playback, any mutation, re-renders all 26 trees.

```ts
// before — every field, every change
const { currentProject, selectedLayerIds, mutateProject } = useEditorStore();

// after — three fields, shallow-compared
import { useShallow } from 'zustand/react/shallow';
const { currentProject, selectedLayerIds, mutateProject } = useEditorStore(
  useShallow((s) => ({
    currentProject: s.currentProject,
    selectedLayerIds: s.selectedLayerIds,
    mutateProject: s.mutateProject,
  }))
);
```

Rules that keep it honest:

- **Never** build a new object in a selector without `useShallow`.
- Actions are stable references in this store (they are defined once in the `create` call) — selecting them
  costs nothing.
- Panels that only need **one layer** should not select `currentProject` at all; select the layer:
  `useEditorStore((s) => findLayer(s.currentProject, id))` with a shallow comparator.
- `useSelectedLayer` (`useSelectedLayer.ts:6-13`) is the worst offender because **10 panels** share it — fix it
  once and 10 trees stop re-rendering. It must return a **stable identity** for `layer` when the layer did
  not change, which `I-1` guarantees.

### `I-5` — Split transient state out of the project store

`currentTimeMs` changes 60×/s and `audioLevel` up to 60×/s. Both live in the same object as
`currentProject`, so every tick invalidates every subscriber.

**Idea:** two stores.

- `useEditorStore` — project, selection, tools, panels. Changes on user intent.
- `usePlayheadStore` — `currentTimeMs`, `audioLevel`, `isPlaying`, `previewZoom`. Changes on a clock.

Then only the playbar, the timeline's playhead line, and the clock readout subscribe to the playhead store,
and they update at 60 Hz in isolation. Everything else is untouched during playback.

This is the single largest structural win for "editing while the preview runs", because it decouples the
two clocks that currently share one notifier.

### `I-6` — Coalesce render requests to one per frame

The render is currently driven by an effect whose dependency is `currentProject` (`EditorScreen.tsx`,
paused-frame render). Because `I-1`'s replacement still produces a new project object per mutation, three
mutations in one frame produce three renders.

```ts
// a single pending-render slot
let pending = 0;
const requestRender = () => {
  if (pending) return;
  pending = requestAnimationFrame(() => { pending = 0; renderNow(); });
};
```

Also skip the render when nothing visual changed:

- `modifiedTime` is bumped on every mutation (`:521`) and is not read by the renderer. If the **only**
  difference between the previous and next project is `modifiedTime`, do not re-render.
- Same for `durationMs` (I-7) when it did not actually change.

**Not allowed:** skipping the render when a *visual* field changed, however imperceptible. If in doubt,
render.

### `I-7` — Keep derived state incrementally

```ts
const maxEnd = next.layers.reduce((m, l) => Math.max(m, l.endTime), next.durationMs);   // :523
next.durationMs = maxEnd;
```

O(n) on every edit, and it only needs recomputing when a layer's `startTime`/`endTime` changes (trim,
move-in-time, delete, add). Two options:

- Recompute only when the mutation was time-affecting (the patch from `I-2` already tells you which paths
  were touched — check for `startTime`/`endTime`).
- Or maintain `durationMs` as a memo on `(layers)` that returns the previous value when the array is
  `===` (which `I-1` makes common).

**Invariant to preserve:** `durationMs` must end up **exactly** the same value for the same project state.
It feeds the renderer's time mapping; a stale value is a visual bug.

### `I-8` — Keep persistence off the editing path

```ts
// :250-256
if (saveDebounce) window.clearTimeout(saveDebounce);
saveDebounce = window.setTimeout(() => saveProjectToDb(proj), 350);
```

Every mutation re-arms this. During a continuous drag it never fires (good), then it fires once on release
and serialises the entire project into IndexedDB — a multi-millisecond main-thread stall at exactly the
moment the user expects the UI to settle.

**Idea:**

- Debounce keyed by project id, and only reset the timer when the *content* hash changed.
- Fire on `requestIdleCallback` with a 2 s deadline, not `setTimeout`, so it cannot land mid-gesture.
- Save on gesture end (`I-3`) and on `visibilitychange → hidden` explicitly, so nothing is lost if the tab
  dies.
- Do **not** put the project object into the store's `projects` array on every mutation (`:529`). Replace it
  once when persistence commits, or keep `projects` as ids and read the live project from
  `currentProject` — today every mutation re-renders anything listing projects.

### `I-9` — Timeline: virtualise and memoise

```tsx
// src/ui/editor/Timeline.tsx
} = useEditorStore();                                   // :87   whole store
const displayIndices = layers.map((_, idx) => idx).reverse();   // :300
{displayIndices.map((idx) => { ... })}                  // :485  full row render
{displayIndices.map((idx, visualPos) => { ... })}       // :605  second full pass
```

Three separate problems:

1. **Whole-store subscription** → fix with `I-4`.
2. **Two unvirtualised passes over every layer** → combine into one pass, or virtualise. With rows at
   28–36 px and 60 layers, only ~12 rows are ever visible; rendering 60 × 2 is pure waste.
3. **No row memoisation** → extract `<TimelineRow layer={layer} .../>` wrapped in `React.memo` with a
   comparator on `(layer === prev.layer, isSelected, pxPerSec, scroll)`. With `I-1`, an unedited layer is
   reference-identical, so 59 of 60 rows skip entirely.

Keep the visual result identical: same order, same row height, same offsets, same keyframe markers. A
virtualiser changes *when* a row exists in the DOM, never what it looks like — assert with a screenshot at
a fixed scroll offset and layer count (§5, V-3).

### `I-10` — Pointer drags: write to a ref, commit on release

Panels call `updateLayer(...)` inside `pointermove` (`MoveTransformPanel.tsx:77`, `:195`, `:256` and 11
more). Each call is a store write, a React commit, and a render.

Minimum viable change, no new architecture:

- Accumulate the delta in a `useRef` during the move.
- Throttle the store write to `requestAnimationFrame` (one write per frame, not one per event).
- Commit the final value on `pointerup`.
- Use `pointerdown`/`pointerup` with `setPointerCapture` so a fast drag off the element does not strand
  the gesture.

If the layer's visual position must track the cursor in real time, the render still happens once per frame
— that is the floor, and it is fine. What disappears is the 3–8 events per frame all doing full clones.

`event.getCoalescedEvents()` should **not** be used to increase write frequency; it is useful for reading
a high-resolution path (freehand), not for property edits.

---

## 4. Not allowed to change

This is the guard rail for anyone implementing the above.

| Area | Rule |
| --- | --- |
| Shader math, pass order, blend order, premultiplication | untouched |
| `evalAnimatable`, `evalEasing`, keyframe selection, `remappedNormT` | untouched |
| DPR / `previewScale` / render target size | untouched (a lower preview scale is a *look* change) |
| Text layout, `measureText`, font resolution | untouched |
| Z projection, camera FOV, depth sort | untouched |
| Effect order within a layer, `shaderGroups` selection | untouched |
| Layer order, group flattening, clipping/matte behaviour | untouched |
| The **value** of `durationMs` for a given project state | identical |
| Undo/redo **result** for a given sequence (unless `I-3` is enabled) | identical |

If an optimisation requires changing any row above, it belongs in a different document and needs its own
before/after capture.

---

## 5. Measurement — prove it, then prove nothing moved

### 5.1 The visual equivalence gate (must run before merge)

```ts
// pseudo — a Playwright/Vitest harness
const TIMES = [0, 500, 1000, 1500, 2000, 2500];
for (const t of TIMES) {
  await setPlayhead(t);
  const before = hashCanvas();          // sha-256 of canvas.toDataURL() at fixed previewScale
  // ... run the same interaction sequence on both builds
  const after = hashCanvas();
  expect(after).toBe(before);           // exact match, not perceptual
}
```

- Fixed `previewScale`, fixed device pixel ratio, fixed fonts loaded, `await document.fonts.ready`.
- Run on **two** projects: a 2D shape/text project and a 3D video project (so Z and video paths are
  covered).
- Run the sequence twice: idle renders, and renders during a drag (write to a ref → commit → render).
- Exact hash equality is achievable here because nothing in scope changes pixels. If a hash differs, the
  optimisation changed a look — reject the change, not the gate.

### 5.2 The performance numbers

| Metric | How | Target |
| --- | --- | --- |
| Pointer-move → paint latency | `performance.measure` around the handler + `requestAnimationFrame` timestamp | **≤ 16.6 ms p95** |
| Store write cost | `performance.now()` around `mutateProject` | **≤ 0.5 ms** (was 4–12 ms) |
| React commits per drag second | React DevTools Profiler, count commits | **≤ 60** (one per frame), not 200+ |
| Components re-rendered per mutation | Profiler, "highlight updates" | **≤ 4** |
| Timeline rows mounted | DOM query on `.am-track-row` | **≤ visible rows + 2** |
| History memory after 60 edits | `performance.memory.usedJSHeapSize` delta | **≤ 64 MB** |
| Playback tick while editing | re-renders of a non-subscribed panel | **0** |

Instrument the two hot paths so CI can read them:

```ts
// dev only
window.__perf = { mutateMs: [], commitMs: [], renders: 0 };
```

### 5.3 A/B protocol

1. Record the baseline on the current build (same project, same machine, same browser, cold + warm).
2. Apply exactly one idea per commit.
3. Re-run §5.1 (must be byte-identical) and §5.2 (must improve or stay flat).
4. Anything that regresses a metric gets reverted — including a change that "should" help.

---

## 6. Order of execution

| Phase | Items | Why this order |
| --- | --- | --- |
| 1 | `I-4` + `I-5` | Pure subscription surgery, no new data structures. Stops 60 Hz playback from re-rendering 26 trees, which contaminates every other measurement. |
| 2 | `I-1` | The structural core. Everything downstream (`I-2`, `I-6`, `I-7`, `I-9`) depends on unchanged layers keeping their identity. |
| 3 | `I-2` + `I-6` | History cost and render coalescing on top of the new identity model. |
| 4 | `I-9` + `I-10` | Timeline memo and drag throttling — visible latency wins, and safe once `I-1` lands. |
| 5 | `I-7` + `I-8` | Derived state and persistence; smallest gain, lowest risk, do last. |
| 6 | `I-3` (opt-in) | Only after everything else, because it is the one item that changes behaviour. |

---

## 7. Open questions

1. **Is per-pixel undo actually wanted?** If nobody has ever undone a drag one pixel at a time, `I-3`
   should be the default and `I-2` can be simplified. Ask before building the patch format.
2. **Does anything subscribe to `projects` besides the home screen?** `:529` rebuilds that array on every
   mutation; if the home screen is mounted underneath the editor, this alone is a hidden cost.
3. **Where does the main-thread stall on save actually land?** Confirm `I-8` against a real 40 MB project
   before investing — if IndexedDB write is already off-thread enough, drop the item.
4. **Is `Timeline` doing per-row work that survives memoisation?** Waveform arrays (`Timeline.tsx:683`) and
   keyframe lists are computed inline; they need `useMemo` keyed on the layer revision, or a memoised row
   buys nothing.
5. **Should `currentTimeMs` live outside React entirely?** The playback loop already writes it through the
   store 60×/s. A plain mutable playhead + a subscription for the two components that display it would be
   strictly cheaper than any selector — decide with `I-5` measured first.

---

## 8. Sign-off

| # | Claim | Status |
| --- | --- | --- |
| C-01 | Every mutation deep-clones the project twice | ✅ verified (`:518-519`) |
| C-02 | History pushes a full project clone per edit, 60 deep | ✅ verified (`:530`, `:518`) |
| C-03 | Drags push one history entry per pointer move | ✅ verified (`useSelectedLayer.ts:18-29`, `updateLayer` default `true`) |
| C-04 | 26 components use a bare store subscription, 5 use selectors | ✅ verified (grep) |
| C-05 | `Timeline` maps over all layers twice with no memo or virtualisation | ✅ verified (`:485`, `:605`) |
| C-06 | `useSelectedLayer` is shared by 10 panels and re-renders all of them | ✅ verified (10 importing files) |
| C-07 | Every mutation runs an O(n) duration scan and rebuilds `projects` | ✅ verified (`:523`, `:529`) |
| C-08 | Persistence is a re-armed 350 ms debounce that fires once per gesture | ✅ verified (`:250-256`) |
| C-09 | Per-edit timings quoted in §1 | ⚠️ **estimated from structure** — replace with §5.2 numbers |
| C-10 | Nothing in §3 changes a pixel | ⚠️ must be proven by the §5.1 gate, per change |

---

## 9. Appendix — the shape of the fix, in one place

```ts
// store: the whole idea, condensed
mutateLayer(layerId, fn, { history = true } = {}) {
  const s = get();
  const prev = s.currentProject!;

  // 1. copy only the spine, share everything else  (I-1)
  const next = cowProject(prev, new Set([layerId]));

  // 2. capture the inverse for ONE layer, not the project  (I-2)
  const before = history ? structuredClone(findLayer(prev, layerId)) : null;

  // 3. mutate in place — same ergonomics the 61 call sites already use
  fn(findLayer(next, layerId)!);

  // 4. recompute duration only if a time field was touched  (I-7)
  if (touchedTime) next.durationMs = maxLayerEnd(next.layers);

  // 5. push a small history entry  (I-2)
  if (history) s.past.push({ layerId, before });

  // 6. one render per frame, not per mutation  (I-6)
  set({ currentProject: next });
  requestRender();
}
```

Every number that reaches the renderer is the same number it saw before. That is the whole discipline.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[EDITING_PERFORMANCE]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\EDITING_PERFORMANCE.md` |
| Status | active |

Carry forward: Exact-hash canvas equivalence gate before any merge; no optimisation may change a pixel.
