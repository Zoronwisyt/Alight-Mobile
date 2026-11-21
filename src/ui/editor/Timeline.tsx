import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { canonicalizeBlendMode } from '../../engine/blendModes';
import { replaceMediaOnLayers } from '../../engine/mediaReplace';
import { snapTimelineMs } from '../../engine/snapping';
import type { AlightRenderer } from '../../engine/renderer';
import { playbackClock } from '../../store/playbackClock';
import { resolveActiveGroup, useEditorStore } from '../../store/useEditorStore';
import type { Layer } from '../../types/project';
import { AmIcon } from '../components/AmIcon';

interface TimelineProps {
  rendererRef?: React.RefObject<AlightRenderer | null>;
  cacheVersion?: number;
  missingFontLayerIds?: Set<string>;
  onOpenMissingFonts?: () => void;
  onClearCache?: () => void;
  onRenderCacheNow?: () => void;
}

// I-9: Memoise per-layer keyframe list by Layer object identity (O(1) hit for unchanged COW layers)
const layerKeyframesCache = new WeakMap<Layer, number[]>();

function collectLayerKeyframes(layer: Layer): number[] {
  const cached = layerKeyframesCache.get(layer);
  if (cached) return cached;
  const ts = new Set<number>();
  const addProp = (kfs?: { t: number }[]) => {
    if (!kfs) return;
    for (const k of kfs) ts.add(Math.round(k.t * 1000) / 1000);
  };
  addProp(layer.opacity.keyframes);
  addProp(layer.transform.location.keyframes);
  addProp(layer.transform.rotation.keyframes);
  addProp(layer.transform.rotationX?.keyframes);
  addProp(layer.transform.rotationY?.keyframes);
  addProp(layer.transform.scale.keyframes);
  addProp(layer.transform.pivot.keyframes);
  addProp(layer.transform.skew.keyframes);
  addProp(layer.fill.color.keyframes);
  addProp(layer.stroke.width.keyframes);
  addProp(layer.speed.keyframes);
  for (const eff of layer.effects) {
    for (const p of Object.values(eff.params)) {
      addProp(p?.keyframes);
    }
  }
  const out = Array.from(ts);
  layerKeyframesCache.set(layer, out);
  return out;
}

const LAYER_GRADIENTS = [
  'var(--am-el-0)',
  'var(--am-el-1)',
  'var(--am-el-2)',
  'var(--am-el-3)',
  'var(--am-el-4)',
  'var(--am-el-5)',
  'var(--am-el-6)',
  'var(--am-el-7)',
];

function fmtCtsTime(ms: number, fps: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const frame = Math.floor(((safe % 1000) / 1000) * fps);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(frame).padStart(2, '0')}`;
}

interface TimelineHeaderRowProps {
  layer: Layer;
  isSelected: boolean;
  hasMissingFont: boolean;
  onToggleVisible: (id: string) => void;
  onSelect: (id: string, additive: boolean) => void;
  onEnterGroup: (id: string) => void;
  onOpenMissingFonts?: () => void;
}

const TimelineHeaderRow = React.memo<TimelineHeaderRowProps>(
  ({ layer, isSelected, hasMissingFont, onToggleVisible, onSelect, onEnterGroup, onOpenMissingFonts }) => {
    const tagBg = LAYER_GRADIENTS[layer.colorIndex % LAYER_GRADIENTS.length];
    return (
      <div className={`am-track-header ${isSelected ? 'selected' : ''}`}>
        <div className="am-track-tag" style={{ background: tagBg }} />

        <button
          type="button"
          className="am-track-eye-btn"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(layer.id);
          }}
          title={layer.visible ? 'Hide Layer' : 'Show Layer'}
        >
          <AmIcon
            name={layer.visible ? 'ic_visibility' : 'ic_visibility_off'}
            fallback={layer.visible ? 'eye' : 'eyeOff'}
            size={15}
            color={layer.visible ? '#D8DCE8' : '#656B7C'}
          />
        </button>

        {/* Tapping checkmark toggles layer in multi-selection (exact APK timeline_header behavior) */}
        <button
          type="button"
          className={`am-track-check-btn ${isSelected ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(layer.id, true);
          }}
          title="Tap to Multi-Select Layer"
        >
          <AmIcon
            name="ic_selected_layer_checkmark"
            fallback="check"
            size={14}
            color={isSelected ? '#091318' : 'rgba(255,255,255,0.28)'}
          />
        </button>

        {/* R-4: Direct chevron to enter any group layer */}
        {layer.type === 'group' && (
          <button
            type="button"
            className="am-track-enter-group-btn"
            aria-label="Enter group"
            title="Enter Group"
            onClick={(e) => {
              e.stopPropagation();
              onEnterGroup(layer.id);
            }}
          >
            ›
          </button>
        )}

        {/* M-2: Missing-font warning badge on text layers */}
        {layer.type === 'text' && hasMissingFont && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMissingFonts?.();
            }}
            title={`Missing font "${layer.textData?.fontFamily}" — tap to resolve`}
            style={{
              background: 'rgba(255, 107, 129, 0.2)',
              border: '1px solid rgba(255, 107, 129, 0.6)',
              color: '#FF6B81',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 4px',
              cursor: 'pointer',
              lineHeight: 1.1,
            }}
          >
            ⚠
          </button>
        )}
      </div>
    );
  }
);

