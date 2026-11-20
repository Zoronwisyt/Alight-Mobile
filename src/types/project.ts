export type EasingType =
  | 'linear'
  | 'cubicBezier'
  | 'steps'
  | 'step'
  | 'overshoot'
  | 'bounce'
  | 'elastic'
  | 'elasticStep'
  | 'cyclic'
  | 'random';

export interface EasingSpec {
  type: EasingType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  steps?: number;
  /** Raw numeric tail as written by AM, preserved verbatim for lossless round-trip export. */
  params?: number[];
  /** Original AM easing token string. */
  token?: string;
  /** True when the token is recognized/preserved but uses an approximation rather than exact APK bytecode. */
  approximated?: boolean;
}

export interface Keyframe<T = any> {
  /** Normalized time 0..1 relative to layer [startTime, endTime] */
  t: number;
  v: T;
  easing?: EasingSpec;
}

export interface WaveGenerator {
  kind: 'sine' | 'sineMult' | 'triangle' | 'random';
  amplitude: number;
  frequency: number;
  phase: number;
}

export interface Animatable<T = any> {
  value: T;
  keyframes: Keyframe<T>[];
  /** B2: Optional wave/oscillator property generator evaluated on top of base value */
  generator?: WaveGenerator;
}

export type LayerType =
  | 'shape'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'null'
  | 'camera'
  | 'group'
  | 'vector'
  | 'freehand';

/**
 * APK 5.0.280 `com.alightcreative.app.motion.scene.BlendingMode` carries 29 enum constants
 * (see PLAYBACK_PREVIEW_DECOMPILED.md §10). `mask` and `clipping-mask` are blend modes in their
 * own right, independent of the `clippingMask` element boolean.
 *
 * Effect ids are NOT the CSS spelling: `multiply` -> `colormultiply`, `diff` (not `difference`),
 * `luminance` (not `luminosity`), `soft-overlay` -> `softoverlay`.
 */
export type BlendModeId =
  | 'normal'
  | 'mask'
  | 'clipping-mask'
  | 'exclude'
  | 'com.alightcreative.blend.colormultiply'
  | 'com.alightcreative.blend.screen'
  | 'com.alightcreative.blend.diff'
  | 'com.alightcreative.blend.exclusion'
  | 'com.alightcreative.blend.lighten'
  | 'com.alightcreative.blend.darken'
  | 'com.alightcreative.blend.lightercolor'
  | 'com.alightcreative.blend.darkercolor'
  | 'com.alightcreative.blend.colorburn'
  | 'com.alightcreative.blend.linearburn'
  | 'com.alightcreative.blend.colordodge'
  | 'com.alightcreative.blend.lineardodge'
  | 'com.alightcreative.blend.overlay'
  | 'com.alightcreative.blend.softlight'
  | 'com.alightcreative.blend.hardlight'
  | 'com.alightcreative.blend.softoverlay'
  | 'com.alightcreative.blend.vividlight'
  | 'com.alightcreative.blend.linearlight'
  | 'com.alightcreative.blend.pinlight'
  | 'com.alightcreative.blend.hue'
  | 'com.alightcreative.blend.saturation'
  | 'com.alightcreative.blend.color'
  | 'com.alightcreative.blend.luminance'
  | 'com.alightcreative.blend.subtract'
  | 'com.alightcreative.blend.divide'
  // Legacy spellings emitted by web builds before the 5.0.280 blend audit. Import-only:
  // normalised away on load, never written back out.
  | 'com.alightcreative.blend.multiply'
  | 'com.alightcreative.blend.difference'
  | 'com.alightcreative.blend.luminosity';

export interface LayerTransform {
  location: Animatable<[number, number, number]>;
  rotation: Animatable<number>;
  scale: Animatable<[number, number]>;
  scaleLinked: boolean;
  pivot: Animatable<[number, number]>;
  skew: Animatable<[number, number]>;
  /** 3D orientation Euler [x, y, z] in degrees */
  orientation?: Animatable<[number, number, number]>;
}

