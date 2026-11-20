import { create } from 'zustand';
import type {
  Animatable,
  BlendModeId,
  CustomEffectRecord,
  EasingSpec,
  Layer,
  LayerEffectInstance,
  Project,
  SavedElement,
} from '../types/project';
import { animatable, evalAnimatable } from '../engine/animation';
import { setCustomEffects } from '../engine/catalog';
import { createDefaultDemoProjects, makeBaseLayer } from './demoProjects';
import {
  clearAllStorage,
  deleteCustomEffectFromDb,
  deleteElementFromDb,
  deleteProjectFromDb,
  loadAllCustomEffects,
  loadAllElements,
  loadAllProjects,
  saveCustomEffectToDb,
  saveElementToDb,
  saveProjectToDb,
} from './storage';

export type AppScreen = 'home' | 'editor';
export type HomeTab = 'home' | 'tutorials' | 'projects' | 'elements';
export type PreviewQuality = 1 | 0.75 | 0.5 | 0.25;
export type InspectorTab =
  | 'none'
  | 'menu'
  | 'colorFill'
  | 'borderShadow'
  | 'moveTransform'
  | 'blending'
  | 'effects'
  | 'effectSettings'
  | 'editShape'
  | 'editPoints'
  | 'editText'
  | 'cameraOptions'
  | 'speed'
  | 'volume'
  | 'drawing';

export interface ActiveCurveTarget {
  label: string;
  /** Property path descriptor to read/write Animatable */
  kind: 'transform' | 'opacity' | 'fillColor' | 'strokeWidth' | 'effectParam' | 'shapeParam' | 'speed' | 'volume';
  key: string; // e.g., 'location', 'rotation', 'scale', 'pivot', 'skew', or param name
  effectUid?: string;
}

export type HistoryEntry =
  | { kind: 'full'; project: Project }
  | { kind: 'layer'; groupStack: string[]; layerId: string; snapshot: Layer };

interface EditorState {
  screen: AppScreen;
  homeTab: HomeTab;
  theme: 'navy' | 'desat';
  layoutMode: 'classic' | 'widescreen';
  density: 'compact' | 'comfortable';
  uiScale: number;
  toastMessage: string | null;
  showShortcutOverlay: boolean;
  projects: Project[];
  elements: SavedElement[];
  customEffects: CustomEffectRecord[];
  activeProjectId: string | null;
  currentProject: Project | null;

  // Group drill-down stack (layer IDs of nested groups)
  groupStack: string[];

  // History
  past: HistoryEntry[];
  future: HistoryEntry[];

  // Selection & Navigation
  selectedLayerIds: string[];
  inspectorTab: InspectorTab;
  activeEffectUid: string | null;
  curveTarget: ActiveCurveTarget | null;

  // Playback & Timeline
  currentTimeMs: number;
  isPlaying: boolean;
  loop: boolean;
  timelinePxPerSec: number;
  snapEnabled: boolean;
  gridVisible: boolean;
  previewQuality: PreviewQuality;
  previewZoom: number;
  previewPan: [number, number];
  audioLevel: number; // 0..1 for VU meter

  // Clipboards
  layerClipboard: Layer[] | null;
  effectsClipboard: LayerEffectInstance[] | null;
  curveClipboard: EasingSpec | null;

  // Modals / Popups
  showNewProjectDialog: boolean;
  showAddLayerPopup: boolean;
  showEffectBrowser: boolean;
  showExportDialog: boolean;
  showProjectSettings: boolean;
  showDrawer: boolean;

  // Drawing mode state
  drawingBrushColor: string;
  drawingBrushWidth: number;
  drawingBrushOpacity: number;

  // Actions
  initApp: () => Promise<void>;
  setHomeTab: (tab: HomeTab) => void;
  setTheme: (t: 'navy' | 'desat') => void;
  setLayoutMode: (m: 'classic' | 'widescreen') => void;
  setDensity: (d: 'compact' | 'comfortable') => void;
  setUiScale: (s: number) => void;
  showToast: (msg: string) => void;
  setShowShortcutOverlay: (open: boolean) => void;
  addCustomEffect: (rec: CustomEffectRecord, replaceUid?: string) => Promise<void>;
  deleteCustomEffect: (uid: string) => Promise<void>;
  toggleCustomEffect: (uid: string) => Promise<void>;
  renameCustomEffect: (uid: string, nextName: string) => Promise<void>;
  moveCustomEffectToLibrary: (uid: string, library: string) => Promise<void>;
  openProject: (id: string) => void;
  createProject: (opts: { title: string; width: number; height: number; fps: number; bgColor: string; durationMs?: number }) => void;
  importProject: (project: Project) => void;
  duplicateProject: (id: string) => void;
  deleteProject: (id: string) => void;
  closeEditor: () => void;

  // Mutation helpers with Undo history
  mutateProject: (fn: (proj: Project) => void, recordHistory?: boolean) => void;
  mutateLayer: (layerId: string, fn: (layer: Layer) => void, recordHistory?: boolean) => void;
  undo: () => void;
  redo: () => void;

  // Layer selection & group drill-down
  getActiveLayers: () => Layer[];
  selectLayer: (id: string, additive?: boolean) => void;
  clearSelection: () => void;
  enterGroup: (groupLayerId: string) => void;
  exitGroup: (depth?: number) => void;

