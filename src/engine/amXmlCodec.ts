import type {
  Animatable,
  BlendModeId,
  EasingSpec,
  FreehandStroke,
  Keyframe,
  Layer,
  LayerEffectInstance,
  Project,
} from '../types/project';
import { animatable, parseEasingString } from './animation';
import { blendModeToXml, canonicalizeBlendMode, isMaskBlendMode } from './blendModes';
import { getEffectById, getShapeById, parseDefaultParamValue } from './catalog';
import { formatAmFontToken, parseAmFontToken } from './fontNames';
import { amTextSizeToPx, pxToAmTextSize } from './textMetrics';

// Alight Motion stores a text layer's `size` in units that are 1/3 of the em it paints
// with — see src/engine/textMetrics.ts for the APK anchors.
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatEasingAttr(e?: EasingSpec): string {
  if (!e || (e.type === 'linear' && !e.approximated)) return '';
  if (e.approximated && e.token) {
    const raw = [e.token, ...(e.params ?? [])].join(' ');
    return ` e="${escapeXml(raw)}"`;
  }
  if (e.type === 'cubicBezier') {
    return ` e="cubicBezier ${e.x1.toFixed(6)} ${e.y1.toFixed(6)} ${e.x2.toFixed(6)} ${e.y2.toFixed(6)}"`;
  }
  if (e.token && e.params && e.params.length > 0) {
    return ` e="${escapeXml([e.token, ...e.params].join(' '))}"`;
  }
  return '';
}

function formatVal(v: unknown): string {
  if (Array.isArray(v)) return v.map((n) => (typeof n === 'number' ? n.toFixed(6) : String(n))).join(',');
  if (typeof v === 'number') return v.toFixed(6);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v ?? '');
}

function emitAnimProp(tag: string, prop: Animatable<any>, isAttr = false, attrName = 'value'): string {
  if (!prop.keyframes || prop.keyframes.length === 0) {
    if (isAttr) return `<${tag} ${attrName}="${escapeXml(formatVal(prop.value))}"/>`;
    return `<${tag} value="${escapeXml(formatVal(prop.value))}"/>`;
  }
  const kfs = prop.keyframes
    .map((k) => `<kf t="${k.t.toFixed(6)}" v="${escapeXml(formatVal(k.v))}"${formatEasingAttr(k.easing)}/>`)
    .join('\n        ');
  return `<${tag}>\n        ${kfs}\n      </${tag}>`;
}

const SHAPE_NS = 'com.alightcreative.shapes.';

/** AM writes gradient handles in 0..1 page space; the model keeps them in -1..1 layer space. */
function formatGradientChannel(v: number): string {
  return Math.max(0, Math.min(1, (v + 1) / 2)).toFixed(6);
}

/**
 * A media reference has to survive export. AM resolves it against the package, so the media id is
 * authoritative; projects created before ids existed fall back to the source basename.
 */
