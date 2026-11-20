# Building Alight Motion effects

Everything in this document was read out of the Alight Motion **5.0.280** APK and its shipped effect
corpus — not from a forum, not from the web port. Where a fact comes from a decompiled body it names the
class and the method; where it comes from the corpus it names the count across the **315 effect
definitions** in `assets/effects/`.

| Marker | Meaning |
| --- | --- |
| ✅ verified | read out of a decompiled body, or counted across the shipped corpus |
| ⚠️ predicted | follows from the code, but one operand is unverified |
| ❌ open | needs a device test or a capture this document does not have |

Reproduce any number here:

```bash
node scripts/audit/inventory_effects2.mjs <apk>/assets/effects scripts/audit/out/effect_inventory2.json
node scripts/audit/census_param_attrs.mjs <apk>/assets/effects
node scripts/audit/census_shader_ids.mjs  <apk>/assets/effects
node scripts/audit/rea_am_batch8.mjs      # parser + loader bodies
node scripts/audit/rea_am_batch12.mjs     # every param reader
node scripts/audit/rea_am_batch18.mjs     # the JS surface
```

---

## 1. What an effect is

An effect is **one XML file**. No manifest, no zip, no binary blob. Alight Motion scans
`assets/effects/` at startup, parses every `.xml` whose root is `<effect>`, and builds the effect picker
from the result.

```
assets/effects/                 315 <effect> definitions, 1.41 MB total
assets/effects/presets/         13 <scene> files that bundle presets for several effects
assets/effects/resource/        textures an effect can reference with src="resource/…"
assets/effects/textures/        noise/grunge tiles
assets/effects/thumb/           <slug>.webp — the picker thumbnail
```

✅ Corpus: 328 XML files total — **315 `<effect>` + 13 `<scene>`**. The 13 scene files are preset packs,
not effects; their nested `<effect … locallyApplied="false">` elements are *instances* of effects, and
counting them is the fastest way to misreport this corpus.

A minimal, valid effect is six lines:

```xml
<?xml version='1.0' encoding='UTF-8' ?>
<effect id="custom.hello" name="Hello" desc="Does nothing visible.">
    <params>
        <texture id="inputImg" srcType="content" />
    </params>
    <shader type="fragment"><![CDATA[
        void main() { gl_FragColor = texture2DCv(inputImg.texture, acScreenNorm); }
    ]]></shader>
</effect>
```

---

## 2. Who reads it

`com.alightcreative.app.motion.scene.visualeffect.VisualEffectParserKt.readEffect` — 28 497 B of
decompiled body, one function, a `switch` on the child tag name. It is the whole schema. Reading it is
what makes everything below a fact instead of a guess.

What it does, in order:

1. `require(2, ns, "effect")` — the root tag must be `effect`.
2. Reads `id`. **A missing `id` throws** `"<effect> element missing 'id' attribute"`.
3. Reads `name` (falls back to `id`), `desc` (falls back to `""`), `tags`, `affinity`, `category`, `thumb`.
4. Reads the booleans `deprecated`, `auto-transform`, `experimental`, `internal`, `overdraw`.
5. Reads `max-overdraw`, then falls back to `maxOverdraw` — both spellings work, `max-overdraw` wins.
6. Reads `type` and upper-cases it into `EffectType` (`SHADER`, `DRAWING`, `TEXT`); anything unknown
   becomes `SHADER`.
7. Walks the children. Exactly these tags are recognised — everything else is **skipped silently**
   (`pN.Xu`, a skip-subtree helper):
   `strings`, `iterations`, `params`, `passes`, `script`, `shader`, `presets`.
   `strings`, `params`, `passes` and `presets` may each appear **at most once**; a second throws.
8. Derives a slug from the *localised* name and looks for a thumbnail (see §3).
9. Infers the internal effect family, then constructs `VisualEffect`.

Then two smaller parsers do the leaves:

- `com.alightcreative.app.motion.scene.userparam.UserParamParserKt.readUserParams` — `<params>`, 5 699 B,
  a `switch` on the param tag, delegating to 13 `read*Param` functions.
- `com.alightcreative.app.motion.scene.scripting.ACScriptParserKt.readACScript` — `<script>`, 1 650 B.

---

## 3. Root `<effect>` attributes

Counted across the 315 definitions:

