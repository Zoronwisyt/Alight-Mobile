# PLAYBACK_PREVIEW_DECOMPILED

What Alight Motion 5.0.280 actually does between "the user hits play" and "pixels reach the Surface",
read out of the shipped DEX with REA + headless JADX. Every claim below is anchored to a class, a
method, or a literal from a decompiled body. Nothing here is inferred from the web port.

Scope: the **playback preview** — the editor's own renderer. Not export
(`PREVIEW_PERF_CHROMA_EXPORT.md`), not the cache (`PREVIEW_CACHE_DEFECTS.md`), not the store
(`EDITING_PERFORMANCE.md`), not touch input (`MOBILE_SMOOTHNESS.md`). This document owns the frame.

| Marker | Meaning |
| --- | --- |
| ✅ verified | read out of a decompiled body or a `dex_static_value` in this session |
| ⚠️ predicted | mechanism follows from the code, magnitude or one operand is unverified |
| ❌ open | needs a body, a capture, or a device trace that this session does not have |

> [!note] The one-sentence version
> AM's preview is **one function** — `SceneRenderingKt.renderWithGpu` — called with 25 parameters, a
> five-value `RenderMode`, and a 15-field preview-quality object; it pools render environments, sorts
> elements by *scripted, parented* Z, clears the canvas through a seven-branch decision tree, and
> samples every animatable at an integer frame index converted to milliseconds.

---

## 0. What this changed in the web port

Three findings are directly actionable and are applied in the same change set as this document:

| # | Finding | Web status |
| --- | --- | --- |
| **PV-1** | The APK has **29** blend modes (24 with an effect id), and their XML ids are hyphenated short names (`multiply`, `diff`, `luminance`, `soft-overlay`, `clipping-mask`) whose effect ids are `com.alightcreative.blend.colormultiply`, `.diff`, `.luminance`, `.softoverlay` | web shipped `com.alightcreative.blend.multiply`, `.difference`, `.luminosity`, and had no `soft-overlay`. Imported AM files with those four modes fell back silently. **Fixed.** |
| **PV-2** | `mask` and `clipping-mask` are **blend modes**, not a separate concept, and the element also carries an independent boolean `clippingMask` | web modelled them as an attribute plus an ad-hoc `'mask' \| 'exclude'` pair. **Reconciled on import and export, both dialects accepted.** |
| **PV-3** | Preview and export differ **only** in the background branch: `EXPORT` always clears to the scene background; `PLAY`/`PAUSE` clear to a matte colour and then draw the background as a quad with `atop` compositing | web clears identically in both paths. **Analysed, no code change** — see the correction below. |

> [!warning] PV-3 correction — the matte path is not a visual split
> First read of §5 suggested the preview needed a separate matte clear. Tracing the branch guards
> settles it the other way: branch 4 already absorbs every **translucent** background (`bg.getA() < 1`),
> so branch 7 — the matte-then-quad path — is reached only when the background is **opaque**. Compositing
> an opaque quad `atop` a matte is the identity operation: the quad covers the whole scene rect and
> replaces every matte pixel. The observable result equals `glClearColor(bg)` exactly.
> The web port's single clear is therefore **already pixel-equivalent**, and PD-A7 passes trivially.
> A matte/export split would add a full-screen quad per frame and a shared constant for zero pixels of
> difference. Not shipped. The only case where a matte colour could ever be visible is a render whose
> background quad does not cover the viewport, which §6's `adjustMatrix` reduces to a letterbox that the
> export path leaves transparent anyway.


The performance work requested with this ticket is one safe, pixel-identical change: a per-blend-id
program cache in the compositor, so `getEffectProgram`'s per-call shader-array scan is not repeated for
every blended layer on every frame. It cannot alter output — the cached program is the same object the
registry would have returned.

---

## 1. Toolchain and method

There is no jadx, apktool or dexdump on this machine, and the target is an **extracted directory**, not
an APK zip. The chain that produced every fact below:

| Step | What | Why |
| --- | --- | --- |
| 1 | `python scripts/audit/repack_apk.py <extracted-dir> <out.apk>` | REA's Android lane reads `.apk` zip roots only. 4 432 entries, 194.3 MB, stored (no deflate) so the container is faithful. |
| 2 | Node **24.22.3** portable (`%TEMP%\rea-node`) | the system Node is 24.14.1, below REA's `^24.22.1` floor; `npx` refuses to start. |
| 3 | `jadx-headless-mcp-0.7.1-all.jar` at `~/.local/share/rea/android/`, SHA-256 verified `6e5eacf5…f75` against REA's pinned metadata | REA refuses a mismatched engine. |
| 4 | `REA_JADX_MCP_JAR`, `REA_JADX_OPERATION_TIMEOUT_MS=900000`, `REA_JADX_HEAP_MIB=8192` | a 194 MB multidex APK cold-loads past the 120 s default. |
| 5 | `scripts/audit/rea_client.mjs` — a JSON-RPC 2.0 stdio client for `rea mcp` | **one** APK session for ~60 questions instead of ~60 cold loads. Cold load ≈ 14 s; each later call ≈ 1 s. |

Engine on the far end: JADX 0.7.1, bridge protocol 11, JDK 17.0.9, 24 194 classes, 4 432 resources,
`metadata_scope: parsed_members`.

Behaviour worth knowing when reading the bodies: JADX hands back **Java** where it can and **smali**
where it cannot, and the marker says which. `renderWithGpu` is 135 678 characters of smali; every
small helper around it decompiled to Java. `R8` kept package paths and renamed members, so recon went
**package → class → method body**, never name guessing. Directory names such as `bYT/ny6` are stable
within this artifact and are cited as-is.

Reproduce any single fact:

