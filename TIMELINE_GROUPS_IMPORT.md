# TIMELINE · GROUPS · IMPORT — five requirements, measured

Everything in this file came from the user in one message. Each item is a numbered requirement
(`R-1` … `R-5`) with **current state (file:line)**, **target**, **implementation**, **acceptance**.

| Field | Value |
| --- | --- |
| Project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Reference APK | `…\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Reference project | `free flip` — `A7E1PHfB…/i1MwzBcB9D-…` (6.2.60 / amver 869) |
| Companions | `ENGINE_PARITY.md`, `COMPAT_EFFECTS.md`, `PRODUCT_SPEC.md`, `GRAPH_EASING_AUDIT.md` |
| Date | 2026-11-19 |

Requirement order is **not** priority order. Priority is in §6.

---

## R-1 — The timeline is too small on mobile and iPad

### Current state

```css
/* src/styles/app.css:588-590 — mobile "classic" layout */
grid-template-rows: minmax(200px, 1fr) 46px 270px;   /* stage | playbar | timeline */

/* src/styles/app.css:581-582 — "widescreen" */
grid-template-rows: minmax(220px, 1fr) 46px 250px;

/* src/styles/app.css:1896 — narrow viewport */
grid-template-rows: minmax(190px, 1fr) 46px 265px;
```

Inside the timeline: ruler row **36px** (`app.css:961`), CTS box **70px wide**
(`app.css:970`), and each track row is the APK's 28dp (`timeline_item.xml`). On a 390×844 phone
that is 270px of timeline for a stack that routinely holds 16–60 layers, and each row is finger-hostile.

### Target

| Layout | Timeline height | Track row | Ruler row | CTS |
| --- | --- | --- | --- | --- |
| Phone portrait (< 600 px wide) | **38 % of viewport height, min 320 px** | 32 px | 44 px | 84 px |
| Phone landscape | **46 % height, min 240 px** | 32 px | 44 px | 84 px |
| Tablet / iPad portrait (≥ 600 px) | **340 px** | 36 px | 48 px | 90 px |
| iPad landscape / desktop ≥ 1024 px | 300 px, resizable 180–560 | 34 px | 44 px | 84 px |

Two things must land together, or the extra height is wasted:

1. **The stage gives up the space, not the timeline.** Timeline height is a real track in the grid, so
   the stage re-fits (`PreviewCanvas` already recomputes on resize).
2. **The height is a user setting, persisted.** `am.timeline.h` in localStorage; a drag handle on the
   timeline's top edge; double-tap the handle resets to the table above.

### Implementation

```css
:root { --am-timeline-h: 270px; --am-track-row: 32px; --am-ruler-h: 44px; --am-cts-w: 84px; }
.am-editor-body.classic   { grid-template-rows: minmax(200px, 1fr) 46px var(--am-timeline-h); }
.am-editor-body.widescreen{ grid-template-rows: minmax(220px, 1fr) 46px var(--am-timeline-height, 300px); }
@media (min-width: 600px) and (max-width: 1023px) { :root { --am-timeline-h: 340px; --am-track-row: 36px; } }
@media (max-height: 500px) { :root { --am-timeline-h: max(240px, 46vh); } }
@media (max-width: 599px)  { :root { --am-timeline-h: max(320px, 38vh); } }
```

The resize handle writes `--am-timeline-h` on the editor root and persists it. Clamp to
`160px … 62vh`; below 62vh the stage is guaranteed at least 200px.

### Acceptance

- At 390×844, timeline ≥ 320 px and ≥ 8 track rows visible without scrolling.
- At 1024×768 (iPad landscape), timeline ≥ 300 px, stage ≥ 220 px.
- Dragging the handle changes timeline height and never leaves the stage under 200 px.
- Reload restores the dragged height.

---

## R-2 — On mobile, tapping a layer opens a panel that covers the timeline

### Current state — the bug is one rule

```css
/* src/styles/app.css:634-648 */
/* Mobile APK @id/elementFragmentHolder (#202332 bottom sheet over timeline) */
.am-editor-body.classic .am-inspector-dock {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: 270px;          /* <-- the timeline is also 270px */
  z-index: 35;            /* <-- and the timeline has none */
  ...
}
```

The inspector dock is `position:absolute; bottom:0` with **exactly the timeline's height**, sitting at a
higher z-index. Selecting any layer therefore paints the move/transform or effect panel over 100 % of
the timeline. Nothing is left visible — which is exactly what the user reports.

### Why it was written that way

The APK *does* show `elementFragmentHolder` as a bottom sheet over the timeline (`activity_edit.xml`),
but in AM the timeline **collapses to a single-row peek strip** and the playhead stays visible. The web
copied the sheet and forgot the collapse.

### Target — a sheet over the stage, never over the timeline

```
┌───────────────────────────────┐
│ STAGE            (shrinks)    │
│   ┌─────────────────────────┐ │
│   │ inspector SHEET (peek/  │ │   <- anchored to the bottom of the STAGE,
│   │ mid/full, drag handle)  │ │      not to the viewport
│   └─────────────────────────┘ │
├───────────────────────────────┤
│ PLAYBAR 46px                  │
├───────────────────────────────┤
│ TIMELINE  (always visible)    │
└───────────────────────────────┘
```

Rules:

- The dock is a **sheet inside the stage container**, `position:absolute; bottom:0` **relative to
  `.am-stage`**, never to `.am-editor-body`.
- Snap points: **peek 28 %**, **mid 52 %**, **full 86 %** of the stage height. Drag handle at the top,
  44 px tall, with the APK's three-dot grabber.
- The timeline is **never** covered: assert by rect, see acceptance.
- If the stage is shorter than 240 px (landscape phone), the sheet goes full-height *in the stage* and
  the timeline drops to a **96 px peek strip** (ruler + selected track row only), not to zero.
- Selecting a layer scrolls its track into view in the timeline (`scrollIntoView({block:'nearest'})`).
- The sheet closes on tap-outside (which lands on the stage) or a downward flick over the handle —
  **not** on any timeline interaction.

### Acceptance

Playwright, viewport 390×844, layer selected with the move panel open:

```ts
const tl  = await page.locator('.am-timeline-wrap').boundingBox();
const dock= await page.locator('.am-inspector-dock').boundingBox();
expect(dock.y + dock.height).toBeLessThanOrEqual(tl.y + 1);   // no vertical overlap
expect(tl.height).toBeGreaterThanOrEqual(320);
```

- Same assertion at 1024×768 and 320×568 (the small-phone floor).
- In landscape phone, timeline height ≥ 96 and the ruler is visible.
- Dragging the sheet handle never changes `currentTimeMs`.

---

## R-3 — The timeline interaction model is wrong: AM scrolls the ruler, not the playhead

### What the APK actually does (user's description, treated as the spec)

> You don't move a timeline bar. You drag the timeline left and right, and the **middle of the bar
> indicates what millisecond / second you are on.**

So in AM:

- The **playhead is a fixed vertical line at the horizontal centre** of the track area. It does not move.
- The **ruler and all tracks slide underneath it**. Dragging right moves time backwards; dragging left
  moves time forwards.
- The **timecode is read at the centre marker**, and the readout sits with the centre indicator.
- The left `timeline_cts` box (`70dp`) is a *button* (loop/controls), not the time display.

The web does the opposite:

```ts
// src/ui/editor/Timeline.tsx:80
const playheadX = (currentTimeMs / 1000) * timelinePxPerSec;   // playhead moves
// :82-95 — scrubFromClientX maps clientX + scroller.scrollLeft -> time
// :239-243 — the cap is positioned at playheadX
```

The playhead travels, the content scrolls independently, and seeking is a free-floating drag. Result:
the time under a given pixel changes when you scroll, and the "current time" indicator is somewhere
arbitrary in the strip instead of centred.

### Target — centre-fixed playhead, content offset

Single source of truth, one function:

```
timeAtCentre  = currentTimeMs
contentOffset = centreX - (currentTimeMs / 1000) * pxPerSec
```

The ruler, bookmarks, and every track bar render translated by `contentOffset` (a CSS `transform`,
not `scrollLeft`). The centre line is a 1 px element at `left: centreX`, `pointer-events:none`.

Interactions:

| Gesture | Behaviour |
| --- | --- |
| Drag anywhere on ruler or tracks (not on a layer bar edge, not on a trim handle) | pans time; `Δtime = -Δx / pxPerSec` |
| Drag a layer bar's body | moves the layer in time (unchanged, kept) |
| Drag a trim handle | trims (unchanged, kept) |
| Flick | inertia + rubber-band past 0 and past `durationMs` |
| Release near a keyframe within **6 px of centre** | snaps the keyframe under the centre line |
| Pinch (2 fingers) | zooms `pxPerSec` around centre: `pxPerSec *= k`, `currentTimeMs` unchanged |
| Wheel / `Ctrl`+wheel on desktop | same zoom; plain wheel pans time |
| Tap on the ruler | moves that point to centre (i.e. sets time to the tapped time) |
| `←` / `→` | ±1 frame, content slides, centre line stays |

Desktop gets an opt-in **free playhead** mode (`am.timeline.mode = 'centre' | 'free'`, default
`'centre'`), because dragging a bar in a 3-pane layout is a legitimate preference. Mobile has no toggle.

### Implementation notes

- Keep `timelinePxPerSec`; it is already the zoom variable.
- Replace `scrollerRef.scrollLeft` reads in `scrubFromClientX` with `-(clientX - centreX) / pxPerSec`.
- The left headers column must **not** translate horizontally; only vertically with the tracks.
- The centre line and the timecode chip are siblings of the tracks, not children.
- Loop range and bookmarks translate with the content, never with the playhead.

### Acceptance

| Test | Expect |
| --- | --- |
| `currentTimeMs = 1500`, drag ruler 100 px left, `pxPerSec = 100` | `currentTimeMs ≈ 2500` |
| Playhead element's `getBoundingClientRect().x` across a 30-step scrub | constant (±0.5 px) |
| Tap at `currentTimeMs = 0` then flick right | clamps at 0, rubber-band visible, no negative time |
| Zoom in at centre by 2× | time under the centre line unchanged to 1 ms |
| Two keyframes 8 px apart, release 5 px off | snaps to the nearer one |
| Trim/move a layer bar | layer times change, `currentTimeMs` does not |

---

## R-4 — Entering a group is hard

### Current state

`enterGroup` exists (`useEditorStore.ts:142`, impl `:593`) and the store keeps a `groupStack`
(`:72`). But there are exactly **two** entry points in the whole UI:

```tsx
// src/ui/editor/LayerQuickActions.tsx:61
onClick={() => enterGroup(single.id)}