interface TimelineTrackRowProps {
  layer: Layer;
  idx: number;
  visualPos: number;
  totalCount: number;
  isSelected: boolean;
  timelinePxPerSec: number;
  onSelect: (id: string, additive: boolean) => void;
  onEnterGroup: (id: string) => void;
  onReorderLayer: (from: number, to: number) => void;
  onTrackPointerDown: (e: React.PointerEvent, idx: number, mode: 'move' | 'left' | 'right') => void;
}

const TimelineTrackRow = React.memo<TimelineTrackRowProps>(
  ({
    layer,
    idx,
    visualPos,
    totalCount,
    isSelected,
    timelinePxPerSec,
    onSelect,
    onEnterGroup,
    onReorderLayer,
    onTrackPointerDown,
  }) => {
    const left = (layer.startTime / 1000) * timelinePxPerSec;
    const width = Math.max(32, ((layer.endTime - layer.startTime) / 1000) * timelinePxPerSec);
    const kfs = collectLayerKeyframes(layer);

    return (
      <div className="am-track-row">
        {/* APK timeline_item.xml */}
        <div
          className={`am-track-bar ${isSelected ? 'selected' : ''}`}
          style={{
            left,
            width,
            background: LAYER_GRADIENTS[layer.colorIndex % LAYER_GRADIENTS.length],
            opacity: layer.visible ? 1 : 0.42,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(layer.id, e.shiftKey || e.ctrlKey || e.metaKey);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (layer.type === 'group') onEnterGroup(layer.id);
          }}
          onPointerDown={(e) => onTrackPointerDown(e, idx, 'move')}
        >
          {/* APK @id/trimGripLeft (30dp when selected) */}
          <div
            className="am-trim-grip left"
            onPointerDown={(e) => onTrackPointerDown(e, idx, 'left')}
            title="Drag to Trim Start"
          >
            <span className="am-trim-grip-bar" />
          </div>

          <div className="am-track-label-wrap">
            {(canonicalizeBlendMode(layer.blendMode) === 'mask' ||
              canonicalizeBlendMode(layer.blendMode) === 'clipping-mask' ||
              layer.blendMode === 'exclude') && (
              <span className="am-track-mask-icon">↙︎</span>
            )}
            <span className="am-track-label">{layer.label}</span>

            {layer.is3D && (
              <span
                className="am-track-fx-pill"
                style={{
                  background: 'rgba(10, 14, 24, 0.82)',
                  color: '#00FFA8',
                  border: '1px solid rgba(0, 255, 168, 0.6)',
                  fontWeight: 800,
                }}
                title="3D Layer enabled"
              >
                3D
              </span>
            )}

            {layer.effects.length > 0 && (
              <span className="am-track-fx-pill">{layer.effects.length} fx</span>
            )}

            {isSelected && (
              <span className="am-track-z-btns">
                <button
                  type="button"
                  disabled={visualPos === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorderLayer(idx, idx + 1);
                  }}
                  title="Move Layer Up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={visualPos === totalCount - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorderLayer(idx, idx - 1);
                  }}
                  title="Move Layer Down"
                >
                  ▼
                </button>
              </span>
            )}
          </div>

          {/* AudioThumbnailView */}
          {layer.type === 'audio' && layer.audioData?.waveform && (
            <div className="am-track-waveform">
              {layer.audioData.waveform.slice(0, 48).map((v, wi) => (
                <div key={wi} style={{ flex: 1, height: `${Math.max(15, v * 100)}%`, background: '#081318', borderRadius: 1 }} />
              ))}
            </div>
          )}

          {/* KeyframeView Diamonds */}
          {kfs.map((kt, ki) => (
            <div
              key={ki}
              className="am-track-kf-diamond"
              style={{ left: `${Math.max(2, Math.min(98, kt * 100))}%` }}
            />
          ))}

          {/* APK @id/trimGripRight */}
          <div
            className="am-trim-grip right"
            onPointerDown={(e) => onTrackPointerDown(e, idx, 'right')}
            title="Drag to Trim End"
          >
            <span className="am-trim-grip-bar" />
          </div>
        </div>
      </div>
    );
  }
);