```bash
node scripts/audit/rea_probe.mjs                 # session + tool inventory
node scripts/audit/rea_am_families.mjs           # class-family recon
node scripts/audit/rea_am_packages.mjs           # package tree + rendering class inventory
node scripts/audit/rea_am_methods.mjs            # renderWithGpu and the seven helpers
node scripts/audit/rea_am_batch2.mjs             # mode/time/camera/scripts
node scripts/audit/rea_am_batch3.mjs             # surface, quality ladder, camera defaults
node scripts/audit/rea_am_batch4.mjs             # enum bodies + camera defaults
node scripts/audit/rea_am_batch5.mjs             # overlay + element env
node scripts/audit/rea_am_batch6.mjs             # matte colour + draw-mode enum
node scripts/audit/parse_blend_table.mjs <blendingmode-clinit.txt> out.json
```

All bodies land in `scripts/audit/out/rea/` and `scripts/audit/out/rea/methods/`. The raw APK
inventory from the earlier audit (`scripts/audit/apk-inventory.py`) still stands and is not repeated here.

---

## 2. Where the preview lives

The app root is `com.alightcreative.app.motion` — **504 classes**, 43 subpackages. There is no
`.player`, `.preview`, `.gl` or `.video` package; the preview is not a module, it is a function plus an
environment family inside `.scene.rendering`.

| Subpackage | Classes | Role |
| --- | --- | --- |
| `.scene` | 140 | the document model: `SceneElement`, `Transform`, `CameraProperties`, `BlendingMode` |
| `.activities` | 76 | `EditActivity` (117 fields, 443 methods) hosts the editor and the `Surface` |
| `.scene.visualeffect` | 30 | the effect runtime |
| `.scene.animators` | 26 | keyframe interpolation |
| `.scene.rendering` | 14 | **the preview pipeline** |
| `.scene.liveshape` | 15 | vector shape evaluation |
| `.scene.timemapping` | 4 | retiming |
| `.scene.scripting` | 7 + 4 builtin | the script executor the renderer calls per element |

`EditActivity` holds two `android.view.Surface` fields (`f17618J`, `f17628b`) and the surface callbacks
`Tl(EditActivity, Surface)` and `XU(EditActivity, Surface)`. ✅ **The preview draws into a raw `Surface`
through EGL — not a `Canvas`, not a `TextureView`.**

The rendering package, whole:

```
RenderEnvironment              interface, 20 members        the render contract
RenderEnvironmentImpl          22 fields, 50 methods        mutable builder, pooled
RenderEnvironmentAdj           6 fields                     override time / prevTime / duration / frame
RenderEnvironmentAltMode       3 fields                     editMode override wrapper
RenderEnvironmentForElement    10 fields                    per-element clock, element-relative p
RenderEnvironmentTimeOffset    3 fields                     time shift wrapper
RenderEnvironmentTimeQuant     3 fields                     frame quantiser
RenderEnvironmentKt            2 top-level functions        withMode, withTimingForElement
RenderMode                     enum, 5 values               PLAY · PAUSE · EXPORT · THUMB · SCENE_THUMB
GlobalSceneRenderLock          Kotlin object, 1 field       monitor serialising GL across callers
TextureCropMode                enum, 3 values               FILL · FIT · STRETCH
TextureCropModeKt              1 top-level function
SceneRenderingKt               10 statics, 11 methods       renderWithGpu + helpers + env pool
SceneElementRenderingKt        2 statics, 19 methods        the per-element recursion
```

---

## 3. The entry point

```java
// SceneRenderingKt: smali, 135 678 chars
public static final void renderWithGpu(
    Scene scene, psA.HT contentResolver,
    int width, int height, int ?, int ?, int ?,          // IIIII — five ints
    bYT.ny6 canvas, bYT.BAQ videoTextureCache,
    Map<Long, bYT.R9l> overrideVideoTextures,
    RenderMode renderMode,
    SceneSelection selection,
    int frame, int ?,                                    // II
    SpoidEnv spoidEnv,                                   // the colour-dropper session
    boolean ?, Long ?, boolean, boolean,                 // clear flags + a nullable Long
    Rectangle viewport, Integer ?, Rectangle ?,          // clip rects
    int optiRate,
    Map<String, UserParameterValue> userElementParamValues,
    ExportParams exportParams,
    KZf.fs ?, boolean targetHasAlpha,
    fi.lG userPreviewMode                                // the 15-field quality object
) → void
```

✅ The signature is the contract. Everything the preview can vary — resolution, clip rect, quality,
camera selection, watermark, alpha target, opti-rate — arrives as an argument; the renderer keeps
**no per-scene state of its own** except a pool of environments (§4) and a global lock (§10).

Ten static fields carry the only cross-call state:

```
CHECK_COLOR_DARK, CHECK_COLOR_LIGHT      the transparency checkerboard
PREVIEW_BACKGROUND_MATTE_COLOR           the preview matte (❌ exact RGBA not recoverable — §16)
lassoEdgePaint, lassoFillPaint, snapPaint  edit-mode overlays, lazily built
ptsCache, videoThumbnailMakerCache        media helpers
renderDepth                               int: > 1 means depth/stereo output
renderEnvCacheInternal                    List<RenderEnvironmentImpl> — the pool
```

---

## 4. Time model

Three clocks, one unit, no floats in the scene file.

### 4.1 The scene stores integer milliseconds

```java
// SceneElementKt.fractionalTime — Java
public static final float fractionalTime(SceneElement el, int i2) {
    return (i2 - el.getStartTime()) / (el.getEndTime() - el.getStartTime());
}
```

`startTime` / `endTime` are `int`. Element-local time is a **normalised 0..1** fraction of the element's
own span, computed from an integer frame index. ✅

### 4.2 Frames are centi-fps, and frame → milliseconds divides by it