// src/ui/editor/LayerInspector.tsx:456
<button type="button" className="am-apk-tile" onClick={() => enterGroup(layer.id)}>
```

Both are secondary buttons. There is no double-click, no long-press, no chevron on the timeline row, and
the stage never descends. Exit is a single back arrow (`EditorActionBar.tsx:130-131`) that is shared
with "close editor", so it is ambiguous. In a 16-group project like `free flip`, that is 16 manual
hunts.

### Target — four ways in, one obvious way out

| Path | Behaviour |
| --- | --- |
| **Double-tap / double-click** a group layer in the **timeline** | enters that group |
| **Double-tap / double-click on the stage** over a group's content | hit-tests top-down, enters the outermost group that contains the point |
| **Chevron `›`** on the timeline row of any group layer | enters; tap target ≥ 44 px on touch |
| **Long-press (400 ms)** on a group layer | context menu with *Enter group*, *Ungroup*, *Rename* |
| **Breadcrumb** in the action bar (`EditorActionBar.tsx:115`) | each segment is tappable and jumps to that depth |
| **`Enter`** with a group selected / **`Esc`** | enter / exit one level |
| **Back gesture (Android) / browser back** | exits one group level before closing the editor |

Rules that keep it from misfiring:

- Single tap = select. Double tap = enter. Nobody enters a group by accident, and tapping a layer in a
  dense timeline still just selects it.
- A double tap that ends with the pointer having moved > 6 px is a drag, not a tap.
- Entering a group **selects nothing** and does not change `currentTimeMs`.
- On enter, the timeline scrolls to the group's first child within 120 ms.
- Empty groups still open (showing an empty state), so the gesture is never a no-op.

### Implementation

```ts
// store
enterGroup: (groupLayerId) => { /* existing */ },
exitGroup:  (depth?: number) => { /* existing */ },
```

Add a single hit-test helper used by both stage and timeline:

```ts
function groupAtPoint(project: Project, stack: string[], x: number, y: number): string | null
```

Timeline row: render a `›` button inside `.am-track-header` when `layer.type === 'group'`, sized by
`--am-track-row`, `aria-label="Enter group"`.

### Acceptance

- From root, **two taps** reach a nested child in a 2-deep project.
- Double-click on the stage at a point inside a group enters that group; the same click on empty
  canvas selects nothing.
- Chevron exists on every group row and is ≥ 44 × 44 px on touch.
- Breadcrumb depth always equals `groupStack.length + 1`, and clicking segment *n* truncates to *n*.
- `Esc` exits one level; at root it closes the editor only after a confirm.
- Entering a group never mutates the project (hash before/after equal).

---

## R-5 — Imported links lose effects and "flip layer"

Reference: `https://alightcreative.com/am/share/u/A7E1PHfBOLbjchmAEUBK2IOSYu32/p/i1MwzBcB9D-df4e7c0a0523a237`