function mediaReference(mediaId: string | undefined, src: string | undefined): string | null {
  const id = (mediaId || '').trim();
  if (id) return id;
  const raw = (src || '').trim();
  if (!raw) return null;
  const noQuery = raw.split(/[?#]/)[0];
  const base = noQuery.split('/').pop();
  return base || noQuery || null;
}

/** Mirrors renderer.buildVectorPath so an exported <path d> draws the same curve it replaced. */
function vectorPathToSvgD(points: { x: number; y: number; inX: number; inY: number; outX: number; outY: number }[], closed: boolean): string {
  if (points.length === 0) return '';
  const n = (v: number) => Number(v.toFixed(4)).toString();
  let d = `M ${n(points[0].x)} ${n(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    d += ` C ${n(a.x + a.outX)} ${n(a.y + a.outY)} ${n(b.x + b.inX)} ${n(b.y + b.inY)} ${n(b.x)} ${n(b.y)}`;
  }
  if (closed && points.length > 1) {
    const a = points[points.length - 1];
    const b = points[0];
    d += ` C ${n(a.x + a.outX)} ${n(a.y + a.outY)} ${n(b.x + b.inX)} ${n(b.y + b.inY)} ${n(b.x)} ${n(b.y)} Z`;
  }
  return d;
}

function inferShapePropType(v: unknown): string {
  if (Array.isArray(v)) return v.length === 2 ? 'vec2' : v.length === 4 ? 'quat' : 'vec3';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return v.startsWith('#') ? 'color' : 'string';
  return 'float';
}

function emitPropertyEl(name: string, prop: Animatable<any>, indent: string): string {
  const type = inferShapePropType(prop.value);
  if (!prop.keyframes || prop.keyframes.length === 0) {
    return `${indent}<property name="${escapeXml(name)}" type="${type}" value="${escapeXml(formatVal(prop.value))}"/>`;
  }
  const kfs = prop.keyframes
    .map((k) => `${indent}  <kf t="${k.t.toFixed(6)}" v="${escapeXml(formatVal(k.v))}"${formatEasingAttr(k.easing)}/>`)
    .join('\n');
  return `${indent}<property name="${escapeXml(name)}" type="${type}">\n${kfs}\n${indent}</property>`;
}

function layerToXml(layer: Layer, fps = 30, indent = '  '): string {
  const tagMap: Record<string, string> = {
    shape: 'shape',
    text: 'text',
    image: 'image',
    video: 'video',
    audio: 'audio',
    null: 'nullobj',
    camera: 'camera',
    group: 'embedScene',
    vector: 'shape',
    // AM's own tag for a freehand drawing is <drawing>; writing <shape> dropped every stroke.
    freehand: 'drawing',
  };
  const tag = tagMap[layer.type] ?? 'shape';
  const fillAttr =
    layer.fill.type === 'solid'
      ? ` fillType="color" fillColor="${escapeXml(layer.fill.color.value)}"`
      : layer.fill.type === 'gradient'
        ? ` fillType="gradient"`
        : layer.fill.type === 'media'
          ? ` fillType="media"`
          : ` fillType="none"`;

  const parentAttr = layer.parentId ? ` parent="${escapeXml(layer.parentId)}"` : '';
  // B6: export keeps AM's own dialect — mask/clipping-mask become clippingMask="true",
  // every colour blend is written with its hyphenated 5.0.280 xml id (never a legacy web id).
  const canonicalBlend = canonicalizeBlendMode(layer.blendMode);
  const isMask = isMaskBlendMode(canonicalBlend);
  const clipAttr = isMask || canonicalBlend === 'exclude' ? ' clippingMask="true"' : '';
  const blendXmlId = blendModeToXml(canonicalBlend);
  const blendAttr = blendXmlId ? ` blending="${escapeXml(blendXmlId)}"` : '';
  const retimeAttr =
    layer.retime && layer.retime.method !== 'none'
      ? ` retime="${escapeXml(layer.retime.method)}"`
      : '';
  const cropAttr =
    layer.mediaData?.cropMode && layer.mediaData.cropMode !== 'fill'
      ? ` cropMode="${escapeXml(layer.mediaData.cropMode)}"`
      : '';
  const is3DAttr = layer.is3D ? ' is3D="true"' : '';
  const hiddenAttr = layer.visible ? '' : ' hidden="true"';
  const shapeIdAttr =
    layer.type === 'shape' && layer.shapeId
      ? ` s="${escapeXml(
          layer.shapeId.startsWith(SHAPE_NS) ? `.${layer.shapeId.slice(SHAPE_NS.length)}` : layer.shapeId
        )}"`
      : '';
  const fogAttr = layer.cameraData?.fogEnabled ? ' fogEnabled="true"' : '';

  // Media references and playback state live on the layer tag in AM's dialect. Without these the
  // layer re-imports with no source at all, which is what the earlier writer did.
  const mediaRef = mediaReference(layer.mediaData?.mediaId, layer.mediaData?.src);
  const audioRef = mediaReference(layer.audioData?.mediaId, layer.audioData?.src);
  const mediaAttrs: string[] = [];
  if ((layer.type === 'video' || layer.type === 'image') && mediaRef) {
    mediaAttrs.push(` src="${escapeXml(mediaRef)}"`);
  }
  if (layer.type === 'audio' && audioRef) {
    mediaAttrs.push(` src="${escapeXml(audioRef)}"`);
  }
  if (layer.fill.type === 'media') {
    const fillRef = mediaReference(layer.fill.mediaId, layer.fill.mediaSrc) ?? mediaRef;
    if (fillRef) mediaAttrs.push(` fillImage="${escapeXml(fillRef)}"`);
  }
  const playbackSpeed = layer.mediaData?.playbackSpeed;
  if (playbackSpeed != null && Math.abs(playbackSpeed - 1) > 1e-6) {
    mediaAttrs.push(` speed="${playbackSpeed}"`);
  }
  const trimStart = layer.mediaData?.trimStartMs ?? layer.audioData?.trimStartMs;
  if (trimStart != null && trimStart > 0) {
    mediaAttrs.push(` inTime="${Math.round(trimStart)}"`);
  }
  const gainValue = layer.mediaData?.volume;
  if (gainValue != null && Math.abs(gainValue - 1) > 1e-6) {
    mediaAttrs.push(` gain="${gainValue}"`);
  }
  if (layer.mediaData?.muted || layer.audioData?.muted) {
    mediaAttrs.push(' muted="true"');
  }

  const parts: string[] = [];
  // Text attributes belong on the <text> element in AM's own dialect — its loader reads
  // `size`, `font`, `wrapWidth`, `align` and `color` from the layer tag, leaving
  // <content> to hold nothing but the characters.
  let textAttrs = '';
  if (layer.type === 'text' && layer.textData) {
    const td = layer.textData;
    const amFont = formatAmFontToken(td.fontFamily, td.fontWeight ?? 400, Boolean(td.italic));
    const amSize = pxToAmTextSize(td.fontSize).toFixed(6);
    const wrap = Math.round(td.wrapWidth || 800);
    textAttrs =
      ` size="${amSize}" font="${escapeXml(amFont)}" wrapWidth="${wrap}"` +
      ` align="${escapeXml(td.align || 'center')}" color="${escapeXml(td.color || '#FFFFFFFF')}"`;
  }
  parts.push(
    `${indent}<${tag} id="${escapeXml(layer.id)}" label="${escapeXml(layer.label)}" startTime="${Math.round(layer.startTime)}" endTime="${Math.round(layer.endTime)}"${fillAttr}${textAttrs}${parentAttr}${hiddenAttr}${clipAttr}${blendAttr}${retimeAttr}${cropAttr}${is3DAttr}${shapeIdAttr}${fogAttr}${mediaAttrs.join('')}>`
  );

  parts.push(`${indent}  <transform>`);
  parts.push(`${indent}    ${emitAnimProp('location', layer.transform.location)}`);
  parts.push(`${indent}    ${emitAnimProp('rotation', layer.transform.rotation)}`);
  if (layer.transform.rotationX && (layer.transform.rotationX.value !== 0 || layer.transform.rotationX.keyframes.length > 0)) {
    parts.push(`${indent}    ${emitAnimProp('rotationX', layer.transform.rotationX)}`);
  }
  if (layer.transform.rotationY && (layer.transform.rotationY.value !== 0 || layer.transform.rotationY.keyframes.length > 0)) {
    parts.push(`${indent}    ${emitAnimProp('rotationY', layer.transform.rotationY)}`);
  }
  parts.push(`${indent}    ${emitAnimProp('scale', layer.transform.scale)}`);
  parts.push(`${indent}    ${emitAnimProp('pivot', layer.transform.pivot)}`);
  parts.push(`${indent}    ${emitAnimProp('opacity', layer.opacity)}`);
  parts.push(`${indent}  </transform>`);

  if (layer.type === 'text' && layer.textData) {
    parts.push(`${indent}  <content>${escapeXml(layer.textData.content)}</content>`);
  }

  // AM writes a fill colour on elements whose fillType is `none` too (the beta_anim sample keeps
  // <fillColor value="#ff000000"/> on a group). Emitting it unconditionally is what keeps a
  // colour from being replaced by the importer's fallback on the next load.
  if (layer.fill.color.value) {
    parts.push(`${indent}  ${emitAnimProp('fillColor', layer.fill.color)}`);
  }

  if (layer.fill.type === 'gradient') {
    const stops =
      layer.fill.gradientStops.length >= 2
        ? layer.fill.gradientStops
        : [
            { offset: 0, color: '#FFFFFFFF' },
            { offset: 1, color: '#FF000000' },
          ];
    const startColor = stops[0].color;
    const endColor = stops[stops.length - 1].color;
    const midColor = stops.length >= 3 ? stops[Math.floor(stops.length / 2)].color : null;
    parts.push(
      `${indent}  <gradient type="${layer.fill.gradientType}" startColor="${escapeXml(startColor)}"${
        midColor ? ` midColor="${escapeXml(midColor)}"` : ''
      } endColor="${escapeXml(endColor)}" start="${formatGradientChannel(layer.fill.gradientStart[0])},${formatGradientChannel(
        layer.fill.gradientStart[1]
      )}" end="${formatGradientChannel(layer.fill.gradientEnd[0])},${formatGradientChannel(layer.fill.gradientEnd[1])}"/>`
    );
  }

  if (layer.svgPathD) {
    parts.push(`${indent}  <path d="${escapeXml(layer.svgPathD)}"/>`);
  } else if (layer.type === 'vector' && layer.vectorPath && layer.vectorPath.points.length > 0) {
    const d = vectorPathToSvgD(layer.vectorPath.points, layer.vectorPath.closed);
    if (d) parts.push(`${indent}  <path d="${escapeXml(d)}"/>`);
  }

  // Media display size is stored as the half-extent pair on <property name="size">, which is how
  // the importer reads it back for image and video layers.
  if ((layer.type === 'image' || layer.type === 'video') && layer.mediaData?.displayWidth && layer.mediaData.displayHeight) {
    parts.push(
      `${indent}  <property name="size" type="vec2" value="${formatVal([
        layer.mediaData.displayWidth / 2,
        layer.mediaData.displayHeight / 2,
      ])}"/>`
    );
  }

  if (layer.type === 'shape' && layer.shapeParams) {
    for (const [pname, pval] of Object.entries(layer.shapeParams)) {
      parts.push(emitPropertyEl(pname, pval, `${indent}  `));
    }
  }

  if (layer.stroke.enabled && layer.type !== 'freehand') {
    const endType =
      layer.stroke.position === 'inside' ? 'inside' : layer.stroke.position === 'outside' ? 'outside' : 'centered';
    parts.push(`${indent}  <stroke endType="${endType}">`);
    parts.push(`${indent}    ${emitAnimProp('color', layer.stroke.color)}`);
    parts.push(`${indent}    ${emitAnimProp('size', layer.stroke.width)}`);
    parts.push(`${indent}  </stroke>`);
  }

  if (layer.shadow.enabled) {
    parts.push(`${indent}  <shadow>`);
    parts.push(`${indent}    ${emitAnimProp('color', layer.shadow.color)}`);
    parts.push(`${indent}    ${emitAnimProp('alpha', layer.shadow.alpha)}`);
    parts.push(`${indent}    ${emitAnimProp('size', layer.shadow.size)}`);
    parts.push(`${indent}    <offset value="${formatVal([layer.shadow.offsetX.value, layer.shadow.offsetY.value])}"/>`);
    parts.push(`${indent}  </shadow>`);
  }

  if (layer.type === 'freehand' && layer.freehandStrokes) {
    for (const st of layer.freehandStrokes) {
      const pts = st.points
        .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.pressure.toFixed(4)}`)
        .join(';');
      parts.push(
        `${indent}  <stroke points="${escapeXml(pts)}" color="${escapeXml(st.color)}" width="${st.width}" opacity="${st.opacity}"/>`
      );
    }
  }

  if (layer.audioData) {
    parts.push(`${indent}  ${emitAnimProp('gain', layer.audioData.volume)}`);
  }

  if (layer.type === 'camera' && layer.cameraData) {
    parts.push(`${indent}  ${emitAnimProp('fov', layer.cameraData.fov)}`);
    if (layer.cameraData.type === 'orthographic') {
      parts.push(`${indent}  <property name="cameraType" type="string" value="orthographic"/>`);
    }
    if (layer.cameraData.fogEnabled) {
      parts.push(`${indent}  <fogColor value="${escapeXml(layer.cameraData.fogColor)}"/>`);
      parts.push(`${indent}  <fogNearZ value="${layer.cameraData.fogNear}"/>`);
      parts.push(`${indent}  <fogFarZ value="${layer.cameraData.fogFar}"/>`);
    }
    parts.push(`${indent}  ${emitAnimProp('focusDistance', layer.cameraData.focusDistance)}`);
    parts.push(`${indent}  ${emitAnimProp('focusBlurStrength', layer.cameraData.blurStrength)}`);
  }

  for (const eff of layer.effects) {
    const hiddenAttr = !eff.enabled ? ' hidden="true"' : '';
    parts.push(`${indent}  <effect id="${escapeXml(eff.effectId)}" locallyApplied="${eff.locallyApplied ? 'true' : 'false'}" enabled="${eff.enabled ? 'true' : 'false'}"${hiddenAttr}>`);
    for (const [pname, pval] of Object.entries(eff.params)) {
      const ptype = Array.isArray(pval.value)
        ? pval.value.length === 2
          ? 'vec2'
          : pval.value.length === 4
            ? 'quat'
            : 'vec3'
        : typeof pval.value === 'boolean'
          ? 'bool'
          : typeof pval.value === 'string' && pval.value.startsWith('#')
            ? 'color'
            : 'float';
      if (!pval.keyframes || pval.keyframes.length === 0) {
        parts.push(`${indent}    <property name="${escapeXml(pname)}" type="${ptype}" value="${escapeXml(formatVal(pval.value))}"/>`);
      } else {
        parts.push(`${indent}    <property name="${escapeXml(pname)}" type="${ptype}">`);
        for (const k of pval.keyframes) {
          parts.push(`${indent}      <kf t="${k.t.toFixed(6)}" v="${escapeXml(formatVal(k.v))}"${formatEasingAttr(k.easing)}/>`);
        }
        parts.push(`${indent}    </property>`);
      }
    }
    parts.push(`${indent}  </effect>`);
  }

  if (layer.type === 'group' && layer.groupLayers) {
    const gw = Math.round(layer.groupWidth || 1080);
    const gh = Math.round(layer.groupHeight || 1080);
    parts.push(
      `${indent}  <scene title="" width="${gw}" height="${gh}" bgcolor="#00000000" fps="${Math.round(fps) || 30}" totalTime="${Math.round(
        layer.endTime - layer.startTime
      )}">`
    );
    for (const sub of layer.groupLayers) {
      parts.push(layerToXml(sub, fps, indent + '    '));
    }
    parts.push(`${indent}  </scene>`);
  }

  parts.push(`${indent}</${tag}>`);
  return parts.join('\n');
}