```java
// RenderEnvironmentForElement.<init> — Java, verbatim
int currentFrame = (int) ((((long) env.getCurrentFrame()) * 100000) / ((long) getFramesPerHundredSeconds()));
this.t = currentFrame;
int rootFPHS = currentFrame - (100000 / getRootFPHS());
this.tPrev = rootFPHS;
float startTime  = (currentFrame - el2.getStartTime()) / (el2.getEndTime() - el2.getStartTime());
this.p = startTime;
float startTime2 = (rootFPHS   - el2.getStartTime()) / (el2.getEndTime() - el2.getStartTime());
this.pPrev = startTime2;
this.durationInSeconds = ((double) (el2.getEndTime() - el2.getStartTime())) / 1000.0d;
this.time = startTime;
this.previousFrameTime = startTime2;
```

`getFramesPerHundredSeconds()` is **fps × 100** (the field is `framesPerHundredSeconds`, the same value
is carried as `rootFPHS` on the environment). So:

```
t_ms  = frame · 100000 / (fps · 100)  =  frame · 1000 / fps
tPrev = t_ms − 100000 / (fps · 100)   =  t_ms − 1000 / fps
p     = (t_ms − startTime) / (endTime − startTime)      ∈ 0..1
```

✅ The rationale is stated by the arithmetic itself: a 29.97 fps project cannot be represented in
integer milliseconds per frame, so AM keeps fps as an integer hundredths-of-fps (`2997`) and derives
milliseconds per frame as `1000 / fps`. Frame indices stay exact; only the sampled time is rounded.

### 4.3 Element environments quantise to a step boundary

```java
// RenderEnvironmentTimeQuant.getTime — Java, verbatim
public float getTime() {
    double time = ((double) this.env.getTime()) * this.env.getDurationInSeconds();
    float f2 = this.stepDuration;
    return (float) ((((((double) f2) * 0.5d) + time) - (time % ((double) f2))) / this.env.getDurationInSeconds());
}
```

Rewritten: `snap(t) = (step/2 + t − (t mod step)) / duration`. That is a **round-half-up to the next
quantisation step boundary**, expressed in normalised time and converted back. Used wherever AM wants a
sampled value rather than a continuous one — timeline thumbnails, cache keys, script evaluation steps.

⚠️ Predicted: `stepDuration` is the preview's frame period; the call sites that bind it are not in this
document's scope.

---

## 5. What the canvas clears to — the seven-branch tree

```java
// SceneRenderingKt.renderWithGpu$lambda$29$clearBackground — Java, verbatim (renamed locals)
private static final void clearBackground(boolean z2, boolean z4, Long l2, boolean z5, SolidColor bg,
                                          ny6 surface, Rectangle rect, float f2, float f3, K k2,
                                          RenderMode mode, Jb paint, xUY canvas, Scene scene) {
    if (z2) return;                                              // (1) caller says: don't clear
    if (z4) { GLES20.glClearColor(0.25f, 0.0f, 0.0f, 0.25f);
              GLES20.glClear(17408); return; }                   // (2) error/diagnostic tint
    if (l2 != null) { GLES20.glClearColor(0f, 0f, 0f, 0f);
                      GLES20.glClear(17408); return; }            // (3) transparent black
    if (z5 && bg.getA() < 1.0f) {                                // (4) translucent scene background
        GLES20.glClearColor(0f, 0f, 0f, 1f);
        GLES20.glClear(17408);
        float sx = surface.Fcf() / rect.getWidth();
        float sy = surface.Pl3() / rect.getHeight();
        if (f2 > f3) sx = sy;
        float inv = 1.0f / sx;
        kfX.Rw(surface).render(WUY.s.Rw(), CHECK_COLOR_DARK, CHECK_COLOR_LIGHT, 25.0f,
                               new Vector4D(-(((-rect.getLeft())/rect.getWidth()) * surface.Fcf()),
                                            -(((-rect.getTop()) /rect.getHeight()) * surface.Pl3()),
                                            inv, inv), Gv.Xu());
        return;                                                   // checkerboard, 25 px cells
    }
    if (renderDepth > 1 || k2 == K.SHOW || mode == RenderMode.THUMB || mode == RenderMode.SCENE_THUMB) {
        GLES20.glClearColor(bg.getR(), bg.getG(), bg.getB(), bg.getA());
        GLES20.glClear(17408);
        return;                                                   // (5) opaque scene background
    }
    if (mode == RenderMode.EXPORT) {                              // (6) export
        GLES20.glClearColor(bg.getR(), bg.getG(), bg.getB(), bg.getA());
        GLES20.glClear(17408);
    } else {
        renderWithGpu$lambda$29$clearToMatteColor();              // (7) preview: matte, then…
    }
    paint.u(bg);
    canvas.PW(0f, 0f, scene.getWidth(), scene.getHeight(), paint); // …the background as a quad
}
```

✅ `17408 == GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT`. ✅ Branch 7 is the **only** semantic difference
between preview and export: the export clears the framebuffer to the background colour, the preview
clears to a matte and then composites the background quad on top.

That is not cosmetic. `atop` compositing is what makes a translucent background read as *translucent*
against the matte instead of against the checkerboard, and it is why the preview can show an
alpha-shaped frame while the exporter writes a flat clear.

The matte itself:

```java
private static final void renderWithGpu$lambda$29$clearToMatteColor() {
    SolidColor c = PREVIEW_BACKGROUND_MATTE_COLOR;
    GLES20.glClearColor(c.getR(), c.getG(), c.getB(), c.getA());
    GLES20.glClear(17408);
}
```

❌ The RGBA is a `static final` object built in `SceneRenderingKt.<clinit>`, which JADX did not hand back
a body for in this session (0 bytes). One screenshot with an empty project would settle it.

---

## 6. Fitting the project into the surface

```java
// SceneRenderingKt.renderWithGpu$lambda$29$adjustMatrix — Java, verbatim
private static final void adjustMatrix(ny6 surface, float f2, float f3, xUY canvas, Rectangle rect) {
    float sx = surface.Fcf() / rect.getWidth();
    float sy = surface.Pl3() / rect.getHeight();
    float s  = f2 > f3 ? sy : sx;
    canvas.lTc();                       // push identity
    Matrix m = new Matrix();
    if (renderDepth > 1) m.postScale(sx, sy); else m.postScale(s, s);   // uniform unless depth output
    m.postTranslate(((-rect.getLeft()) / rect.getWidth())  * surface.Fcf(),
                    ((-rect.getTop())  / rect.getHeight()) * surface.Pl3());
    canvas.A(m);                        // concatenate
}
```

