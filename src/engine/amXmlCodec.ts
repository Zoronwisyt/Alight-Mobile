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
import { getEffectById, getShapeById, parseDefaultParamValue } from './catalog';

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

function layerToXml(layer: Layer, indent = '  '): string {
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
    freehand: 'shape',
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
  const blendAttr = layer.blendMode !== 'normal' ? ` blending="${escapeXml(layer.blendMode)}"` : '';

  const parts: string[] = [];
  parts.push(
    `${indent}<${tag} id="${escapeXml(layer.id)}" label="${escapeXml(layer.label)}" startTime="${Math.round(layer.startTime)}" endTime="${Math.round(layer.endTime)}"${fillAttr}${parentAttr}${blendAttr}>`
  );

  parts.push(`${indent}  <transform>`);
  parts.push(`${indent}    ${emitAnimProp('location', layer.transform.location)}`);
  parts.push(`${indent}    ${emitAnimProp('rotation', layer.transform.rotation)}`);
  parts.push(`${indent}    ${emitAnimProp('scale', layer.transform.scale)}`);
  parts.push(`${indent}    ${emitAnimProp('pivot', layer.transform.pivot)}`);
  parts.push(`${indent}    ${emitAnimProp('opacity', layer.opacity)}`);
  parts.push(`${indent}  </transform>`);

  if (layer.type === 'text' && layer.textData) {
    parts.push(
      `${indent}  <content font="${escapeXml(layer.textData.fontFamily)}" size="${layer.textData.fontSize}" align="${layer.textData.align}" color="${escapeXml(layer.textData.color)}">${escapeXml(layer.textData.content)}</content>`
    );
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
    parts.push(`${indent}  <scene width="${gw}" height="${gh}" fps="30" totalTime="${Math.round(layer.endTime - layer.startTime)}">`);
    for (const sub of layer.groupLayers) {
      parts.push(layerToXml(sub, indent + '    '));
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
    lines.push(layerToXml(layer, '  '));
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

  if (matchedVideo) {
    type = 'video';
    mediaData = {
      mediaId: matchedVideo.mediaId,
      src: matchedVideo.src,
      naturalWidth: matchedVideo.width || displayWidth || projW,
      naturalHeight: matchedVideo.height || displayHeight || projH,
      displayWidth,
      displayHeight,
      durationMs: matchedVideo.durationMs || 4000,
      trimStartMs: parseFloat(el.getAttribute('inTime') || '0') || 0,
      playbackSpeed: 1,
      volume: 1,
      muted: false,
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
    };
  } else if (matchedAudio) {
    type = 'audio';
    audioData = {
      mediaId: matchedAudio.mediaId,
      src: matchedAudio.src,
      name: matchedAudio.name,
      durationMs: matchedAudio.durationMs || 4000,
      trimStartMs: parseFloat(el.getAttribute('inTime') || '0') || 0,
      volume: animatable(1),
      muted: false,
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
  const rawBlending = (el.getAttribute('blending') as BlendModeId) || 'normal';
  const resolvedBlendMode: BlendModeId =
    isClippingMask && rawBlending !== 'exclude' ? 'mask' : rawBlending;

  return {
    id: el.getAttribute('id') || `layer_${Date.now()}_${idx}`,
    type,
    label: el.getAttribute('label') || matchedVideo?.name || matchedImage?.name || matchedAudio?.name || `${type[0].toUpperCase()}${type.slice(1)} ${idx + 1}`,
    colorIndex: idx % 8,
    startTime: parseFloat(el.getAttribute('startTime') || '0'),
    endTime: parseFloat(el.getAttribute('endTime') || '3000'),
    visible: el.getAttribute('hidden') !== 'true' && el.getAttribute('visible') !== 'false',
    locked: false,
    parentId: el.getAttribute('parent') || null,
    blendMode: resolvedBlendMode,
    opacity: parsePropElement(tf?.querySelector(':scope > opacity') ?? null, parseNum, 1),
    transform: {
      location: parsePropElement(tf?.querySelector(':scope > location') ?? null, parseVec3, [projW / 2, projH / 2, 0]),
      rotation: parsePropElement(tf?.querySelector(':scope > rotation') ?? null, parseNum, 0),
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
    shapeId: type === 'shape' ? resolvedShapeId : undefined,
    shapeParams: type === 'shape' ? shapeParams : undefined,
    svgPathD: type === 'shape' ? svgPathD : undefined,
    freehandStrokes,
    textData:
      type === 'text'
        ? (() => {
            const rawWrap = parseFloat(contentEl?.getAttribute('wrapWidth') || el.getAttribute('wrapWidth') || '');
            const hasExplicitWrap = Number.isFinite(rawWrap) && rawWrap > 0;
            return {
              content: contentEl?.textContent || 'Text',
              fontFamily: contentEl?.getAttribute('font') || 'SpaceGrotesk-Bold',
              fontSize: parseFloat(contentEl?.getAttribute('size') || '72') || 72,
              color: contentEl?.getAttribute('color') || '#FFFFFFFF',
              align: (contentEl?.getAttribute('align') as 'left' | 'center' | 'right') || 'center',
              lineHeight: 1.2,
              letterSpacing: 0,
              wrapWidth: hasExplicitWrap ? rawWrap : projW * 0.85,
            };
          })()
        : undefined,
    mediaData,
    audioData,
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
    modifiedTime: Date.now(),
  };
}