export function exportProjectToAmXml(project: Project): string {
  const lines = [
    `<?xml version='1.0' encoding='UTF-8' ?>`,
    `<!-- Exported by Alight Motion Web Studio (5.0.280) -->`,
    `<scene title="${escapeXml(project.title)}" width="${project.width}" height="${project.height}" exportWidth="${project.width}" exportHeight="${project.height}" bgcolor="${escapeXml(project.bgColor === 'transparent' ? '#00000000' : project.bgColor)}" totalTime="${Math.round(project.durationMs)}" fps="${project.fps}" modifiedTime="${project.modifiedTime}" amver="280" am="com.alightcreative.motion/5.0.280">`,
  ];
  for (const layer of project.layers) {
    lines.push(layerToXml(layer, project.fps, '  '));
  }
  for (const bm of project.bookmarks) {
    lines.push(`  <bookmark t="${Math.round(bm)}"/>`);
  }
  lines.push('</scene>');
  return lines.join('\n');
}

function parsePropElement<T>(
  el: Element | null,
  parseFn: (raw: string) => T,
  fallback: T
): Animatable<T> {
  if (!el) return animatable(fallback);
  const kfEls = Array.from(el.querySelectorAll(':scope > kf'));
  if (kfEls.length > 0) {
    const kfs: Keyframe<T>[] = kfEls
      .map((kf) => ({
        t: parseFloat(kf.getAttribute('t') || '0'),
        v: parseFn(kf.getAttribute('v') || ''),
        easing: parseEasingString(kf.getAttribute('e') || undefined),
      }))
      .sort((a, b) => a.t - b.t);
    return animatable(kfs[0].v, kfs);
  }
  const val = el.getAttribute('value');
  return animatable(val != null ? parseFn(val) : fallback);
}

