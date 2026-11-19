import React, { useRef, useState } from 'react';
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

  if (!currentProject) return null;
  const layers = getActiveLayers();
  const totalSec = Math.max(2, currentProject.durationMs / 1000 + 1);
  const trackWidth = Math.max(900, Math.round(totalSec * timelinePxPerSec));
  const playheadX = (currentTimeMs / 1000) * timelinePxPerSec;

  const scrubFromClientX = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + (scrollerRef.current?.scrollLeft ?? 0);
    const ms = Math.max(0, Math.min(currentProject.durationMs, (x / timelinePxPerSec) * 1000));
    setIsPlaying(false);
    setCurrentTimeMs(ms);
  };

  const handleRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    scrubFromClientX(e.clientX, el);
    const onMove = (ev: PointerEvent) => scrubFromClientX(ev.clientX, el);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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

      {/* Top Row: 70dp CTS Timecode Box + Scrubbable Time Ruler */}
      <div className="am-timeline-top-row">
        {/* APK timeline_cts_bg_width (70dp) */}
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
          onScroll={(e) => {
            if (scrollerRef.current) scrollerRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
        >
          <div style={{ width: trackWidth, height: '100%', position: 'relative' }}>
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

            {/* Playhead Handle */}
            <div
              className="am-ruler-playhead-cap"
              style={{ left: playheadX - 7 }}
            />
          </div>
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
              </div>
            );
          })}
        </div>

        {/* Scrollable Layer Tracks */}
        <div
          ref={scrollerRef}
          className="am-timeline-tracks am-scroll"
          onScroll={(e) => {
            if (rulerRef.current) rulerRef.current.scrollLeft = e.currentTarget.scrollLeft;
            if (headersRef.current) headersRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) selectLayer('');
          }}
        >
          <div style={{ width: trackWidth, minHeight: '100%', position: 'relative' }}>
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

            {/* Vertical Playhead Line (1.5dp) */}
            <div className="am-playhead-line" style={{ left: playheadX }} />
          </div>
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
