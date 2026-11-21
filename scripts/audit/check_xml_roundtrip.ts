// Round-trip gate for the Alight Motion XML codec.
//
// What this proves: import(export(project)) carries every field the codec claims to model, and
// export(import(export(project))) is byte-identical to the first export. Before this gate the
// exporter emitted only transform, text content, camera fov and effects â€” every shape path,
// stroke, shadow, gradient, media reference and audio gain was dropped on save.
//
// Run: esbuild â†’ node, same as scripts/audit/check_blend_modes.ts.
//   node check_xml_roundtrip.mjs
// Optional argument: path to a real AM XML (e.g. the APK's assets/hometab/beta_anim.xml) for the
// same byte-stability check against a file the port did not produce.

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { exportProjectToAmXml, importProjectFromAmXml, type AmPackageMediaMap } from '../../src/engine/amXmlCodec';
import type { Animatable, Keyframe, Layer, Project } from '../../src/types/project';

const dom = new JSDOM('');
(globalThis as unknown as { DOMParser: typeof dom.window.DOMParser }).DOMParser = dom.window.DOMParser;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
}

const anim = <T,>(value: T, keyframes: Keyframe<T>[] = []): Animatable<T> => ({ value, keyframes });
const R = (v: number) => Math.round(v * 1e4) / 1e4;

function animCanon(a: Animatable<any> | undefined) {
  if (!a) return null;
  return {
    value: a.value,
    kfs: a.keyframes.map((k) => ({ t: R(k.t), v: k.v, e: k.easing?.type ?? 'linear' })),
  };
}

function makeLayer(partial: Partial<Layer> & { id: string; type: Layer['type']; label: string }): Layer {
  return {
    colorIndex: 0,
    startTime: 0,
    endTime: 2000,
    visible: true,
    locked: false,
    parentId: null,
    blendMode: 'normal',
    opacity: anim(1),
    transform: {
      location: anim<[number, number, number]>([540, 960, 0]),
      rotation: anim(0),
      scale: anim<[number, number]>([1, 1]),
      scaleLinked: true,
      pivot: anim<[number, number]>([0, 0]),
      skew: anim<[number, number]>([0, 0]),
    },
    fill: {
      type: 'solid',
      color: anim('#FFFFFFFF'),
      gradientType: 'linear',
      gradientStops: [
        { offset: 0, color: '#FFFFFFFF' },
        { offset: 1, color: '#FF000000' },
      ],
      gradientStart: [-0.5, -0.5],
      gradientEnd: [0.5, 0.5],
    },
    stroke: {
      enabled: false,
      color: anim('#FFFFFFFF'),
      width: anim(4),
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
      color: anim('#88000000'),
      alpha: anim(0.6),
      size: anim(12),
      offsetX: anim(6),
      offsetY: anim(6),
    },
    effects: [],
    speed: anim(1),
    ...partial,
  } as Layer;
}

const MEDIA_MAP: AmPackageMediaMap = new Map([
  [
    'media_img_1',
    { mediaId: 'media_img_1', src: 'blob:fixture/img', mime: 'image/png', name: 'img.png', width: 1920, height: 1080 },
  ],
  [
    'media_vid_1',
    { mediaId: 'media_vid_1', src: 'blob:fixture/vid', mime: 'video/mp4', name: 'vid.mp4', width: 1280, height: 720, durationMs: 6000 },
  ],
  [
    'media_aud_1',
    { mediaId: 'media_aud_1', src: 'blob:fixture/aud', mime: 'audio/mpeg', name: 'aud.mp3', durationMs: 8000 },
  ],
]);

// Expected SVG path for the vector fixture below: two cubic segments, closed.
const VECTOR_D = 'M 0 0 C 10 0 90 50 100 50 C 100 60 0 0 0 0 Z';