| Attribute | Used by | Meaning |
| --- | --- | --- |
| `id` | **315** | required. The stable identity used by scenes, presets and `pass.effect` |
| `name` | 315 | display name. `@string/name` and `@am:string/…` references are resolved |
| `desc` | 291 | one-line description under the name |
| `category` | 271 | picker section. Observed: `distort` (46), `color` (44), `procedural` (39), `blur` (30), `3d` (26), `transform` (25), `drawing` (18), `matte` (16), `opacity` (11), `repeat` (7), `text` (6), `other` (3) |
| `thumb` | 271 | path relative to the effect file, e.g. `thumb/boxblur.webp` |
| `tags` | 238 | comma-separated keywords used by search |
| `deprecated` | 120 | hidden behind the "show deprecated" toggle |
| `experimental` | 70 | hidden behind the "show experimental" toggle |
| `overdraw` | 49 | the effect samples outside `[0,1]`; the engine pads the target |
| `max-overdraw` | 37 (+8 as `maxOverdraw`) | how far outside, in UV units. Observed: `0.1` (17), `0.2` (18), `0.5`, `0.001` |
| `internal` | 33 | not shown in the picker; applied by the engine itself |
| `affinity` | 18 | which element types it can attach to (§12) |
| `auto-transform` | 17 | engine supplies a transform to a script-only effect |
| `type` | 7 | `text` (6) or `drawing` (1); omit for a shader effect |
| `compat` | 4 | one known value: `acScreenNorm-y` (see §11) |
| `afxver` | 3 | effect-format version, all `2` |

### Thumbnail resolution ✅

`readEffect` builds the slug from the **localised name**, then checks the filesystem:

```
slug = name → non-alphanumerics to '-', collapse '--', trim '-', lowercase, '-' to '_'
candidate 1: thumb/<slug>.webp        (wins if the file exists)
candidate 2: thumb/<slug>_bg.webp     (background tile for the picker card)
fallback   : the thumb="…" attribute, relative to the effect file
```

So `name="Box Blur"` resolves `thumb/box_blur.webp` — which is why the shipped file is named
`thumb/boxblur.webp` *and* carries an explicit `thumb="thumb/boxblur.webp"`.

### Localisation ✅

```xml
<strings>
    <locale lang="en">
        <string name="name">Box Blur</string>
        <string name="desc">Blur the layer by averaging the colors of nearby pixels.</string>
        <string name="strength">Strength</string>
        <string name="iterations">Iterations</string>
    </locale>
</strings>
```

Any attribute in the file may then say `label="@string/strength"` or `name="@am:string/effect_blink_name"`
(app resources for the built-ins). The lookup is `B8K.Hfr(value, context)` on an English context.
One `<strings>` element, several `<locale>` children.

---

## 4. `<params>` — the parameter block

Tag set, straight out of `readUserParams` ✅:

```
spinner  slider  float  color  point  xyz  orient  hue-disc  hue-ring
selector  switch  texture  section  tip
```

**An unrecognised tag is skipped, not fatal.** `readUserParams`' `default:` branch calls the skip helper
and moves on, so an AM effect and a typo in the same file still loads.

Usage across the corpus:

| Tag | Count | What it is |
| --- | --- | --- |
| `spinner` | 1 208 | numeric field with an inline drag control |
| `texture` | 384 | an image input (layer content, backdrop, buffer, file, user pick) |
| `slider` | 236 | numeric slider |
| `switch` | 220 | boolean |
| `color` | 213 | ARGB colour |
| `selector` | 182 | enum / radio / dropdown |
| `point` | 180 | 2D point |
| `section` | 148 | visual divider with a heading |
| `xyz` | 40 | 3D vector |
| `tip` | 29 | static hint text |
| `orient` | 24 | quaternion |
| `hue-disc` | 13 | hue wheel |
| `float` | 3 | invisible constant |
| `hue-ring` | 0 | hue ring (legal, unused by the shipped set) |

Common attributes on every param: `id` (**required**, throws if missing), `label`, `enabled` (default
`true`; `enabled="false"` hides the control but keeps the value live).

### 4.1 `spinner` ✅

| Attribute | Default | Notes |
| --- | --- | --- |
| `id` | required | uniform name |
| `label` | — | `@string/…` allowed |
| `default` | — | initial value. Always supplied in the corpus (1 208/1 208) |
| `min` / `max` | — | the corpus supplies both on every spinner |
| `step` | — | supplied on 1 102 of 1 208 |
| `ticks` | — | comma list of labelled stops: `ticks="0,45,90,135,180"` (62 uses) or a plain number `ticks="1"` |
| `type` | `float` | see below |
| `snap` | — | comma list or scalar the drag snaps to |
| `multiplier` | — | display multiplier, `100` for percentages |
| `logscale` | — | base for a logarithmic drag (e.g. `2.351`) |
| `originValue` / `valueOrigin` | — | the "reset to" value |

`type` values observed in the corpus: `percent` (231), `angle` (144), `hz` (8), `relative-percent` (8),
`seconds` (2), `kelvin`, `angle-range`, `rpm`. The parser also knows `float`, `integer`, `frames`,
`relative-float`.