  // Layer CRUD
  addLayer: (layer: Layer) => void;
  deleteSelectedLayers: () => void;
  duplicateSelectedLayers: () => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  reorderLayer: (fromIdx: number, toIdx: number) => void;
  splitSelectedAtPlayhead: () => void;
  trimSelectedLeft: () => void;
  trimSelectedRight: () => void;
  groupSelectedLayers: (maskMode?: 'none' | 'mask' | 'exclude') => void;
  ungroupSelectedLayer: () => void;
  /** B5: Align & Distribute selection (single undo entry each) */
  alignSelectedLayers: (axis: 'hcenter' | 'vcenter') => void;
  distributeSelectedLayers: (axis: 'horizontal' | 'vertical' | 'time') => void;
  copySelectedLayers: () => void;
  pasteLayers: () => void;
  copyLayerEffects: () => void;
  pasteLayerEffects: () => void;
  saveSelectedAsElement: () => Promise<void>;
  deleteElement: (id: string) => Promise<void>;

  // Keyframes
  toggleKeyframeOnProp: (target: ActiveCurveTarget, normT: number) => void;
  stepKeyframe: (target: ActiveCurveTarget, dir: -1 | 1) => void;
  updateKeyframeEasing: (target: ActiveCurveTarget, kfIdx: number, easing: EasingSpec) => void;