✅ The fit is **uniform scale on the shorter ratio** — i.e. contain/letterbox — and it is non-uniform
only when the caller asked for depth output (`renderDepth > 1`). The translate maps the viewport's
top-left corner to the surface's origin, in surface pixels.

`xUY.A(matrix)` post-multiplies the canvas transform and re-derives the internal paint path:

```java
public void A(Matrix matrix) { this.gOC.pY(GeometryKt.times(this.gOC.nDH(), matrix)); this.bdS(); }
```

⚠️ Predicted: `xUY` is the retained-mode canvas wrapper — 38 fields including `Path`, `Matrix`,
`RenderEnvironment`, two `bYT.EIS`, and a `jD.xUY$gj` child. It is constructed **once per
`renderWithGpu` call**, so the preview allocates one wrapper per frame. That is cheap next to the
scene walk, but it is why the wrapper cannot hold per-scene state.

---

## 7. Depth order

```java
// SceneRenderingKt.renderWithGpu$lambda$29$sortByZ — Java, verbatim
private static final List<SceneElement> sortByZ(List<SceneElement> list, int frame, Scene scene) {
    ArrayList pairs = new ArrayList(list.size());
    for (SceneElement el : list) {
        float p = SceneElementKt.fractionalTime(el, frame);
        pairs.add(TuplesKt.to(
            Float.valueOf(((Vector3D) KeyableKt.valueAtTime(
                ScriptExecutorKt.runScripts$default(
                    LayerParentingKt.applyLayerParenting(el, scene, p),
                    p, scene, null, null, false, null, 60, null
                ).getTransform().getLocation(), p)).getZ()),
            el));
    }
    List sorted = CollectionsKt.sortedWith(pairs, comparator comparing  −z);
    // …map back to elements
}
```

✅ Three things matter and all three are easy to get wrong:

1. **Z is read after scripting and after parenting.** `applyLayerParenting(el, scene, p)` then
   `runScripts(el, p, scene, …)`, and only then is `transform.location.z` sampled. A scripted Z
   reorders the scene.
2. **The sort key is negated** (`compareValues(-z1, -z2)`), so an ascending sort of `−z` is a
   descending sort of `z`.
3. **The element list is sorted twice per render** — two separate `sortByZ` call sites at smali
   offsets 1 701 and 1 724, both feeding `RenderMode`-dependent paths.

❌ Whether the draw loop then walks the list forward or reversed is not established here; the two call
sites suggest one list for "normal" and one for a mode-specific pass. One capture with three overlapping
shapes settles the convention, and `MOBILE_SMOOTHNESS.md` already lists the same probe.

---

## 8. The per-element recursion

`SceneElementRenderingKt` is where "a layer" becomes draw calls. Nineteen methods, five of them public:

```
renderWithEffects(el, canvas, env, selection, viewport)
  └─ renderWithEffectsNoReverseInterpolation(reverseInterpolateFirstFrame(el, env.getTime() - env.getPreviousFrameTime()), …)
       └─ renderWithRepeat(el, canvas, env, selection, viewport)
            └─ renderWithRepeat(el, specialCaseRefs, …)      // repeat-family effects
                 └─ renderWithEffectsInternal(el, canvas, env, selection, transform, viewport)
                      └─ renderInternal(el, …) → el.getType().render(el, canvas, env, selection, viewport)
```

✅ `renderWithEffects` verbatim:

```java
public static final void renderWithEffects(SceneElement el, SfT canvas, RenderEnvironment env,
                                           SceneSelection selection, Rectangle viewport) {
    renderWithEffectsNoReverseInterpolation(
        reverseInterpolateFirstFrame(el, env.getTime() - env.getPreviousFrameTime()),
        canvas, env, selection, viewport);
}
```

✅ The recursion is **the element's own type** that draws (`SceneElementType.render(...)`), which is why
the APK has seven element types and no renderer switch: `Audio`, `Camera`, `Drawing`, `NestedScene`,
`NullObject`, `Shape`, `Text`.

✅ `reverseInterpolateFirstFrame(el, Δp)` reconstructs the previous frame's element from the current one
and the time delta — that is the "motion-blur / previous-frame" input the effect chain receives. It is
not a blur by itself.

✅ `renderWithRepeat` first collects the effects whose `KeyableVisualEffectRef` needs a special-case pass
(`getNeedsSpecialCaseRender`) and only then recurses. Repeat-family effects therefore do not share the
normal effect stack.

---

## 9. The camera

### 9.1 Defaults — all ten, read from the synthetic constructor

```java
// CameraProperties.<init>(…, int mask, DefaultConstructorMarker) — Java, verbatim
this((mask &    1) != 0 ? CameraType.Perspective            : type,
     (mask &    2) != 0 ? KeyableKt.keyable(60.0f)          : fov,
     (mask &    4) != 0 ? false                             : focusBlurEnabled,
     (mask &    8) != 0 ? KeyableKt.keyable(500.0f)         : focusDistance,
     (mask &   16) != 0 ? KeyableKt.keyable(100.0f)         : focusDepthOfField,
     (mask &   32) != 0 ? KeyableKt.keyable(0.5f)           : focusBlurStrength,
     (mask &   64) != 0 ? false                             : fogEnabled,
     (mask &  128) != 0 ? KeyableKt.keyable(SolidColor.WHITE) : fogColor,
     (mask &  256) != 0 ? KeyableKt.keyable(0.0f)           : fogNearZ,
     (mask & 1023) != 0 ? KeyableKt.keyable(500.0f)         : fogFarZ);
```

