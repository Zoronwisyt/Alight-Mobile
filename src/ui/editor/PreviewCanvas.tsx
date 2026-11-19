import React, { useEffect, useRef, useState } from 'react';
import { evalAnimatable, evalRemappedTime } from '../../engine/animation';
import { getShapeById, parseDefaultParamValue } from '../../engine/catalog';
import { evaluateShapeHandles } from '../../engine/scriptRuntime';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';
import { LayerQuickActions } from './LayerQuickActions';

interface PreviewCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onVisibilityPauseChange: (paused: boolean) => void;
  viewModeOpen: boolean;
}

export const PreviewCanvas: React.FC<PreviewCanvasProps> = ({
  canvasRef,
  onVisibilityPauseChange,
  viewModeOpen,
}) => {
  const {
    currentProject,
    currentTimeMs,
    selectedLayerIds,
    groupStack,
    getActiveLayers,
    inspectorTab,
    gridVisible,
    toggleGrid,
    snapEnabled,
    toggleSnap,
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
  const touchDistRef = useRef<number | null>(null);
  const touchZoomStartRef = useRef<number>(1);

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
      const rightPad = viewModeOpen ? 68 : 28;
      const padW = Math.max(110, r.width - rightPad);
      const padH = Math.max(110, r.height - 24);
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
  }, [currentProject?.width, currentProject?.height, viewModeOpen]);

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

  // Two-finger touch pinch-to-zoom on mobile
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchDistRef.current = Math.hypot(dx, dy);
      touchZoomStartRef.current = previewZoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && touchDistRef.current && touchDistRef.current > 10) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      setPreviewZoom(touchZoomStartRef.current * (dist / touchDistRef.current));
    }
  };

  const handleTouchEnd = () => {
    touchDistRef.current = null;
  };

  // Freehand Drawing Mode & Pan
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || e.altKey) {
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
      const loc = evalAnimatable(singleLayer.transform.location, remappedNormT, [
        currentProject.width / 2,
        currentProject.height / 2,
        0,
      ]);
      const pts: { x: number; y: number; pressure: number }[] = [
        { x: Math.round(px - loc[0]), y: Math.round(py - loc[1]), pressure: e.pressure || 0.5 },
      ];
      let strokeIdx = -1;

      const pushPoints = (record: boolean) => {
        mutateProject((proj) => {
          let list = proj.layers;
          for (const gid of groupStack) {
            const g = list.find((l) => l.id === gid);
            if (g?.groupLayers) list = g.groupLayers;
          }
          const target = list.find((l) => l.id === singleLayer.id);
          if (!target) return;
          target.freehandStrokes = target.freehandStrokes ?? [];
          if (strokeIdx >= 0 && target.freehandStrokes[strokeIdx]) {
            target.freehandStrokes[strokeIdx].points = [...pts];
          } else {
            strokeIdx = target.freehandStrokes.length;
            target.freehandStrokes.push({
              color: drawingBrushColor,
              width: drawingBrushWidth,
              opacity: drawingBrushOpacity,
              points: [...pts],
            });
          }
        }, record);
      };

      pushPoints(false);
      const onMove = (ev: PointerEvent) => {
        const [mx, my] = clientToProject(ev.clientX, ev.clientY);
        pts.push({ x: Math.round(mx - loc[0]), y: Math.round(my - loc[1]), pressure: ev.pressure || 0.5 });
        pushPoints(false);
      };
      const onUp = () => {
        pushPoints(true);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Hit-test layers top-to-bottom on stage click
    const [px, py] = clientToProject(e.clientX, e.clientY);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked || l.type === 'audio' || l.type === 'camera') continue;
      if (currentTimeMs < l.startTime || currentTimeMs > l.endTime) continue;
      const { remappedNormT } = evalRemappedTime(l, currentTimeMs);
      const loc = evalAnimatable(l.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0]);
      const sc = evalAnimatable(l.transform.scale, remappedNormT, [1, 1]);
      const rad = 180 * Math.max(Math.abs(sc[0]), Math.abs(sc[1]), 0.35);
      if (Math.abs(px - loc[0]) <= rad && Math.abs(py - loc[1]) <= rad) {
        selectLayer(l.id, e.shiftKey || e.ctrlKey || e.metaKey);
        return;
      }
    }
  };

  // Drag selected layer gizmo (move / scale / rotate)
  const startLayerDrag = (e: React.PointerEvent, mode: 'move' | 'scale' | 'rotate') => {
    e.stopPropagation();
    if (!singleLayer || singleLayer.locked) return;
    const { remappedNormT } = evalRemappedTime(singleLayer, currentTimeMs);
    const startX = e.clientX;
    const startY = e.clientY;
    const startLoc = [...evalAnimatable(singleLayer.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0])] as [number, number, number];
    const startScale = [...evalAnimatable(singleLayer.transform.scale, remappedNormT, [1, 1])] as [number, number];
    const startRot = evalAnimatable(singleLayer.transform.rotation, remappedNormT, 0);

    const applyUpdate = (clientX: number, clientY: number, record: boolean) => {
      const dx = (clientX - startX) / (projScale * previewZoom);
      const dy = (clientY - startY) / (projScale * previewZoom);

      mutateProject((proj) => {
        let list = proj.layers;
        for (const gid of groupStack) {
          const g = list.find((l) => l.id === gid);
          if (g?.groupLayers) list = g.groupLayers;
        }
        const target = list.find((l) => l.id === singleLayer.id);
        if (!target) return;

        if (mode === 'move') {
          let nx = Math.round(startLoc[0] + dx);
          let ny = Math.round(startLoc[1] + dy);
          let gx = false;
          let gy = false;
          if (snapEnabled) {
            if (Math.abs(nx - proj.width / 2) < 16) {
              nx = proj.width / 2;
              gx = true;
            }
            if (Math.abs(ny - proj.height / 2) < 16) {
              ny = proj.height / 2;
              gy = true;
            }
          }
          setSnapGuide({ x: gx, y: gy });
          const next = [nx, ny, startLoc[2]] as [number, number, number];
          if (target.transform.location.keyframes.length > 0) {
            const kf = target.transform.location.keyframes.find((k) => Math.abs(k.t - remappedNormT) < 0.015);
            if (kf) kf.v = next;
            else target.transform.location.keyframes.push({ t: remappedNormT, v: next });
            target.transform.location.keyframes.sort((a, b) => a.t - b.t);
          } else {
            target.transform.location.value = next;
          }
        } else if (mode === 'scale') {
          const factor = Math.max(0.05, 1 + (dx - dy) / 260);
          const next: [number, number] = [
            Math.round(startScale[0] * factor * 100) / 100,
            Math.round(startScale[1] * factor * 100) / 100,
          ];
          if (target.transform.scale.keyframes.length > 0) {
            const kf = target.transform.scale.keyframes.find((k) => Math.abs(k.t - remappedNormT) < 0.015);
            if (kf) kf.v = next;
            else target.transform.scale.keyframes.push({ t: remappedNormT, v: next });
            target.transform.scale.keyframes.sort((a, b) => a.t - b.t);
          } else {
            target.transform.scale.value = next;
          }
        } else if (mode === 'rotate') {
          const next = Math.round((startRot + dx * 0.45) * 10) / 10;
          if (target.transform.rotation.keyframes.length > 0) {
            const kf = target.transform.rotation.keyframes.find((k) => Math.abs(k.t - remappedNormT) < 0.015);
            if (kf) kf.v = next;
            else target.transform.rotation.keyframes.push({ t: remappedNormT, v: next });
            target.transform.rotation.keyframes.sort((a, b) => a.t - b.t);
          } else {
            target.transform.rotation.value = next;
          }
        }
      }, record);
    };

    const onMove = (ev: PointerEvent) => applyUpdate(ev.clientX, ev.clientY, false);
    const onUp = (ev: PointerEvent) => {
      setSnapGuide({ x: false, y: false });
      applyUpdate(ev.clientX, ev.clientY, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Compute selected layer overlay gizmo coordinates
  let gizmo: {
    x: number;
    y: number;
    rot: number;
    sx: number;
    sy: number;
    shapeHandles: Record<string, [number, number]>;
  } | null = null;

  if (singleLayer && singleLayer.visible && currentTimeMs >= singleLayer.startTime && currentTimeMs <= singleLayer.endTime) {
    const { remappedNormT } = evalRemappedTime(singleLayer, currentTimeMs);
    const loc = evalAnimatable(singleLayer.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0]);
    const rot = evalAnimatable(singleLayer.transform.rotation, remappedNormT, 0);
    const sc = evalAnimatable(singleLayer.transform.scale, remappedNormT, [1, 1]);
    let shapeHandles: Record<string, [number, number]> = {};
    if (singleLayer.type === 'shape' && singleLayer.shapeId && inspectorTab === 'editShape') {
      const sDef = getShapeById(singleLayer.shapeId);
      if (sDef) {
        const sp: Record<string, any> = {};
        for (const pd of sDef.params) {
          if (pd.id) sp[pd.id] = evalAnimatable(singleLayer.shapeParams?.[pd.id], remappedNormT, parseDefaultParamValue(pd));
        }
        shapeHandles = evaluateShapeHandles(sDef, sp);
      }
    }
    gizmo = {
      x: loc[0] * projScale,
      y: loc[1] * projScale,
      rot,
      sx: sc[0],
      sy: sc[1],
      shapeHandles,
    };
  }

  return (
    <div
      ref={wrapRef}
      className="am-stage-wrap"
      onPointerDown={handleStagePointerDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setPreviewZoom(previewZoom + (e.deltaY < 0 ? 0.12 : -0.12));
        }
      }}
    >
      {/* Stage Frame */}
      <div
        className={currentProject.bgColor === 'transparent' ? 'am-checker-bg' : ''}
        style={{
          width: stageSize.w,
          height: stageSize.h,
          position: 'relative',
          transform: `translate(${previewPan[0]}px, ${previewPan[1]}px) scale(${previewZoom})`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.75)',
          border: '1px solid rgba(255,255,255,0.14)',
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
              border: '2px solid #00FFA8',
              borderRadius: 4,
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
                background: '#00FFA8',
                transform: 'translate(-50%, -50%)',
                border: '1.5px solid #091318',
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
                borderRadius: 2,
                background: '#FFFFFF',
                border: '2px solid #00FFA8',
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
                background: '#00FFA8',
                border: '2px solid #091318',
                transform: 'translateX(-50%)',
                cursor: 'grab',
              }}
            />

            {/* Procedural Shape Handles */}
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

      {/* APK @id/viewmodeHolder (50dp #333750 right vertical drawer from activity_edit.xml) */}
      {viewModeOpen && (
        <div
          className="am-viewmode-holder"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`am-viewmode-btn ${gridVisible ? 'active' : ''}`}
            onClick={toggleGrid}
            title="Toggle Safe Area & Grid"
          >
            <AmIcon name="ic_preview_mode_grid_off" fallback="grid" size={20} color={gridVisible ? '#FFCD4B' : '#FFFFFF'} />
          </button>

          <button
            type="button"
            className={`am-viewmode-btn ${snapEnabled ? 'active' : ''}`}
            onClick={toggleSnap}
            title="Toggle Center Snapping"
          >
            <AmIcon name="snap" fallback="snap" size={18} color={snapEnabled ? '#FFCD4B' : '#FFFFFF'} />
          </button>

          <button
            type="button"
            className={`am-viewmode-btn ${currentProject.cameraEnabled ? 'active' : ''}`}
            onClick={() => mutateProject((p) => { p.cameraEnabled = !p.cameraEnabled; })}
            title="Toggle Active 3D Camera"
          >
            <AmIcon
              name={currentProject.cameraEnabled ? 'ic_preview_mode_camera_on' : 'ic_preview_mode_camera_off'}
              fallback="camera"
              size={20}
              color={currentProject.cameraEnabled ? '#FFCD4B' : '#FFFFFF'}
            />
          </button>

          {/* APK previewmode_canvas_zoom.xml (vertical + / 100% / - box) */}
          <div className="am-canvas-zoom-box">
            <button
              type="button"
              className="am-zoom-step-btn"
              onClick={() => setPreviewZoom(previewZoom * 1.15)}
              title="Zoom In Stage"
            >
              <AmIcon name="ic_viewmode_zoom_in" fallback="plus" size={16} />
            </button>
            <button
              type="button"
              className="am-zoom-pct-btn"
              onClick={() => {
                setPreviewZoom(1);
                setPreviewPan([0, 0]);
              }}
              title="Reset Stage Zoom"
            >
              {Math.round(previewZoom * 100)}%
            </button>
            <button
              type="button"
              className="am-zoom-step-btn"
              onClick={() => setPreviewZoom(previewZoom / 1.15)}
              title="Zoom Out Stage"
            >
              <AmIcon name="ic_viewmode_zoom_out" fallback="minus" size={16} />
            </button>
          </div>
        </div>
      )}

      <LayerQuickActions />
    </div>
  );
};