const LAYER_TAGS = new Set([
  'shape',
  'text',
  'image',
  'video',
  'audio',
  'nullobj',
  'camera',
  'embedscene',
  'drawing',
]);

const parseNum = (s: string) => parseFloat(s) || 0;
const parseVec2 = (s: string): [number, number] => {
  const a = s.split(',').map((x) => parseFloat(x.trim()) || 0);
  return [a[0] ?? 0, a[1] ?? 0];
};
const parseVec3 = (s: string): [number, number, number] => {
  const a = s.split(',').map((x) => parseFloat(x.trim()) || 0);
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
};
const parseQuat = (s: string): [number, number, number, number] => {
  const a = s.split(',').map((x) => parseFloat(x.trim()));
  if (a.length >= 4 && a.every((n) => Number.isFinite(n))) {
    return [a[0], a[1], a[2], a[3]];
  }
  return [0, 0, 0, 1];
};

function parseDrawingStrokes(el: Element): FreehandStroke[] {
  const strokes: FreehandStroke[] = [];
  for (const stEl of Array.from(el.querySelectorAll(':scope > stroke'))) {
    const rawPts = stEl.getAttribute('points') || '';
    const points: { x: number; y: number; pressure: number }[] = [];
    for (const seg of rawPts.split(';')) {
      const trimmed = seg.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(',').map((n) => parseFloat(n.trim()));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        points.push({
          x: parts[0],
          y: parts[1],
          pressure: Number.isFinite(parts[2]) ? parts[2] : 1,
        });
      }
    }
    if (points.length >= 2) {
      strokes.push({
        points,
        color: stEl.getAttribute('color') || '#FFFFFFFF',
        width: parseFloat(stEl.getAttribute('width') || '16') || 16,
        opacity: parseFloat(stEl.getAttribute('opacity') || '1') ?? 1,
      });
    }
  }
  return strokes;
}

function parseDirectProperties(el: Element): Record<string, Animatable<any>> {
  const out: Record<string, Animatable<any>> = {};
  for (const propEl of Array.from(el.querySelectorAll(':scope > property'))) {
    const pname = propEl.getAttribute('name');
    const ptype = propEl.getAttribute('type') || 'float';
    if (!pname) continue;
    const parser = (raw: string) => {
      if (ptype === 'vec2') return parseVec2(raw);
      if (ptype === 'vec3') return parseVec3(raw);
      if (ptype === 'quat') return parseQuat(raw);
      if (ptype === 'int') return parseInt(raw, 10) || 0;
      if (ptype === 'bool') return raw === 'true' || raw === '1';
      if (ptype === 'color') return raw;
      // `type="string"` is how AM writes enum-valued properties such as cameraType; parsing it as
      // a float silently reset an orthographic camera to perspective on every round trip.
      if (ptype === 'string') return raw;
      return parseFloat(raw) || 0;
    };
    const fallback = ptype === 'quat' ? [0, 0, 0, 1] : parser('0');
    out[pname] = parsePropElement(propEl, parser, fallback);
  }
  return out;
}