export interface GradientStop {
  offset: number;
  color: string; // #AARRGGBB or #RRGGBB
}

export interface LayerFill {
  type: 'none' | 'solid' | 'gradient' | 'media';
  color: Animatable<string>;
  gradientType: 'linear' | 'radial' | 'sweep';
  gradientStops: GradientStop[];
  gradientStart: [number, number]; // normalized -1..1 or 0..1 relative to layer
  gradientEnd: [number, number];
  mediaId?: string;
  mediaSrc?: string;
}

export interface LayerStroke {
  enabled: boolean;
  color: Animatable<string>;
  width: Animatable<number>;
  position: 'inside' | 'center' | 'outside';
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dash: boolean;
  dashLength: number;
  dashGap: number;
  dashOffset: number;
}

export interface LayerShadow {
  enabled: boolean;
  color: Animatable<string>;
  alpha: Animatable<number>;
  size: Animatable<number>;
  offsetX: Animatable<number>;
  offsetY: Animatable<number>;
}

export interface LayerEffectInstance {
  uid: string;
  effectId: string;
  enabled: boolean;
  locallyApplied?: boolean;
  params: Record<string, Animatable<any>>;
}

export interface VectorPoint {
  x: number;
  y: number;
  /** Handle in relative to point */
  inX: number;
  inY: number;
  /** Handle out relative to point */
  outX: number;
  outY: number;
  corner?: 'smooth' | 'corner' | 'symmetric';
}

export interface FreehandStroke {
  points: { x: number; y: number; pressure: number }[];
  color: string;
  width: number;
  opacity: number;
}

export interface TextData {
  content: string;
  fontFamily: string;
  fontSize: number; // px relative to 1080p project
  fontWeight?: number | string;
  italic?: boolean;
  color: string; // #AARRGGBB
  align: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  wrapWidth: number;
}

export interface MediaData {
  mediaId?: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth?: number;
  displayHeight?: number;
  /** B4: APK TextureCropMode (fill = cover, fit = contain, stretch = distort to box) */
  cropMode?: 'fill' | 'fit' | 'stretch';
  durationMs?: number;
  trimStartMs?: number;
  playbackSpeed?: number;
  volume?: number;
  muted?: boolean;
}

export interface AudioData {
  mediaId?: string;
  src: string;
  name: string;
  durationMs: number;
  trimStartMs?: number;
  volume: Animatable<number>;
  muted: boolean;
  waveform?: number[];
  synthPattern?: 'beat' | 'ambient' | 'pulse';
}

export interface CameraData {
  fov: Animatable<number>;
  type?: 'perspective' | 'orthographic';
  active: boolean;
  fogEnabled: boolean;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  focusDistance: Animatable<number>;
  blurStrength: Animatable<number>;
}

export type RetimeMethod = 'none' | 'freeze' | 'loop' | 'stretch' | 'loopStretch' | 'blank';

export interface RetimeConfig {
  method: RetimeMethod;
  sourceStartMs?: number;
  sourceEndMs?: number;
  /** Loop count (0 = fill layer duration) */
  repeats?: number;
}

export interface Layer {
  id: string;
  type: LayerType;
  label: string;
  colorIndex: number; // 0..7
  startTime: number; // ms
  endTime: number; // ms
  visible: boolean;
  locked: boolean;
  parentId: string | null;
  blendMode: BlendModeId;
  opacity: Animatable<number>;
  transform: LayerTransform;
  fill: LayerFill;
  stroke: LayerStroke;
  shadow: LayerShadow;
  effects: LayerEffectInstance[];
  speed: Animatable<number>;
  /** A2: APK ReTimingMethod (freeze / loop / stretch / loopStretch / blank) */
  retime?: RetimeConfig;