### What is actually in that package (measured)

Package fetched without a token (HTTP 200, **7,040,080** bytes) → `projectfiles.zip` contains
`<ID>.xml` (77,556 bytes), one MP4, one PNG, `manifest.txt`.

```xml
<scene title="free flip" width="1080" height="1350"
       exportWidth="1080" exportHeight="1350" totalTime="3199" fps="60"
       amver="869" ffver="107" am="com.alightcreative.motion/6.2.60"
       amplatform="ios" precompose="dynamicResolution" retime="freeze">
```

| Metric | Value |
| --- | --- |
| Effect instances | **129** |
| Distinct effect types | **14** |
| `wipe2` | **40** |
| `flip3` | **43** (40 on shapes, 3 on groups) |
| `satvib` / `gaussianblur` / `tile` | 7 / 7 / 6 |
| `motionblur4` | 7 |
| `dblur` / `circularripple2` / `transform` | 4 / 4 / 4 |
| `zoomblur3` / `radialwipe` | 2 / 2 |
| `chromaticzoomblur` / `simplestars2` / `streaks-zoom` | 1 each |
| Effects on `<embedScene>` (group) layers | **19** |
| Effects on `<shape>` layers | 110 |
| Groups (`embedScene` + nested `<scene>`) | **16** |
| `clippingMask="true"` layers | **6** |
| `blending="…"` layers | 8 |
| `hidden="true"` effects | **0** |
| Keyframe `t` range | **−11.450475 … 1.286125** |