`type` is not cosmetic. `hz` and `rpm` are **integrated**, not sampled — a spin speed of 2 rpm produces a
cumulative rotation, not a constant 2. That is why `el.transform.angle += p.rpm` works in `spin.xml`.

### 4.2 `slider` ✅

Same attributes as `spinner` minus `multiplier`; adds `logscale` in practice (`2.5`, `3.0`). Corpus
`type` values: `integer` (64), `percent` (36). A slider with `type="integer"` hides the decimals in the
readout; the value is still a float in the shader.

### 4.3 `float` ✅

```xml
<float id="seed" value="1337" />
```

Three uses in the corpus. No UI, no drag, just a constant bound as a uniform — the way to bake a number
that a preset may still override.

### 4.4 `color` ✅

| Attribute | Default | Notes |
| --- | --- | --- |
| `default` | `#FF000000` | **AARRGGBB**, eight hex digits. 41 distinct values in the corpus, all 8-digit |
| `alpha` | `false` | `true` shows an alpha slider in the picker |
| `enabled` | `true` | |

`#FFFF0000` is opaque red; `#80FFFFFF` is 50 % white. The four legacy files that use `value=` instead of
`default=` still parse.

### 4.5 `point` ✅

| Attribute | Default | Notes |
| --- | --- | --- |
| `default` | `0,0` | `"x,y"` |
| `min` / `max` | `-9999,-9999` / `9999,9999` | vec2 |
| `step` | `1` | scalar |
| `type` | `layer` | `layer`, `screen`, `offset`, `size` — anything else **throws** |

`type` decides the space the point lives in. `layer` is element-local pixels, `screen` is project pixels,
`offset` is a delta, `size` scales with the element. This matters: the same `500,500` means different
places in each mode.

### 4.6 `xyz` ✅

`default/min/max` are `"x,y,z"`. `type` is `translate` (default), `rotate` or `scale`; anything else
throws. The corpus also passes `step`, `ticks` and `applyto="orient"` — the last two are read by the UI
layer, not by `readXYZParam`.

### 4.7 `orient` ✅

```xml
<orient id="rotation" label="Rotation" invert="true" default="0.4871745,0,0,-0.8733046" />
```

`default` is a **quaternion `x,y,z,w`** parsed by `QuaternionKt.toQuaternionOrNull`, falling back to
identity. `invert="true"` (22 of 24 uses) flips the sense of the control, which is what you want when the
shader multiplies by the inverse.

### 4.8 `hue-disc` and `hue-ring` ✅

`hue-disc`: `default` is a `vec3` (corpus: `0,1,0`), `bias="true"` on 11 of 13.
`hue-ring`: `default` is a single float, parsed with `toFloatOrNull`, default `0`. Legal, unused by the
shipped corpus.

### 4.9 `selector` ✅

```xml
<selector id="mode" label="Mode" default="1" style="radio">
    <choice value="0" label="Normal" />
    <choice value="1" label="Add" enableTargets="strength,angle" />
</selector>
```

- `default` is an **int**; omitted, it is the first choice's value.
- `style` is `dropdown` or `radio`; anything else throws `"expected 'dropdown' or 'radio'"`. Omit it and
  the engine picks: **≤ 3 choices → radio, more → dropdown**.
- Every `<choice>` needs a **valid integer** `value`, else `"Missing or invalid choice value"`.
- Duplicate values throw `"Duplicate choice value 'N'"`.
- Zero choices throw `"<selector> must have at least one <choice> element"`.
- `enableTargets` is a comma list of param ids this choice switches on — the same mechanism as on
  `<switch>`.

### 4.10 `switch` ✅

```xml
<switch id="invert" label="Invert" default="false" enableTargets="lightIntensity,lightColor" />
```

`default` must literally be `"true"` or `"false"` — the parser rejects anything else with
`"expected 'true' or 'false'"`. `enableTargets` is a comma list, trimmed, empties dropped.

### 4.11 `texture` ✅

| Attribute | Default | Notes |
| --- | --- | --- |
| `id` | required | shaders see `id.texture` and `id.size` |
| `srcType` | `user` when no `src`, else `image` | see below |
| `src` | — | path relative to the effect file, e.g. `resource/grunge_a.webp` |
| `downsample` | `1` | integer divisor for a buffer's resolution |
| `enabled` | `true` | |

`srcType` values — and this is where the web port and the APK disagreed:

| Value | Count | Meaning |
| --- | --- | --- |
| `content` | 269 | the element's own rendered pixels |
| `buffer` | 64 | an offscreen buffer, filled by a `<pass target="…">` |
| `comp` | 43 | everything drawn beneath the element |
| `image` | 6 | a file referenced by `src` |
| `user` | 0 in the corpus, **the parser default** | a user-chosen image |