export const Timeline: React.FC<TimelineProps> = ({
  rendererRef,
  cacheVersion = 0,
  missingFontLayerIds,
  onOpenMissingFonts,
  onClearCache,
  onRenderCacheNow,
}) => {
  const {
    currentProject,
    currentTimeMs,
    timelinePxPerSec,
    isPlaying,
    selectedLayerIds,
    groupStack,
    loop,
    snapEnabled,
    previewQuality,
    getActiveLayers,
    setCurrentTimeMs,
    setIsPlaying,
    setLoop,
    selectLayer,
    enterGroup,
    toggleLayerVisible,
    reorderLayer,
    setTimelineZoom,
    mutateProject,
    mutateLayer,
    setModal,
  } = useEditorStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      currentTimeMs: s.currentTimeMs,
      timelinePxPerSec: s.timelinePxPerSec,
      isPlaying: s.isPlaying,
      selectedLayerIds: s.selectedLayerIds,
      groupStack: s.groupStack,
      loop: s.loop,
      snapEnabled: s.snapEnabled,
      previewQuality: s.previewQuality,
      getActiveLayers: s.getActiveLayers,
      setCurrentTimeMs: s.setCurrentTimeMs,
      setIsPlaying: s.setIsPlaying,
      setLoop: s.setLoop,
      selectLayer: s.selectLayer,
      enterGroup: s.enterGroup,
      toggleLayerVisible: s.toggleLayerVisible,
      reorderLayer: s.reorderLayer,
      setTimelineZoom: s.setTimelineZoom,
      mutateProject: s.mutateProject,
      mutateLayer: s.mutateLayer,
      setModal: s.setModal,
    }))
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  /** The two elements that slide under the fixed centre playhead; written directly at 60 fps. */
  const rulerContentRef = useRef<HTMLDivElement>(null);
  const tracksContentRef = useRef<HTMLDivElement>(null);
  const ctsSpanRef = useRef<HTMLSpanElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showCacheMenu, setShowCacheMenu] = useState(false);
  const [trackViewportW, setTrackViewportW] = useState(600);

  // Compute merged color runs for the AE-style preview RAM cache bar (root scene only)
  const cacheRuns = useMemo(() => {
    void cacheVersion;
    const renderer = rendererRef?.current;
    if (!renderer || !currentProject || groupStack.length > 0) return [] as { startPct: number; widthPct: number; state: number }[];
    const totalFrames = Math.max(1, Math.ceil((currentProject.durationMs / 1000) * Math.max(1, currentProject.fps)));
    const map = renderer.getCachedFrameMap(totalFrames, previewQuality);
    const runs: { startPct: number; widthPct: number; state: number }[] = [];
    let i = 0;
    while (i < map.length) {
      const st = map[i];
      let j = i + 1;
      while (j < map.length && map[j] === st) j++;
      if (st > 0) {
        runs.push({
          startPct: (i / map.length) * 100,
          widthPct: ((j - i) / map.length) * 100,
          state: st,
        });
      }
      i = j;
    }
    return runs;
  }, [rendererRef, currentProject, groupStack.length, previewQuality, cacheVersion]);

  // R-1: Restore persisted timeline height from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('am.timeline.h');
      if (saved) {
        const px = parseInt(saved, 10);
        if (Number.isFinite(px) && px >= 160 && px <= 700) {
          document.documentElement.style.setProperty('--am-timeline-h', `${px}px`);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // R-3: Measure track viewport width so centre-fixed playhead stays exact
  useEffect(() => {
    const el = scrollerRef.current ?? rulerRef.current;
    if (!el) return;
    const update = () => {
      const w = scrollerRef.current?.clientWidth || rulerRef.current?.clientWidth || 600;
      setTrackViewportW(Math.max(160, w));
    };
    update();
    const ro = new ResizeObserver(update);
    if (scrollerRef.current) ro.observe(scrollerRef.current);
    if (rulerRef.current && rulerRef.current !== scrollerRef.current) ro.observe(rulerRef.current);
    return () => ro.disconnect();
  }, [currentProject?.id, groupStack.length]);

  // Attach non-passive native wheel listener so Ctrl+wheel zoom and horizontal trackpad pan
  // never trigger Chrome's "Unable to preventDefault inside passive event listener" error.
  useEffect(() => {
    const targets = [rulerRef.current, scrollerRef.current].filter((x): x is HTMLDivElement => Boolean(x));
    if (targets.length === 0) return;
    const onWheel = (e: WheelEvent) => {
      const st = useEditorStore.getState();
      if (!st.currentProject) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        st.setTimelineZoom(st.timelinePxPerSec * factor);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        st.setIsPlaying(false);
        const maxDur = resolveActiveGroup(st.currentProject, st.groupStack).durationMs;
        const nextMs = Math.max(0, Math.min(maxDur, st.currentTimeMs + (e.deltaX / st.timelinePxPerSec) * 1000));
        st.setCurrentTimeMs(nextMs);
      }
    };
    for (const el of targets) el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      for (const el of targets) el.removeEventListener('wheel', onWheel);
    };
  }, [currentProject?.id]);

  // During playback the ruler and the track rows slide under the fixed centre playhead 60 times a
  // second. Driving that through `translate3d` from React means a full timeline reconcile per frame
  // on a device that cannot afford one, so while playing the transform is written straight to the
  // DOM from the playback clock and React only re-renders at the store's ~6 Hz commit. The committed
  // value always equals the live one at the moment of commit, so there is no jump when it lands.
  useEffect(() => {
    if (!isPlaying) return;
    const fps = currentProject?.fps ?? 30;
    let lastCtsText = '';
    const apply = (ms: number) => {
      const x = trackViewportW * 0.5 - (ms / 1000) * timelinePxPerSec;
      const t = `translate3d(${x}px, 0, 0)`;
      if (rulerContentRef.current) rulerContentRef.current.style.transform = t;
      if (tracksContentRef.current) tracksContentRef.current.style.transform = t;
      if (ctsSpanRef.current) {
        const nextText = fmtCtsTime(ms, fps);
        if (nextText !== lastCtsText) {
          lastCtsText = nextText;
          ctsSpanRef.current.textContent = nextText;
        }
      }
    };
    let raf = 0;
    const loop = () => {
      apply(playbackClock.get());
      raf = requestAnimationFrame(loop);
    };
    apply(playbackClock.get());
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, trackViewportW, timelinePxPerSec, currentProject?.fps]);

  if (!currentProject) return null;  const activeGroup = resolveActiveGroup(currentProject, groupStack);
  const activeDurationMs = activeGroup.durationMs;
  const layers = getActiveLayers();
  const totalSec = Math.max(1, activeDurationMs / 1000 + 0.5);
  const trackWidth = Math.max(400, Math.round(totalSec * timelinePxPerSec));
  const centreX = trackViewportW * 0.5;
  const contentOffset = centreX - (currentTimeMs / 1000) * timelinePxPerSec;

  // R-1: Drag top handle to resize timeline height (160px..62vh), double-click resets
  const handleTimelineResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const startY = e.clientY;
    const wrap = e.currentTarget.parentElement;
    const startH = wrap ? wrap.getBoundingClientRect().height : 300;
    const maxH = Math.round(window.innerHeight * 0.62);
    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const nextH = Math.max(160, Math.min(maxH, Math.round(startH - (ev.clientY - startY))));
      document.documentElement.style.setProperty('--am-timeline-h', `${nextH}px`);
    };
    const onUp = (ev: PointerEvent) => {
      const finalH = Math.max(160, Math.min(maxH, Math.round(startH - (ev.clientY - startY))));
      try {
        localStorage.setItem('am.timeline.h', String(finalH));
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // R-3: Drag ruler or track background to slide timeline under the fixed centre playhead (rAF-coalesced)
  const handlePanScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.am-track-bar, .am-ruler-bookmark')) return;
    const startX = e.clientX;
    const startTimeMs = currentTimeMs;
    const fps = currentProject.fps;
    let moved = false;
    let lastMs = startTimeMs;
    setIsPlaying(false);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    // Pre-collect timeline snap targets: layer starts/ends, bookmarks, scope bounds, selected layer keyframes
    const snapTargets: number[] = [0, activeDurationMs];
    for (const l of layers) {
      snapTargets.push(l.startTime, l.endTime);
    }
    for (const bm of currentProject.bookmarks) {
      snapTargets.push(bm);
    }
    const selLayer = selectedLayerIds.length === 1 ? layers.find((l) => l.id === selectedLayerIds[0]) : undefined;
    if (selLayer) {
      const kfs = collectLayerKeyframes(selLayer);
      const dur = Math.max(1, selLayer.endTime - selLayer.startTime);
      for (const kt of kfs) {
        snapTargets.push(selLayer.startTime + kt * dur);
      }
    }
    const snapThresholdMs = (8 / Math.max(1, timelinePxPerSec)) * 1000;

    let scrubRaf = 0;
    let pendingMs = startTimeMs;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      const rawMs = Math.max(0, Math.min(activeDurationMs, startTimeMs - (dx / timelinePxPerSec) * 1000));
      if (snapEnabled && !ev.altKey) {
        lastMs = snapTimelineMs(rawMs, snapTargets, snapThresholdMs).ms;
      } else {
        lastMs = rawMs;
      }
      pendingMs = lastMs;
      // Instant DOM feedback at display refresh while coalescing React/WebGL commits to 1/frame
      const x = trackViewportW * 0.5 - (lastMs / 1000) * timelinePxPerSec;
      const t = `translate3d(${x}px, 0, 0)`;
      if (rulerContentRef.current) rulerContentRef.current.style.transform = t;
      if (tracksContentRef.current) tracksContentRef.current.style.transform = t;
      if (ctsSpanRef.current) ctsSpanRef.current.textContent = fmtCtsTime(lastMs, fps);
      if (scrubRaf) return;
      scrubRaf = requestAnimationFrame(() => {
        scrubRaf = 0;
        setCurrentTimeMs(pendingMs);
      });
    };
    const onUp = () => {
      if (scrubRaf) {
        cancelAnimationFrame(scrubRaf);
        scrubRaf = 0;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) {
        setCurrentTimeMs(lastMs);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    handlePanScrubDown(e);
  };

  const handleTrackMove = (e: React.PointerEvent, layerIdx: number, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    const layer = layers[layerIdx];
    if (!layer || layer.locked) return;
    const layerId = layer.id;
    const startX = e.clientX;
    const origStart = layer.startTime;
    const origEnd = layer.endTime;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const snapTargets: number[] = [0, activeDurationMs, currentTimeMs];
    for (let i = 0; i < layers.length; i++) {
      if (i === layerIdx) continue;
      snapTargets.push(layers[i].startTime, layers[i].endTime);
    }
    for (const bm of currentProject.bookmarks) {
      snapTargets.push(bm);
    }
    const snapThresholdMs = (8 / Math.max(1, timelinePxPerSec)) * 1000;

    const update = (dxPx: number, record: boolean, altKey: boolean) => {
      const dMs = Math.round((dxPx / timelinePxPerSec) * 1000);
      const doSnap = snapEnabled && !altKey;
      mutateLayer(
        layerId,
        (target) => {
          if (mode === 'move') {
            const dur = origEnd - origStart;
            let ns = Math.max(0, origStart + dMs);
            if (doSnap) {
              const snapStart = snapTimelineMs(ns, snapTargets, snapThresholdMs);
              const snapEnd = snapTimelineMs(ns + dur, snapTargets, snapThresholdMs);
              const distStart = snapStart.snapped ? Math.abs(snapStart.ms - ns) : Infinity;
              const distEnd = snapEnd.snapped ? Math.abs(snapEnd.ms - (ns + dur)) : Infinity;
              if (distStart <= distEnd && distStart < Infinity) {
                ns = Math.max(0, snapStart.ms);
              } else if (distEnd < Infinity) {
                ns = Math.max(0, snapEnd.ms - dur);
              }
            }
            target.startTime = ns;
            target.endTime = ns + dur;
          } else if (mode === 'left') {
            let ns = Math.max(0, Math.min(origEnd - 120, origStart + dMs));
            if (doSnap) {
              const s = snapTimelineMs(ns, snapTargets, snapThresholdMs);
              if (s.snapped) ns = Math.max(0, Math.min(origEnd - 120, s.ms));
            }
            target.startTime = ns;
          } else {
            let ne = Math.max(origStart + 120, origEnd + dMs);
            if (doSnap) {
              const s = snapTimelineMs(ne, snapTargets, snapThresholdMs);
              if (s.snapped) ne = Math.max(origStart + 120, s.ms);
            }
            target.endTime = ne;
          }
        },
        record
      );
    };

    let moveRaf = 0;
    let lastDx = 0;
    let lastAlt = false;
    const onMove = (ev: PointerEvent) => {
      lastDx = ev.clientX - startX;
      lastAlt = ev.altKey;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        update(lastDx, false, lastAlt);
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
      }
      update(ev.clientX - startX, true, ev.altKey);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleTrackMoveRef = useRef(handleTrackMove);
  handleTrackMoveRef.current = handleTrackMove;
  const onTrackPointerDownStable = React.useCallback(
    (e: React.PointerEvent, idx: number, mode: 'move' | 'left' | 'right') => {
      handleTrackMoveRef.current(e, idx, mode);
    },
    []
  );

  const selectAllLayers = () => {
    if (layers.length === 0) return;
    selectLayer(layers[0].id, false);
    for (let i = 1; i < layers.length; i++) {
      selectLayer(layers[i].id, true);
    }
    setShowOverflowMenu(false);
  };

  // Generate ruler ticks every 0.5s or 1s (timeline_tick_sec = 18dp, timeline_tick_halfsec = 12dp)
  const tickStepSec = timelinePxPerSec >= 100 ? 0.5 : 1.0;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= totalSec; s += tickStepSec) {
      out.push(Number(s.toFixed(2)));
    }
    return out;
  }, [totalSec, tickStepSec]);

  // Render layers top-to-bottom (highest Z-order at top like Alight Motion)
  const displayIndices = useMemo(() => layers.map((_, idx) => idx).reverse(), [layers]);
  const selectedSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);

  return (
    <div className="am-timeline-wrap">
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0 && selectedLayerIds.length > 0) {
            replaceMediaOnLayers(e.target.files, selectedLayerIds, groupStack, mutateProject);
          }
          e.target.value = '';
          setShowOverflowMenu(false);
        }}
      />

      {/* R-1: Top resize handle (drag to resize timeline, double-click to reset) */}
      <div
        className="am-timeline-resize-handle"
        onPointerDown={handleTimelineResizeDown}
        onDoubleClick={() => {
          try {
            localStorage.removeItem('am.timeline.h');
          } catch {
            // ignore
          }
          document.documentElement.style.removeProperty('--am-timeline-h');
        }}
        title="Drag to resize timeline (double-click to reset)"
      />

      {/* Top Row: CTS Timecode Box + Centre-Fixed Scrubbable Time Ruler */}
      <div className="am-timeline-top-row">
        {/* APK timeline_cts_bg_width */}
        <button
          type="button"
          className={`am-timeline-cts ${loop ? 'loop-on' : ''}`}
          onClick={() => setLoop(!loop)}
          title="Current Time (tap to toggle loop playback)"
        >
          <span ref={ctsSpanRef}>{fmtCtsTime(currentTimeMs, currentProject.fps)}</span>
        </button>

        <div
          ref={rulerRef}
          className="am-timeline-ruler"
          onPointerDown={handleRulerDown}
        >
          <div
            ref={rulerContentRef}
            style={{
              width: trackWidth,
              height: '100%',
              position: 'relative',
              transform: `translate3d(${contentOffset}px, 0, 0)`,
              willChange: 'transform',
            }}
          >
            {/* AE-style Preview RAM Cache Bar (green=full, amber=adaptive, subtle red=uncached) */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowCacheMenu((v) => !v);
              }}
              title="Preview RAM Cache Bar (click to clear or pre-render)"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: (activeDurationMs / 1000) * timelinePxPerSec,
                height: 4,
                background: 'rgba(255, 95, 115, 0.22)',
                cursor: 'pointer',
                zIndex: 5,
              }}
            >
              {cacheRuns.map((run, idx) => (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: `${run.startPct}%`,
                    width: `${run.widthPct}%`,
                    top: 0,
                    height: '100%',
                    background: run.state === 2 ? '#22D38B' : '#F5B742',
                  }}
                />
              ))}
            </div>

            {ticks.map((s) => {
              const left = s * timelinePxPerSec;
              const isMajor = Math.abs(s - Math.round(s)) < 0.01;
              return (
                <div
                  key={s}
                  style={{
                    position: 'absolute',
                    left,
                    bottom: 0,
                    height: isMajor ? 18 : 10,
                    borderLeft: `1px solid ${isMajor ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.16)'}`,
                  }}
                >
                  {isMajor && (
                    <span className="am-ruler-sec-label">
                      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(Math.round(s % 60)).padStart(2, '0')}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Beat Bookmarks (root timeline only — don't leak past group duration inside Edit Group) */}
            {groupStack.length === 0 && currentProject.bookmarks.map((bm) => (
              <div
                key={bm}
                className="am-ruler-bookmark"
                style={{ left: (bm / 1000) * timelinePxPerSec - 6 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPlaying(false);
                  setCurrentTimeMs(bm);
                }}
                title={`Beat Bookmark (${(bm / 1000).toFixed(2)}s)`}
              />
            ))}
          </div>

          {/* R-3: Fixed Centre Playhead Cap (locked to exact centreX px so ruler & tracks never desync) */}
          <div className="am-centre-playhead-cap" style={{ left: centreX }} />

          {showCacheMenu && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 22,
                right: 8,
                zIndex: 40,
                background: 'var(--am-surface-2, #1E2239)',
                border: '1px solid var(--am-border)',
                borderRadius: 8,
                padding: 6,
                display: 'flex',
                gap: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              }}
            >
              <button
                type="button"
                className="am-btn am-btn-accent"
                style={{ padding: '4px 8px', fontSize: 11 }}
                onClick={() => {
                  setShowCacheMenu(false);
                  onRenderCacheNow?.();
                }}
              >
                Render preview now
              </button>
              <button
                type="button"
                className="am-btn"
                style={{ padding: '4px 8px', fontSize: 11 }}
                onClick={() => {
                  setShowCacheMenu(false);
                  onClearCache?.();
                }}
              >
                Clear cache
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Body: 70dp Left Layer Headers (timeline_header.xml) + Scrollable Track Lanes (timeline_item.xml) */}
      <div className="am-timeline-body">
        {/* APK timeline_header.xml (70dp column: trackTag 10dp + layerVisibilityToggle + layerSelectionCheckmark) */}
        <div ref={headersRef} className="am-timeline-headers">
          {displayIndices.map((idx) => {
            const layer = layers[idx];
            return (
              <TimelineHeaderRow
                key={layer.id}
                layer={layer}
                isSelected={selectedSet.has(layer.id)}
                hasMissingFont={Boolean(missingFontLayerIds?.has(layer.id))}
                onToggleVisible={toggleLayerVisible}
                onSelect={selectLayer}
                onEnterGroup={enterGroup}
                onOpenMissingFonts={onOpenMissingFonts}
              />
            );
          })}
        </div>

        {/* Scrollable Layer Tracks (slides under fixed centre playhead) */}
        <div
          ref={scrollerRef}
          className="am-timeline-tracks am-scroll"
          style={{ overflowX: 'hidden', position: 'relative' }}
          onPointerDown={handlePanScrubDown}
          onScroll={(e) => {
            if (headersRef.current) headersRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) selectLayer('');
          }}
        >
          <div
            ref={tracksContentRef}
            style={{
              width: trackWidth,
              minHeight: '100%',
              position: 'relative',
              transform: `translate3d(${contentOffset}px, 0, 0)`,
              willChange: 'transform',
            }}
          >
            {layers.length === 0 && (
              <div style={{ padding: 24, color: 'var(--am-text-muted)', fontSize: 13 }}>
                Tap the mint <strong>+</strong> button to add Shapes, Text, Media, Audio, Camera, or Vector Drawings.
              </div>
            )}

            {displayIndices.map((idx, visualPos) => {
              const layer = layers[idx];
              return (
                <TimelineTrackRow
                  key={layer.id}
                  layer={layer}
                  idx={idx}
                  visualPos={visualPos}
                  totalCount={displayIndices.length}
                  isSelected={selectedSet.has(layer.id)}
                  timelinePxPerSec={timelinePxPerSec}
                  onSelect={selectLayer}
                  onEnterGroup={enterGroup}
                  onReorderLayer={reorderLayer}
                  onTrackPointerDown={onTrackPointerDownStable}
                />
              );
            })}

          </div>

          {/* R-3: Fixed Centre Playhead Line (locked to exact centreX px) */}
          <div className="am-centre-playhead" style={{ left: centreX }} />
        </div>
      </div>

      {/* APK @id/timelineOverflowButton (40x40dp bottom-left) */}
      <button
        type="button"
        className="am-timeline-overflow-btn"
        onClick={() => setShowOverflowMenu((v) => !v)}
        title="Timeline Options & Multi-Select"
      >
        <AmIcon name="ic_more_vert_white_24dp" fallback="more" size={18} />
      </button>

      {showOverflowMenu && (
        <div className="am-popup-menu" style={{ left: 10, bottom: 50, width: 220 }}>
          <button type="button" className="am-popup-item" onClick={selectAllLayers}>
            Select All Layers ({layers.length})
          </button>
          <button
            type="button"
            className="am-popup-item"
            disabled={selectedLayerIds.length === 0}
            onClick={() => {
              selectLayer('');
              setShowOverflowMenu(false);
            }}
          >
            Deselect All
          </button>
          <button
            type="button"
            className="am-popup-item"
            disabled={selectedLayerIds.length === 0}
            onClick={() => replaceInputRef.current?.click()}
          >
            Replace Selected Media ({selectedLayerIds.length})
          </button>
          <div className="am-popup-sep" />
          <div style={{ padding: '6px 10px' }}>
            <label
              htmlFor="tl-zoom-slider"
              style={{ display: 'block', fontSize: 11, color: 'var(--am-text-secondary)', marginBottom: 4 }}
            >
              Timeline Zoom ({timelinePxPerSec}px/s)
            </label>
            <input
              id="tl-zoom-slider"
              name="timelineZoom"
              type="range"
              min={40}
              max={360}
              value={timelinePxPerSec}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--am-accent)' }}
            />
          </div>
        </div>
      )}

      {/* APK @id/buttonAdd (add_layer_button bottom-right) */}
      <button
        type="button"
        className="am-editor-fab"
        onClick={() => setModal('showAddLayerPopup', true)}
        aria-label="Add Layer"
        title="Add Layer (Shape, Text, Media, Audio, Drawing, Camera)"
      >
        <AmIcon name="ic_add_project_plus" fallback="plus" size={26} />
      </button>
    </div>
  );
};