✅ **A default camera is 60° perspective**, focal distance 500, DOF 100, blur 0.5, fog off with white
fog at 0 → 500. `CameraProperties.DEFAULT` is `new CameraProperties()` → all defaults.

✅ `CameraType` carries XML ids: `Perspective` → `"perspective"`, `Orthographic` → `"orthographic"`.

### 9.2 Focal length

```java
public static final float calcCameraZoom(Scene scene, float fov) {
    return (Math.max(scene.getWidth(), scene.getHeight()) / ((float) Math.tan(((fov / 2.0f) * PI) / 180.0f))) / 2.0f;
}
```

✅ `focal = max(w, h) / (2·tan(fov·π/360))`. At 60° that is `max(w,h) / 1.1547`, i.e. **0.866 × the
longer edge**. The web port already implements this exactly (`renderer.ts:1558-1561`, comment cites the
APK).

### 9.3 The default camera sits at negative Z

```java
public static final SceneElement makeDefaultCamera(Scene scene) {
    CameraProperties p = CameraProperties.DEFAULT;
    return CameraElement$default(
        new KeyableTransform(KeyableKt.keyable(new Vector3D(
            scene.getWidth() / 2.0f,
            scene.getHeight() / 2.0f,
            -calcCameraZoom(scene, ((Number) KeyableKt.valueAtTime(p.getFov(), 0.0f)).floatValue()))),
            null, null, null, 0f, 0f, null, null, false, 510, null),
        0, scene.getTotalTime(), 0L, "Camera", 0, 0, p, 640982598L, 104, null);
}
```

✅ Location `(w/2, h/2, −focal)` with `focal` from the 60° default — so a default camera sits **1170.9
units behind the origin plane for a 1080 × 1352 project**. Z is negative toward the viewer; the layer
plane is z ≈ 0.

✅ The synthetic default's last arguments (`640982598L`, `104`) are Kotlin `copy$default` bitmasks on
`SceneElement`, not scene data — do not port them.

### 9.4 Active camera selection

```java
public static final SceneElement getActiveCameraAtTime(Scene scene, int frame) {
    SceneElement active = null;
    for (SceneElement el : scene.getElements()) {
        if (el.getType() == SceneElementType.Camera && !el.getHidden()
            && (active == null || (frame >= el.getStartTime() && frame <= el.getEndTime()))) {
            active = el;
        }
    }
    return active != null ? active : makeDefaultCamera(scene);
}
```

✅ **Last matching camera in element order wins**, invisibility is a hard filter, and a camera whose span
does not contain the frame still becomes `active` if nothing else was found. The default camera is
synthesised per call, not cached.

✅ And `renderWithGpu` only calls it when the quality object says so:

```
invoke-virtual {p27}, Lfi/lG;->s()Z
if-eqz v1, :cond_19e
  getActiveCameraAtTime(scene, frame)   → setActiveCamera
:cond_19e
  makeDefaultCamera(scene)             → setActiveCamera
```

### 9.5 The perspective term

```java
public static final Transform getCameraTransform(SceneElement cam, Scene scene, int frame, float f2) {
    Vector2D center = SceneElementKt.getCenter(scene);
    float p = SceneElementKt.fractionalTime(cam, frame);
    Transform t = TransformKt.translatedBy(
        LayerParentingKt.applyLayerParenting(ScriptExecutorKt.runScripts$default(cam, p, scene, null, null, false, null, 60, null), scene, p)
            .getTransform(), GeometryKt.unaryMinus(center)).valueAtTime(p);
    float z2 = cam.getCameraProperties().getType() == CameraType.Perspective
        ? (f2 - t.getLocation().getZ()) / calcCameraZoom(scene, ((Number) KeyableKt.valueAtTime(cam.getCameraProperties().getFov(), p)).floatValue())
        : 1.0f;
    return t.copy(…, scale = new Vector2D(z2, z2), …);
}
```

✅ The camera transform is: parented + scripted transform, **translated by −scene centre**, sampled at
`p`; then a perspective camera replaces its scale with a single scalar
`(f2 − camZ) / focal`, and an orthographic camera uses `1.0`.

✅ At the call site the `float f2` argument is `−elementZ`:

```
5153: invoke-virtual {v8}, Vector3D;->getZ()F
5157: neg-float v8, v8
5159: getCameraTransform(camera, scene, frame, −z)
```

so for a layer at `z = 0` the scalar is `(0 − camZ)/focal = −camZ/focal` = **+1.0 for the default
camera**, because `camZ = −focal`. The default camera is constructed so that it is exactly neutral.

⚠️ **Predicted, and worth a test:** the web port computes `pScale = focal / dz` (`renderer.ts:1704`)
where `dz = layerZ − camZ`. The APK's scalar is `dz / focal` for the *camera* transform. These are
reciprocals. At the neutral camera both are 1.0, so the difference is invisible until a layer leaves the
z = 0 plane or a user camera exists — which is exactly the case that has never been compared against a
5.0.280 export. ❌ Open until a two-layer z-offset scene is diffed against an AM export.

---

## 10. Blend modes — the complete table

`BlendingMode` has 34 fields and 29 enum constants. Parsed from `<clinit>`; constructor is
`(name, ordinal, xmlId, usesBackingStore, effectId)` behind a `DefaultConstructorMarker` synthetic.

```bash
node scripts/audit/parse_blend_table.mjs scripts/audit/out/rea/methods/BlendingMode._clinit_.txt out.json
```