An invalid `srcType` throws `"expected 'composition', 'content', 'image', or 'user'"` — note the message
lists `composition`, while the accepted literal is `comp`.

Texture params are the only ones whose uniform is a struct: the engine declares
`struct AC_ImageInfo { sampler2D texture; vec2 size; }`, so `inputImg.texture` and `inputImg.size` both
work in GLSL.

### 4.12 `section` and `tip` ✅

```xml
<section text="Colour" />
<tip text="Pick a colour to tint the layer." />
<section text="Advanced" hintType="editFirst" />
```

`text` is the body. `label` is accepted and unused for these two. `id` may be omitted — the parser
synthesises `__staticText<lineNumber>`. `hintType="editFirst"` marks a section that should be opened for
first-time users.

---

## 5. `<iterations>` ✅

```xml
<iterations param="iter" />
<iterations count="3" param="strength" />
```

- `count` is an integer, default **1**.
- `param` names a numeric param whose value overrides `count` at render time.

The effect runs its whole `<passes>` block `iterations` times, and `acIter` is the current index. This is
the cheap way to make "quality" a user-facing knob without duplicating passes.

---

## 6. `<passes>` and the buffer pipeline ✅

Read by `VisualEffectParserKt.readPasses` (2 961 B). Each `<pass>` is one full-screen draw:

| Attribute | Default | Meaning |
| --- | --- | --- |
| `target` | `-` | which texture this pass writes. `-` means the effect's output; any other value must be a **valid GLSL identifier** and must match a `srcType="buffer"` texture id, else `"Illegal target name"` |
| `effect` | `none` | delegate this pass to another effect id |
| `src` | `-` | which buffer to read instead of the element |
| `blend` | `normal` | blend function for this pass |

Rules the parser enforces:

- `<passes>` may appear **at most once**.
- If it is present it must contain **at least one `<pass>`** —
  `"If <passes> is present, at least one <pass> must be specified."`
- Absent entirely, the effect gets one implicit pass: `target "-"`, `blend "normal"`, `effect "none"`,
  `src "-"`.

The canonical two-pass blur, verbatim from `assets/effects/boxblur.xml`:

```xml
<params>
    <texture id="inputImg" srcType="content" />
    <texture id="hblur"    srcType="buffer" />
    <slider id="strength" default="1.0" min="0.0" max="100.0" type="integer" step="1" />
    <slider id="iter"     default="1"   min="1"   max="9"     type="integer" step="1" />
</params>

<iterations param="iter" />

<passes>
    <pass target="hblur" />   <!-- pass 0: horizontal, into the buffer -->
    <pass />                  <!-- pass 1: vertical, to the output -->
</passes>

<shader type="fragment"><![CDATA[
    void main() {
        int from = -max(1,int(strength));
        int to   =  max(1,int(strength));
        vec4 outColor = vec4(0.0);
        if( acPass==0 ) {
            for(int i=from; i<to; i++)
                outColor += texture2DCv(inputImg.texture, vec2(acScreenNorm.s + float(i)*(1.0/1280.0), acScreenNorm.t));
        } else {
            for(int i=from; i<to; i++)
                outColor += texture2DCv(hblur.texture, vec2(acScreenNorm.s, acScreenNorm.t + float(i)*(1.0/720.0)));
        }
        gl_FragColor = outColor/(float(to)*2.0);
    }
]]></shader>
```

Note `acPass` — the shader is compiled **once** and branches per pass. That is the reason `passes` is one
shader with a branch rather than N shaders.

✅ 49 of the 315 shipped effects use `<passes>`; 29 ship more than one `<shader>` (shader groups, §8).

---

## 7. `<script>` ✅

`ACScriptParserKt.readACScript` (1 650 B) is the whole contract:

```java
String external = getAttributeValue(ns, "external");
if (!isBlank(external)) { skip(); return new ACScript(external, ACScriptType.External); }
String lang = getAttributeValue(ns, "lang");
if (lang == null) throw new MalformedXMLException("<script> element missing 'lang' attribute");
if (!lang.equals("js")) throw new MalformedXMLException("Unrecognized <script> language, '" + lang + "'");
return new ACScript(textOfTheElement(), ACScriptType.JS);
```

- `lang="js"` is required unless `external="…"` is set.
- `external` points at a script file instead of inline text.
- Several `<script>` elements are allowed (the parser accumulates a list); the **first** one decides the
  effect's family.

### 7.1 The function

```js
function animate(env, el, p) { /* … */ return el; }
```

✅ `runScriptsInternal` puts exactly these names on the interpreter scope: `animate`, `AM`, `v8`, plus the
three arguments.

### 7.2 `env` — the clock