  // Type-specific payloads
  shapeId?: string;
  shapeParams?: Record<string, Animatable<any>>;
  svgPathD?: string;
  vectorPath?: {
    points: VectorPoint[];
    closed: boolean;
  };
  freehandStrokes?: FreehandStroke[];
  textData?: TextData;
  mediaData?: MediaData;
  audioData?: AudioData;
  cameraData?: CameraData;
  groupLayers?: Layer[];
  groupWidth?: number;
  groupHeight?: number;
  groupMaskMode?: 'none' | 'mask' | 'exclude';
}

export interface ImportReport {
  width: number;
  height: number;
  sizeSource: 'exportWidth/exportHeight' | 'width/height' | 'aspect';
  roundedToEven: boolean;
  fps: number;
  durationMs: number;
  layerCount: number;
  mediaFound: number;
  mediaMissing: number;
  textWrapDefaults: number;
  fontDefaultsApplied?: number;
}

export interface Project {
  id: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  bgColor: string; // #AARRGGBB or 'transparent'
  layers: Layer[];
  bookmarks: number[]; // ms timestamps
  cameraEnabled: boolean;
  modifiedTime: number;
  thumbnailDataUrl?: string;
  importReport?: ImportReport;
  fontSubstitutions?: Record<string, string>;
}

export interface SavedElement {
  id: string;
  name: string;
  createdAt: number;
  layers: Layer[];
  previewDataUrl?: string;
}

/* Extracted APK Schema Types */
export interface EffectChoice {
  label: string;
  value: string;
  enableTargets: string;
}

export interface EffectParamDef {
  tag:
    | 'spinner'
    | 'slider'
    | 'point'
    | 'xyz'
    | 'orient'
    | 'color'
    | 'hue-disc'
    | 'selector'
    | 'switch'
    | 'section'
    | 'tip'
    | 'texture'
    | 'float';
  id?: string;
  label?: string;
  text?: string;
  default?: string;
  value?: string;
  min?: string;
  max?: string;
  step?: string;
  ticks?: string;
  snap?: string;
  type?: string;
  multiplier?: string;
  logscale?: string;
  alpha?: string;
  bias?: string;
  invert?: string;
  applyto?: string;
  enabled?: string;
  style?: string;
  choices?: EffectChoice[];
  srcType?: string;
  downsample?: string;
  src?: string;
}

export interface EffectPassDef {
  target?: string;
  effect?: string;
  src?: string;
  blend?: string;
}

export interface EffectShaderDef {
  type: 'fragment' | 'vertex';
  precision: string;
  group?: string | null;
  fastMath: boolean;
  code: string;
}

export interface EffectDef {
  id: string;
  file: string;
  name: string;
  desc: string;
  category: string;
  tags: string[];
  thumb: string;
  thumbBg?: string;
  deprecated: boolean;
  experimental: boolean;
  internal: boolean;
  overdraw: boolean;
  maxOverdraw: number;
  autoTransform: boolean;
  compat?: string | null;
  afxver?: string | null;
  affinity: string;
  type: string;
  params: EffectParamDef[];
  passes: EffectPassDef[];
  iterations?: string | null;
  shaders: EffectShaderDef[];
  script?: string | null;
  isCustom?: boolean;
}

export interface CustomEffectRecord {
  uid: string;
  id: string;
  name: string;
  library?: string;
  xml: string;
  source: 'paste' | 'file';
  created: number;
  hash: string;
  enabled: boolean;
  def: EffectDef;
}

export interface EffectPreset {
  name: string;
  pack: string;
  locallyApplied: boolean;
  props: {
    name: string;
    type: string;
    value?: string | null;
    kfs: { t: number; v: string; e: string }[];
  }[];
}

export interface ShapeHandleDef {
  id: string;
  param: string;
  type: 'radius' | 'angle' | 'point' | 'size' | string;
  icon?: string;
}

export interface ShapeDef {
  id: string;
  file: string;
  name: string;
  params: EffectParamDef[];
  handles: ShapeHandleDef[];
  script: string;
}