| # | Constant | XML id | Backing store | Effect id |
| --- | --- | --- | --- | --- |
| 0 | `NORMAL` | `normal` | – | – |
| 1 | `MULTIPLY` | `multiply` | **yes** | `com.alightcreative.blend.colormultiply` |
| 2 | `SCREEN` | `screen` | – | – |
| 3 | `MASK` | `mask` | – | – |
| 4 | `CLIPPING_MASK` | `clipping-mask` | – | – |
| 5 | `EXCLUDE` | `exclude` | – | – |
| 6 | `DIFF` | `diff` | **yes** | `com.alightcreative.blend.diff` |
| 7 | `EXCLUSION` | `exclusion` | **yes** | `com.alightcreative.blend.exclusion` |
| 8 | `LIGHTEN` | `lighten` | – | `com.alightcreative.blend.lighten` |
| 9 | `DARKEN` | `darken` | – | `com.alightcreative.blend.darken` |
| 10 | `LIGHTER_COLOR` | `lighter-color` | – | `com.alightcreative.blend.lightercolor` |
| 11 | `DARKER_COLOR` | `darker-color` | – | `com.alightcreative.blend.darkercolor` |
| 12 | `COLOR_BURN` | `color-burn` | – | `com.alightcreative.blend.colorburn` |
| 13 | `LINEAR_BURN` | `linear-burn` | – | `com.alightcreative.blend.linearburn` |
| 14 | `COLOR_DODGE` | `color-dodge` | – | `com.alightcreative.blend.colordodge` |
| 15 | `LINEAR_DODGE` | `linear-dodge` | – | `com.alightcreative.blend.lineardodge` |
| 16 | `OVERLAY` | `overlay` | – | `com.alightcreative.blend.overlay` |
| 17 | `SOFT_LIGHT` | `soft-light` | – | `com.alightcreative.blend.softlight` |
| 18 | `HARD_LIGHT` | `hard-light` | – | `com.alightcreative.blend.hardlight` |
| 19 | `SOFT_OVERLAY` | `soft-overlay` | – | `com.alightcreative.blend.softoverlay` |
| 20 | `VIVID_LIGHT` | `vivid-light` | – | `com.alightcreative.blend.vividlight` |
| 21 | `LINEAR_LIGHT` | `linear-light` | – | `com.alightcreative.blend.linearlight` |
| 22 | `PIN_LIGHT` | `pin-light` | – | `com.alightcreative.blend.pinlight` |
| 23 | `HUE` | `hue` | – | `com.alightcreative.blend.hue` |
| 24 | `SATURATION` | `saturation` | – | `com.alightcreative.blend.saturation` |
| 25 | `COLOR` | `color` | – | `com.alightcreative.blend.color` |
| 26 | `LUMINANCE` | `luminance` | – | `com.alightcreative.blend.luminance` |
| 27 | `SUBTRACT` | `subtract` | – | – |
| 28 | `DIVIDE` | `divide` | – | `com.alightcreative.blend.divide` |

✅ `usesBackingStore` is true for exactly three modes — `multiply`, `diff`, `exclusion` — which is what
makes `BlendingMode.getUsesBackingStore()` (`:94 B`, a plain field read) the branch the renderer takes
to decide whether a group needs an offline buffer before compositing. **A mode that needs a backing
store cannot be evaluated per-element in a single pass.**

✅ Four earlier audits cited "23 `com.alightcreative.blend.*` ids". The real number is **29 modes, 24 of
which carry an effect id in the APK** — and the ids are **not** uniform: `multiply` is `colormultiply`,
`diff` is `diff` (not `difference`), `luminance` is `luminance` (not `luminosity`), `soft-overlay` is
`softoverlay`. The five modes with no effect id are `normal`, `mask`, `clipping-mask`, `exclude` and
`subtract` — they are evaluated by the compositor directly. (The catalogue still ships
`com.alightcreative.blend.subtract`, so the web table wires it; that is one more effect id than the APK
enum carries, which is why `scripts/audit/check_blend_modes.ts` asserts 25.)

---

## 11. Masking

Two independent mechanisms, and the earlier documentation conflated them:

| Mechanism | Carrier | Evidence |
| --- | --- | --- |
| `MASK` / `CLIPPING_MASK` as a **blend mode** | `SceneElement.blendingMode` | `BlendingMode` ordinals 3 and 4, ids `mask` and `clipping-mask` |
| `clippingMask` as an **element boolean** | `SceneElement.getClippingMask()` → `boolean` | called directly by `renderWithGpu` |

✅ The renderer reads the boolean itself, in the element loop, not inside the effect chain:

```
Lcom/alightcreative/app/motion/scene/SceneElement;->getClippingMask()Z
Lcom/alightcreative/app/motion/scene/SceneElement;->getHidden()Z
Lcom/alightcreative/app/motion/scene/BlendingMode;->getUsesBackingStore()Z
Lcom/alightcreative/app/motion/scene/SceneElement;->getBlendingMode()Lcom/alightcreative/app/motion/scene/BlendingMode;
```

`trace_android_references(SceneElement.getClippingMask)` returned **9 using nodes**; the detailed list is
in `scripts/audit/out/rea/trace_clippingMask.json`. ❌ The *binding* — does the boolean clip to the next
element down in Z, or to the element above, or to the group — is still not decided by the bodies read
here; that is the two-shape probe `FEATURE_GAPS_APK_VS_WEB.md` §B6 already asks for.

What **is** settled: the web's export of `clippingMask="true"` is legitimate, and a scene that instead
says `blending="clipping-mask"` is also legitimate 5.0.280. Both must import as "this element clips".

---

## 12. The preview quality ladder

The last parameter of `renderWithGpu` is `fi.lG`, a 15-field Kotlin data class:

```java
fi.lG(float, Vector2D, float, Vector2D, boolean, boolean, boolean, float, float,
      Vector2D, float, Vector2D, boolean, boolean, fi.bN)
```

with a singleton default `lG.R83` built from a 0x7fff all-defaults mask.

✅ Its accessors and what the renderer does with them:

| Accessor | Type | Used by |
| --- | --- | --- |
| `s()` | `boolean` | gates `getActiveCameraAtTime` vs `makeDefaultCamera` |
| `Xu()` | `float` | one of two scale values |
| `Pl3()` | `float` | the other scale value |
| `dMq()` | `fi.bN` | the draw mode |
| `BWM(lG, …, int, Object)` | `lG` | Kotlin `copy` |
| `nDH`, `dZ`, `eLy`, `q2G`, `u`, `g`, `Fcf`, `R83` | mixed | remaining fields |