| Property | Type | Meaning |
| --- | --- | --- |
| `time` | 0..1 | normalised position in the element |
| `duration` | seconds | element duration |
| `startTime`, `endTime`, `inTime` | ms | element span |
| `frame`, `fps` | int | current frame and project fps |
| `absTime` | seconds | absolute project time |
| `prevFrameTime` | 0..1 | normalised previous frame time |
| `velocity`, `angularVelocity`, `scaleVelocity` | vec2 / float / float | element motion this frame |
| `editMode` | string | editor state |
| `selected` | bool | is the element selected |
| `renderMode` | string | `play`, `pause`, `export`, `thumb`, `sceneThumb` |

Seconds are `time * duration`. That is the idiom every shipped script uses — `blink.xml`:

```js
if( (env.time * env.duration * p.freq) % 1.0 > 0.5 ) el.alpha = 0.0
```

### 7.3 `el` — the element

| Property | Shape |
| --- | --- |
| `el.alpha` | float 0..1 |
| `el.text` | string (text layers) |
| `el.fillColor` | colour |
| `el.shaderGroups` | shader-group state |
| `el.transform.location` | `{x, y, z}` |
| `el.transform.scale` | `{x, y}` |
| `el.transform.angle` | number ⚠️ unit unverified — `spin.xml` does `angle += p.rpm` and expects rotation, so it is not degrees-per-frame at 1 rpm; treat as engine-native |

`jitter.xml`, in full — the best short example of the API:

```js
function animate(env,el,p) {
    let globalTime = env.duration * env.time;
    let t = globalTime - (globalTime % (1.0/p.freq));
    let a = p.angle * (Math.PI / 180);
    let m = AM.simplexNoise(t*637.729, 0, p.seed*394.417);
    el.transform.location.x += Math.sin(a) * p.mag * m;
    el.transform.location.y += Math.cos(a) * p.mag * m;
    if( p.slack > 0 ) {
        a += Math.PI/2;
        let m2 = AM.simplexNoise(t*951.217+149.231, 0, p.seed*894.417+2773.908);
        el.transform.location.x += Math.sin(a) * p.mag * m2 * p.slack;
        el.transform.location.y += Math.cos(a) * p.mag * m2 * p.slack;
    }
    if( p.zjitter > 0 ) {
        let zm = AM.simplexNoise(t*637.729+241.386, 0, p.seed*394.417+1729.361);
        el.transform.location.z += zm * p.zjitter;
    }
    return el;
}
```

Two things to copy from it: quantise time before sampling noise (`t - t % period`) or the result shimmers;
and offset every noise channel (`+149.231`, `+2773.908`) or the axes correlate.

### 7.4 `p` — your params

`p.<paramId>` for every param declared in `<params>`, **except** `<texture>`, which is not exposed to
scripts. Values are the live animated ones at the current frame.

### 7.5 `AM.*` ✅ — registered by `ScriptExecutorKt.registerAlightMotionScriptMethods`

| Function | Signature | Notes |
| --- | --- | --- |
| `AM.log(v)` | any | goes to logcat under the effect's tag |
| `AM.simplexNoise(x[,y[,z[,w]]])` | 1–4 numbers → double | 0 args or >4 return `0` |
| `AM.triangle(x)` | number → double | `abs(((x + 0.75) % 1) - 0.5) * 4 - 1` |
| `AM.hsvToRgb({h,s,v})` | → `{r,g,b}` | |
| `AM.rgbToHsv({r,g,b})` | → `{h,s,v}` | |

There is no DOM, no `fetch`, no timers. The interpreter is Javet (V8) and only these five functions are
bound.

---

## 8. `<shader>` ✅

`VisualEffectParserKt.readShader` (2 577 B):

| Attribute | Required | Values | Default |
| --- | --- | --- | --- |
| `type` | **yes** | `fragment`, `vertex` | throws if absent |
| `precision` | no | `high`, `medium`, `low` | `high` |
| `group` | no | integer | `0` |

- The body is the element's text, normally inside `<![CDATA[ … ]]>`.
- Shaders are stored in **groups**: `Map<groupId, Map<type, ShaderInfo>>`. Two shaders of the same type in
  the same group throw `"More than one <fragment> shader in group 1"`.
- A group is a complete program: one `vertex` (optional) + one `fragment`.
- `fastMath` is **not** an AM attribute. The web port accepts it; the APK ignores it.
- No `#version`, no `precision` statement, no `#extension` go in the file — the engine prepends its own
  prelude.

Because groups are a map, an effect can ship several complete programs and a script chooses between them
through `el.shaderGroups`. 29 of 315 do.

### 8.1 The prelude — what is already declared

The engine generates the prologue; the effect body is appended to it. The identifiers that shipped effects
actually reference, counted across 315 definitions:

