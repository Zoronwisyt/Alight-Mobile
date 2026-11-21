import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { evalAnimatable, evalRemappedTime } from '../../engine/animation';
import { snapLayerPosition } from '../../engine/snapping';
import { getShapeById, parseDefaultParamValue } from '../../engine/catalog';
import { evaluateShapeHandles } from '../../engine/scriptRuntime';
import { resolveActiveGroup, useEditorStore, type PreviewQuality } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';
import { LayerQuickActions } from './LayerQuickActions';

const PREVIEW_QUALITY_OPTIONS: { q: PreviewQuality; label: string; short: string }[] = [
  { q: 1, label: 'Full Quality (1/1)', short: 'Full' },
  { q: 0.75, label: 'High Quality (3/4)', short: '3/4' },
  { q: 0.5, label: 'Half Quality (1/2)', short: '1/2' },
  { q: 0.25, label: 'Quarter Quality (1/4)', short: '1/4' },
];

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
    snapGuides,
    setSnapGuides,
    previewQuality,
    setPreviewQuality,
    previewZoom,
    setPreviewZoom,
    previewPan,
    setPreviewPan,
    selectLayer,
    enterGroup,
    mutateProject,
    mutateLayer,
    drawingBrushColor,
    drawingBrushWidth,
    drawingBrushOpacity,
  } = useEditorStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      currentTimeMs: s.currentTimeMs,
      selectedLayerIds: s.selectedLayerIds,
      groupStack: s.groupStack,
      getActiveLayers: s.getActiveLayers,
      inspectorTab: s.inspectorTab,
      gridVisible: s.gridVisible,
      toggleGrid: s.toggleGrid,
      snapEnabled: s.snapEnabled,
      toggleSnap: s.toggleSnap,
      snapGuides: s.snapGuides,
      setSnapGuides: s.setSnapGuides,
      previewQuality: s.previewQuality,
      setPreviewQuality: s.setPreviewQuality,
      previewZoom: s.previewZoom,
      setPreviewZoom: s.setPreviewZoom,
      previewPan: s.previewPan,
      setPreviewPan: s.setPreviewPan,
      selectLayer: s.selectLayer,
      enterGroup: s.enterGroup,
      mutateProject: s.mutateProject,
      mutateLayer: s.mutateLayer,
      drawingBrushColor: s.drawingBrushColor,
      drawingBrushWidth: s.drawingBrushWidth,
      drawingBrushOpacity: s.drawingBrushOpacity,
    }))
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 360, h: 360 });
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
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

  const activeScope = currentProject ? resolveActiveGroup(currentProject, groupStack) : null;
  const activeW = activeScope?.width ?? currentProject?.width ?? 1080;
  const activeH = activeScope?.height ?? currentProject?.height ?? 1080;

  // Fit project (or isolated group) aspect cleanly inside stage container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !currentProject) return;
    const compute = () => {
      const r = el.getBoundingClientRect();
      const rightPad = viewModeOpen ? 68 : 28;
      const padW = Math.max(110, r.width - rightPad);
      const padH = Math.max(110, r.height - 24);
      const asp = activeW / Math.max(1, activeH);
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
  }, [activeW, activeH, currentProject, viewModeOpen]);

  if (!currentProject) return null;

  const layers = getActiveLayers();
  const singleLayer = selectedLayerIds.length === 1 ? layers.find((l) => l.id === selectedLayerIds[0]) : undefined;
  const projScale = stageSize.w / Math.max(1, activeW);

  const clientToProject = (clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const r = canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * activeW;
    const py = ((clientY - r.top) / r.height) * activeH;
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
    const projW = currentProject.width;
    const projH = currentProject.height;
    const layerId = singleLayer.id;

    // MO-3: Capture pointer on drag surface so fast touch drags never strand listeners
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if synthetic pointer event
    }

    const applyUpdate = (clientX: number, clientY: number, record: boolean) => {
      const dx = (clientX - startX) / (projScale * previewZoom);
      const dy = (clientY - startY) / (projScale * previewZoom);

      // MO-2: Layer-scoped COW write (never deep-clones the whole project per pointermove)
      mutateLayer(layerId, (target) => {
        if (mode === 'move') {
          let nx = Math.round(startLoc[0] + dx);
          let ny = Math.round(startLoc[1] + dy);
          if (snapEnabled) {
            const threshold = Math.max(10, Math.min(28, 14 / Math.max(0.15, projScale * previewZoom)));
            const snapped = snapLayerPosition(nx, ny, {
              project: currentProject,
              layers,
              activeLayerId: layerId,
              currentTimeMs,
              threshold,
            });
            nx = snapped.x;
            ny = snapped.y;
            setSnapGuides({ x: snapped.guideX, y: snapped.guideY });
          } else {
            setSnapGuides({ x: null, y: null });
          }
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

    // MO-1 + MO-3: Coalesce pointermove to 1 store write per rAF + handle pointercancel cleanly
    let dragRaf = 0;
    let lastX = startX;
    let lastY = startY;
    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        applyUpdate(lastX, lastY, false);
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (dragRaf) {
        cancelAnimationFrame(dragRaf);
        dragRaf = 0;
      }
      applyUpdate(ev.clientX, ev.clientY, true);
      setSnapGuides({ x: null, y: null });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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

  const handleStageDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const [px, py] = clientToProject(e.clientX, e.clientY);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.type !== 'group' || !l.visible || l.locked) continue;
      if (currentTimeMs < l.startTime || currentTimeMs > l.endTime) continue;
      const { remappedNormT } = evalRemappedTime(l, currentTimeMs);
      const loc = evalAnimatable(l.transform.location, remappedNormT, [currentProject.width / 2, currentProject.height / 2, 0]);
      const sc = evalAnimatable(l.transform.scale, remappedNormT, [1, 1]);
      const halfW = ((l.groupWidth || currentProject.width) * Math.abs(sc[0])) * 0.5;
      const halfH = ((l.groupHeight || currentProject.height) * Math.abs(sc[1])) * 0.5;
      if (Math.abs(px - loc[0]) <= Math.max(120, halfW) && Math.abs(py - loc[1]) <= Math.max(120, halfH)) {
        enterGroup(l.id);
        return;
      }
    }
  };

  return (
    <div
      ref={wrapRef}
      className="am-stage-wrap"
      onPointerDown={handleStagePointerDown}
      onDoubleClick={handleStageDoubleClick}
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

        {/* Grid & Dynamic Alight Motion Snap Guides */}
        {(gridVisible || snapGuides.x || snapGuides.y) && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 12 }}>
            {gridVisible && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage:
                      'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
                    backgroundSize: '33.333% 33.333%',
                  }}
                />
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(0,255,168,0.35)' }} />
                <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(0,255,168,0.35)' }} />
              </>
            )}
            {snapGuides.x && (
              <div
                style={{
                  position: 'absolute',
                  left: `${(snapGuides.x.pos / Math.max(1, currentProject.width)) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: snapGuides.x.kind === 'center' ? 1.5 : 1,
                  background: snapGuides.x.kind === 'center' || snapGuides.x.kind === 'edge' ? '#FF3B5C' : '#00FFA8',
                  boxShadow:
                    snapGuides.x.kind === 'center' || snapGuides.x.kind === 'edge'
                      ? '0 0 6px rgba(255,59,92,0.75)'
                      : '0 0 6px rgba(0,255,168,0.75)',
                }}
              />
            )}
            {snapGuides.y && (
              <div
                style={{
                  position: 'absolute',
                  top: `${(snapGuides.y.pos / Math.max(1, currentProject.height)) * 100}%`,
                  left: 0,
                  right: 0,
                  height: snapGuides.y.kind === 'center' ? 1.5 : 1,
                  background: snapGuides.y.kind === 'center' || snapGuides.y.kind === 'edge' ? '#FF3B5C' : '#00FFA8',
                  boxShadow:
                    snapGuides.y.kind === 'center' || snapGuides.y.kind === 'edge'
                      ? '0 0 6px rgba(255,59,92,0.75)'
                      : '0 0 6px rgba(0,255,168,0.75)',
                }}
              />
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

          {/* Preview Quality & Resolution Selector (Full 1.0x down to Quarter 0.25x) */}
          <div className="am-quality-control">
            <button
              type="button"
              className={`am-viewmode-btn am-quality-trigger ${previewQuality < 1 ? 'active' : ''}`}
              onClick={() => setQualityMenuOpen((v) => !v)}
              title="Preview Render Quality (Full to Quarter)"
              aria-label="Preview Render Quality"
            >
              <span className="am-quality-short">
                {PREVIEW_QUALITY_OPTIONS.find((o) => o.q === previewQuality)?.short ?? '3/4'}
              </span>
              <span className="am-quality-res">
                {Math.max(16, Math.round(currentProject.width * previewQuality))}×
                {Math.max(16, Math.round(currentProject.height * previewQuality))}
              </span>
            </button>

            {qualityMenuOpen && (
              <div className="am-quality-popover" role="menu" aria-label="Preview Quality Options">
                <div className="am-quality-popover-title">Preview Quality</div>
                {PREVIEW_QUALITY_OPTIONS.map((opt) => {
                  const rw = Math.max(16, Math.round(currentProject.width * opt.q));
                  const rh = Math.max(16, Math.round(currentProject.height * opt.q));
                  const active = previewQuality === opt.q;
                  return (
                    <button
                      key={opt.q}
                      type="button"
                      className={`am-quality-option ${active ? 'active' : ''}`}
                      onClick={() => {
                        setPreviewQuality(opt.q);
                        setQualityMenuOpen(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      <strong>
                        {rw}×{rh}
                      </strong>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* APK previewmode_canvas_zoom.xml (+ / Resolution / - box) */}
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
              title="Reset Stage Zoom (Current Preview Resolution)"
            >
              {Math.max(16, Math.round(currentProject.width * previewQuality))}×
              {Math.max(16, Math.round(currentProject.height * previewQuality))}
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

      {/* Always-accessible compact Preview Quality pill (top-left of stage for mobile & desktop) */}
      <button
        type="button"
        className="am-stage-quality-pill"
        style={{ left: selectedLayerIds.length > 0 ? 58 : undefined }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          const order: PreviewQuality[] = [1, 0.75, 0.5, 0.25];
          const idx = order.indexOf(previewQuality);
          setPreviewQuality(order[(idx + 1) % order.length]);
        }}
        title="Tap to cycle Preview Quality (Full → 3/4 → 1/2 → 1/4)"
      >
        <span>{PREVIEW_QUALITY_OPTIONS.find((o) => o.q === previewQuality)?.short ?? '3/4'}</span>
        <strong>
          {Math.max(16, Math.round(currentProject.width * previewQuality))}×
          {Math.max(16, Math.round(currentProject.height * previewQuality))}
        </strong>
      </button>

      <LayerQuickActions />
    </div>
  );
};