All 14 effect IDs resolve in `public/am/effects.json` — `flip3`, `wipe2`, `radialwipe`,
`circularripple2`, `simplestars2`, `streaks-zoom` all present with their shaders. **The catalog is not
the problem.**

### "Flip" has no attribute — it is an effect

Verified: **0** negative scale values in this project, and no layer-level `flip` / `mirror` attribute
anywhere. AM does not serialize a flip flag; it serializes a `flip3` effect (43 instances here, angle
keyframed `-91.4° → 0°`). Therefore "flip layer is missing" means **the `flip3` effect did not render**,
not that a flag was dropped. Fix the effect, not the parser.

`flip3` is the highest-risk shader in the set: it declares `mat4 inverse(...)`, two `mat4 translate(...)`
overloads and `mat4 rotationAxisAngle(...)`. `shaderCompiler.ts:74-77` already renames `inverse` to
`ac_u_inverse`; everything else must still compile under `#version 300 es`.

### The three defects that actually drop effects

**R-5.1 — `clippingMask` is never parsed. Confirmed.**

```
grep -r "clippingMask" src/engine/  ->  0 matches
```

AM encodes a clipping mask as `clippingMask="true"` on a `<shape>` (`6` here). The web reads
`blending` (`amXmlCodec.ts:552`) but silently discards `clippingMask`, so masked reveal stacks render
without their mask — a `wipe2` inside a clipping mask simply does not look applied. That is the user's
*"they aren't getting the effects"*, in its most literal form.

