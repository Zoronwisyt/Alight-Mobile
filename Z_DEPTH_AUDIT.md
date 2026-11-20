# Z-DEPTH AUDIT — making 3D Alight links a 1:1 copy of the phone

**Symptom:** links that animate Z (null rigs, dolly moves, 3D card stacks) do not look like the phone.
**Cause class:** the browser engine *has* a perspective projection, but its camera is unpinned —
unknown FOV, computed from the wrong axis, fed by a camera the importer never parses — and Z is
discarded in two places.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Reference APK | `…\Alight_Motion_5.0.280_1789568706_latestmodapks.com` |
| Test project | `Null 1` — `Ag3FCK1B…/1FAhTEheX5-c823cbc0e6fc50e8` (6.2.15 / amver 774) |
| RE tooling | [`SimoneAvogadro/android-reverse-engineering-skill`](https://github.com/SimoneAvogadro/android-reverse-engineering-skill) |
| Companions | `ENGINE_PARITY.md`, `GRAPH_EASING_AUDIT.md`, `TIMELINE_GROUPS_IMPORT.md` |
| Date | 2026-11-19 |

---

## 1. TL;DR

| # | Finding | Anchor | Confidence |
| --- | --- | --- | --- |
| **1** | `<camera>` / `<fov>` are **never parsed**. `cameraData` is read by the renderer and written by nobody, so FOV is always the hardcoded **60°** | `amXmlCodec.ts` (0 hits for `fov`), `renderer.ts:1208` | **Certain** |
| **2** | Focal length is derived from `project.height`, but the APK computes FOV **for a size** and from a **large dimension** | `renderer.ts:1212` vs APK `CameraProperties.calcCameraFovForSize` / `calcCameraLargeDimension` | **High** (symbol names) |
| **3** | The Z sign convention is asserted in a comment, not measured | `renderer.ts:1202` | **Unverified** |
| **4** | A layer whose `dz <= 10` is **dropped with `return`** — it pops out of existence instead of clipping at the near plane | `renderer.ts:1214` | **Certain** |
| **5** | Depth sort is ascending raw world Z, and **cannot cross a group boundary** — every group is flattened into its own FBO | `renderer.ts:1159–1162`, `:1282–1318` | **Certain** |
| **6** | `acLayerCenter` is 2D, so shaders that want the projected centre get a stale value | `renderer.ts:1962` | **Certain** |

One APK screenshot at `t = 0` decides 1, 2 and 3 at once — see §7. Do that before changing a line.

---

## 2. The test project — why it is a perfect Z probe

Fetched without a token (HTTP 200, **3,961,341** bytes). XML is only 7,958 bytes:

```xml
<scene title="Null 1" width="1080" height="1350"
       exportWidth="1920" exportHeight="1080" totalTime="3999" fps="60"
       amver="774" ffver="107" am="com.alightcreative.motion/6.2.15"
       precompose="dynamicResolution" retime="freeze">
```

Nine layers, and **no `<camera>` element at all** — yet the whole rig lives in Z:

| id | type | parent | transform at t = 0 |
| --- | --- | --- | --- |
| `7` | nullobj | — | `location 540, 675, 0` |
| `6` | nullobj | `7` | `0,0,0` at t=0 → `1177.8, 31, 0` at t=1 |
| `4` | nullobj | `6` | `0,0,0` at t=0 → `2018.9, 945.6, +381.2` at t=0.75, rot 0 → 79.02° |
| `5` | nullobj | `4` | `0,0,0` at t=0 → `169.1, −1673.0, +1735.0` at t=0.5, rot 0 → 57.07° |
| `3` | nullobj | `5` | `0,0,0,0` at t=0 → **`0,0,+811.8`** at t=0.25 |
| `12` | shape | `3` | `540, 675, **+197**`, scale 78.33 (starfield) |
| `1` | shape (image) | `3` | no location → `540, 675, 0`, scale 0.5 |
| `8` | shape (image) | `3` | `1057.9, 1223.5, **−1766.3**`, rot −58.17° |
| `11` | shape (image) | `3` | `2109.2, 3135.2, **−2345.8**`, rot −135° |
| `10` | shape (image) | `3` | keyed `2109.2,3135.2,−2345.8` → `2930.0,3970.1,−2277.5` |

At `t = 0` every null sits at the origin of its parent, so **world position of each card is exact and
known**: `world = (540 + local.x, 675 + local.y, local.z)`. No keyframe interpolation, no ambiguity.

That is why this project is worth more than a screenshot diff: it is a **calibration chart**.
Three cards at three known depths, one at `z = 0`, one at `z = +197`.

### The tell

Card `11` is authored at world `x = 2649` on a **1080-wide** scene. It can only be on screen if the
X coordinate is divided by depth. So perspective is mandatory — this is not a "maybe z is ignored" bug,
it is a *how much* and *which way* bug.

---

## 3. What the web does today

### 3.1 Z reaches the renderer

`resolveWorldTransform` (`renderer.ts:1022–1118`) does read and compose Z:

```ts
// parent composition, :1106-1113
const rx = x * pt.sx * c - y * pt.sy * s;
const ry = x * pt.sx * s + y * pt.sy * c;
x = pt.x + rx;
y = pt.y + ry;
z += pt.z;
```

Z-rotation does not mix z, and the parent's Z is added linearly, which is **correct** for
translation + 2D-rotation rigs like this one. Leave it.

### 3.2 A projection exists — with four loose ends

```ts
// renderer.ts:1201-1220
// Right-handed AM convention: -Z is further away (smaller), +Z is closer to viewer (larger).
if (camState || Math.abs(tf.z) > 0.01) {
  const fov  = camState?.fov || 60;
  const camZ = camState?.z ?? 0;
  const focal = (project.height * 0.5) / Math.tan((fov * Math.PI) / 360);
  const dz = focal - (tf.z - camZ);
  if (dz <= 10) return;                    // (4) hard pop
  const pScale = focal / dz;
  wx = project.width  * 0.5 + (wx - camX - project.width  * 0.5) * pScale;
  wy = project.height * 0.5 + (wy - camY - project.height * 0.5) * pScale;
  wsx *= pScale;
  wsy *= pScale;
}
```

- **(1) `fov` is always 60.** `camState` is built only when `project.cameraEnabled`
  (`renderer.ts:1131`), which `amXmlCodec.ts:746` sets to `layers.some(l => l.type === 'camera')`.
  This project has no camera layer → `camState === null` → `fov = 60`, `camZ = 0`.
- **(2) `focal` uses `project.height`.** FOV is a property of the *camera*, and the APK recomputes it
  per size (see §4). Using height on a 4:5 project is a guess that happens to be half-right.
- **(3) Sign asserted, not measured.** The comment claims `+Z` is closer. If it is backwards, every
  dolly in every link runs inverted and the depth sort is inverted with it — a very visible, very
  "doesn't look correct" failure.
- **(4) `return` on `dz <= 10`.** A layer that crosses the near plane disappears in one frame. AM
  clips geometry; it does not delete the element.

### 3.3 Depth sort

```ts
// renderer.ts:1152-1162
if (zEntries.some((e) => Math.abs(e.z) > 0.5)) {
  zEntries.sort((a, b) => (Math.abs(a.z - b.z) > 0.5 ? a.z - b.z : a.idx - b.idx));
}
```

Ascending world Z. Under the code's own convention (larger Z = closer) that paints nearer layers last,
which is right — **but it depends entirely on defect (3)**. If the convention is inverted, so is the
sort, and cards draw back-to-front. Fix the sign and this line fixes itself; do not change both blindly.

### 3.4 Groups flatten depth

`renderLayerList` renders a group's children into `grpFbo` and blits the result
(`renderer.ts:1282–1318`). Children of a group therefore **cannot interleave in depth with siblings
outside it**, and their relative Z is flattened into one image before projection. Any rig that puts
cards in different groups loses its depth ordering. This is architectural — see §6.4.

### 3.5 Camera is never imported

```
grep "fov" src/engine/amXmlCodec.ts   ->  0 hits
```

`<camera>` is only mapped as a layer type (`amXmlCodec.ts:64, 298`). The APK emits:

```xml
<camera ...><fov value="…"/></camera>
<focus-blur/><depth-of-field/><fog/><near-z/>
```

(all seen in a sibling project). None of it is read. `cameraData` exists in the type and is consumed at
`renderer.ts:1138` but is written by nothing.

---

## 4. What the APK actually does — evidence

String/descriptor scan of the 5.0.280 dex pools (same technique the RE skill formalises) turns up a real
camera model, not a constant:

| Symbol | Kind | What it implies |
| --- | --- | --- |
| `com.alightcreative.app.motion.scene.CameraProperties` | class | the camera is a **scene property**, not a layer — so a default camera exists even when no `<camera>` element is present |
| `calcCameraFov` | method | FOV is **computed**, not stored raw |
| `calcCameraFovForSize` | method | FOV is computed **per size** → `project.height` alone is wrong |
| `calcCameraDimensions` | method | camera frustum dimensions are derived |
| `calcCameraLargeDimension` | method | the reference dimension is the **larger** of width/height |
| `calcCameraZoom` | method | zoom folds into the same model |
| `cameraDistance` | field | distance is first-class; `camZ` as a position is unconfirmed |
| `camera_fov`, `camera_fog_color`, `camera_fog_far_z`, `camera_fog_near_z`, `camera_objects` | string keys | the full camera block is serialized and must be parsed |
| `CameraElementKt`, `CameraType`, `getCameraProperties()` | descriptors | camera element ↔ camera properties |

The web models none of this. `fov = 60` and `focal = height/2 / tan(fov/2)` is a **stand-in**.

---

## 5. Reverse-engineering plan (using the Android RE skill)

```bash
git clone https://github.com/SimoneAvogadro/android-reverse-engineering-skill.git
cd android-reverse-engineering-skill
S=plugins/android-reverse-engineering/skills/android-reverse-engineering/scripts

# Phase 0 — triage: framework, obfuscation, native libs
bash $S/fingerprint.sh "<APK>/Alight_Motion_5.0.280_1789568706_latestmodapks.com.apk"

# Decompile (jadx). 10 dex files; expect ~2–4 GB of sources and several minutes.
bash $S/decompile.sh "<APK>/Alight_Motion_5.0.280_1789568706_latestmodapks.com.apk"

# R8 strips symbols but not Kotlin metadata — recover the real names
bash $S/recover-kotlin-names.sh out/sources out/names
bash $S/lookup-name.sh out/names CameraProperties
```

Then read, in this order:

1. **`scene/CameraProperties.kt`** — `calcCameraFov`, `calcCameraFovForSize`,
   `calcCameraLargeDimension`, `calcCameraZoom`, `cameraDistance`. This is the whole fix. Extract:
   - default FOV in degrees (and whether it is vertical or diagonal),
   - which dimension is the reference (`max(w,h)` per the method name),
   - the near plane constant,
   - whether `cameraDistance` is a position or a distance-from-target.
2. **`scene/CameraElement` / `CameraElementKt`** — how `<camera>` and `<fov>` deserialize, and the
   default when no camera element exists.
3. The **projection matrix builder** (search `perspective`, `setPerspective`, `frustumM`). Confirm the
   handedness: whether `+Z` is toward or away from the viewer. This settles defect (3) with code
   rather than a comment.
4. `scene/Transform` / `ElementKt` — confirm whether Z is affected by any parent operation the web
   skips (skew, 3D orientation quaternions).

Record every constant in the implementation with the class + method it came from.

> The APK here is a repack, but the `com.alightcreative.app.motion.*` classes and Kotlin metadata are
> intact (that is where every quoted symbol came from), so jadx output will be readable, if partly
> obfuscated at the leaves.

---

## 6. The fix

### 6.1 Parse the camera

In `amXmlCodec.ts`, when building the project:

```ts
const camEl = scene.querySelector(':scope > camera');
const camera: CameraProps = {
  enabled: !!camEl,
  // AM stores the camera as a scene property; no element == the built-in default camera.
  fov: camEl ? parsePropElement(camEl.querySelector(':scope > fov'), parseNum, 60) : animatable(60),
  nearZ: parseFloat(scene.getAttribute('near-z') || '') || DEFAULT_NEAR,
  fogNearZ: … , fogFarZ: …, fogColor: …,
  focusBlur: …, depthOfField: …,
};
```

Drop `cameraEnabled: layers.some(l => l.type === 'camera')` (`:746`) — the default camera always exists.

### 6.2 Derive the focal length the APK's way

```ts
// Mirrors CameraProperties.calcCameraFovForSize / calcCameraLargeDimension.
// Verify the constant against the decompiled class before shipping.
const referenceDim = Math.max(project.width, project.height);
const fovRad = (fovDeg * Math.PI) / 180;
const focal = (referenceDim * 0.5) / Math.tan(fovRad * 0.5);
```

This is the change most likely to fix "Z doesn't look correct": on 1080×1350 nothing moves, but on a
**landscape 1920×1080** project the current code uses 1080 while the APK uses 1920 — a 78 % error in
the zoom response, which reads exactly like "the depth is wrong".

### 6.3 Project once, in 4×4, with a real near plane

Replace the ad-hoc scale-about-centre block with a proper transform so groups, pivots and future 3D
orientation all work:

```ts
// world = T(parent) · R(parent) · S(parent) · T(local) · R(local) · S(local)
// proj  = Perspective(fov, aspect, near, far) · LookAt(camera)
const mvp = multiply(proj, world);
const clip = transformVec4(mvp, [0, 0, 0, 1]);
if (clip.w <= nearZ) {
  // Clip, do not delete. Skip drawing this layer but keep it in the sort list
  // and keep its transform stable, so a null crossing the camera does not
  // pop its children out of existence.
  return;
}
const ndc = [clip.x / clip.w, clip.y / clip.w];
const screen = [ (ndc[0] * 0.5 + 0.5) * project.width,
                 (0.5 - ndc[1] * 0.5) * project.height ];
const pScale = focal / clip.w;
```

Even if the matrix refactor is deferred, the **minimum** change is the sign-corrected, size-corrected
scalar version plus the near-plane semantics:

```ts
const dz = focal - (tf.z - camZ);
if (dz <= nearZ) return;          // nearZ from the APK, not 10
```

### 6.4 Depth sort

```ts
// Sort by projected depth (clip.w), not raw z, so groups and cameras behave.
entries.sort((a, b) =>
  Math.abs(a.depth - b.depth) > 0.5 ? a.depth - b.depth : (a.idx - b.idx)
);
```

For cross-group ordering, add a **scene-wide 3D pass**: if any layer in the tree has `|z| > 0.5`,
flatten the affected subtree(s) into one list, sort globally, and render. Otherwise keep the current
per-group FBO optimisation. Gate it behind `has3D` so 2D projects keep their fast path.

### 6.5 Uniforms

`acLayerCenter` (`renderer.ts:1962`) must carry the **projected** centre, and add
`acLayerCenterZ` / `acCameraDist` so shaders can reason about depth. Any effect that reads
`acLayerNorm` for 3D (`flip3`, `streaks`, `tile`) needs the post-projection values, not pre.

---

## 7. Acceptance — numbers, not vibes

At `t = 0` the world positions are exact (§2). Measure the three card centres on an APK screenshot at
1080×1350 and compare:

| Layer | world (x, y, z) | web today (F = 1169) | F = 880 (75°) | F = 675 (90°) |
| --- | --- | --- | --- | --- |
| `12` starfield | 540, 675, **+197** | 540, 675 · scale 1.203 | 540, 675 · 1.289 | 540, 675 · 1.412 |
| `1` image | 540, 675, 0 | 540, 675 · scale 1.000 | same | same |
| `8` card A | 1597.9, 1898.5, **−1766.3** | **(961, 1162)** · 0.398 | (892, 1082) · 0.333 | (833, 1013) · 0.277 |
| `11` card B | 2649.2, 3810.2, **−2345.8** | (1242, 1718) · 0.333 | (1115, 1530) · 0.273 | (1011, 1376) · 0.223 |

Card A's centre moves **128 px** between the three candidate cameras — far outside measurement error.
So one screenshot pins `focal` without touching a line of code. If the APK's card A lands at
~(961, 1162), the current FOV is right and the bug is the sign or the sort. If it lands near
(833, 1013), the FOV is too narrow.

| # | Test | Pass |
| --- | --- | --- |
| Z-1 | Load `Null 1` at t=0, screenshot vs APK at 1080×1350 | card A centre within **±4 px**, scale within ±1 % |
| Z-2 | Scrub t=0 → 1.0 | the dolly reads as *approaching* on both; no frame where a card pops out |
| Z-3 | Card B exits frame at the same time | first out-of-frame frame identical ±1 |
| Z-4 | Depth order during the stack overlap | nearer card always on top, no flicker |
| Z-5 | A 1920×1080 project with the same rig | matches; proves the large-dimension focal |
| Z-6 | A project with an explicit `<camera><fov value="90"/>` | fov honoured; removing the element returns to default |
| Z-7 | `oscillate3` with `direction = 1` (writes `location.z`) | visible depth breathing, matches APK |
| Z-8 | A card pushed to `z = focal` | clipped at the near plane, not deleted |

---

## 8. Sign-off

| # | Claim | Status |
| --- | --- | --- |
| C-01 | Perspective exists in the web engine | ✅ verified (`renderer.ts:1201–1220`) |
| C-02 | Z is composed through parents correctly for 2D-rotation rigs | ✅ verified (`:1106–1113`) |
| C-03 | FOV is hardcoded 60° | ✅ verified (`:1208`, `:1131`, codec has no `fov`) |
| C-04 | `<camera>` / `<fov>` are never imported | ✅ verified (0 grep hits in codec) |
| C-05 | APK computes FOV per size from a large dimension | ⚠️ **high confidence, from symbol names** — confirm in jadx |
| C-06 | `+Z` is toward the viewer | ⚠️ unverified — comment only |
| C-07 | Near-plane drop is wrong | ✅ verified (`:1214` `return`) |
| C-08 | Depth sort cannot cross group boundaries | ✅ verified (`:1282–1318`) |
| C-09 | `Null 1` is a usable calibration chart | ✅ verified (world coords known at t=0) |

---

## 9. Open questions

1. **Default FOV in degrees, and its axis.** Vertical? Diagonal? From
   `CameraProperties.calcCameraFovForSize` in jadx.
2. **Is `cameraDistance` a position or a distance?** Decides whether `camZ` subtracts or inverts.
3. **Sign of Z.** Model-view in jadx, or the one capture in §7.
4. **Near plane constant.** Needed for Z-8; `DEFAULT_NEAR` in the doc is a placeholder on purpose.
5. **Do groups participate in a global depth sort in AM?** If yes, §6.4's scene-wide pass is required
   for correctness, not just for looks.
6. **`exportWidth`/`exportHeight` vs `width`/`height` for the camera.** This project carries
   1080×1350 canvas with a **1920×1080 export** — a mismatch that will move `focal` a lot if the APK
   feeds the camera the export size. Z-5 exists to catch exactly that.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[Z_DEPTH_AUDIT]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\Z_DEPTH_AUDIT.md` |
| Status | active |

Carry forward: Null 1 at t=0 pins focal with one screenshot; fix the Z sign before the depth sort.
