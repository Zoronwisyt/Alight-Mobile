import React, { useRef, useState } from 'react';
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

export const Timeline: React.FC = () => {
  const {
    currentProject,
    currentTimeMs,
    timelinePxPerSec,
    selectedLayerIds,
    groupStack,
    getActiveLayers,
    setCurrentTimeMs,
    setIsPlaying,
    selectLayer,
    toggleLayerVisible,
    reorderLayer,
    mutateProject,
    setModal,
  } = useEditorStore();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);

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

  // Generate ruler ticks every 0.5s or 1s
  const tickStepSec = timelinePxPerSec >= 100 ? 0.5 : 1.0;
  const ticks: number[] = [];
  for (let s = 0; s <= totalSec; s += tickStepSec) {
    ticks.push(Number(s.toFixed(2)));
  }

  // Render layers top-to-bottom (highest Z-order at top like Alight Motion)
  const displayIndices = layers.map((_, idx) => idx).reverse();

  return (
    <div className="am-timeline-wrap">
      {/* Scrubbable Time Ruler */}
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
                  height: isMajor ? 14 : 7,
                  borderLeft: `1px solid ${isMajor ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.18)'}`,
                }}
              >
                {isMajor && (
                  <span style={{ position: 'absolute', left: 3, top: -8, fontSize: 10, color: 'var(--am-text-muted)' }}>
                    {s}s
                  </span>
                )}
              </div>
            );
          })}

          {/* Beat Bookmarks */}
          {currentProject.bookmarks.map((bm) => (
            <div
              key={bm}
              style={{
                position: 'absolute',
                left: (bm / 1000) * timelinePxPerSec - 5,
                top: 2,
                width: 10,
                height: 10,
                background: 'var(--am-gold)',
                clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
              }}
            />
          ))}

          {/* Playhead Handle */}
          <div
            style={{
              position: 'absolute',
              left: playheadX - 6,
              bottom: 0,
              width: 12,
              height: 14,
              background: 'var(--am-accent)',
              clipPath: 'polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%)',
            }}
          />
        </div>
      </div>

      {/* Scrollable Layer Tracks */}
      <div
        ref={scrollerRef}
        className="am-timeline-tracks am-scroll"
        onScroll={(e) => {
          if (rulerRef.current) rulerRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) selectLayer('');
        }}
      >
        <div style={{ width: trackWidth, minHeight: '100%', position: 'relative', paddingLeft: 4 }}>
          {layers.length === 0 && (
            <div style={{ padding: 24, color: 'var(--am-text-muted)', fontSize: 13 }}>
              Tap the glowing <strong>+</strong> button to add Shapes, Text, Media, Audio, Camera, or Vector Drawings.
            </div>
          )}

          {displayIndices.map((idx, visualPos) => {
            const layer = layers[idx];
            const isSelected = selectedLayerIds.includes(layer.id);
            const left = (layer.startTime / 1000) * timelinePxPerSec;
            const width = Math.max(32, ((layer.endTime - layer.startTime) / 1000) * timelinePxPerSec);
            const durMs = Math.max(1, layer.endTime - layer.startTime);
            const kfs = collectLayerKeyframes(layer);

            return (
              <div key={layer.id} className="am-track-row">
                {/* Layer Track Bar */}
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
                    selectLayer(layer.id, multiSelectMode || e.shiftKey || e.ctrlKey || e.metaKey);
                  }}
                  onPointerDown={(e) => handleTrackMove(e, idx, 'move')}
                >
                  <div
                    className="am-trim-grip"
                    onPointerDown={(e) => handleTrackMove(e, idx, 'left')}
                    title="Drag to Trim Start"
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, padding: '0 6px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLayerVisible(layer.id);
                      }}
                      style={{ color: '#081318', display: 'flex', alignItems: 'center' }}
                      title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                    >
                      <AmIcon name={layer.visible ? 'ic_visibility' : 'ic_visibility_off'} fallback={layer.visible ? 'eye' : 'eyeOff'} size={14} />
                    </button>

                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {layer.label}
                    </span>

                    {layer.effects.length > 0 && (
                      <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 99, background: 'rgba(0,0,0,0.22)', color: '#fff' }}>
                        {layer.effects.length} fx
                      </span>
                    )}

                    {/* Z-order move up/down buttons when selected */}
                    {isSelected && (
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
                        <button
                          type="button"
                          disabled={visualPos === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            reorderLayer(idx, idx + 1);
                          }}
                          style={{ color: '#081318', fontSize: 11, padding: '0 3px' }}
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
                          style={{ color: '#081318', fontSize: 11, padding: '0 3px' }}
                          title="Move Layer Down"
                        >
                          ▼
                        </button>
                      </span>
                    )}
                  </div>

                  {/* Audio Waveform Preview */}
                  {layer.type === 'audio' && layer.audioData?.waveform && (
                    <div style={{ position: 'absolute', inset: '4px 12px', display: 'flex', alignItems: 'center', gap: 2, opacity: 0.35, pointerEvents: 'none' }}>
                      {layer.audioData.waveform.slice(0, 48).map((v, wi) => (
                        <div key={wi} style={{ flex: 1, height: `${Math.max(15, v * 100)}%`, background: '#081318', borderRadius: 1 }} />
                      ))}
                    </div>
                  )}

                  {/* Keyframe Diamonds on Track */}
                  {kfs.map((kt, ki) => (
                    <div
                      key={ki}
                      style={{
                        position: 'absolute',
                        left: `${Math.max(2, Math.min(98, kt * 100))}%`,
                        bottom: 3,
                        width: 7,
                        height: 7,
                        background: '#FFFFFF',
                        border: '1px solid #081318',
                        transform: 'translateX(-50%) rotate(45deg)',
                        pointerEvents: 'none',
                      }}
                    />
                  ))}

                  <div
                    className="am-trim-grip"
                    onPointerDown={(e) => handleTrackMove(e, idx, 'right')}
                    title="Drag to Trim End"
                  />
                </div>
              </div>
            );
          })}

          {/* Vertical Playhead Line */}
          <div className="am-playhead-line" style={{ left: playheadX }} />
        </div>
      </div>

      {/* Mobile-friendly Multi-Select Toggle */}
      <button
        type="button"
        className={`am-btn ${multiSelectMode ? 'am-btn-primary' : ''}`}
        onClick={() => setMultiSelectMode((v) => !v)}
        title="Toggle Multi-Select Mode (tap multiple layers)"
        style={{
          position: 'absolute',
          left: 10,
          bottom: 12,
          zIndex: 18,
          padding: '6px 10px',
          fontSize: 11,
          borderRadius: 99,
          boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
        }}
      >
        {multiSelectMode ? `Multi (${selectedLayerIds.length})` : 'Multi'}
      </button>

      {/* Floating Mint + Add Layer Button */}
      <button
        type="button"
        className="am-editor-fab"
        onClick={() => setModal('showAddLayerPopup', true)}
        aria-label="Add Layer"
        title="Add Layer (Shape, Text, Media, Audio, Drawing, Camera)"
      >
        <AmIcon name="ic_add_project_plus" fallback="plus" size={24} />
      </button>
    </div>
  );
};
