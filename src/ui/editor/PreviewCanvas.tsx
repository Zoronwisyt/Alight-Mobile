import React, { useEffect, useRef, useState } from 'react';
import { evalAnimatable, evalRemappedTime } from '../../engine/animation';
import { getShapeById, parseDefaultParamValue } from '../../engine/catalog';
import { evaluateShapeHandles } from '../../engine/scriptRuntime';
import { useEditorStore } from '../../store/useEditorStore';
import { LayerQuickActions } from './LayerQuickActions';

interface PreviewCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onVisibilityPauseChange: (paused: boolean) => void;
}

export const PreviewCanvas: React.FC<PreviewCanvasProps> = ({ canvasRef, onVisibilityPauseChange }) => {
  const {
    currentProject,
    currentTimeMs,
    selectedLayerIds,
    groupStack,
    getActiveLayers,
    inspectorTab,
    gridVisible,
    snapEnabled,
    previewZoom,
    setPreviewZoom,
    previewPan,
    setPreviewPan,
    selectLayer,
    mutateProject,
    drawingBrushColor,
    drawingBrushWidth,
    drawingBrushOpacity,
  } = useEditorStore();

  const wrapRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 360, h: 360 });
  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });

  // Modern Web Guidance: Pause background WebGL rendering when off-screen via contentvisibilityautostatechange
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onStateChange = (e: Event) => {
      const skipped = Boolean((e as unknown as { skipped?: boolean }).skipped);
      onVisibilityPauseChange(skipped);
    };
    el.addEventListener('contentvisibilityautostatechange', onStateChange);
    let observer: IntersectionObserver | null = null;
    if (!('contentVisibility' in document.documentElement.style)) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const ent of entries) onVisibilityPauseChange(!ent.isIntersecting);
        },
        { rootMargin: '200px' }
      );
      observer.observe(el);
    }
    return () => {
      el.removeEventListener('contentvisibilityautostatechange', onStateChange);
      observer?.disconnect();
    };
  }, [onVisibilityPauseChange]);

  // Fit project aspect cleanly inside stage container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !currentProject) return;
    const compute = () => {
      const r = el.getBoundingClientRect();
      const padW = Math.max(120, r.width - 72);
      const padH = Math.max(120, r.height - 40);
      const asp = currentProject.width / Math.max(1, currentProject.height);
      let w = padW;
      let h = w / asp;
      if (h > padH) {
        h = padH;
        w = h * asp;
      }
      setStageSize({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentProject?.width, currentProject?.height]);

  if (!currentProject) return null;

  const layers = getActiveLayers();
  const singleLayer = selectedLayerIds.length === 1 ? layers.find((l) => l.id === selectedLayerIds[0]) : undefined;
  const projScale = stageSize.w / Math.max(1, currentProject.width);

  const clientToProject = (clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const r = canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * currentProject.width;
    const py = ((clientY - r.top) / r.height) * currentProject.height;
    return [px, py];
  };

  // Freehand Drawing Mode
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || e.altKey) {
      // Middle-mouse / Alt pan
      const sx = e.clientX;
      const sy = e.clientY;
      const [opx, opy] = previewPan;
      const onMove = (ev: PointerEvent) => setPreviewPan([opx + ev.clientX - sx, opy + ev.clientY - sy]);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    if (inspectorTab === 'drawing' && singleLayer?.type === 'freehand') {
      const [px, py] = clientToProject(e.clientX, e.clientY);
      const { remappedNormT } = evalRemappedTime(singleLayer, currentTimeMs);
      const loc = evalAnimatable(singleLayer.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0]);
      const pts: { x: number; y: number; pressure: number }[] = [{ x: px - loc[0], y: py - loc[1], pressure: e.pressure || 0.7 }];
      let strokeIdx = -1;

      mutateProject((proj) => {
        let list = proj.layers;
        for (const gid of groupStack) {
          const g = list.find((x) => x.id === gid);
          if (g?.groupLayers) list = g.groupLayers;
        }
        const target = list.find((x) => x.id === singleLayer.id);
        if (!target) return;
        target.freehandStrokes = target.freehandStrokes ?? [];
        target.freehandStrokes.push({
          points: pts,
          color: drawingBrushColor,
          width: drawingBrushWidth,
          opacity: drawingBrushOpacity,
        });
        strokeIdx = target.freehandStrokes.length - 1;
      }, false);

      const onMove = (ev: PointerEvent) => {
        const [nx, ny] = clientToProject(ev.clientX, ev.clientY);
        mutateProject((proj) => {
          let list = proj.layers;
          for (const gid of groupStack) {
            const g = list.find((x) => x.id === gid);
            if (g?.groupLayers) list = g.groupLayers;
          }
          const target = list.find((x) => x.id === singleLayer.id);
          const st = target?.freehandStrokes?.[strokeIdx];
          if (st) st.points.push({ x: nx - loc[0], y: ny - loc[1], pressure: ev.pressure || 0.7 });
        }, false);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Hit-test visible layers top-down when clicking canvas
    if (e.target === e.currentTarget || e.target === canvasRef.current) {
      const [px, py] = clientToProject(e.clientX, e.clientY);
      let hit: string | null = null;
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        if (!l.visible || l.locked || l.type === 'audio' || currentTimeMs < l.startTime || currentTimeMs > l.endTime) continue;
        const { remappedNormT } = evalRemappedTime(l, currentTimeMs);
        const loc = evalAnimatable(l.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0]);
        if (Math.abs(px - loc[0]) < 240 && Math.abs(py - loc[1]) < 240) {
          hit = l.id;
          break;
        }
      }
      if (hit) selectLayer(hit, e.shiftKey);
      else selectLayer('');
    }
  };

  // Drag selected layer position directly on canvas
  const startLayerDrag = (e: React.PointerEvent, mode: 'move' | 'rotate' | 'scale') => {
    e.stopPropagation();
    if (!singleLayer || singleLayer.locked) return;
    const { remappedNormT } = evalRemappedTime(singleLayer, currentTimeMs);
    const startLoc = evalAnimatable(singleLayer.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0]);
    const startRot = evalAnimatable(singleLayer.transform.rotation, remappedNormT, 0);
    const startScale = evalAnimatable(singleLayer.transform.scale, remappedNormT, [1, 1]);
    const sx = e.clientX;
    const sy = e.clientY;

    const applyDelta = (cx: number, cy: number, record: boolean) => {
      const dx = (cx - sx) / (projScale * previewZoom);
      const dy = (cy - sy) / (projScale * previewZoom);
      mutateProject((proj) => {
        let list = proj.layers;
        for (const gid of groupStack) {
          const g = list.find((x) => x.id === gid);
          if (g?.groupLayers) list = g.groupLayers;
        }
        const target = list.find((x) => x.id === singleLayer.id);
        if (!target) return;
        const { remappedNormT: nt } = evalRemappedTime(target, currentTimeMs);
        const writeAnim = (prop: { value: any; keyframes: any[] }, val: any) => {
          prop.value = val;
          if (prop.keyframes.length > 0) {
            const idx = prop.keyframes.findIndex((k) => Math.abs(k.t - nt) < 0.015);
            if (idx !== -1) prop.keyframes[idx].v = val;
            else {
              prop.keyframes.push({ t: nt, v: val });
              prop.keyframes.sort((a, b) => a.t - b.t);
            }
          }
        };

        if (mode === 'move') {
          let nx = startLoc[0] + dx;
          let ny = startLoc[1] + dy;
          let snappedX = false;
          let snappedY = false;
          if (snapEnabled) {
            if (Math.abs(nx - proj.width / 2) < 18) { nx = proj.width / 2; snappedX = true; }
            if (Math.abs(ny - proj.height / 2) < 18) { ny = proj.height / 2; snappedY = true; }
          }
          setSnapGuide({ x: snappedX, y: snappedY });
          writeAnim(target.transform.location, [nx, ny, startLoc[2] ?? 0]);
        } else if (mode === 'rotate') {
          writeAnim(target.transform.rotation, Math.round((startRot + dx * 0.6) * 10) / 10);
        } else if (mode === 'scale') {
          const factor = Math.max(0.05, 1 + (dx - dy) * 0.004);
          writeAnim(target.transform.scale, [
            Math.round(startScale[0] * factor * 100) / 100,
            Math.round(startScale[1] * factor * 100) / 100,
          ]);
        }
      }, record);
    };

    const onMove = (ev: PointerEvent) => applyDelta(ev.clientX, ev.clientY, false);
    const onUp = (ev: PointerEvent) => {
      applyDelta(ev.clientX, ev.clientY, true);
      setSnapGuide({ x: false, y: false });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Interactive Gizmo & Shape/Vector Handles
  let gizmo: {
    x: number;
    y: number;
    rot: number;
    shapeHandles: Record<string, [number, number]>;
  } | null = null;

  if (singleLayer && currentTimeMs >= singleLayer.startTime && currentTimeMs <= singleLayer.endTime) {
    const { remappedNormT } = evalRemappedTime(singleLayer, currentTimeMs);
    const loc = evalAnimatable(singleLayer.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0]);
    const rot = evalAnimatable(singleLayer.transform.rotation, remappedNormT, 0);
    let shapeHandles: Record<string, [number, number]> = {};
    if (singleLayer.type === 'shape' && singleLayer.shapeId && inspectorTab === 'editShape') {
      const def = getShapeById(singleLayer.shapeId);
      if (def) {
        const sp: Record<string, any> = {};
        for (const pd of def.params) {
          if (pd.id) sp[pd.id] = evalAnimatable(singleLayer.shapeParams?.[pd.id], remappedNormT, parseDefaultParamValue(pd));
        }
        shapeHandles = evaluateShapeHandles(def, sp);
      }
    }
    gizmo = { x: loc[0] * projScale, y: loc[1] * projScale, rot, shapeHandles };
  }

  return (
    <div
      ref={wrapRef}
      className="am-stage-wrap"
      onPointerDown={handleStagePointerDown}
      onWheel={(e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          setPreviewZoom(previewZoom * (e.deltaY < 0 ? 1.1 : 0.9));
        }
      }}
    >
      {/* Viewport Zoom Controls */}
      <div style={{ position: 'absolute', left: 10, top: 10, zIndex: 16, display: 'flex', gap: 4 }}>
        <button type="button" className="am-btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setPreviewZoom(previewZoom * 0.85)}>
          -
        </button>
        <button
          type="button"
          className="am-btn"
          style={{ padding: '4px 8px', fontSize: 11 }}
          onClick={() => {
            setPreviewZoom(1);
            setPreviewPan([0, 0]);
          }}
        >
          {Math.round(previewZoom * 100)}%
        </button>
        <button type="button" className="am-btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setPreviewZoom(previewZoom * 1.15)}>
          +
        </button>
      </div>

      {/* Stage Frame */}
      <div
        className={currentProject.bgColor === 'transparent' ? 'am-checker-bg' : ''}
        style={{
          width: stageSize.w,
          height: stageSize.h,
          position: 'relative',
          transform: `translate(${previewPan[0]}px, ${previewPan[1]}px) scale(${previewZoom})`,
          boxShadow: '0 12px 44px rgba(0,0,0,0.75)',
          border: '1px solid var(--am-border-strong)',
          overflow: 'visible',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: inspectorTab === 'drawing' ? 'crosshair' : 'default',
          }}
        />

        {/* Grid & Snap Center Guides */}
        {(gridVisible || snapGuide.x || snapGuide.y) && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {gridVisible && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage:
                    'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
                  backgroundSize: '33.333% 33.333%',
                }}
              />
            )}
            {(gridVisible || snapGuide.x) && (
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: snapGuide.x ? 'var(--am-accent)' : 'rgba(0,255,168,0.35)' }} />
            )}
            {(gridVisible || snapGuide.y) && (
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: snapGuide.y ? 'var(--am-accent)' : 'rgba(0,255,168,0.35)' }} />
            )}
          </div>
        )}

        {/* Selected Layer Transform Gizmo & Shape Handles */}
        {gizmo && inspectorTab !== 'drawing' && (
          <div
            onPointerDown={(e) => startLayerDrag(e, 'move')}
            style={{
              position: 'absolute',
              left: gizmo.x,
              top: gizmo.y,
              width: 110,
              height: 110,
              transform: `translate(-50%, -50%) rotate(${gizmo.rot}deg)`,
              border: '1.5px dashed rgba(0, 255, 168, 0.85)',
              borderRadius: 6,
              cursor: 'move',
              pointerEvents: 'auto',
            }}
          >
            {/* Center Pivot Dot */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--am-accent)',
                transform: 'translate(-50%, -50%)',
                border: '1px solid #000',
              }}
            />
            {/* Corner Scale Handle */}
            <div
              onPointerDown={(e) => startLayerDrag(e, 'scale')}
              title="Drag to Scale"
              style={{
                position: 'absolute',
                right: -6,
                bottom: -6,
                width: 12,
                height: 12,
                borderRadius: 3,
                background: '#FFFFFF',
                border: '2px solid var(--am-accent)',
                cursor: 'nwse-resize',
              }}
            />
            {/* Top Rotate Handle */}
            <div
              onPointerDown={(e) => startLayerDrag(e, 'rotate')}
              title="Drag to Rotate"
              style={{
                position: 'absolute',
                left: '50%',
                top: -22,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'var(--am-accent)',
                border: '2px solid #091318',
                transform: 'translateX(-50%)',
                cursor: 'grab',
              }}
            />

            {/* Procedural Shape Handles (when in Edit Shape mode) */}
            {Object.entries(gizmo.shapeHandles).map(([hid, [hx, hy]]) => (
              <div
                key={hid}
                title={`Shape handle: ${hid}`}
                style={{
                  position: 'absolute',
                  left: 55 + hx * projScale,
                  top: 55 + hy * projScale,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#FFCD4B',
                  border: '1.5px solid #081318',
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                }}
              />
            ))}
          </div>
        )}

        {/* Vector Bezier Edit Points Overlay */}
        {singleLayer?.type === 'vector' && singleLayer.vectorPath && inspectorTab === 'editPoints' && gizmo && (
          <div style={{ position: 'absolute', left: gizmo.x, top: gizmo.y, pointerEvents: 'auto' }}>
            {singleLayer.vectorPath.points.map((pt, pi) => (
              <div
                key={pi}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const sx = e.clientX;
                  const sy = e.clientY;
                  const ox = pt.x;
                  const oy = pt.y;
                  const movePt = (cx: number, cy: number, record: boolean) => {
                    const dx = (cx - sx) / (projScale * previewZoom);
                    const dy = (cy - sy) / (projScale * previewZoom);
                    mutateProject((proj) => {
                      let list = proj.layers;
                      for (const gid of groupStack) {
                        const g = list.find((x) => x.id === gid);
                        if (g?.groupLayers) list = g.groupLayers;
                      }
                      const t = list.find((x) => x.id === singleLayer.id);
                      if (t?.vectorPath?.points[pi]) {
                        t.vectorPath.points[pi].x = Math.round(ox + dx);
                        t.vectorPath.points[pi].y = Math.round(oy + dy);
                      }
                    }, record);
                  };
                  const onMove = (ev: PointerEvent) => movePt(ev.clientX, ev.clientY, false);
                  const onUp = (ev: PointerEvent) => {
                    movePt(ev.clientX, ev.clientY, true);
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                  };
                  window.addEventListener('pointermove', onMove);
                  window.addEventListener('pointerup', onUp);
                }}
                style={{
                  position: 'absolute',
                  left: pt.x * projScale,
                  top: pt.y * projScale,
                  width: 11,
                  height: 11,
                  borderRadius: '50%',
                  background: '#00FFA8',
                  border: '2px solid #091318',
                  transform: 'translate(-50%, -50%)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        )}
      </div>

      <LayerQuickActions />
    </div>
  );
};