Fix: parse it into `layer.clipMode = 'mask'`, and in the render path render the masked layer into an FBO
and multiply its alpha by the mask layer's alpha before compositing. Bind it to the layer **below** in AM
order (mask applies to the next sibling / the group), which must be confirmed with one APK capture.

> [!danger] CORRECTION — measured 2026-11-19, supersedes the R-5.1 premise above
> **`clippingMask` *is* parsed.** `amXmlCodec.ts:559-562` reads the attribute and resolves it to
> `blendMode: 'mask'` (or `'exclude'` when `blending="exclude"` is also present), and
> `renderer.ts:2065-2081` runs a dedicated mask shader pass for it (`maskProg`, `uBase` = scene,
> `uMask` = layer, `uExclude` flag). The `grep src/engine/ → 0 matches` proof above no longer holds;
> the claim "masked reveal stacks render without their mask" is **wrong for the current tree**.
>
> **What is actually broken is the write side.** `amXmlCodec.ts:81` emits
> `blending="${layer.blendMode}"` for any non-`normal` mode and never emits `clippingMask` at all — so
> a mask renders correctly until the project is saved as XML, at which point the matte is lost. AM
> cannot read `blending="mask"` either: `mask` is not one of its 23 `com.alightcreative.blend.*` ids.
> Both directions are wrong in the same six lines.
>
> Full analysis, the fix and the acceptance tests: [[FEATURE_GAPS_APK_VS_WEB]] §B6.

**R-5.2 — shader compile failures are silent.**

`shaderCompiler.ts:348` exposes `verifyAllEffects()`, but nothing in the import path calls it. If
`flip3`, `wipe2` or `radialwipe` fails to compile on a given GPU, the effect is skipped and the user
sees "no effect". Fix: after import, compile every referenced effect; any failure becomes an import-report
row (`Effect <id> failed to compile — GLSL log`) and a visible badge on that layer's effect chip.

**R-5.3 — `hidden="true"` → disabled is still in the tree.**

This project has **0** hidden effects so it is *not* the cause here, but the same importer serves the
`CONQ SHAKE PACK` link, where 101 of 387 instances are hidden and 79 are keyframed. See
`GRAPH_EASING_AUDIT.md` §5.1 — fix it once, both packs benefit.

### Trap — do not "fix" group size with `exportWidth`

Every nested group carries its own `<scene>`:

```xml
<scene title="" width="1082" height="1352" exportWidth="1920" exportHeight="1080" ...>
```

`width`/`height` (1082×1352) is the **group canvas**; `exportWidth`/`exportHeight` (1920×1080) is stale
inherited junk. `PRODUCT_SPEC.md` Track A tells you to prefer `exportWidth` on the **root** scene — that
rule must **not** apply to nested scenes, or every group will be re-proportioned. `amXmlCodec.ts:534`
already does the right thing (`nestedScene.width`); keep it and add the comment.

### Import report — make silent loss impossible

Ship this with R-5. When an import finishes, show a sheet:

```
free flip · 1080×1350 · 60 fps · 3.199 s
Layers 16 · Groups 16 · Effects 129 (14 types)
⚠ 6 layers use a clipping mask — not yet rendered
⚠ 43 × flip3 — shader verified on your GPU
⚠ 8 layers carry blending modes
✓ Media 2/2 resolved
```

Rules:

- Every count is **parsed vs rendered**. `129 parsed / 129 rendered` is the only passing state.
- Anything unimplemented is listed by name — never a silent skip.
- The report is reachable again from the project (not a one-shot toast).

### Acceptance

| Test | Expect |
| --- | --- |
| Import `free flip` | report says `129 / 129` effects, `16` groups, `2 / 2` media |
| Count `flip3` in the layer inspector for any flip layer | 1, enabled, angle animating `−91.4 → 0` |
| Frame 0 vs APK frame 0 | group silhouettes match; flipped cards show their back face mid-animation |
| The 6 `clippingMask` layers | a capture-diff at 3 frames; masked reveal visible, nothing outside the mask |
| `verifyAllEffects()` on the 14 IDs used here | 14 / 14 compile |
| Disable one effect in AM, export, import | exactly that one instance disabled (post R-5.3) |