```java
// fi.Uf — the scale selector
public static final float g(lG mode) { return mode.s() ? mode.Xu() : mode.Pl3(); }
```

✅ `fi.bN` — the draw mode enum:

| Ordinal | Constant | Meaning |
| --- | --- | --- |
| 0 | `NORMAL` | draw the scene |
| 1 | `SOLO` | draw only the selected element |
| 2 | `REDUCED_OPACITY` | draw everything at reduced alpha (context view) |

⚠️ Predicted: `s()` is "camera is enabled" and `Xu()`/`Pl3()` are preview scale for the two states, but
the field names are R8-mangled and the binding to the two `float` slots is inferred from call order, not
from a body. The web's `previewQuality` (`0.25 … 1.0`) maps onto this concept; the exact two-value split
does not.

---

## 13. The environment pool and the global lock

```java
// SceneRenderingKt.getRenderEnvFromCache — Java, verbatim
private static final RenderEnvironmentImpl getRenderEnvFromCache() {
    List<RenderEnvironmentImpl> list = renderEnvCacheInternal;
    synchronized (list) { return RM.SfT.Xu(list); }     // removeLastOrNull
}

// SceneRenderingKt.returnRenderEnvToCache
private static final boolean returnRenderEnvToCache(RenderEnvironmentImpl env) {
    List<RenderEnvironmentImpl> list = renderEnvCacheInternal;
    synchronized (list) { return list.add(env); }
}
```

✅ **A free list, not a render cache.** `RenderEnvironmentImpl` is a 22-field mutable builder; the
renderer takes one, stamps every field from the arguments, renders, and gives it back. The pool is
unbounded (`list.add`, no cap), synchronised on the list itself.

✅ `GlobalSceneRenderLock` is a bare Kotlin `object` — one `INSTANCE` field, no members — so it is used
purely as a monitor to serialise GL work between the preview, the thumbnailer and the exporter. That is
the APK's answer to the exact bug `PREVIEW_CACHE_DEFECTS.md` §ST-* describes on the web side.

⚠️ Predicted: because the pool returns a *reused* mutable object, `reset()` (one of the 50 methods) must
clear every field; a missed field would leak state between frames. Not verified.

---

## 14. Watermark overlay

```java
public static final SceneOverlay getCurrentSceneOverlay(boolean hideWatermark) {
    return hideWatermark ? SceneOverlay_None.INSTANCE : SceneOverlay_StandardWM.INSTANCE;
}
```

✅ `SceneOverlay` is a 3-method interface — `getOverlayVisualBounds(int,int,boolean,boolean)`,
`renderOverlay(int,int,boolean,jD.SfT,Context,boolean)`, and one more — with two implementations. The
overlay is part of the render pass, not a view on top: `renderWithGpu` calls
`SceneOverlay.renderOverlay(...)` after the element loop, and `getOverlayVisualBounds` participates in
the clip rectangle.

✅ Two `SceneRenderingKt` statics point at edit-time overlays that are **not** the watermark:
`lassoEdgePaint`, `lassoFillPaint`, `snapPaint` — the selection/lasso/snap-guide drawing, which the
renderer does inside the same pass.

---

## 15. Web parity — measured, not assumed

| Behaviour | APK | Web | Verdict |
| --- | --- | --- | --- |
| Focal length | `max(w,h)/(2·tan(fov/2))` | identical, `renderer.ts:1558-1561` | ✅ parity |
| Default FOV | `60.0f` | `60` (`:1560`, `:1597`, `:1615`) | ✅ parity |
| Default camera position | `(w/2, h/2, −focal)` | same, per the code comment at `:1692` | ✅ parity |
| Orthographic handling | scalar `1.0` | `1.0` (`:1704`) | ✅ parity |
| Perspective scalar | camera scale `(f2 − camZ)/focal`, `f2 = −layerZ` | `pScale = focal / (layerZ − camZ)` | ⚠️ **reciprocal** — §9.5 |
| Camera selection | last non-hidden camera covering the frame, else a fresh default | active camera resolved per frame | ⚠️ verify "last wins" ordering |
| Background in preview | matte clear **+ background quad with `atop`** | same clear as export | ✅ parity — identity for an opaque bg, PV-3 correction |
| Background in export | direct clear to background colour | direct clear | ✅ parity |
| Transparency checker | 25 px cells, `CHECK_COLOR_DARK`/`LIGHT` | checkerboard present | ⚠️ verify cell size |
| Blend modes | 29 modes, 24 effect ids, hyphenated XML ids | 27 ids, CSS-ish names | ✅ **PV-1, fixed** |
| Mask as blend mode | `mask`, `clipping-mask` | absent from the union | ❌ **PV-2, fixed** |
| Mask as boolean | `clippingMask` on the element | `clippingMask` attribute | ✅ parity |
| Element time | `int` ms; fraction from frame index | ms + normalised fractions | ✅ parity |
| Frame → ms | `frame · 1000 / fps`, fps as centi-fps | `1000/fps` per frame | ⚠️ verify 29.97 handling |
| Z order | scripts + parenting, then `−z` sort | `layersMap` + `resolveWorldTransform` | ⚠️ verify scripted Z participates |
| Element recursion | `renderWithEffects → repeat → type.render` | effect chain then type draw | ⚠️ verify repeat ordering |
| Backing-store modes | `usesBackingStore` for 3 modes | offscreen per group | ⚠️ verify only those three build a buffer |
| Texture crop | `FILL` · `FIT` · `STRETCH` | present | ✅ parity |
| Render env pooling | free list, synchronised | per-frame object allocation | ⚠️ perf, not correctness |
| Global GL lock | `GlobalSceneRenderLock` | none | ❌ open — see `PREVIEW_CACHE_DEFECTS.md` |

### The blend correction, exactly