| Identifier | Uses | Files | Meaning |
| --- | --- | --- | --- |
| `acScreenNorm` | 707 | 233 | `vec2`, 0..1 screen UV — the default sampling coordinate |
| `acLayerSize` | 366 | 111 | `vec2`, element size in pixels |
| `acScreenSize` | 286 | 100 | `vec2`, render target size |
| `acLayerNorm` | 162 | 111 | `vec2`, 0..1 within the element |
| `acLayerToScreen` | 117 | 91 | `mat4` |
| `acPass` | 62 | 36 | `int`, current pass index |
| `acLayerCenterNorm` | 52 | 22 | `vec2` |
| `acLayerCenter` | 41 | 29 | `vec2` |
| `acLayerPivot` | 16 | 4 | `vec2` |
| `acScreenToLayer` | 15 | 2 | `mat4` |
| `acPreviewSize` | 14 | 10 | `vec2` |
| `acTime` | 13 | 13 | `float`, seconds |
| `acLTS` | 10 | 5 | alias of `acLayerToScreen` |
| `acShowGuides` | 5 | 5 | `bool`, editor guides visible |
| `acLayerSizeNorm` | 4 | 4 | `vec2` |
| `acVelocity` | 4 | 4 | `vec2` |
| `acAngularVelocity` | 4 | 4 | `float` |
| `acScaleVelocity` | 4 | 4 | `float` |
| `acProjectSize` | 2 | 1 | `vec2`, project dimensions |

Plus `acIter` (current iteration) and `acLayerTransform` (`mat3`), which the engine declares but the
shipped corpus does not read directly.

### 8.2 Sampling helpers

| Helper | Uses | What it does |
| --- | --- | --- |
| `texture2DCv(sampler, vec2)` | 627 | sample through `acVtoRSpace` — **use this**, not raw `texture()` |
| `texture2D(sampler, vec2)` | 71 | aliased to `texture()` for old GLSL |
| `texture2DCvCv(...)` | 3 | cover-crop variant |

`texture2DCv` is what makes an effect resolution-independent: the raw `acScreenNorm` is in vertex space,
`acVtoRSpace` converts it to the texture's render space. Effects that skip it break on preview scaling.

### 8.3 Output

Write to `gl_FragColor`, **premultiplied**. The port rewrites it to `ac_fragColor`; the APK compiles for
GLES with the same convention. The blend inputs are already premultiplied, so a "mix toward a colour" is
`mix(c.rgb, tint.rgb * c.a, amount)` — see §10.

---

## 9. `<presets>` ✅

```xml
<presets>
    <preset id="flag-left" label="Waving Flag (Left)" timescale="2000" timing="extend" short-code="WA1">
        <property name="damping"       type="float" value="-1"/>
        <property name="dampingOrigin" type="float" value="1"/>
        <property name="m1"            type="float" value="10"/>
        <property name="phase" type="float">
            <kf t="0" v="4"/>
            <kf t="1" v="0"/>
        </property>
    </preset>
</presets>
```

`readPresets` (9 337 B) reads `id`, `label`, `timescale` (ms), `timing` (`extend`, …) and `short-code`,
then a list of `<property name type value>` with optional `<kf t v>` keyframes where `t` is normalised
0..1. One definition may carry many presets — they appear as one-tap variations in the picker.
Only 1 of 315 ships its presets inline; the other 13 preset packs live as `<scene>` files in
`assets/effects/presets/`, where each effect instance is
`<effect id="…" locallyApplied="false"><property …/></effect>`.

---

## 10. Three complete effects

### 10.1 Minimal tint — colour, spinner, premultiplied maths

```xml
<?xml version='1.0' encoding='UTF-8' ?>
<effect id="custom.neon_tint" name="Neon Tint" desc="Tints the layer." category="color" tags="color, tint">
    <params>
        <texture id="inputImg" srcType="content" />
        <color   id="tint"   label="Tint"   default="#FFFF00FF" alpha="true" />
        <spinner id="amount" label="Amount" default="0.5" min="0" max="1" step="0.01" type="percent" />
    </params>
    <shader type="fragment" precision="high"><![CDATA[
        void main() {
            vec4 c = texture2DCv(inputImg.texture, acScreenNorm);
            vec3 rgb = mix(c.rgb, tint.rgb * c.a, amount);
            gl_FragColor = vec4(rgb, c.a);
        }
    ]]></shader>
</effect>
```

Why `tint.rgb * c.a`: the input is premultiplied, so multiplying an unpremultiplied tint by `c.a` keeps
the result consistent. Skip it and transparent edges glow.

### 10.2 Two-pass directional blur with a quality knob

`assets/effects/boxblur.xml`, reproduced in §6 — buffer texture, `<iterations param="iter">`,
`acPass` branch, integer-typed sliders.

### 10.3 Script-only effect