  // Playback & UI
  setCurrentTimeMs: (ms: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setLoop: (loop: boolean) => void;
  setTimelineZoom: (pxPerSec: number) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setActiveEffectUid: (uid: string | null) => void;
  setCurveTarget: (t: ActiveCurveTarget | null) => void;
  setAudioLevel: (lvl: number) => void;
  setPreviewQuality: (q: PreviewQuality) => void;
  setPreviewZoom: (z: number) => void;
  setPreviewPan: (pan: [number, number]) => void;
  toggleSnap: () => void;
  toggleGrid: () => void;
  toggleBookmarkAtPlayhead: () => void;
  jumpBookmark: (dir: -1 | 1) => void;

  setModal: (
    key: 'showNewProjectDialog' | 'showAddLayerPopup' | 'showEffectBrowser' | 'showExportDialog' | 'showProjectSettings' | 'showDrawer',
    val: boolean
  ) => void;
  setDrawingBrush: (opts: Partial<{ color: string; width: number; opacity: number }>) => void;
  setCurveClipboard: (c: EasingSpec) => void;
  clearCache: () => Promise<void>;
}

function cloneProj(p: Project): Project {
  return structuredClone(p);
}

function cloneLayer(l: Layer, offsetTime = 0): Layer {
  const c = structuredClone(l);
  const reId = (layer: Layer) => {
    layer.id = `layer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    layer.startTime += offsetTime;
    layer.endTime += offsetTime;
    for (const e of layer.effects) {
      e.uid = `eff_${Math.random().toString(36).slice(2, 9)}`;
    }
    if (layer.groupLayers) layer.groupLayers.forEach(reId);
  };
  reId(c);
  return c;
}

function getLayersRef(proj: Project, groupStack: string[]): Layer[] {
  let list = proj.layers;
  for (const gid of groupStack) {
    const grp = list.find((l) => l.id === gid && l.type === 'group');
    if (!grp || !grp.groupLayers) return list;
    list = grp.groupLayers;
  }
  return list;
}

export function getAnimatableByTarget(layer: Layer, t: ActiveCurveTarget): Animatable<any> | null {
  switch (t.kind) {
    case 'transform':
      return (layer.transform as any)[t.key] ?? null;
    case 'opacity':
      return layer.opacity;
    case 'fillColor':
      return layer.fill.color;
    case 'strokeWidth':
      return layer.stroke.width;
    case 'speed':
      return layer.speed;
    case 'volume':
      return layer.audioData?.volume ?? null;
    case 'shapeParam':
      return layer.shapeParams?.[t.key] ?? null;
    case 'effectParam': {
      const eff = layer.effects.find((e) => e.uid === t.effectUid);
      return eff?.params[t.key] ?? null;
    }
    default:
      return null;
  }
}

/** Copy-on-write spine: clones only the path along groupStack to layerId, shares every other layer by reference (I-1) */
function cowReplaceLayer(
  proj: Project,
  groupStack: string[],
  layerId: string,
  replacement: Layer
): { next: Project; prevLayer: Layer | null } {
  let prevLayer: Layer | null = null;
  const walk = (layers: Layer[], depth: number): Layer[] => {
    if (depth < groupStack.length) {
      const gid = groupStack[depth];
      const idx = layers.findIndex((l) => l.id === gid && l.type === 'group');
      if (idx === -1 || !layers[idx].groupLayers) return layers;
      const nextChildren = walk(layers[idx].groupLayers!, depth + 1);
      if (nextChildren === layers[idx].groupLayers) return layers;
      const out = layers.slice();
      out[idx] = { ...layers[idx], groupLayers: nextChildren };
      return out;
    }
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return layers;
    prevLayer = layers[idx];
    const out = layers.slice();
    out[idx] = replacement;
    return out;
  };
  const nextLayers = walk(proj.layers, 0);
  if (nextLayers === proj.layers) return { next: proj, prevLayer: null };
  return { next: { ...proj, layers: nextLayers }, prevLayer };
}

function recordPerfMutate(ms: number) {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __perf?: { mutateMs: number[]; renders: number } };
  if (!w.__perf) w.__perf = { mutateMs: [], renders: 0 };
  w.__perf.mutateMs.push(Math.round(ms * 100) / 100);
  if (w.__perf.mutateMs.length > 120) w.__perf.mutateMs.shift();
}

let saveDebounce: number | null = null;
let saveIdleHandle: number | null = null;
let pendingSaveProj: Project | null = null;

function flushPendingSave() {
  if (saveDebounce !== null) {
    window.clearTimeout(saveDebounce);
    saveDebounce = null;
  }
  if (saveIdleHandle !== null) {
    const win = window as Window & { cancelIdleCallback?: (id: number) => void };
    win.cancelIdleCallback?.(saveIdleHandle);
    saveIdleHandle = null;
  }
  if (pendingSaveProj) {
    const p = pendingSaveProj;
    pendingSaveProj = null;
    saveProjectToDb(p).catch(() => {});
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingSave);
}

/** I-8: Off-editing-path persistence — fires on requestIdleCallback (2s timeout) instead of stalling gesture release */
function scheduleSave(proj: Project) {
  pendingSaveProj = proj;
  if (saveDebounce !== null) window.clearTimeout(saveDebounce);
  if (saveIdleHandle !== null) {
    const win = window as Window & { cancelIdleCallback?: (id: number) => void };
    win.cancelIdleCallback?.(saveIdleHandle);
    saveIdleHandle = null;
  }
  saveDebounce = window.setTimeout(() => {
    saveDebounce = null;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (win.requestIdleCallback) {
      saveIdleHandle = win.requestIdleCallback(
        () => {
          saveIdleHandle = null;
          flushPendingSave();
        },
        { timeout: 2000 }
      );
    } else {
      flushPendingSave();
    }
  }, 500);
}

let toastTimer: number | null = null;

function applyDensityTokens(density: 'compact' | 'comfortable', uiScale: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-density', density);
  document.documentElement.style.setProperty('--am-ui-scale', String(uiScale));
}

function defaultDensityForViewport(): { density: 'compact' | 'comfortable'; uiScale: number } {
  if (typeof window === 'undefined') return { density: 'compact', uiScale: 1 };
  try {
    const saved = localStorage.getItem('am.layout.v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      if ((parsed.density === 'compact' || parsed.density === 'comfortable') && typeof parsed.uiScale === 'number') {
        return { density: parsed.density, uiScale: Math.max(0.8, Math.min(1.25, parsed.uiScale)) };
      }
    }
  } catch {
    // ignore
  }
  const w = window.innerWidth;
  if (w < 768) return { density: 'comfortable', uiScale: 1 };
  if (w < 1280) return { density: 'compact', uiScale: 1 };
  if (w < 1920) return { density: 'compact', uiScale: 1.1 };
  return { density: 'compact', uiScale: 1.15 };
}

const initialLayout = defaultDensityForViewport();

export const useEditorStore = create<EditorState>((set, get) => ({
  screen: 'home',
  homeTab: 'home',
  theme: 'navy',
  layoutMode: typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'widescreen' : 'classic',
  density: initialLayout.density,
  uiScale: initialLayout.uiScale,
  toastMessage: null,
  showShortcutOverlay: false,
  projects: [],
  elements: [],
  customEffects: [],
  activeProjectId: null,
  currentProject: null,
  groupStack: [],
  past: [],
  future: [],
  selectedLayerIds: [],
  inspectorTab: 'none',
  activeEffectUid: null,
  curveTarget: null,
  currentTimeMs: 0,
  isPlaying: false,
  loop: true,
  timelinePxPerSec: 120,
  snapEnabled: true,
  gridVisible: false,
  previewQuality: 0.75,
  previewZoom: 1,
  previewPan: [0, 0],
  audioLevel: 0,
  layerClipboard: null,
  effectsClipboard: null,
  curveClipboard: null,
  showNewProjectDialog: false,
  showAddLayerPopup: false,
  showEffectBrowser: false,
  showExportDialog: false,
  showProjectSettings: false,
  showDrawer: false,
  drawingBrushColor: '#FF00FFA8',
  drawingBrushWidth: 14,
  drawingBrushOpacity: 1,

  initApp: async () => {
    const s = get();
    applyDensityTokens(s.density, s.uiScale);
    let projects = await loadAllProjects();
    if (projects.length === 0) {
      projects = createDefaultDemoProjects();
      for (const p of projects) await saveProjectToDb(p);
    }
    const elements = await loadAllElements();
    const customEffects = await loadAllCustomEffects();
    setCustomEffects(customEffects.filter((c) => c.enabled).map((c) => c.def));
    set({ projects, elements, customEffects });
  },

  setHomeTab: (homeTab) => set({ homeTab }),
  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    set({ theme });
  },
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setDensity: (density) => {
    const uiScale = get().uiScale;
    applyDensityTokens(density, uiScale);
    try {
      localStorage.setItem('am.layout.v1', JSON.stringify({ density, uiScale }));
    } catch {
      // ignore
    }
    set({ density });
  },
  setUiScale: (rawScale) => {
    const uiScale = Math.max(0.8, Math.min(1.25, Math.round(rawScale * 100) / 100));
    const density = get().density;
    applyDensityTokens(density, uiScale);
    try {
      localStorage.setItem('am.layout.v1', JSON.stringify({ density, uiScale }));
    } catch {
      // ignore
    }
    set({ uiScale });
  },
  showToast: (msg) => {
    if (toastTimer) window.clearTimeout(toastTimer);
    set({ toastMessage: msg });
    toastTimer = window.setTimeout(() => {
      set({ toastMessage: null });
      toastTimer = null;
    }, 1800);
  },
  setShowShortcutOverlay: (showShortcutOverlay) => set({ showShortcutOverlay }),
  addCustomEffect: async (rec, replaceUid) => {
    if (replaceUid) {
      await deleteCustomEffectFromDb(replaceUid);
    }
    await saveCustomEffectToDb(rec);
    const next = [rec, ...get().customEffects.filter((c) => c.uid !== replaceUid && c.uid !== rec.uid)];
    setCustomEffects(next.filter((c) => c.enabled).map((c) => c.def));
    set({ customEffects: next });
    get().showToast(`Imported custom effect: ${rec.name}`);
  },
  deleteCustomEffect: async (uid) => {
    await deleteCustomEffectFromDb(uid);
    const next = get().customEffects.filter((c) => c.uid !== uid);
    setCustomEffects(next.filter((c) => c.enabled).map((c) => c.def));
    set({ customEffects: next });
    get().showToast('Removed custom effect');
  },
  toggleCustomEffect: async (uid) => {
    const next = get().customEffects.map((c) => (c.uid === uid ? { ...c, enabled: !c.enabled } : c));
    const target = next.find((c) => c.uid === uid);
    if (target) await saveCustomEffectToDb(target);
    setCustomEffects(next.filter((c) => c.enabled).map((c) => c.def));
    set({ customEffects: next });
  },
  renameCustomEffect: async (uid, nextName) => {
    const clean = nextName.trim();
    if (!clean) return;
    const next = get().customEffects.map((c) =>
      c.uid === uid ? { ...c, name: clean, def: { ...c.def, name: clean } } : c
    );
    const target = next.find((c) => c.uid === uid);
    if (target) await saveCustomEffectToDb(target);
    setCustomEffects(next.filter((c) => c.enabled).map((c) => c.def));
    set({ customEffects: next });
    get().showToast(`Renamed custom effect to "${clean}"`);
  },
  moveCustomEffectToLibrary: async (uid, library) => {
    const clean = library.trim() || 'Default';
    const next = get().customEffects.map((c) => (c.uid === uid ? { ...c, library: clean } : c));
    const target = next.find((c) => c.uid === uid);
    if (target) await saveCustomEffectToDb(target);
    set({ customEffects: next });
  },

  openProject: (id) => {
    const p = get().projects.find((x) => x.id === id);
    if (!p) return;
    set({
      screen: 'editor',
      activeProjectId: id,
      currentProject: cloneProj(p),
      groupStack: [],
      past: [],
      future: [],
      selectedLayerIds: [],
      inspectorTab: 'none',
      activeEffectUid: null,
      curveTarget: null,
      currentTimeMs: 0,
      isPlaying: false,
      previewZoom: 1,
      previewPan: [0, 0],
    });
  },

  createProject: ({ title, width, height, fps, bgColor, durationMs = 5000 }) => {
    const proj: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim() || 'Untitled Project',
      width,
      height,
      fps,
      durationMs,
      bgColor,
      layers: [],
      bookmarks: [],
      cameraEnabled: false,
      modifiedTime: Date.now(),
    };
    saveProjectToDb(proj).catch(() => {});
    set((s) => ({
      projects: [proj, ...s.projects],
      screen: 'editor',
      activeProjectId: proj.id,
      currentProject: cloneProj(proj),
      groupStack: [],
      past: [],
      future: [],
      selectedLayerIds: [],
      inspectorTab: 'none',
      currentTimeMs: 0,
      isPlaying: false,
      showNewProjectDialog: false,
    }));
  },

  importProject: (proj) => {
    saveProjectToDb(proj).catch(() => {});
    const rep = proj.importReport;
    if (rep) {
      const notes = [
        `${rep.width}×${rep.height} (${rep.sizeSource})`,
        `${rep.fps}fps`,
        `${rep.layerCount} layers`,
        rep.mediaMissing > 0 ? `${rep.mediaMissing} missing media` : null,
        rep.roundedToEven ? 'even-rounded' : null,
      ].filter(Boolean);
      get().showToast(`Imported: ${notes.join(' · ')}`);
    }
    set((s) => ({
      projects: [proj, ...s.projects],
      screen: 'editor',
      activeProjectId: proj.id,
      currentProject: cloneProj(proj),
      groupStack: [],
      past: [],
      future: [],
      selectedLayerIds: [],
      inspectorTab: 'none',
      currentTimeMs: 0,
      isPlaying: false,
    }));
  },

  duplicateProject: (id) => {
    const orig = get().projects.find((p) => p.id === id);
    if (!orig) return;
    const copy = cloneProj(orig);
    copy.id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    copy.title = `${orig.title} (Copy)`;
    copy.modifiedTime = Date.now();
    saveProjectToDb(copy).catch(() => {});
    set((s) => ({ projects: [copy, ...s.projects] }));
  },

  deleteProject: (id) => {
    deleteProjectFromDb(id).catch(() => {});
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
    }));
  },

  closeEditor: () => {
    const cur = get().currentProject;
    if (cur) {
      pendingSaveProj = cur;
      flushPendingSave();
    }
    set((st) => ({
      screen: 'home',
      isPlaying: false,
      projects: cur ? st.projects.map((p) => (p.id === cur.id ? cur : p)) : st.projects,
    }));
  },

  mutateLayer: (layerId, fn, recordHistory = true) => {
    const t0 = performance.now();
    const s = get();
    const cur = s.currentProject;
    if (!cur) return;
    const activeList = getLayersRef(cur, s.groupStack);
    const existing = activeList.find((l) => l.id === layerId);
    if (!existing) return;

    // I-1 + I-2: Clone ONLY the single touched layer (1/60th cost of full-project structuredClone)
    const draftLayer = structuredClone(existing);
    fn(draftLayer);

    const { next } = cowReplaceLayer(cur, s.groupStack, layerId, draftLayer);
    next.modifiedTime = Date.now();
    // I-7: Incremental O(1) duration check instead of O(n) scan
    if (s.groupStack.length === 0 && draftLayer.endTime > next.durationMs) {
      next.durationMs = draftLayer.endTime;
    }
    scheduleSave(next);

    const entry: HistoryEntry | null = recordHistory
      ? { kind: 'layer', groupStack: s.groupStack.slice(), layerId, snapshot: existing }
      : null;

    set((st) => ({
      currentProject: next,
      past: entry ? [...st.past.slice(-59), entry] : st.past,
      future: entry ? [] : st.future,
    }));
    recordPerfMutate(performance.now() - t0);
  },

  mutateProject: (fn, recordHistory = true) => {
    const t0 = performance.now();
    const s = get();
    if (!s.currentProject) return;
    const prev = recordHistory ? s.currentProject : null;
    const next = cloneProj(s.currentProject);
    fn(next);
    next.modifiedTime = Date.now();
    // Auto-extend duration if any layer extends beyond project duration
    const maxEnd = next.layers.reduce((m, l) => Math.max(m, l.endTime), next.durationMs);
    next.durationMs = maxEnd;
    scheduleSave(next);

    set((st) => ({
      currentProject: next,
      past: prev ? [...st.past.slice(-59), { kind: 'full', project: prev }] : st.past,
      future: prev ? [] : st.future,
    }));
    recordPerfMutate(performance.now() - t0);
  },

  undo: () => {
    const s = get();
    if (s.past.length === 0 || !s.currentProject) return;
    const entry = s.past[s.past.length - 1];
    if (entry.kind === 'layer') {
      const { next, prevLayer } = cowReplaceLayer(s.currentProject, entry.groupStack, entry.layerId, entry.snapshot);
      next.modifiedTime = Date.now();
      scheduleSave(next);
      set({
        currentProject: next,
        past: s.past.slice(0, -1),
        future: prevLayer
          ? [{ kind: 'layer', groupStack: entry.groupStack, layerId: entry.layerId, snapshot: prevLayer }, ...s.future]
          : s.future,
      });
    } else {
      const prev = entry.project;
      const cur = s.currentProject;
      scheduleSave(prev);
      set({
        currentProject: prev,
        past: s.past.slice(0, -1),
        future: [{ kind: 'full', project: cur }, ...s.future],
      });
    }
  },

  redo: () => {
    const s = get();
    if (s.future.length === 0 || !s.currentProject) return;
    const entry = s.future[0];
    if (entry.kind === 'layer') {
      const { next, prevLayer } = cowReplaceLayer(s.currentProject, entry.groupStack, entry.layerId, entry.snapshot);
      next.modifiedTime = Date.now();
      scheduleSave(next);
      set({
        currentProject: next,
        past: prevLayer
          ? [...s.past, { kind: 'layer', groupStack: entry.groupStack, layerId: entry.layerId, snapshot: prevLayer }]
          : s.past,
        future: s.future.slice(1),
      });
    } else {
      const next = entry.project;
      const cur = s.currentProject;
      scheduleSave(next);
      set({
        currentProject: next,
        past: [...s.past, { kind: 'full', project: cur }],
        future: s.future.slice(1),
      });
    }
  },

  getActiveLayers: () => {
    const s = get();
    if (!s.currentProject) return [];
    return getLayersRef(s.currentProject, s.groupStack);
  },

  selectLayer: (id, additive = false) => {
    const s = get();
    if (!id) {
      set({ selectedLayerIds: [], inspectorTab: 'none', curveTarget: null });
      return;
    }
    if (additive) {
      const exists = s.selectedLayerIds.includes(id);
      const next = exists ? s.selectedLayerIds.filter((x) => x !== id) : [...s.selectedLayerIds, id];
      set({
        selectedLayerIds: next,
        inspectorTab: next.length === 1 ? 'menu' : 'none',
      });
    } else {
      set({
        selectedLayerIds: [id],
        inspectorTab: s.inspectorTab === 'none' ? 'menu' : s.inspectorTab,
        curveTarget: null,
      });
    }
  },

  clearSelection: () => set({ selectedLayerIds: [], inspectorTab: 'none', activeEffectUid: null, curveTarget: null }),

  enterGroup: (groupLayerId) => {
    set((s) => ({
      groupStack: [...s.groupStack, groupLayerId],
      selectedLayerIds: [],
      inspectorTab: 'none',
    }));
  },

  exitGroup: (depth) => {
    set((s) => ({
      groupStack: depth === undefined ? s.groupStack.slice(0, -1) : s.groupStack.slice(0, depth),
      selectedLayerIds: [],
      inspectorTab: 'none',
    }));
  },

  addLayer: (layer) => {
    const s = get();
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      list.push(layer);
      if (layer.type === 'camera') proj.cameraEnabled = true;
    });
    set({
      selectedLayerIds: [layer.id],
      inspectorTab: layer.type === 'freehand' ? 'drawing' : layer.type === 'text' ? 'editText' : 'menu',
      showAddLayerPopup: false,
    });
  },

  deleteSelectedLayers: () => {
    const s = get();
    if (s.selectedLayerIds.length === 0) return;
    const ids = new Set(s.selectedLayerIds);
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const remaining = list.filter((l) => !ids.has(l.id));
      list.length = 0;
      list.push(...remaining);
      for (const l of list) {
        if (l.parentId && ids.has(l.parentId)) l.parentId = null;
      }
      proj.cameraEnabled = proj.layers.some((l) => l.type === 'camera');
    });
    set({ selectedLayerIds: [], inspectorTab: 'none', curveTarget: null });
  },

  duplicateSelectedLayers: () => {
    const s = get();
    if (s.selectedLayerIds.length === 0) return;
    const newIds: string[] = [];
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const additions: Layer[] = [];
      for (const l of list) {
        if (s.selectedLayerIds.includes(l.id)) {
          const dup = cloneLayer(l);
          dup.label = `${l.label} Copy`;
          newIds.push(dup.id);
          additions.push(dup);
        }
      }
      list.push(...additions);
    });
    set({ selectedLayerIds: newIds });
  },

  toggleLayerVisible: (id) => {
    const s = get();
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const l = list.find((x) => x.id === id);
      if (l) l.visible = !l.visible;
    });
  },

  toggleLayerLocked: (id) => {
    const s = get();
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const l = list.find((x) => x.id === id);
      if (l) l.locked = !l.locked;
    });
  },

  reorderLayer: (fromIdx, toIdx) => {
    const s = get();
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      if (fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length) return;
      const [item] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, item);
    });
  },

  splitSelectedAtPlayhead: () => {
    const s = get();
    const t = s.currentTimeMs;
    if (s.selectedLayerIds.length === 0) return;
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const next: Layer[] = [];
      for (const l of list) {
        if (s.selectedLayerIds.includes(l.id) && t > l.startTime + 40 && t < l.endTime - 40) {
          const right = cloneLayer(l);
          right.label = `${l.label} (2)`;
          l.endTime = t;
          right.startTime = t;
          next.push(l, right);
        } else {
          next.push(l);
        }
      }
      list.length = 0;
      list.push(...next);
    });
  },

  trimSelectedLeft: () => {
    const s = get();
    const t = s.currentTimeMs;
    if (s.selectedLayerIds.length === 0) return;
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      for (const l of list) {
        if (s.selectedLayerIds.includes(l.id) && t < l.endTime - 40) {
          l.startTime = Math.max(0, t);
        }
      }
    });
  },

  trimSelectedRight: () => {
    const s = get();
    const t = s.currentTimeMs;
    if (s.selectedLayerIds.length === 0) return;
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      for (const l of list) {
        if (s.selectedLayerIds.includes(l.id) && t > l.startTime + 40) {
          l.endTime = t;
        }
      }
    });
  },

  groupSelectedLayers: (maskMode = 'none') => {
    const s = get();
    if (s.selectedLayerIds.length < 1) return;
    const ids = new Set(s.selectedLayerIds);
    let createdId = '';
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const selected = list.filter((l) => ids.has(l.id));
      if (selected.length === 0) return;
      const minStart = Math.min(...selected.map((l) => l.startTime));
      const maxEnd = Math.max(...selected.map((l) => l.endTime));
      const firstIdx = list.findIndex((l) => ids.has(l.id));
      const remaining = list.filter((l) => !ids.has(l.id));
      const cx = proj.width / 2;
      const cy = proj.height / 2;

      const groupLayer = makeBaseLayer({
        id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'group',
        label: maskMode === 'mask' ? 'Mask Group' : maskMode === 'exclude' ? 'Exclude Group' : `Group (${selected.length})`,
        colorIndex: 4,
        startTime: minStart,
        endTime: maxEnd,
        transform: {
          location: animatable([cx, cy, 0]),
          rotation: animatable(0),
          scale: animatable([1, 1]),
          scaleLinked: true,
          pivot: animatable([0, 0]),
          skew: animatable([0, 0]),
        },
        groupLayers: selected.map((sub, idx) => {
          const c = structuredClone(sub);
          c.startTime -= minStart;
          c.endTime -= minStart;
          if (maskMode !== 'none' && idx === selected.length - 1) {
            c.blendMode = maskMode === 'mask' ? 'mask' : 'exclude';
          }
          return c;
        }),
        groupMaskMode: maskMode,
      });
      createdId = groupLayer.id;
      remaining.splice(Math.max(0, firstIdx), 0, groupLayer);
      list.length = 0;
      list.push(...remaining);
    });
    if (createdId) set({ selectedLayerIds: [createdId], inspectorTab: 'menu' });
  },

  ungroupSelectedLayer: () => {
    const s = get();
    if (s.selectedLayerIds.length !== 1) return;
    const gid = s.selectedLayerIds[0];
    const ungroupedIds: string[] = [];
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const idx = list.findIndex((l) => l.id === gid && l.type === 'group');
      if (idx === -1) return;
      const grp = list[idx];
      const children = (grp.groupLayers ?? []).map((c) => {
        const copy = structuredClone(c);
        copy.startTime += grp.startTime;
        copy.endTime += grp.startTime;
        ungroupedIds.push(copy.id);
        return copy;
      });
      list.splice(idx, 1, ...children);
    });
    set({ selectedLayerIds: ungroupedIds });
  },

  alignSelectedLayers: (axis) => {
    const s = get();
    if (!s.currentProject || s.selectedLayerIds.length === 0) return;
    const cx = s.currentProject.width * 0.5;
    const cy = s.currentProject.height * 0.5;
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const targets = list.filter((l) => s.selectedLayerIds.includes(l.id));
      if (targets.length === 0) return;
      const targetVal =
        targets.length === 1
          ? axis === 'hcenter'
            ? cx
            : cy
          : targets.reduce((sum, l) => sum + (axis === 'hcenter' ? l.transform.location.value[0] : l.transform.location.value[1]), 0) /
            targets.length;
      for (const l of targets) {
        const loc = [...l.transform.location.value] as [number, number, number];
        if (axis === 'hcenter') loc[0] = Math.round(targetVal);
        else loc[1] = Math.round(targetVal);
        l.transform.location.value = loc;
      }
    });
  },

  distributeSelectedLayers: (axis) => {
    const s = get();
    if (!s.currentProject || s.selectedLayerIds.length < 3) return;
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const targets = list.filter((l) => s.selectedLayerIds.includes(l.id));
      if (targets.length < 3) return;
      if (axis === 'time') {
        targets.sort((a, b) => a.startTime - b.startTime);
        const first = targets[0].startTime;
        const last = targets[targets.length - 1].startTime;
        const step = (last - first) / (targets.length - 1);
        for (let i = 1; i < targets.length - 1; i++) {
          const dur = targets[i].endTime - targets[i].startTime;
          const nextStart = Math.round(first + step * i);
          targets[i].startTime = nextStart;
          targets[i].endTime = nextStart + dur;
        }
      } else {
        const idx = axis === 'horizontal' ? 0 : 1;
        targets.sort((a, b) => a.transform.location.value[idx] - b.transform.location.value[idx]);
        const first = targets[0].transform.location.value[idx];
        const last = targets[targets.length - 1].transform.location.value[idx];
        const step = (last - first) / (targets.length - 1);
        for (let i = 1; i < targets.length - 1; i++) {
          const loc = [...targets[i].transform.location.value] as [number, number, number];
          loc[idx] = Math.round(first + step * i);
          targets[i].transform.location.value = loc;
        }
      }
    });
  },

  copySelectedLayers: () => {
    const s = get();
    const list = s.getActiveLayers();
    const sel = list.filter((l) => s.selectedLayerIds.includes(l.id));
    if (sel.length > 0) set({ layerClipboard: structuredClone(sel) });
  },

  pasteLayers: () => {
    const s = get();
    if (!s.layerClipboard || s.layerClipboard.length === 0) return;
    const newIds: string[] = [];
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const minStart = Math.min(...s.layerClipboard!.map((l) => l.startTime));
      const shift = s.currentTimeMs - minStart;
      for (const orig of s.layerClipboard!) {
        const pasted = cloneLayer(orig, shift);
        newIds.push(pasted.id);
        list.push(pasted);
      }
    });
    set({ selectedLayerIds: newIds });
  },

  copyLayerEffects: () => {
    const s = get();
    const list = s.getActiveLayers();
    const l = list.find((x) => x.id === s.selectedLayerIds[0]);
    if (l && l.effects.length > 0) {
      set({ effectsClipboard: structuredClone(l.effects) });
    }
  },

  pasteLayerEffects: () => {
    const s = get();
    if (!s.effectsClipboard || s.selectedLayerIds.length === 0) return;
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      for (const l of list) {
        if (s.selectedLayerIds.includes(l.id)) {
          for (const e of s.effectsClipboard!) {
            const copy = structuredClone(e);
            copy.uid = `eff_${Math.random().toString(36).slice(2, 9)}`;
            l.effects.push(copy);
          }
        }
      }
    });
  },

  saveSelectedAsElement: async () => {
    const s = get();
    const list = s.getActiveLayers();
    const sel = list.filter((l) => s.selectedLayerIds.includes(l.id));
    if (sel.length === 0) return;
    const el: SavedElement = {
      id: `elem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: sel.length === 1 ? sel[0].label : `${sel[0].label} + ${sel.length - 1}`,
      createdAt: Date.now(),
      layers: structuredClone(sel),
    };
    await saveElementToDb(el);
    set((st) => ({ elements: [el, ...st.elements] }));
  },