---

## 6. Sequencing

| Phase | Items | Why |
| --- | --- | --- |
| 1 | **R-2**, **R-1** | Layout bugs, pure CSS + one container change. Highest daily pain, zero engine risk. R-2 must land before R-1 or the bigger timeline is still covered. |
| 2 | **R-3** | Interaction model rewrite. Needs the timeline to stop being covered (R-2) and to have room (R-1). |
| 3 | **R-4** | Group entry. Touches timeline rows — do it after R-3 stops moving rows around. |
| 4 | **R-5.1 / R-5.2** | Import correctness. Independent of the UI work; can run in parallel with 1–3 by a second agent. |
| 5 | **R-5.3** | Depends on the `hidden` diff in `GRAPH_EASING_AUDIT.md` §5.1. Do not ship blind. |

`R-5.1` and `R-5.2` are the only ones that change rendered output. Keep them in their own PR so a
visual regression has one suspect.

---

## 7. Open questions

1. **`clippingMask` target** — does the mask apply to the next sibling, the group above, or the layer
   itself? One AM capture with a mask over a known shape settles it. Do not guess.
2. **Timeline height on iPad split-screen** — 600 px wide but 320 px tall composes badly. Suggest
   `min(340px, 46vh)`; needs a call.
3. **Free-playhead mode on desktop** — default `'centre'` (matches AM) or `'free'` (matches every NLE
   the user may know)? Recommend `'centre'` with a toggle.
4. **Double-tap on stage** — enters the outermost group, or the innermost hit group? Recommend
   outermost, so the gesture is reversible one level at a time.
5. **`retime="freeze"`** — still unhandled on import (see `GRAPH_EASING_AUDIT.md` §6). Log as unknown.

---

## 8. Sign-off

| # | Claim | Status |
| --- | --- | --- |
| C-01 | Mobile inspector dock covers 100 % of the timeline | ✅ verified (`app.css:634-648` vs `:588-590`, both 270 px) |
| C-02 | Timeline is 270 / 265 / 250 px today | ✅ verified |
| C-03 | Web moves the playhead; APK moves the content | ✅ verified (`Timeline.tsx:80`, `:239`) |
| C-04 | Only 2 group-entry buttons exist in the UI | ✅ verified (`LayerQuickActions.tsx:61`, `LayerInspector.tsx:456`) |
| C-05 | `free flip` = 129 effects, 14 types, 16 groups | ✅ verified |
| C-06 | All 14 effect IDs exist in the catalog | ✅ verified |
| C-07 | No flip attribute exists; flip is `flip3` | ✅ verified (0 negative scales, 43 `flip3`) |
| C-08 | `clippingMask` is parsed nowhere | ✅ verified (0 grep hits), 6 layers affected |
| C-09 | `hidden` is the cause of this link's loss | ❌ ruled out (0 hidden here) |
| C-10 | `flip3` compiles on WebGL2 | ⚠️ unverified — needs `verifyAllEffects` run |

---

## Appendix — reproduce the import numbers

```python
import xml.etree.ElementTree as ET, collections
p = r"...\amsample2\ex\4801350B-54BD-4FF0-9371-3166CC342684.xml"
root = ET.parse(p).getroot()
print(collections.Counter(e.attrib["id"] for e in root.iter("effect")).most_common())
print("hidden:", sum(1 for e in root.iter("effect") if e.attrib.get("hidden") == "true"))
print("clip :", sum(1 for e in root.iter() if e.attrib.get("clippingMask") == "true"))
print("blend:", sum(1 for e in root.iter() if "blending" in e.attrib))
print("groups:", sum(1 for e in root.iter("embedScene")))
print("nested scenes:", len(list(root.iter("scene"))) - 1)
```

Expected: 43 `flip3`, 40 `wipe2`, 129 total · 0 hidden · 6 clip · 8 blend · 16 groups · 16 nested.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[TIMELINE_GROUPS_IMPORT]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\TIMELINE_GROUPS_IMPORT.md` |
| Status | active |

Carry forward: Flip is the flip3 effect, not a layer attribute; clippingMask binding target is still unconfirmed.