const shapeLayer = makeLayer({
  id: 'shape-1',
  type: 'shape',
  label: 'Round rect',
  blendMode: 'com.alightcreative.blend.colormultiply',
  opacity: anim(0.8),
  fill: {
    type: 'gradient',
    color: anim('#FF112233'),
    gradientType: 'radial',
    gradientStops: [
      { offset: 0, color: '#FFFF0000' },
      { offset: 0.5, color: '#FF00FF00' },
      { offset: 1, color: '#FF0000FF' },
    ],
    gradientStart: [-0.4, 0.2],
    gradientEnd: [0.6, -0.1],
  },
  stroke: {
    enabled: true,
    color: anim('#FF00FFFF'),
    width: anim(6),
    position: 'outside',
    cap: 'round',
    join: 'round',
    dash: false,
    dashLength: 16,
    dashGap: 10,
    dashOffset: 0,
  },
  shadow: {
    enabled: true,
    color: anim('#88000000'),
    alpha: anim(0.45),
    size: anim(14),
    offsetX: anim(5),
    offsetY: anim(-7),
  },
  shapeId: 'com.alightcreative.shapes.roundrect',
  shapeParams: { size: anim<[number, number]>([120, 80]), radius: anim(12) },
  effects: [
    {
      uid: 'fx-1',
      effectId: 'com.alightcreative.effects.motionblur',
      enabled: true,
      locallyApplied: false,
      params: {
        amount: anim(50, [
          { t: 0, v: 0, easing: { type: 'cubicBezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
          { t: 0.5, v: 100 },
        ]),
      },
    },
  ],
});

const maskLayer = makeLayer({ id: 'mask-1', type: 'shape', label: 'Matte', blendMode: 'mask' });
const clippedLayer = makeLayer({
  id: 'clipped-1',
  type: 'video',
  label: 'Clipped clip',
  clippedToMask: true,
  mediaData: {
    mediaId: 'media_vid_1',
    src: 'blob:fixture/vid',
    naturalWidth: 1280,
    naturalHeight: 720,
    durationMs: 6000,
  },
});
const excludeLayer = makeLayer({ id: 'exclude-1', type: 'shape', label: 'Exclude', blendMode: 'exclude' });

const hidden3D = makeLayer({
  id: 'null-1',
  type: 'null',
  label: 'Hidden 3D null',
  visible: false,
  is3D: true,
  parentId: 'group-1',
  retime: { method: 'loop' },
  transform: {
    location: anim<[number, number, number]>([100, 200, 30]),
    rotation: anim(15),
    rotationX: anim(10),
    rotationY: anim(-12),
    scale: anim<[number, number]>([1.5, 1.5]),
    scaleLinked: true,
    pivot: anim<[number, number]>([10, -10]),
    skew: anim<[number, number]>([0, 0]),
  },
});

const textLayer = makeLayer({
  id: 'text-1',
  type: 'text',
  label: 'Title text',
  endTime: 3000,
  textData: {
    content: 'Hello <AM> & "friends"',
    fontFamily: 'Inter',
    fontSize: 54,
    fontWeight: 700,
    italic: false,
    color: '#FFEEAA92',
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    wrapWidth: 800,
  },
});

const imageLayer = makeLayer({
  id: 'image-1',
  type: 'image',
  label: 'Still',
  mediaData: {
    mediaId: 'media_img_1',
    src: 'blob:fixture/img',
    naturalWidth: 1920,
    naturalHeight: 1080,
    displayWidth: 640,
    displayHeight: 360,
    cropMode: 'fit',
    durationMs: 4000,
  },
});

const videoLayer = makeLayer({
  id: 'video-1',
  type: 'video',
  label: 'Clip',
  endTime: 5000,
  mediaData: {
    mediaId: 'media_vid_1',
    src: 'blob:fixture/vid',
    naturalWidth: 1280,
    naturalHeight: 720,
    durationMs: 6000,
    trimStartMs: 250,
    playbackSpeed: 1.5,
    volume: 0.5,
    muted: false,
  },
});

const audioLayer = makeLayer({
  id: 'audio-1',
  type: 'audio',
  label: 'Track',
  endTime: 8000,
  audioData: {
    mediaId: 'media_aud_1',
    src: 'blob:fixture/aud',
    name: 'aud.mp3',
    durationMs: 8000,
    trimStartMs: 100,
    volume: anim(0.7),
    muted: true,
  },
});

const cameraLayer = makeLayer({
  id: 'camera-1',
  type: 'camera',
  label: 'Camera',
  endTime: 4000,
  cameraData: {
    fov: anim(50),
    type: 'orthographic',
    active: true,
    fogEnabled: true,
    fogColor: '#FF102030',
    fogNear: 250,
    fogFar: 1800,
    focusDistance: anim(750),
    blurStrength: anim(12),
  },
});

const vectorLayer = makeLayer({
  id: 'vector-1',
  type: 'vector',
  label: 'Pen path',
  vectorPath: {
    points: [
      { x: 0, y: 0, inX: 0, inY: 0, outX: 10, outY: 0 },
      { x: 100, y: 50, inX: -10, inY: 0, outX: 0, outY: 10 },
    ],
    closed: true,
  },
});

const freehandLayer = makeLayer({
  id: 'freehand-1',
  type: 'freehand',
  label: 'Scribble',
  freehandStrokes: [
    {
      points: [
        { x: 0, y: 0, pressure: 1 },
        { x: 20, y: 30, pressure: 0.8 },
        { x: 40, y: 10, pressure: 0.6 },
      ],
      color: '#FF00FF00',
      width: 12,
      opacity: 0.9,
    },
  ],
});

const childA = makeLayer({ id: 'group-child-1', type: 'shape', label: 'Inner A', startTime: 0, endTime: 1000 });
const childB = makeLayer({ id: 'group-child-2', type: 'shape', label: 'Inner B', startTime: 500, endTime: 1500 });
const groupLayer = makeLayer({
  id: 'group-1',
  type: 'group',
  label: 'Group',
  groupWidth: 640,
  groupHeight: 480,
  groupLayers: [childA, childB],
});

const FIXTURE: Project = {
  id: 'proj-fixture',
  title: 'Round trip <fixture>',
  width: 1080,
  height: 1920,
  fps: 60,
  durationMs: 4000,
  bgColor: '#FF101820',
  layers: [
    shapeLayer,
    maskLayer,
    clippedLayer,
    excludeLayer,
    hidden3D,
    textLayer,
    imageLayer,
    videoLayer,
    audioLayer,
    cameraLayer,
    vectorLayer,
    freehandLayer,
    groupLayer,
  ],
  bookmarks: [500, 1500],
  cameraEnabled: true,
  modifiedTime: 1730000000000,
};

function canon(layer: Layer): any {
  const isVector = layer.type === 'vector' && !!layer.vectorPath;
  const px = layer.type === 'shape' || isVector ? null : null;
  void px;
  const hasPath = isVector || !!layer.svgPathD;
  // `<shape>` with no explicit `s` is AM's default rectangle, and the importer materialises that
  // default. Comparing "absent" against "rect" would flag a difference the format cannot express.
  const isDefaultShape = !hasPath && (!layer.shapeId || layer.shapeId === 'com.alightcreative.shapes.rect');
  const rotationX = layer.transform.rotationX;
  const rotationY = layer.transform.rotationY;
  return {
    id: layer.id,
    type: isVector ? 'shape' : layer.type,
    label: layer.label,
    startTime: layer.startTime,
    endTime: layer.endTime,
    visible: layer.visible,
    is3D: layer.is3D ?? false,
    clippedToMask: layer.clippedToMask ?? false,
    parentId: layer.parentId,
    blendMode: layer.blendMode,
    retime: layer.retime?.method ?? 'none',
    opacity: animCanon(layer.opacity),
    transform: {
      location: animCanon(layer.transform.location),
      rotation: animCanon(layer.transform.rotation),
      scale: animCanon(layer.transform.scale),
      pivot: animCanon(layer.transform.pivot),
      rotationX: rotationX && (rotationX.value !== 0 || rotationX.keyframes.length > 0) ? animCanon(rotationX) : null,
      rotationY: rotationY && (rotationY.value !== 0 || rotationY.keyframes.length > 0) ? animCanon(rotationY) : null,
    },
    fill: {
      type: layer.fill.type,
      color: animCanon(layer.fill.color),
      gradientType: layer.fill.type === 'gradient' ? layer.fill.gradientType : null,
      stops:
        layer.fill.type === 'gradient'
          ? layer.fill.gradientStops.map((s) => ({ offset: R(s.offset), color: s.color.toLowerCase() }))
          : null,
      start: layer.fill.type === 'gradient' ? layer.fill.gradientStart.map(R) : null,
      end: layer.fill.type === 'gradient' ? layer.fill.gradientEnd.map(R) : null,
    },
    stroke:
      layer.stroke.enabled && layer.type !== 'freehand'
        ? {
            enabled: true,
            color: animCanon(layer.stroke.color),
            width: animCanon(layer.stroke.width),
            position: layer.stroke.position,
          }
        : { enabled: false },
    shadow: layer.shadow.enabled
      ? {
          enabled: true,
          color: animCanon(layer.shadow.color),
          alpha: animCanon(layer.shadow.alpha),
          size: animCanon(layer.shadow.size),
          offsetX: animCanon(layer.shadow.offsetX),
          offsetY: animCanon(layer.shadow.offsetY),
        }
      : { enabled: false },
    effects: layer.effects.map((e) => ({ effectId: e.effectId, enabled: e.enabled, locallyApplied: !!e.locallyApplied })),
    text: layer.textData
      ? {
          content: layer.textData.content,
          fontFamily: layer.textData.fontFamily,
          fontWeight: Number(layer.textData.fontWeight ?? 400),
          italic: !!layer.textData.italic,
          color: layer.textData.color,
          align: layer.textData.align,
          wrapWidth: R(layer.textData.wrapWidth),
          fontSize: R(layer.textData.fontSize),
        }
      : null,
    media: layer.mediaData
      ? {
          mediaId: layer.mediaData.mediaId ?? null,
          src: layer.mediaData.src,
          naturalWidth: R(layer.mediaData.naturalWidth),
          naturalHeight: R(layer.mediaData.naturalHeight),
          displayWidth: layer.mediaData.displayWidth != null ? R(layer.mediaData.displayWidth) : null,
          displayHeight: layer.mediaData.displayHeight != null ? R(layer.mediaData.displayHeight) : null,
          cropMode: layer.mediaData.cropMode ?? null,
          trimStartMs: R(layer.mediaData.trimStartMs ?? 0),
          playbackSpeed: R(layer.mediaData.playbackSpeed ?? 1),
          volume: R(layer.mediaData.volume ?? 1),
          muted: !!layer.mediaData.muted,
        }
      : null,
    audio: layer.audioData
      ? {
          mediaId: layer.audioData.mediaId ?? null,
          src: layer.audioData.src,
          volume: animCanon(layer.audioData.volume),
          muted: layer.audioData.muted,
          trimStartMs: R(layer.audioData.trimStartMs ?? 0),
        }
      : null,
    camera: layer.cameraData
      ? {
          fov: animCanon(layer.cameraData.fov),
          type: layer.cameraData.type ?? 'perspective',
          fogEnabled: layer.cameraData.fogEnabled,
          fogColor: layer.cameraData.fogColor,
          fogNear: R(layer.cameraData.fogNear),
          fogFar: R(layer.cameraData.fogFar),
          focusDistance: animCanon(layer.cameraData.focusDistance),
          blurStrength: animCanon(layer.cameraData.blurStrength),
        }
      : null,
    shapeId: hasPath || isDefaultShape ? null : (layer.shapeId ?? null),
    shapeParams:
      hasPath || isDefaultShape || !layer.shapeParams
        ? null
        : Object.fromEntries(Object.entries(layer.shapeParams).map(([k, v]) => [k, animCanon(v)])),
    svgPathD: isVector ? VECTOR_D : (layer.svgPathD ?? null),
    freehand: layer.freehandStrokes
      ? layer.freehandStrokes.map((s) => ({
          points: s.points.map((p) => ({ x: R(p.x), y: R(p.y), pressure: R(p.pressure) })),
          color: s.color,
          width: R(s.width),
          opacity: R(s.opacity),
        }))
      : null,
    group:
      layer.groupLayers != null
        ? {
            width: R(layer.groupWidth ?? 0),
            height: R(layer.groupHeight ?? 0),
            children: layer.groupLayers.map(canon),
          }
        : null,
  };
}

function canonProject(p: Project) {
  return {
    title: p.title,
    width: p.width,
    height: p.height,
    fps: p.fps,
    durationMs: p.durationMs,
    bgColor: p.bgColor,
    bookmarks: p.bookmarks,
    layers: p.layers.map(canon),
  };
}

function diffPath(a: any, b: any, path = ''): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path || '<root>'}: type ${typeof a} vs ${typeof b}`;
  if (a === null || b === null) return `${path || '<root>'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (typeof a !== 'object') return `${path || '<root>'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path || '<root>'}: array mismatch`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diffPath(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = diffPath(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}

console.log('fixture round trip');
const xml1 = exportProjectToAmXml(FIXTURE);
const imported1 = importProjectFromAmXml(xml1, MEDIA_MAP);
const d1 = diffPath(canonProject(FIXTURE), canonProject(imported1));
check('every modelled field survives import(export(x))', d1 === null, d1 ?? undefined);

console.log('export stability');
const xml2 = exportProjectToAmXml(imported1);
const imported2 = importProjectFromAmXml(xml2, MEDIA_MAP);
const xml3 = exportProjectToAmXml(imported2);
// One settle pass is expected: importing an effect fills that effect's declared default params,
// so the second export carries them. From there the document must stop moving.
check('export settles after one normalisation pass', xml2 === xml3, `len ${xml2.length} vs ${xml3.length}`);
const d2 = diffPath(canonProject(imported1), canonProject(imported2));
check('second import equals the first', d2 === null, d2 ?? undefined);

console.log('dialect assertions');
check('shape id is written short-form', xml1.includes('s=".roundrect"'), xml1.match(/<shape[^>]*s="[^"]*"/)?.[0]);
check('shape params are written as properties', xml1.includes('<property name="radius" type="float" value="12.000000"/>'));
check('gradient keeps type and stop colours', xml1.includes('<gradient type="radial" startColor="#FFFF0000" midColor="#FF00FF00" endColor="#FF0000FF"'));
check('gradient handles stay inside 0..1 page space', xml1.includes('start="0.300000,0.600000"'), xml1.match(/<gradient[^>]*start="[^"]*"/)?.[0]);
check('stroke exports as AM path-stroke with direction, cap and join', xml1.includes('<path-stroke direction="outside" cap="round" join="round" end-size="0">'), xml1.match(/<path-stroke[^>]*>/)?.[0]);
check('stroke children stay keyable', xml1.includes('<size value="6.000000"/>'));
check('shadow exports its alpha as opacity', xml1.includes('<opacity value="0.450000"/>'), xml1.match(/<shadow[^>]*>[\s\S]{0,200}/)?.[0]);
check('shadow offset is a keyable child, never an attribute', xml1.includes('<offset value="5.000000,-7.000000"/>'));
// AM keeps the two mask concepts on separate attributes: the clipper carries blending="mask", and
// the layer being clipped carries clippingMask="true" with no blending at all. Conflating them made
// the clipped video render as a mask and the clipper's rectangle show through (shared project
// i1MwzBcB9D). See PARITY_SWEEP_5.0.280.md Â§9.
check('clipper writes blending="mask"', xml1.includes('blending="mask"'), xml1.match(/blending="mask"[^>]*/)?.[0]);
check('clipper does not carry the clippingMask flag', !/<shape[^>]*clippingMask="true"[^>]*blending="mask"/.test(xml1));
check('clipped layer writes clippingMask="true" without a blend mode', /<video[^>]*clippingMask="true"[^>]*>/.test(xml1), xml1.match(/<video[^>]*>/)?.[0]);
check('exclude exports as clippingMask plus blending="exclude"', /clippingMask="true"[^>]*blending="exclude"/.test(xml1));
check('blend id is hyphenated XML, not the effect id', xml1.includes('blending="multiply"'), xml1.match(/blending="[^"]*"/g)?.slice(0, 4));
check('hidden layer keeps hidden="true"', xml1.includes('hidden="true"'));
// TextElementTypeImpl.serialize writes exactly size, font, wrapWidth, align and <content>.
// StyledText has no lineSpacing/letterSpacing field at all, so the exporter must not invent
// one; text spacing in AM is the text-spacing effect's letterspacing/linespacing params.
check(
  'text element writes only AM\'s five fields',
  xml1.includes('<text ') &&
    !/lineHeight|letterSpacing|lineSpacing/.test(xml1) &&
    xml1.includes('<content>') &&
    /<text [^>]*size="/.test(xml1)
);
check('retime method survives', xml1.includes('retime="loop"'));
check('crop mode survives', xml1.includes('cropMode="fit"'));
check('3D flag survives', xml1.includes('is3D="true"'));
check('image src is a stable reference', xml1.includes('src="media_img_1"'));
check('video speed and trim survive', xml1.includes('speed="1.5"') && xml1.includes('inTime="250"'));
check('audio gain and mute survive', xml1.includes('<gain value="0.700000"/>') && xml1.includes('muted="true"'));
check('camera fog and focus survive', xml1.includes('fogEnabled="true"') && xml1.includes('<fogNearZ value="250"/>') && xml1.includes('<focusBlurStrength value="12.000000"/>'));
check('freehand exports as <drawing> with points', xml1.includes('<drawing') && xml1.includes('points="0.0000,0.0000,1.0000;'));
check('vector path exports as SVG d', xml1.includes(`<path d="${VECTOR_D}"/>`), VECTOR_D);
check('nested scene carries its own size and fps', xml1.includes('<scene title="" width="640" height="480" bgcolor="#00000000" fps="60"'));
check('keyframed effect param is written and re-read', /<property name="amount" type="float">\s*<kf t="0\.000000" v="0\.000000" e="cubicBezier 0\.420000 0\.000000 0\.580000 1\.000000"\/>/.test(xml1));

const effectAfter = imported1.layers.find((l) => l.id === 'shape-1')?.effects[0];
// `value` mirrors the first keyframe by design, so the animated 50 lives in the keyframe list.
check('effect keyframe value survives', effectAfter?.params.amount?.keyframes[1]?.v === 100, effectAfter?.params.amount?.keyframes);
check('effect keyframe easing survives', effectAfter?.params.amount?.keyframes[0]?.easing?.x1 === 0.42, effectAfter?.params.amount?.keyframes[0]?.easing);

const samplePath = process.argv[2];
if (samplePath) {
  console.log(`real AM sample: ${samplePath}`);
  const raw = readFileSync(samplePath, 'utf8');
  const p1 = importProjectFromAmXml(raw);
  const out1 = exportProjectToAmXml(p1);
  const p2 = importProjectFromAmXml(out1);
  const out2 = exportProjectToAmXml(p2);
  check('sample: export is byte-stable on the second pass', out1 === out2, `len ${out1.length} vs ${out2.length}`);
  const dp = diffPath(canonProject(p1), canonProject(p2));
  check('sample: second import equals the first', dp === null, dp ?? undefined);
  check('sample: gradients survive', out1.includes('<gradient '));
  check('sample: nested scene survives', out1.includes('<embedScene') && out1.includes('<scene '));
  check('sample: text content survives', out1.includes('<content>BETA</content>'));
  check('sample: paths survive', out1.includes('<path d="M '));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