  deleteElement: async (id) => {
    await deleteElementFromDb(id);
    set((st) => ({ elements: st.elements.filter((e) => e.id !== id) }));
  },

  toggleKeyframeOnProp: (target, normT) => {
    const s = get();
    if (s.selectedLayerIds.length !== 1) return;
    const lid = s.selectedLayerIds[0];
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const l = list.find((x) => x.id === lid);
      if (!l) return;
      const prop = getAnimatableByTarget(l, target);
      if (!prop) return;
      const existingIdx = prop.keyframes.findIndex((k) => Math.abs(k.t - normT) < 0.012);
      if (existingIdx !== -1) {
        prop.keyframes.splice(existingIdx, 1);
      } else {
        const valAtT = prop.keyframes.length > 0 ? evalAnimatable(prop, normT, prop.value) : prop.value;
        prop.keyframes.push({ t: normT, v: structuredClone(valAtT) });
        prop.keyframes.sort((a, b) => a.t - b.t);
      }
    });
  },

  stepKeyframe: (target, dir) => {
    const s = get();
    const list = s.getActiveLayers();
    const l = list.find((x) => x.id === s.selectedLayerIds[0]);
    if (!l) return;
    const prop = getAnimatableByTarget(l, target);
    if (!prop || prop.keyframes.length === 0) return;
    const dur = Math.max(1, l.endTime - l.startTime);
    const curNorm = (s.currentTimeMs - l.startTime) / dur;
    const sorted = [...prop.keyframes].sort((a, b) => a.t - b.t);
    if (dir < 0) {
      const prev = [...sorted].reverse().find((k) => k.t < curNorm - 0.005);
      if (prev) set({ currentTimeMs: l.startTime + prev.t * dur, isPlaying: false });
    } else {
      const next = sorted.find((k) => k.t > curNorm + 0.005);
      if (next) set({ currentTimeMs: l.startTime + next.t * dur, isPlaying: false });
    }
  },

  updateKeyframeEasing: (target, kfIdx, easing) => {
    const s = get();
    const lid = s.selectedLayerIds[0];
    if (!lid) return;
    s.mutateProject((proj) => {
      const list = getLayersRef(proj, s.groupStack);
      const l = list.find((x) => x.id === lid);
      if (!l) return;
      const prop = getAnimatableByTarget(l, target);
      if (!prop || !prop.keyframes[kfIdx]) return;
      prop.keyframes[kfIdx].easing = easing;
    });
  },

  setCurrentTimeMs: (ms) => {
    const proj = get().currentProject;
    const clamped = proj ? Math.max(0, Math.min(proj.durationMs, ms)) : Math.max(0, ms);
    set({ currentTimeMs: clamped });
  },
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  togglePlay: () =>
    set((s) => {
      if (!s.isPlaying && s.currentProject && s.currentTimeMs >= s.currentProject.durationMs - 10) {
        return { isPlaying: true, currentTimeMs: 0 };
      }
      return { isPlaying: !s.isPlaying };
    }),
  setLoop: (loop) => set({ loop }),
  setTimelineZoom: (timelinePxPerSec) => set({ timelinePxPerSec: Math.max(30, Math.min(480, timelinePxPerSec)) }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setActiveEffectUid: (activeEffectUid) => set({ activeEffectUid }),
  setCurveTarget: (curveTarget) => set({ curveTarget }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),
  setPreviewQuality: (previewQuality) => set({ previewQuality }),
  setPreviewZoom: (previewZoom) => set({ previewZoom: Math.max(0.2, Math.min(5, previewZoom)) }),
  setPreviewPan: (previewPan) => set({ previewPan }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),

  toggleBookmarkAtPlayhead: () => {
    const s = get();
    s.mutateProject((proj) => {
      const idx = proj.bookmarks.findIndex((b) => Math.abs(b - s.currentTimeMs) < 35);
      if (idx !== -1) proj.bookmarks.splice(idx, 1);
      else {
        proj.bookmarks.push(Math.round(s.currentTimeMs));
        proj.bookmarks.sort((a, b) => a - b);
      }
    }, false);
  },

  jumpBookmark: (dir) => {
    const s = get();
    const bms = s.currentProject?.bookmarks ?? [];
    if (bms.length === 0) return;
    if (dir < 0) {
      const prev = [...bms].reverse().find((b) => b < s.currentTimeMs - 20);
      if (prev !== undefined) set({ currentTimeMs: prev, isPlaying: false });
    } else {
      const next = bms.find((b) => b > s.currentTimeMs + 20);
      if (next !== undefined) set({ currentTimeMs: next, isPlaying: false });
    }
  },

  setModal: (key, val) => set({ [key]: val } as any),
  setDrawingBrush: (opts) =>
    set((s) => ({
      drawingBrushColor: opts.color ?? s.drawingBrushColor,
      drawingBrushWidth: opts.width ?? s.drawingBrushWidth,
      drawingBrushOpacity: opts.opacity ?? s.drawingBrushOpacity,
    })),
  setCurveClipboard: (curveClipboard) => set({ curveClipboard }),

  clearCache: async () => {
    await clearAllStorage();
    const projects = createDefaultDemoProjects();
    for (const p of projects) await saveProjectToDb(p);
    set({ projects, elements: [] });
  },
}));