export interface ImportedMediaAsset {
  mediaId: string;
  src: string;
  mime: string;
  name: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export type AmPackageMediaMap = Map<string, ImportedMediaAsset>;

function lookupMediaAsset(rawRef: string | null, mediaMap?: AmPackageMediaMap): ImportedMediaAsset | undefined {
  if (!rawRef || !mediaMap) return undefined;
  const cleaned = rawRef.replace(/^amproj:/i, '').trim();
  const base = cleaned.split('/').pop() || cleaned;
  return (
    mediaMap.get(cleaned) ??
    mediaMap.get(cleaned.toLowerCase()) ??
    mediaMap.get(base) ??
    mediaMap.get(base.toLowerCase())
  );
}

function parseXmlLayer(
  el: Element,
  idx: number,
  projW: number,
  projH: number,
  mediaMap?: AmPackageMediaMap
): Layer {
  const tag = el.tagName.toLowerCase();
  const typeMap: Record<string, Layer['type']> = {
    shape: 'shape',
    text: 'text',
    image: 'image',
    video: 'video',
    audio: 'audio',
    nullobj: 'null',
    camera: 'camera',
    embedscene: 'group',
    drawing: 'freehand',
  };
  let type: Layer['type'] = typeMap[tag] ?? 'shape';
  const tf = el.querySelector(':scope > transform');

  const effects: LayerEffectInstance[] = [];
  for (const effEl of Array.from(el.querySelectorAll(':scope > effect'))) {
    const eid = effEl.getAttribute('id') || '';
    if (!eid) continue;
    const def = getEffectById(eid);
    const params: Record<string, Animatable<any>> = {};
    if (def) {
      for (const pd of def.params) {
        if (!pd.id) continue;
        if (pd.tag === 'orient') {
          params[pd.id] = animatable([0, 0, 0, 1]);
        } else if (pd.default !== undefined) {
          params[pd.id] = animatable(
            pd.tag === 'point'
              ? parseVec2(pd.default)
              : pd.tag === 'xyz' || pd.tag === 'hue-disc'
                ? parseVec3(pd.default)
                : pd.tag === 'switch'
                  ? pd.default === 'true'
                  : pd.tag === 'color'
                    ? pd.default
                    : parseNum(pd.default)
          );
        }
      }
    }
    const effProps = parseDirectProperties(effEl);
    for (const [pname, pval] of Object.entries(effProps)) {
      params[pname] = pval;
    }
    effects.push({
      uid: `eff_${Math.random().toString(36).slice(2, 10)}`,
      effectId: eid,
      enabled: effEl.getAttribute('enabled') !== 'false' && effEl.getAttribute('hidden') !== 'true',
      locallyApplied: effEl.getAttribute('locallyApplied') === 'true',
      params,
    });
  }

  const contentEl = el.querySelector(':scope > content');
  const fillTypeAttr = el.getAttribute('fillType');
  const fillColorEl = el.querySelector(':scope > fillColor');
  const fillColorFallback = el.getAttribute('fillColor') || '#FF69FC97';
  const fillColorAnim = fillColorEl
    ? parsePropElement(fillColorEl, (s) => s || fillColorFallback, fillColorFallback)
    : animatable(fillColorFallback);

  // Parse <gradient type="linear|radial|sweep" startColor="..." endColor="..." start="x,y" end="x,y"/>
  const gradEl = el.querySelector(':scope > gradient');
  let gradientType: 'linear' | 'radial' | 'sweep' = 'linear';
  let gradientStops = [
    { offset: 0, color: '#FF69FC97' },
    { offset: 1, color: '#FF5CE5FF' },
  ];
  let gradientStart: [number, number] = [-0.5, -0.5];
  let gradientEnd: [number, number] = [0.5, 0.5];
  if (gradEl) {
    const gt = (gradEl.getAttribute('type') || 'linear').toLowerCase();
    gradientType = gt === 'radial' ? 'radial' : gt === 'sweep' ? 'sweep' : 'linear';
    const sc = gradEl.getAttribute('startColor') || '#FF000000';
    const ec = gradEl.getAttribute('endColor') || '#FFFFFFFF';
    const mc = gradEl.getAttribute('midColor');
    gradientStops = mc
      ? [
          { offset: 0, color: sc },
          { offset: 0.5, color: mc },
          { offset: 1, color: ec },
        ]
      : [
          { offset: 0, color: sc },
          { offset: 1, color: ec },
        ];
    const sRaw = gradEl.getAttribute('start');
    const eRaw = gradEl.getAttribute('end');
    if (sRaw) {
      const [sx, sy] = parseVec2(sRaw);
      gradientStart = [sx * 2 - 1, sy * 2 - 1];
    }
    if (eRaw) {
      const [ex, ey] = parseVec2(eRaw);
      gradientEnd = [ex * 2 - 1, ey * 2 - 1];
    }
  }

  // Parse <shape s=".rect|.roundrect|...">, direct <property> children, and <path d="..."/>
  const rawShapeAttr = el.getAttribute('s');
  const resolvedShapeId = rawShapeAttr
    ? rawShapeAttr.startsWith('.')
      ? `com.alightcreative.shapes.${rawShapeAttr.slice(1)}`
      : rawShapeAttr
    : 'com.alightcreative.shapes.rect';
  const directProps = parseDirectProperties(el);
  const pathEl = el.querySelector(':scope > path');
  const svgPathD = pathEl?.getAttribute('d') || undefined;

  let shapeParams: Record<string, Animatable<any>> | undefined;
  if (tag === 'shape') {
    shapeParams = {};
    const sDef = getShapeById(resolvedShapeId);
    if (sDef) {
      for (const pd of sDef.params) {
        if (pd.id) {
          shapeParams[pd.id] = animatable(parseDefaultParamValue(pd));
        }
      }
    } else {
      shapeParams.size = animatable([100, 100] as [number, number]);
    }
    for (const [k, v] of Object.entries(directProps)) {
      shapeParams[k] = v;
    }
  }

  // Parse <stroke> on shapes (distinct from <drawing><stroke points="..."/>)
  const freehandStrokes = tag === 'drawing' ? parseDrawingStrokes(el) : undefined;
  let stroke: Layer['stroke'] = {
    enabled: false,
    color: animatable('#FFFFFFFF'),
    width: animatable(4),
    position: 'center',
    cap: 'round',
    join: 'round',
    dash: false,
    dashLength: 16,
    dashGap: 10,
    dashOffset: 0,
  };
  if (tag !== 'drawing') {
    const stEl = el.querySelector(':scope > stroke');
    if (stEl && stEl.getAttribute('enabled') !== 'false') {
      const stColorEl = stEl.querySelector(':scope > color');
      const stSizeEl = stEl.querySelector(':scope > size');
      const endType = (stEl.getAttribute('endType') || 'centered').toLowerCase();
      stroke = {
        ...stroke,
        enabled: true,
        color: stColorEl
          ? parsePropElement(stColorEl, (s) => s || '#FFFFFFFF', '#FFFFFFFF')
          : animatable(stEl.getAttribute('color') || '#FFFFFFFF'),
        width: stSizeEl
          ? parsePropElement(stSizeEl, parseNum, 4)
          : animatable(parseFloat(stEl.getAttribute('size') || '4') || 4),
        position: endType === 'inside' ? 'inside' : endType === 'outside' ? 'outside' : 'center',
      };
    }
  }

  // Parse <shadow> — in AM XML, enabled shadows omit `enabled`, disabled ones explicitly write `enabled="false"`
  let shadow: Layer['shadow'] = {
    enabled: false,
    color: animatable('#88000000'),
    alpha: animatable(0.6),
    size: animatable(12),
    offsetX: animatable(6),
    offsetY: animatable(6),
  };
  const shEl = el.querySelector(':scope > shadow');
  if (shEl) {
    const shColorEl = shEl.querySelector(':scope > color');
    const shSizeEl = shEl.querySelector(':scope > size');
    const shOffEl = shEl.querySelector(':scope > offset');
    const shAlphaEl = shEl.querySelector(':scope > alpha');
    const offVec = shOffEl ? parseVec2(shOffEl.getAttribute('value') || '0,0') : [0, 0];
    shadow = {
      enabled: shEl.getAttribute('enabled') !== 'false',
      color: shColorEl
        ? parsePropElement(shColorEl, (s) => s || '#FF000000', '#FF000000')
        : animatable('#FF000000'),
      alpha: shAlphaEl ? parsePropElement(shAlphaEl, parseNum, 0.75) : animatable(0.75),
      size: shSizeEl ? parsePropElement(shSizeEl, parseNum, 20) : animatable(20),
      offsetX: animatable(offVec[0]),
      offsetY: animatable(offVec[1]),
    };
  }

  // Resolve bundled .amproj media references (fillVideo / fillImage / src / uri)
  const fillVideoRef = el.getAttribute('fillVideo');
  const fillImageRef = el.getAttribute('fillImage');
  const directSrcRef = el.getAttribute('src') ?? el.getAttribute('uri');
  const matchedVideo = lookupMediaAsset(fillVideoRef || (type === 'video' ? directSrcRef : null), mediaMap);
  const matchedImage = lookupMediaAsset(fillImageRef || (type === 'image' ? directSrcRef : null), mediaMap);
  const matchedAudio = lookupMediaAsset(type === 'audio' ? directSrcRef : null, mediaMap);

  // Extract shape half-extent size for media-filled shapes (<shape fillType="media"><property name="size" value="sx,sy"/>)
  const shapeSizeVal = directProps.size?.value;
  const displayWidth = Array.isArray(shapeSizeVal) && shapeSizeVal[0] > 0 ? shapeSizeVal[0] * 2 : undefined;
  const displayHeight = Array.isArray(shapeSizeVal) && shapeSizeVal[1] > 0 ? shapeSizeVal[1] * 2 : undefined;

  let mediaData: Layer['mediaData'];
  let audioData: Layer['audioData'];

  const rawCrop = (el.getAttribute('cropMode') || el.getAttribute('mediaFillMode') || '').toLowerCase();
  const cropMode: 'fill' | 'fit' | 'stretch' | undefined =
    rawCrop === 'fit' || rawCrop === 'stretch' || rawCrop === 'fill' ? rawCrop : undefined;

  if (matchedVideo) {
    type = 'video';
    const rawSpeed = parseFloat(el.getAttribute('speed') || '');
    const parsedSpeed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? Math.max(0.1, Math.min(4, rawSpeed)) : 1;
    const volEl = el.querySelector(':scope > gain') ?? el.querySelector(':scope > volume');
    const rawVolAttr = el.getAttribute('gain') ?? el.getAttribute('volume');
    const parsedVol = volEl
      ? parsePropElement(volEl, parseNum, 1).value
      : rawVolAttr != null
        ? parseFloat(rawVolAttr) || 0
        : 1;
    const isMuted = el.getAttribute('muted') === 'true' || el.getAttribute('mute') === 'true' || parsedVol <= 0.001;
    mediaData = {
      mediaId: matchedVideo.mediaId,
      src: matchedVideo.src,
      naturalWidth: matchedVideo.width || displayWidth || projW,
      naturalHeight: matchedVideo.height || displayHeight || projH,
      displayWidth,
      displayHeight,
      cropMode,
      durationMs: matchedVideo.durationMs || 4000,
      trimStartMs: parseFloat(el.getAttribute('inTime') || '0') || 0,
      playbackSpeed: parsedSpeed,
      volume: parsedVol,
      muted: isMuted,
    };
  } else if (matchedImage) {
    type = 'image';
    mediaData = {
      mediaId: matchedImage.mediaId,
      src: matchedImage.src,
      naturalWidth: matchedImage.width || displayWidth || projW,
      naturalHeight: matchedImage.height || displayHeight || projH,
      displayWidth,
      displayHeight,
      cropMode,
    };
  } else if (matchedAudio) {
    type = 'audio';
    const volEl = el.querySelector(':scope > gain') ?? el.querySelector(':scope > volume');
    const rawVolAttr = el.getAttribute('gain') ?? el.getAttribute('volume');
    const volAnim = volEl
      ? parsePropElement(volEl, parseNum, 1)
      : animatable(rawVolAttr != null ? parseFloat(rawVolAttr) || 0 : 1);
    const isMuted = el.getAttribute('muted') === 'true' || el.getAttribute('mute') === 'true';
    audioData = {
      mediaId: matchedAudio.mediaId,
      src: matchedAudio.src,
      name: matchedAudio.name,
      durationMs: matchedAudio.durationMs || 4000,
      trimStartMs: parseFloat(el.getAttribute('inTime') || '0') || 0,
      volume: volAnim,
      muted: isMuted,
    };
  }

  // Nested <scene> inside <embedScene>: always use width/height (group canvas), never stale exportWidth/exportHeight
  const nestedScene = el.querySelector(':scope > scene');
  const groupWidth = nestedScene ? parseInt(nestedScene.getAttribute('width') || '', 10) || projW : undefined;
  const groupHeight = nestedScene ? parseInt(nestedScene.getAttribute('height') || '', 10) || projH : undefined;
  const groupLayers = nestedScene
    ? Array.from(nestedScene.children)
        .filter((c) => LAYER_TAGS.has(c.tagName.toLowerCase()))
        .map((c, j) => parseXmlLayer(c, j, groupWidth!, groupHeight!, mediaMap))
    : undefined;

  const isClippingMask = el.getAttribute('clippingMask') === 'true';
  const rawBlending = el.getAttribute('blending');
  // `blending="clipping-mask"` is a 5.0.280 blend mode, not a wrapper boolean: both spellings
  // mean "this element clips". See PLAYBACK_PREVIEW_DECOMPILED.md §11.
  const resolvedBlendMode: BlendModeId = isClippingMask
    ? canonicalizeBlendMode(rawBlending) === 'exclude'
      ? 'exclude'
      : 'mask'
    : canonicalizeBlendMode(rawBlending);

  const parentId = el.getAttribute('parent') || null;
  let cameraData: Layer['cameraData'] = undefined;
  let defaultCamZ = 0;
  if (type === 'camera') {
    const camProps = parseDirectProperties(el);
    const fovEl = el.querySelector(':scope > fov');
    const fovAnim: Animatable<number> = fovEl
      ? parsePropElement(fovEl, parseNum, 60)
      : camProps.fov ?? animatable(parseFloat(el.getAttribute('fov') || '60') || 60);
    const rawCamType = (
      el.getAttribute('cameraType') ||
      el.getAttribute('type') ||
      (typeof camProps.cameraType?.value === 'string' ? camProps.cameraType.value : '')
    ).toLowerCase();
    const camType: 'perspective' | 'orthographic' =
      rawCamType === 'orthographic' ? 'orthographic' : 'perspective';
    const fogEnabled =
      el.getAttribute('fogEnabled') === 'true' || Boolean(camProps.fogEnabled?.value);
    const fogColorEl = el.querySelector(':scope > fogColor');
    const fogColor =
      fogColorEl?.getAttribute('value') ||
      (typeof camProps.fogColor?.value === 'string' ? camProps.fogColor.value : null) ||
      el.getAttribute('fogColor') ||
      '#FF0E1317';
    const fogNear =
      parseFloat(el.querySelector(':scope > fogNearZ')?.getAttribute('value') || '') ||
      (typeof camProps.fogNearZ?.value === 'number' ? camProps.fogNearZ.value : 300);
    const fogFar =
      parseFloat(el.querySelector(':scope > fogFarZ')?.getAttribute('value') || '') ||
      (typeof camProps.fogFarZ?.value === 'number' ? camProps.fogFarZ.value : 2000);
    const focusDistEl = el.querySelector(':scope > focusDistance');
    const focusDistance: Animatable<number> = focusDistEl
      ? parsePropElement(focusDistEl, parseNum, 1000)
      : camProps.focusDistance ?? animatable(1000);
    const blurEl = el.querySelector(':scope > focusBlurStrength');
    const blurStrength: Animatable<number> = blurEl
      ? parsePropElement(blurEl, parseNum, 0)
      : camProps.focusBlurStrength ?? animatable(0);
    cameraData = {
      fov: fovAnim,
      type: camType,
      active: true,
      fogEnabled,
      fogColor,
      fogNear,
      fogFar,
      focusDistance,
      blurStrength,
    };
    const initFov = fovAnim.value > 0 ? fovAnim.value : 60;
    // Matches APK CameraElementKt.makeDefaultCamera: z = -calcCameraZoom(scene, fov)
    defaultCamZ = -(Math.max(projW, projH) / (2 * Math.tan((initFov * Math.PI) / 360)));
  }
  const defaultLoc: [number, number, number] = parentId
    ? [0, 0, 0]
    : [projW / 2, projH / 2, defaultCamZ];

  return {
    id: el.getAttribute('id') || `layer_${Date.now()}_${idx}`,
    type,
    label: el.getAttribute('label') || matchedVideo?.name || matchedImage?.name || matchedAudio?.name || `${type[0].toUpperCase()}${type.slice(1)} ${idx + 1}`,
    colorIndex: idx % 8,
    startTime: parseFloat(el.getAttribute('startTime') || '0'),
    endTime: parseFloat(el.getAttribute('endTime') || '3000'),
    visible: el.getAttribute('hidden') !== 'true' && el.getAttribute('visible') !== 'false',
    locked: false,
    is3D: el.getAttribute('is3D') === 'true' || undefined,
    parentId,
    blendMode: resolvedBlendMode,
    opacity: parsePropElement(tf?.querySelector(':scope > opacity') ?? null, parseNum, 1),
    transform: {
      location: parsePropElement(tf?.querySelector(':scope > location') ?? null, parseVec3, defaultLoc),
      rotation: parsePropElement(tf?.querySelector(':scope > rotation') ?? null, parseNum, 0),
      rotationX: tf?.querySelector(':scope > rotationX')
        ? parsePropElement(tf.querySelector(':scope > rotationX'), parseNum, 0)
        : undefined,
      rotationY: tf?.querySelector(':scope > rotationY')
        ? parsePropElement(tf.querySelector(':scope > rotationY'), parseNum, 0)
        : undefined,
      scale: parsePropElement(tf?.querySelector(':scope > scale') ?? null, parseVec2, [1, 1]),
      scaleLinked: true,
      pivot: parsePropElement(tf?.querySelector(':scope > pivot') ?? null, parseVec2, [0, 0]),
      skew: animatable([0, 0]),
    },
    fill: {
      type: fillTypeAttr === 'none' ? 'none' : fillTypeAttr === 'gradient' ? 'gradient' : fillTypeAttr === 'media' ? 'media' : 'solid',
      color: fillColorAnim,
      gradientType,
      gradientStops,
      gradientStart,
      gradientEnd,
    },
    stroke,
    shadow,
    effects,
    speed: animatable(1),
    retime: (() => {
      const r = (el.getAttribute('retime') || '').trim();
      if (r === 'freeze' || r === 'loop' || r === 'stretch' || r === 'loopStretch' || r === 'blank') {
        return { method: r };
      }
      return undefined;
    })(),
    shapeId: type === 'shape' ? resolvedShapeId : undefined,
    shapeParams: type === 'shape' ? shapeParams : undefined,
    svgPathD: type === 'shape' ? svgPathD : undefined,
    freehandStrokes,
    textData:
      type === 'text'
        ? (() => {
            // AM writes text attributes on the <text> element (see
            // assets/hometab/beta_anim.xml), not on <content>. Read the layer first and
            // fall back to the child, so both dialects load.
            const textAttr = (name: string): string | null =>
              el.getAttribute(name) ?? contentEl?.getAttribute(name) ?? null;
            const rawWrap = parseFloat(textAttr('wrapWidth') || '');
            const hasExplicitWrap = Number.isFinite(rawWrap) && rawWrap > 0;
            const parsedFont = parseAmFontToken(textAttr('font'));
            const rawSize = parseFloat(textAttr('size') || '');
            // AM's default StyledText fontSize is 18.0 (= 54px at 3px/unit), not 72.
            const amSize = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 18;
            const rawAlign = (textAttr('align') || '').trim().toLowerCase();
            // APK TextElementTypeImpl.getHasFillColor = true: AM stores text color in
            // <fillColor value="..."/> (often omitting a `color` attribute on <text>).
            const textColor =
              textAttr('color') ||
              fillColorEl?.getAttribute('value') ||
              (fillColorAnim.keyframes.length > 0 ? fillColorAnim.keyframes[0].v : null) ||
              el.getAttribute('fillColor') ||
              '#FFFFFFFF';
            return {
              content: contentEl?.textContent || 'Text',
              fontFamily: parsedFont.family,
              fontWeight: parsedFont.weight,
              italic: parsedFont.style === 'italic',
              // AM paints at 3× the stored size; the renderer works in pixels.
              fontSize: Math.max(1, amTextSizeToPx(amSize)),
              color: textColor,
              align: (rawAlign === 'left' || rawAlign === 'right' || rawAlign === 'center' ? rawAlign : 'center') as
                | 'left'
                | 'center'
                | 'right',
              lineHeight: 1.2,
              letterSpacing: 0,
              wrapWidth: hasExplicitWrap ? rawWrap : projW * 0.85,
            };
          })()
        : undefined,
    mediaData,
    audioData,
    cameraData,
    groupLayers,
    groupWidth,
    groupHeight,
  };
}

function resolveImportSceneSize(scene: Element): {
  width: number;
  height: number;
  sizeSource: 'exportWidth/exportHeight' | 'width/height' | 'aspect';
  roundedToEven: boolean;
} {
  const parsePosInt = (attr: string | null) => {
    if (!attr) return 0;
    const n = parseInt(attr, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  let rawW = 0;
  let rawH = 0;
  let sizeSource: 'exportWidth/exportHeight' | 'width/height' | 'aspect' = 'width/height';

  const expW = parsePosInt(scene.getAttribute('exportWidth'));
  const expH = parsePosInt(scene.getAttribute('exportHeight'));
  const attrW = parsePosInt(scene.getAttribute('width'));
  const attrH = parsePosInt(scene.getAttribute('height'));

  if (attrW > 0 && attrH > 0) {
    // Scene width/height is the true project canvas (e.g. 1080x1350 4:5);
    // exportWidth/exportHeight often holds a stale 1920x1080 16:9 export preset.
    rawW = attrW;
    rawH = attrH;
    sizeSource = 'width/height';
  } else if (expW > 0 && expH > 0) {
    rawW = expW;
    rawH = expH;
    sizeSource = 'exportWidth/exportHeight';
  } else {
    const aspectStr = (scene.getAttribute('aspect') || '').trim();
    const m = aspectStr.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      const aw = parseFloat(m[1]);
      const ah = parseFloat(m[2]);
      if (aw > 0 && ah > 0) {
        const base = 1080;
        if (aw >= ah) {
          rawH = base;
          rawW = Math.round((base * aw) / ah);
        } else {
          rawW = base;
          rawH = Math.round((base * ah) / aw);
        }
        sizeSource = 'aspect';
      }
    }
  }

  if (rawW <= 0 || rawH <= 0) {
    throw new Error('Project size not declared in XML (missing exportWidth/exportHeight, width/height, or aspect).');
  }
  if (rawW < 16 || rawW > 8192 || rawH < 16 || rawH > 8192) {
    throw new Error(`Project size ${rawW}×${rawH} is outside allowed bounds (16..8192).`);
  }
  const ratio = rawW / rawH;
  if (ratio < 1 / 8 || ratio > 8) {
    throw new Error(`Project aspect ratio ${rawW}:${rawH} is outside allowed bounds (1:8..8:1).`);
  }

  const width = rawW % 2 === 0 ? rawW : rawW + 1;
  const height = rawH % 2 === 0 ? rawH : rawH + 1;
  return { width, height, sizeSource, roundedToEven: width !== rawW || height !== rawH };
}

export function importProjectFromAmXml(xmlText: string, mediaMap?: AmPackageMediaMap): Project {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const scene = doc.querySelector('scene');
  if (!scene) {
    throw new Error('Invalid Alight Motion XML: missing <scene> root.');
  }
  const { width, height, sizeSource, roundedToEven } = resolveImportSceneSize(scene);
  const fps = parseInt(scene.getAttribute('fps') || '30', 10) || 30;
  const durationMs = parseInt(scene.getAttribute('totalTime') || '5000', 10) || 5000;
  const bg = scene.getAttribute('bgcolor') || '#FF000000';
  const layerEls = Array.from(scene.children).filter((c) => LAYER_TAGS.has(c.tagName.toLowerCase()));
  const layers = layerEls.map((c, i) => parseXmlLayer(c, i, width, height, mediaMap));

  // Build import report metrics (no silent decisions)
  let mediaFound = 0;
  let mediaMissing = 0;
  let textWrapDefaults = 0;
  const scanReport = (list: Layer[]) => {
    for (const l of list) {
      if (l.type === 'image' || l.type === 'video') {
        if (l.mediaData?.src) mediaFound++;
        else mediaMissing++;
      } else if (l.type === 'text' && l.textData && Math.abs(l.textData.wrapWidth - width * 0.85) < 1) {
        textWrapDefaults++;
      }
      if (l.groupLayers?.length) scanReport(l.groupLayers);
    }
  };
  scanReport(layers);

  const bookmarkSet = new Set<number>();
  for (const bmEl of Array.from(scene.querySelectorAll('bookmark, marker'))) {
    // Only top-level scene bookmarks (skip nested embedScene bookmarks)
    if (bmEl.closest('scene') !== scene) continue;
    const raw = bmEl.getAttribute('t') ?? bmEl.getAttribute('time');
    if (raw == null) continue;
    const val = parseFloat(raw);
    if (Number.isFinite(val) && val >= 0) {
      bookmarkSet.add(Math.round(val));
    }
  }
  const bookmarks = Array.from(bookmarkSet).sort((a, b) => a - b);

  return {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: scene.getAttribute('title') || 'Imported XML Project',
    width,
    height,
    fps,
    durationMs: Math.max(1000, durationMs),
    bgColor: bg === '#00000000' ? 'transparent' : bg,
    layers,
    bookmarks,
    importReport: {
      width,
      height,
      sizeSource,
      roundedToEven,
      fps,
      durationMs: Math.max(1000, durationMs),
      layerCount: layers.length,
      mediaFound,
      mediaMissing,
      textWrapDefaults,
    },
    cameraEnabled: layers.some((l) => l.type === 'camera'),
    // Keep the document's own timestamp when it has one: regenerating it made every
    // export→import→export pass differ by milliseconds.
    modifiedTime: parseInt(scene.getAttribute('modifiedTime') || '', 10) || Date.now(),
  };
}
