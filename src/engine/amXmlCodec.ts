import type {
  Animatable,
  BlendModeId,
  EasingSpec,
  Keyframe,
  Layer,
  LayerEffectInstance,
  Project,
} from '../types/project';
import { animatable, parseEasingString } from './animation';
import { getEffectById } from './catalog';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatEasingAttr(e?: EasingSpec): string {
  if (!e || e.type === 'linear') return '';
  if (e.type === 'cubicBezier') {
    return ` e="cubicBezier ${e.x1.toFixed(6)} ${e.y1.toFixed(6)} ${e.x2.toFixed(6)} ${e.y2.toFixed(6)}"`;
  }
  return ` e="${e.type}"`;
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
    parts.push(`${indent}  <effect id="${escapeXml(eff.effectId)}" locallyApplied="${eff.locallyApplied ? 'true' : 'false'}" enabled="${eff.enabled ? 'true' : 'false'}">`);
    for (const [pname, pval] of Object.entries(eff.params)) {
      const ptype = Array.isArray(pval.value)
        ? pval.value.length === 2
          ? 'vec2'
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
    parts.push(`${indent}  <scene width="1080" height="1080" fps="30" totalTime="${Math.round(layer.endTime - layer.startTime)}">`);
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

const parseNum = (s: string) => parseFloat(s) || 0;
const parseVec2 = (s: string): [number, number] => {
  const a = s.split(',').map((x) => parseFloat(x.trim()) || 0);
  return [a[0] ?? 0, a[1] ?? 0];
};
const parseVec3 = (s: string): [number, number, number] => {
  const a = s.split(',').map((x) => parseFloat(x.trim()) || 0);
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
};

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
        if (pd.id && pd.default !== undefined) {
          params[pd.id] = animatable(
            pd.tag === 'point'
              ? parseVec2(pd.default)
              : pd.tag === 'xyz' || pd.tag === 'hue-disc' || pd.tag === 'orient'
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
    for (const propEl of Array.from(effEl.querySelectorAll(':scope > property'))) {
      const pname = propEl.getAttribute('name');
      const ptype = propEl.getAttribute('type') || 'float';
      if (!pname) continue;
      const parser = (raw: string) => {
        if (ptype === 'vec2') return parseVec2(raw);
        if (ptype === 'vec3') return parseVec3(raw);
        if (ptype === 'int') return parseInt(raw, 10) || 0;
        if (ptype === 'bool') return raw === 'true' || raw === '1';
        if (ptype === 'color') return raw;
        return parseFloat(raw) || 0;
      };
      params[pname] = parsePropElement(propEl, parser, parser('0'));
    }
    effects.push({
      uid: `eff_${Math.random().toString(36).slice(2, 10)}`,
      effectId: eid,
      enabled: effEl.getAttribute('enabled') !== 'false',
      locallyApplied: effEl.getAttribute('locallyApplied') === 'true',
      params,
    });
  }

  const contentEl = el.querySelector(':scope > content');
  const fillTypeAttr = el.getAttribute('fillType');
  const fillColorAttr = el.getAttribute('fillColor') || '#FF69FC97';

  // Resolve bundled .amproj media references (fillVideo / fillImage / src / uri)
  const fillVideoRef = el.getAttribute('fillVideo');
  const fillImageRef = el.getAttribute('fillImage');
  const directSrcRef = el.getAttribute('src') ?? el.getAttribute('uri');
  const matchedVideo = lookupMediaAsset(fillVideoRef || (type === 'video' ? directSrcRef : null), mediaMap);
  const matchedImage = lookupMediaAsset(fillImageRef || (type === 'image' ? directSrcRef : null), mediaMap);
  const matchedAudio = lookupMediaAsset(type === 'audio' ? directSrcRef : null, mediaMap);

  let mediaData: Layer['mediaData'];
  let audioData: Layer['audioData'];

  if (matchedVideo) {
    type = 'video';
    mediaData = {
      mediaId: matchedVideo.mediaId,
      src: matchedVideo.src,
      naturalWidth: matchedVideo.width || projW,
      naturalHeight: matchedVideo.height || projH,
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
      naturalWidth: matchedImage.width || projW,
      naturalHeight: matchedImage.height || projH,
    };
  } else if (matchedAudio) {
    type = 'audio';
    audioData = {
      mediaId: matchedAudio.mediaId,
      src: matchedAudio.src,
      name: matchedAudio.name,
      durationMs: matchedAudio.durationMs || 4000,
      volume: animatable(1),
      muted: false,
    };
  }

  const nestedScene = el.querySelector(':scope > scene');
  const groupLayers = nestedScene
    ? Array.from(nestedScene.children)
        .filter((c) => ['shape', 'text', 'image', 'video', 'audio', 'nullobj', 'camera', 'embedscene'].includes(c.tagName.toLowerCase()))
        .map((c, j) => parseXmlLayer(c, j, projW, projH, mediaMap))
    : undefined;

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
    blendMode: (el.getAttribute('blending') as BlendModeId) || 'normal',
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
      type: fillTypeAttr === 'none' ? 'none' : fillTypeAttr === 'gradient' ? 'gradient' : 'solid',
      color: animatable(fillColorAttr),
      gradientType: 'linear',
      gradientStops: [
        { offset: 0, color: '#FF69FC97' },
        { offset: 1, color: '#FF5CE5FF' },
      ],
      gradientStart: [-0.5, -0.5],
      gradientEnd: [0.5, 0.5],
    },
    stroke: {
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
    },
    shadow: {
      enabled: false,
      color: animatable('#88000000'),
      alpha: animatable(0.6),
      size: animatable(12),
      offsetX: animatable(6),
      offsetY: animatable(6),
    },
    effects,
    speed: animatable(1),
    shapeId: type === 'shape' ? 'com.alightcreative.shapes.rect' : undefined,
    shapeParams:
      type === 'shape'
        ? {
            size: animatable([150, 150] as [number, number]),
          }
        : undefined,
    textData:
      type === 'text'
        ? {
            content: contentEl?.textContent || 'Text',
            fontFamily: contentEl?.getAttribute('font') || 'SpaceGrotesk-Bold',
            fontSize: parseFloat(contentEl?.getAttribute('size') || '72') || 72,
            color: contentEl?.getAttribute('color') || '#FFFFFFFF',
            align: (contentEl?.getAttribute('align') as 'left' | 'center' | 'right') || 'center',
            lineHeight: 1.2,
            letterSpacing: 0,
            wrapWidth: projW * 0.85,
          }
        : undefined,
    mediaData,
    audioData,
    groupLayers,
  };
}

export function importProjectFromAmXml(xmlText: string, mediaMap?: AmPackageMediaMap): Project {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const scene = doc.querySelector('scene');
  if (!scene) {
    throw new Error('Invalid Alight Motion XML: missing <scene> root.');
  }
  const width = parseInt(scene.getAttribute('width') || '1080', 10) || 1080;
  const height = parseInt(scene.getAttribute('height') || '1080', 10) || 1080;
  const fps = parseInt(scene.getAttribute('fps') || '30', 10) || 30;
  const durationMs = parseInt(scene.getAttribute('totalTime') || '5000', 10) || 5000;
  const bg = scene.getAttribute('bgcolor') || '#FF000000';
  const layers = Array.from(scene.children)
    .filter((c) => ['shape', 'text', 'image', 'video', 'audio', 'nullobj', 'camera', 'embedscene'].includes(c.tagName.toLowerCase()))
    .map((c, i) => parseXmlLayer(c, i, width, height, mediaMap));

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
    cameraEnabled: layers.some((l) => l.type === 'camera'),
    modifiedTime: Date.now(),
  };
}