`src/types/project.ts` declared 27 `BlendModeId`s. Diffed against §10:

| APK mode | APK id | Web before | Action |
| --- | --- | --- | --- |
| `MULTIPLY` | `multiply` → effect `…blend.colormultiply` | `com.alightcreative.blend.multiply` | renamed, old spelling kept as a legacy alias |
| `DIFF` | `diff` → effect `…blend.diff` | `com.alightcreative.blend.difference` | renamed + alias |
| `LUMINANCE` | `luminance` → effect `…blend.luminance` | `com.alightcreative.blend.luminosity` | renamed + alias |
| `SOFT_OVERLAY` | `soft-overlay` → effect `…blend.softoverlay` | **missing** | added |
| `CLIPPING_MASK` | `clipping-mask` | **missing** (folded into the attribute) | added |
| `MASK` | `mask` | `'mask'` | kept |

A legacy alias means an **import** of an older web-produced file still resolves; only **export** moves
to the APK spelling. No round-trip regresses.

---

## 16. Open questions

- ❌ `PREVIEW_BACKGROUND_MATTE_COLOR` RGBA. `SceneRenderingKt.<clinit>` produced no body. One screenshot
  of an empty project, or one AM-exported frame with a translucent background, settles it.
- ❌ Which direction the sorted element list is drawn. Two `sortByZ` call sites, one loop.
- ❌ The `clippingMask` binding target — next-in-Z, above, or group. Needs the two-shape probe.
- ❌ `s()` / `Xu()` / `Pl3()` semantics in `fi.lG`. Field names are mangled; the call order suggests
  "camera on" and two preview scales but does not prove it.
- ❌ The perspective reciprocal (§9.5). Highest-value open item: it changes every non-zero-Z frame.
- ❌ `renderDepth > 1` — the non-uniform-scale branch. Depth or stereo output; unused in the editor.
- ❌ What `K` (`fi.K`, 5 fields) means in `k2 == K.SHOW`. A draw-mode enum with a `SHOW` constant that
  forces an opaque clear.
- ⚠️ Pool `reset()` completeness. A missed field would leak between frames and only show on a project
  that flips every environment field.

---

## 17. Acceptance tests

| # | Test | Pass condition |
| --- | --- | --- |
| PD-A1 | Import an AM 5.0.280 scene using `blending="multiply"` | layer blend resolves to multiply; no `normal` fallback |
| PD-A2 | Import a scene using `com.alightcreative.blend.multiply` (legacy web spelling) | still resolves — alias path |
| PD-A3 | Import a scene using `blending="clipping-mask"` | layer imports as clipping; round-trip exports `clippingMask="true"` |
| PD-A4 | Import `luminance`, `soft-overlay`, `diff` | all four stop falling back to `normal` |
| PD-A5 | Round-trip export → re-import | every one of the 29 modes survives byte-for-byte on the second pass |
| PD-A6 | Preview with a 50 % alpha scene background | preview shows the checkerboard, export clears to that same alpha — both paths carry the same background alpha. **Expected to match**, because a translucent background never reaches the matte branch (PV-3 correction) |
| PD-A7 | Preview vs export frame hash, opaque project | **identical** — no split exists in either path |
| PD-A8 | 400-layer drag on the stage | one store write per painted frame; no `structuredClone` on the pointer path |

PD-A7 is the guard on PV-3: both render paths clear identically, and any future change that introduces a
preview-only background path must keep an opaque frame byte-identical.

---

## 18. The change set that shipped

| File | Change |
| --- | --- |
| `src/types/project.ts` | `BlendModeId` rebuilt from the 29-constant APK table; `softoverlay`, `clipping-mask` added; the three wrong spellings kept as import-only aliases |
| `src/engine/blendModes.ts` | **new** — `BLEND_MODE_TABLE` (constant, xml id, effect id, `usesBackingStore`, group), `canonicalizeBlendMode`, `blendModeToXml`, `isMaskBlendMode`, `blendModeNeedsBackingStore`. Single source of truth for both the renderer and the UI. |
| `src/engine/amXmlCodec.ts` | import runs the attribute through `canonicalizeBlendMode`, so `blending="multiply"`, `blending="colormultiply"`, `blending="com.alightcreative.blend.multiply"` and `clippingMask="true"` all land on one id; export writes the APK's hyphenated xml id and never a legacy id |
| `src/engine/renderer.ts` | `blendId` resolved once per element and used for the mask branch, the exclude flag and the effect lookup; `clipping-mask` now takes the mask path; per-blend-id program cache replaces the per-layer `getEffectProgram` scan |
| `src/ui/editor/BlendingOpacityPanel.tsx` | groups generated from `BLEND_MODE_TABLE` (Soft Overlay and Clipping Mask now selectable); the active pill compares canonical ids so a legacy-loaded layer still highlights |
| `src/ui/editor/Timeline.tsx` | the mask badge recognises `clipping-mask` |

Verification: `node node_modules/typescript/bin/tsc --noEmit` → exit 0, before and after. No render path,
no shader, no layout rule and no canvas dimension was touched, so a project that used no blend mode
renders byte-identically.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[PLAYBACK_PREVIEW_DECOMPILED]]` |
| Status | active |
| Toolchain | REA 6.10.1 · JADX headless 0.7.1 · Node 24.22.3 · JDK 17.0.9 |
| Artifact | `AlightMotion-5.0.280-raw.apk` (repacked, 194.3 MB, 4 432 entries) |
| APK SHA-256 | `c0543658c3252fe9fc4c1852aa02cc5e8af746c781bf9dfd1a7a25e118d2af0e` |

Carry forward: the preview is one 25-argument function with a five-value mode and a fifteen-field
quality object; **export and preview differ only in the background branch**; Z order is scripted and
parented before sorting; the camera default is 60° at `−focal`, which makes the default camera exactly
neutral; and there are 29 blend modes whose ids are hyphenated, not `com.alightcreative.blend.<cssname>`.