```xml
<?xml version='1.0' encoding='UTF-8' ?>
<effect id="custom.sway" name="Sway" desc="Gentle horizontal drift." category="transform"
        tags="transform, animation, propadjust" auto-transform="true">
    <params>
        <spinner id="amp"   label="Amplitude" default="40"  min="0" max="400" step="1" />
        <spinner id="speed" label="Speed"     default="0.5" min="0.1" max="4" step="0.1" type="hz" />
        <spinner id="seed"  label="Seed"      default="0"   min="-100" max="100" step="1" />
    </params>
    <script lang="js"><![CDATA[
        function animate(env,el,p) {
            let t = env.time * env.duration;
            let m = AM.simplexNoise(t * p.speed * 1.7, p.seed * 13.37);
            el.transform.location.x += m * p.amp;
            return el;
        }
    ]]></script>
</effect>
```

No `<shader>`, no `<params>` texture. `auto-transform="true"` tells the engine to hand the script a
transform to mutate.

---

## 11. Things that bite

| Symptom | Cause |
| --- | --- |
| Effect missing from the picker | `id` missing (throws), or `internal="true"`, or `deprecated="true"` with the toggle off, or the file is not under `assets/effects/` |
| Effect appears with the wrong thumbnail | the slug comes from the *localised name*, not the filename — name it `Box Blur` and the engine looks for `thumb/box_blur.webp` |
| `Illegal target name` | `pass.target` is not `-` and not a valid GLSL identifier (no dots, no dashes) |
| `If <passes> is present, at least one <pass> must be specified` | empty `<passes>` |
| `More than one <fragment> shader in group 0` | two same-type shaders, same `group` |
| `Unrecognized shader precision 'ultra'` | only `high`/`medium`/`low` |
| `Unrecognized shader type 'pixel'` | only `fragment`/`vertex` |
| `expected 'layer', 'screen', 'offset', or 'size'` | bad `point type` |
| `expected 'translate', 'rotate', or 'scale'` | bad `xyz type` |
| `expected 'true' or 'false'` | a `<switch>`/`<color alpha>` value that is not literally true/false |
| `Missing or invalid choice value` | `<choice>` without an integer `value` |
| `<script> element missing 'lang' attribute` | `<script>` without `lang="js"` |
| Shader fails to compile | wrote `#version`/`precision`, used `acScreenNorm` in a *vertex* shader, or referenced an undeclared param |
| Effect samples the wrong place after preview zoom | used `texture()` instead of `texture2DCv()` |
| Edges bleed at the layer border | effect reads outside `[0,1]` — declare `overdraw="true"` and `max-overdraw="0.2"` |
| Translucent input causes dark fringes | maths done on premultiplied colour without `* c.a` |

Two `compat` notes: `compat="acScreenNorm-y"` (4 files — `colorbalance`, `mattefringe`, `ominoglass`,
`chromaticzoomblur`) marks effects authored against a Y-flipped `acScreenNorm`. Anything other than that
one literal is ignored, and the APK logs a warning. ⚠️ The port logs the same warning and does not flip;
verified only for the four shipped files.

---

## 12. `affinity` — where an effect is allowed

Observed values and their meaning, from the `EffectAffinity.fromString` mapping and the corpus:

| Value | Count | Attaches to |
| --- | --- | --- |
| `media` | 7 | image/video layers |
| `text!` | 6 | text layers only (`!` = exclusive) |
| `transform-animation!` | 2 | elements with an animated transform |
| `stroke!`, `freehand!`, `animation!` | 1 each | stroke / freehand / any animated element |

Omit it and the effect attaches to anything. The `!` suffix marks an exclusive affinity: the picker hides
the effect for anything that does not match.

---

## 13. Shipping one into Alight Motion

The APK loads from `assets/effects/`, which is read-only for a normal user. Practical routes:

1. **Repack the APK** — drop the XML into `assets/effects/`, keep it stored (no deflate) so the container
   stays faithful, resign, install. `scripts/audit/repack_apk.py` in this repo does exactly that.
2. **A companion `assets/effects/presets/` scene** — preset packs are ordinary `<scene>` files, so a
   "pack" can ship as a project you import and apply.
3. **The web port** — paste the XML into the effect browser (Track D) and it is validated and stored.

### 13.1 The web port's importer — 14 rules

`src/engine/customEffects.ts`, `validateCustomEffectXml`. These are **security and safety** rules on top
of AM's schema, not AM behaviour:

