import React, { useEffect, useRef, useState } from 'react';
import { replaceMediaOnLayers } from '../../engine/mediaReplace';
import { useEditorStore } from '../../store/useEditorStore';
import type { Layer } from '../../types/project';
import { AmIcon } from '../components/AmIcon';

function collectLayerKeyframes(layer: Layer): number[] {
  const ts = new Set<number>();
  const addProp = (kfs?: { t: number }[]) => {
    if (!kfs) return;
    for (const k of kfs) ts.add(Math.round(k.t * 1000) / 1000);
  };
  addProp(layer.opacity.keyframes);
  addProp(layer.transform.location.keyframes);
  addProp(layer.transform.rotation.keyframes);
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
  return Array.from(ts);
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

export const Timeline: React.FC = () => {
  const {
    currentProject,
    currentTimeMs,
    timelinePxPerSec,
    selectedLayerIds,
    groupStack,
    loop,
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
    setModal,
  } = useEditorStore();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [trackViewportW, setTrackViewportW] = useState(600);

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
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setTrackViewportW(Math.max(160, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentProject?.id]);

  if (!currentProject) return null;
  const layers = getActiveLayers();
  const totalSec = Math.max(2, currentProject.durationMs / 1000 + 1);
  const trackWidth = Math.max(900, Math.round(totalSec * timelinePxPerSec));
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

  // R-3: Drag ruler or track background to slide timeline under the fixed centre playhead
  const handlePanScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.am-track-bar, .am-ruler-bookmark')) return;
    const startX = e.clientX;
    const startTimeMs = currentTimeMs;
    let moved = false;
    let lastMs = startTimeMs;
    setIsPlaying(false);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      lastMs = Math.max(0, Math.min(currentProject.durationMs, startTimeMs - (dx / timelinePxPerSec) * 1000));
      setCurrentTimeMs(lastMs);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        // Snap to nearest keyframe within 6px of centre playhead
        const selLayer = selectedLayerIds.length === 1 ? layers.find((l) => l.id === selectedLayerIds[0]) : undefined;
        if (selLayer) {
          const kfs = collectLayerKeyframes(selLayer);
          const dur = Math.max(1, selLayer.endTime - selLayer.startTime);
          let bestMs = lastMs;
          let bestPx = 6.01;
          for (const kt of kfs) {
            const kfMs = selLayer.startTime + kt * dur;
            const distPx = (Math.abs(kfMs - lastMs) / 1000) * timelinePxPerSec;
            if (distPx < bestPx) {
              bestPx = distPx;
              bestMs = kfMs;
            }
          }
          if (bestPx <= 6) setCurrentTimeMs(bestMs);
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    handlePanScrubDown(e);
  };

  const handleTimelineWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setTimelineZoom(timelinePxPerSec * factor);
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      setIsPlaying(false);
      const nextMs = Math.max(0, Math.min(currentProject.durationMs, currentTimeMs + (e.deltaX / timelinePxPerSec) * 1000));
      setCurrentTimeMs(nextMs);
    }
  };

  const handleTrackMove = (e: React.PointerEvent, layerIdx: number, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    const layer = layers[layerIdx];
    if (!layer || layer.locked) return;
    const startX = e.clientX;
    const origStart = layer.startTime;
    const origEnd = layer.endTime;

    const update = (dxPx: number, record: boolean) => {
      const dMs = Math.round((dxPx / timelinePxPerSec) * 1000);
      mutateProject((proj) => {
        let list = proj.layers;
        for (const gid of groupStack) {
          const g = list.find((x) => x.id === gid);
          if (g?.groupLayers) list = g.groupLayers;
        }
        const target = list[layerIdx];
        if (!target) return;
        if (mode === 'move') {
          const dur = origEnd - origStart;
          const ns = Math.max(0, origStart + dMs);
          target.startTime = ns;
          target.endTime = ns + dur;
        } else if (mode === 'left') {
          target.startTime = Math.max(0, Math.min(origEnd - 120, origStart + dMs));
        } else {
          target.endTime = Math.max(origStart + 120, origEnd + dMs);
        }
      }, record);
    };

    const onMove = (ev: PointerEvent) => update(ev.clientX - startX, false);
    const onUp = (ev: PointerEvent) => {
      update(ev.clientX - startX, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
  const ticks: number[] = [];
  for (let s = 0; s <= totalSec; s += tickStepSec) {
    ticks.push(Number(s.toFixed(2)));
  }

  // Render layers top-to-bottom (highest Z-order at top like Alight Motion)
  const displayIndices = layers.map((_, idx) => idx).reverse();

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
          <span>{fmtCtsTime(currentTimeMs, currentProject.fps)}</span>
        </button>

        <div
          ref={rulerRef}
          className="am-timeline-ruler"
          onPointerDown={handleRulerDown}
          onWheel={handleTimelineWheel}
        >
          <div
            style={{
              width: trackWidth,
              height: '100%',
              position: 'relative',
              transform: `translate3d(${contentOffset}px, 0, 0)`,
              willChange: 'transform',
            }}
          >
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

            {/* Beat Bookmarks */}
            {currentProject.bookmarks.map((bm) => (
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

          {/* R-3: Fixed Centre Playhead Cap */}
          <div className="am-centre-playhead-cap" />
        </div>
      </div>

      {/* Main Body: 70dp Left Layer Headers (timeline_header.xml) + Scrollable Track Lanes (timeline_item.xml) */}
      <div className="am-timeline-body">
        {/* APK timeline_header.xml (70dp column: trackTag 10dp + layerVisibilityToggle + layerSelectionCheckmark) */}
        <div ref={headersRef} className="am-timeline-headers">
          {displayIndices.map((idx) => {
            const layer = layers[idx];
            const isSelected = selectedLayerIds.includes(layer.id);
            const tagBg = LAYER_GRADIENTS[layer.colorIndex % LAYER_GRADIENTS.length];
            return (
              <div
                key={layer.id}
                className={`am-track-header ${isSelected ? 'selected' : ''}`}
              >
                <div className="am-track-tag" style={{ background: tagBg }} />

                <button
                  type="button"
                  className="am-track-eye-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisible(layer.id);
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
                    selectLayer(layer.id, true);
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
                      enterGroup(layer.id);
                    }}
                  >
                    ›
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Scrollable Layer Tracks (slides under fixed centre playhead) */}
        <div
          ref={scrollerRef}
          className="am-timeline-tracks am-scroll"
          style={{ overflowX: 'hidden', position: 'relative' }}
          onPointerDown={handlePanScrubDown}
          onWheel={handleTimelineWheel}
          onScroll={(e) => {
            if (headersRef.current) headersRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) selectLayer('');
          }}
        >
          <div
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
              const isSelected = selectedLayerIds.includes(layer.id);
              const left = (layer.startTime / 1000) * timelinePxPerSec;
              const width = Math.max(32, ((layer.endTime - layer.startTime) / 1000) * timelinePxPerSec);
              const kfs = collectLayerKeyframes(layer);

              return (
                <div key={layer.id} className="am-track-row">
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
                      selectLayer(layer.id, e.shiftKey || e.ctrlKey || e.metaKey);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (layer.type === 'group') enterGroup(layer.id);
                    }}
                    onPointerDown={(e) => handleTrackMove(e, idx, 'move')}
                  >
                    {/* APK @id/trimGripLeft (30dp when selected) */}
                    <div
                      className="am-trim-grip left"
                      onPointerDown={(e) => handleTrackMove(e, idx, 'left')}
                      title="Drag to Trim Start"
                    >
                      <span className="am-trim-grip-bar" />
                    </div>

                    <div className="am-track-label-wrap">
                      {(layer.blendMode === 'mask' || layer.blendMode === 'exclude') && (
                        <span className="am-track-mask-icon">↙︎</span>
                      )}
                      <span className="am-track-label">{layer.label}</span>

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
                              reorderLayer(idx, idx + 1);
                            }}
                            title="Move Layer Up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            disabled={visualPos === displayIndices.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              reorderLayer(idx, idx - 1);
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
                      onPointerDown={(e) => handleTrackMove(e, idx, 'right')}
                      title="Drag to Trim End"
                    >
                      <span className="am-trim-grip-bar" />
                    </div>
                  </div>
                </div>
              );
            })}

          </div>

          {/* R-3: Fixed Centre Playhead Line */}
          <div className="am-centre-playhead" />
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