| Rule | Check |
| --- | --- |
| 1 | non-empty, ≤ 64 KB after BOM strip |
| 3 | no `<!DOCTYPE>` / `<!ENTITY>` |
| 4 | well formed, single `<effect>` root; `<scene>`, `<presets>`, `<shapes>` get a targeted message |
| 5 | non-empty `id` and `name` |
| 6 | `id` matches `^[a-z0-9._-]{3,80}$`; a built-in id is re-namespaced to `custom.<slug>` |
| 7 | every param tag must be in the allowlist |
| 8 | `srcType` in `content`/`buffer`/`comp`/`image`; no remote or `../` image `src` |
| 9 | ≤ 8 passes; pass attributes limited to `target`, `effect`, `src`, `blend` |
| 10 | ≤ 8 shader blocks; `type` must be `fragment` or `vertex` |
| 11 | no `#include`, `#extension`, `sampler3D`, `samplerCube`, `imageLoad`, URLs |
| 12 | the shaders must actually compile in WebGL2 |
| 13 | script ≤ 16 KB; no `fetch`, `XMLHttpRequest`, `eval`, `Function`, `document`, `window`, storage, `import()`, `while(true)` |
| 14 | the script runs in a Worker with a hard time budget |

Known divergences between the port and the APK, as of this writing:

| Divergence | APK | Port before | Port now |
| --- | --- | --- | --- |
| `srcType="user"` | legal, and the **default** when `src` is absent | rejected (rule 8) | accepted |
| `hue-ring` | legal param tag | rejected (rule 7) | accepted |
| unknown param tag | skipped silently | rejected (rule 7) | unchanged — stricter on purpose |
| empty `<passes>` | throws | accepted | now throws, to match |
| `fastMath` on `<shader>` | ignored | accepted | unchanged |
| `text` as a param tag | not a param tag | accepted | unchanged |

Writing to AM's schema means an effect authored here imports into AM unchanged, and an effect lifted from
AM imports here once it clears rules 3, 11 and 13 — which is the point of those rules.

---

## 14. The port's data model

`public/am/effects.json` is the same 315 definitions, flattened. Field-by-field:

| JSON | XML |
| --- | --- |
| `id` | `<effect id>` |
| `name` / `desc` / `category` / `tags` / `thumb` | same attributes |
| `deprecated` / `experimental` / `internal` | same |
| `overdraw` / `maxOverdraw` | `overdraw` / `max-overdraw` |
| `autoTransform` | `auto-transform` |
| `compat` / `afxver` / `affinity` / `type` | same |
| `params[]` | `<params>` children, verbatim attributes |
| `passes` | `<passes>` → `<pass>` list, or `[]` when absent |
| `iterations` | the `param` attribute of `<iterations>` (a param id, not a number) |
| `shaders[]` | every `<shader>` with `code`, `type`, `precision`, `group` |
| `script` | the first `<script>` body |

Render path: `getEffectById` → `ShaderRegistry.getEffectProgram(def, group)` → prelude from
`shaderCompiler.ts` → `renderer.runEffectPasses` (buffer allocation by `downsample`, `iterations` from the
param value clamped to 32, `acPass` per pass, nested `pass.effect` recursion).

---

## 15. Acceptance tests

| # | Test | Pass |
| --- | --- | --- |
| EA-A1 | Import §10.1 into the port | accepted; tint visible; no compile error |
| EA-A2 | Run `boxblur.xml` unmodified | imports, two passes, `iter` slider changes the result |
| EA-A3 | Import a file with `srcType="user"` | accepted (previously rejected) |
| EA-A4 | Import a file with `<hue-ring>` | accepted |
| EA-A5 | Import a file with an empty `<passes>` | rejected with AM's message |
| EA-A6 | Export from the port and diff against the source XML | ids, params and shader bodies unchanged |
| EA-A7 | A script effect calling `AM.simplexNoise` with 1, 2, 3 and 4 args | all four accepted, >4 returns 0 |
| EA-A8 | Corpus sweep: all 315 definitions through the importer | 0 unexplained rejections; every rejection names a rule |

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[EFFECT_AUTHORING]]` |
| Source of truth | `assets/effects/` in Alight Motion 5.0.280 · `VisualEffectParserKt.readEffect` · `UserParamParserKt.readUserParams` · `ACScriptParserKt.readACScript` · `ScriptExecutorKt.registerAlightMotionScriptMethods` |
| Corpus | 315 `<effect>` + 13 `<scene>`, 1.41 MB of effect XML |
| Script API | `AM.log`, `AM.simplexNoise`, `AM.triangle`, `AM.hsvToRgb`, `AM.rgbToHsv` |
| Status | active |

Carry forward: the schema is **one function** — `readEffect` — and it is deliberately permissive: unknown
tags are skipped, unknown attributes ignored, `max-overdraw` is spelled two ways. The only hard failures
are a missing `id`, a missing shader `type`, an empty `<passes>`, a bad enum value, and duplicate shader
type per group. Write to that shape and the same file works in the APK and in the port.
