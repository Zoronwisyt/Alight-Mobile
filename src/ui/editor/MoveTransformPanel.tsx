import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { evalAnimatable, toggleLayer3DPreservingPosition } from '../../engine/animation';
import { snapLayerPosition } from '../../engine/snapping';
import { useEditorStore, type ActiveCurveTarget } from '../../store/useEditorStore';
import type { Layer, Project } from '../../types/project';
import { AmIcon } from '../components/AmIcon';
import { SpinnerControl } from '../components/SpinnerControl';
import { useSelectedLayer } from './useSelectedLayer';

type Mode = 'location' | 'rotation' | 'scale' | 'skew';

function getLayerBaseDimensions(layer: Layer, project: Project, normT: number): [number, number] {
  if (layer.mediaData?.displayWidth && layer.mediaData?.displayHeight) {
    return [layer.mediaData.displayWidth, layer.mediaData.displayHeight];
  }
  if (layer.mediaData?.naturalWidth && layer.mediaData?.naturalHeight) {
    return [layer.mediaData.naturalWidth, layer.mediaData.naturalHeight];
  }
  if (layer.groupWidth && layer.groupHeight) {
    return [layer.groupWidth, layer.groupHeight];
  }
  if (layer.type === 'shape' && layer.shapeParams) {
    const sizeVal = layer.shapeParams.size ? evalAnimatable(layer.shapeParams.size, normT, null as unknown as number[]) : null;
    if (Array.isArray(sizeVal) && Number.isFinite(sizeVal[0]) && Number.isFinite(sizeVal[1])) {
      return [Math.max(1, Math.round(sizeVal[0] * 2)), Math.max(1, Math.round(sizeVal[1] * 2))];
    }
    const radVal = layer.shapeParams.radius ? evalAnimatable(layer.shapeParams.radius, normT, null as unknown as number) : null;
    if (typeof radVal === 'number' && Number.isFinite(radVal)) {
      const d = Math.max(1, Math.round(radVal * 2));
      return [d, d];
    }
  }
  return [project.width, project.height];
}

export const MoveTransformPanel: React.FC = () => {
  const {
    toggleKeyframeOnProp,
    stepKeyframe,
    setCurveTarget,
    snapEnabled,
    setSnapGuides,
    currentTimeMs,
    getActiveLayers,
  } = useEditorStore(
    useShallow((s) => ({
      toggleKeyframeOnProp: s.toggleKeyframeOnProp,
      stepKeyframe: s.stepKeyframe,
      setCurveTarget: s.setCurveTarget,
      snapEnabled: s.snapEnabled,
      setSnapGuides: s.setSnapGuides,
      currentTimeMs: s.currentTimeMs,
      getActiveLayers: s.getActiveLayers,
    }))
  );
  const { project, layer, normT, updateLayer, setAnimValue, hasKfHere, readAnim } = useSelectedLayer();
  const [mode, setMode] = useState<Mode>('location');
  const [rotAxis, setRotAxis] = useState<'x' | 'y' | 'z'>('z');
  const [editPivot, setEditPivot] = useState(false);

  if (!layer || !project) return null;

  const is3D = Boolean(layer.is3D);
  const loc = readAnim(layer.transform.location, [project.width / 2, project.height / 2, 0]);
  const rot = readAnim(layer.transform.rotation, 0);
  const rotX = readAnim(layer.transform.rotationX, 0);
  const rotY = readAnim(layer.transform.rotationY, 0);
  const scale = readAnim(layer.transform.scale, [1, 1]);
  const [baseW, baseH] = getLayerBaseDimensions(layer, project, normT);
  const resolvedW = Math.max(1, Math.round(baseW * scale[0]));
  const resolvedH = Math.max(1, Math.round(baseH * scale[1]));
  const pivot = readAnim(layer.transform.pivot, [0, 0]);
  const skew = readAnim(layer.transform.skew, [0, 0]);

  const effectiveRotAxis = is3D ? rotAxis : 'z';
  const activeTarget: ActiveCurveTarget =
    mode === 'location' && editPivot
      ? { label: 'Pivot', kind: 'transform', key: 'pivot' }
      : mode === 'rotation' && effectiveRotAxis === 'x'
        ? { label: 'Rotation X', kind: 'transform', key: 'rotationX' }
        : mode === 'rotation' && effectiveRotAxis === 'y'
          ? { label: 'Rotation Y', kind: 'transform', key: 'rotationY' }
          : {
              label: mode === 'location' ? 'Location' : mode === 'rotation' ? (is3D ? 'Rotation Z' : 'Rotation') : mode === 'scale' ? 'Scale' : 'Skew',
              kind: 'transform',
              key: mode,
            };

  const activeProp =
    mode === 'location' && editPivot
      ? layer.transform.pivot
      : mode === 'rotation' && effectiveRotAxis === 'x'
        ? layer.transform.rotationX ?? { value: 0, keyframes: [] }
        : mode === 'rotation' && effectiveRotAxis === 'y'
          ? layer.transform.rotationY ?? { value: 0, keyframes: [] }
          : layer.transform[mode];
  const kfActive = hasKfHere(activeProp);

  const handlePadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const sLoc = [...loc] as [number, number, number];
    const sRot = rot;
    const sRotX = rotX;
    const sRotY = rotY;
    const sScale = [...scale] as [number, number];
    const sPiv = [...pivot] as [number, number];
    const sSkew = [...skew] as [number, number];
    e.currentTarget.setPointerCapture(e.pointerId);

    const apply = (cx: number, cy: number, record: boolean) => {
      const dx = cx - startX;
      const dy = cy - startY;
      updateLayer((l) => {
        if (mode === 'location') {
          if (editPivot) {
            setAnimValue(l.transform.pivot, [Math.round(sPiv[0] + dx), Math.round(sPiv[1] + dy)]);
          } else {
            let nx = Math.round(sLoc[0] + dx * 2);
            let ny = Math.round(sLoc[1] + dy * 2);
            if (snapEnabled) {
              const snapped = snapLayerPosition(nx, ny, {
                project,
                layers: getActiveLayers(),
                activeLayerId: layer.id,
                currentTimeMs,
                threshold: 16,
              });
              nx = snapped.x;
              ny = snapped.y;
              setSnapGuides({ x: snapped.guideX, y: snapped.guideY });
            } else {
              setSnapGuides({ x: null, y: null });
            }
            setAnimValue(l.transform.location, [nx, ny, sLoc[2]]);
          }
        } else if (mode === 'rotation') {
          if (l.is3D && rotAxis === 'x') {
            if (!l.transform.rotationX) l.transform.rotationX = { value: 0, keyframes: [] };
            setAnimValue(l.transform.rotationX, Math.round((sRotX + dx * 0.5) * 10) / 10);
          } else if (l.is3D && rotAxis === 'y') {
            if (!l.transform.rotationY) l.transform.rotationY = { value: 0, keyframes: [] };
            setAnimValue(l.transform.rotationY, Math.round((sRotY + dx * 0.5) * 10) / 10);
          } else {
            setAnimValue(l.transform.rotation, Math.round((sRot + dx * 0.5) * 10) / 10);
          }
        } else if (mode === 'scale') {
          const sx = Math.max(0.05, Math.round((sScale[0] + dx * 0.008) * 100) / 100);
          const sy = l.transform.scaleLinked
            ? sx
            : Math.max(0.05, Math.round((sScale[1] - dy * 0.008) * 100) / 100);
          setAnimValue(l.transform.scale, [sx, sy]);
        } else {
          setAnimValue(l.transform.skew, [
            Math.max(-80, Math.min(80, Math.round(sSkew[0] + dx * 0.25))),
            Math.max(-80, Math.min(80, Math.round(sSkew[1] + dy * 0.25))),
          ]);
        }
      }, record);
    };

    // I-10: Coalesce pointermove updates to 1 store write per animation frame, commit final value on release
    let dragRaf = 0;
    let lastX = startX;
    let lastY = startY;
    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        apply(lastX, lastY, false);
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (dragRaf) {
        cancelAnimationFrame(dragRaf);
        dragRaf = 0;
      }
      apply(ev.clientX, ev.clientY, true);
      setSnapGuides({ x: null, y: null });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 3D Layer Switch (enables native X/Y/Z 3D rotations & 3D Null parenting) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderRadius: 10,
          background: is3D ? 'rgba(0, 255, 168, 0.12)' : 'rgba(255, 255, 255, 0.04)',
          border: `1px solid ${is3D ? 'rgba(0, 255, 168, 0.45)' : 'var(--am-border)'}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: is3D ? '#00FFA8' : 'var(--am-text)' }}>
            {layer.type === 'null' ? '3D Null' : '3D Layer'}
          </span>
          <span style={{ fontSize: 10, color: 'var(--am-text-secondary)' }}>
            {layer.type === 'null'
              ? is3D
                ? 'Moves & rotates parented layers that are also 3D'
                : 'Enable 3D to drive 3D-enabled child layers'
              : is3D
                ? 'Native X / Y / Z rotations active'
                : 'Enable 3D to unlock X / Y / Z rotations'}
          </span>
        </div>
        <button
          type="button"
          className={`am-pill ${is3D ? 'active' : ''}`}
          style={{ minWidth: 54, fontWeight: 700 }}
          onClick={() => {
            const activeLayers = getActiveLayers();
            updateLayer((l) => {
              toggleLayer3DPreservingPosition(l, activeLayers, currentTimeMs);
            });
          }}
        >
          {is3D ? '3D ON' : '2D'}
        </button>
      </div>

      {/* APK fragment_move_transform.xml (#262A3C layout: Left Keyframe/Curve Rail + Center ControlPad + Right 4-Mode Tabs) */}
      <div className="am-mt-apk-shell">
        {/* Left Keyframe + Easing Curve Column */}
        <div className="am-mt-left-rail">
          <div className="am-mt-kf-group">
            <button
              type="button"
              className={`am-mt-kf-btn ${kfActive ? 'active' : ''}`}
              onClick={() => toggleKeyframeOnProp(activeTarget, normT)}
              title="Add / Remove Keyframe"
            >
              <AmIcon name={kfActive ? 'ic_keyframe_sign' : 'ic_keyframe_add_hollow'} fallback="plus" size={20} color={kfActive ? '#00FFA8' : '#FFFFFF'} />
            </button>
            <div className="am-mt-kf-arrows">
              <button type="button" onClick={() => stepKeyframe(activeTarget, -1)} title="Previous Keyframe">
                <AmIcon name="ic_prev_element" fallback="back" size={12} />
              </button>
              <button type="button" onClick={() => stepKeyframe(activeTarget, 1)} title="Next Keyframe">
                <AmIcon name="ic_next_element" fallback="next" size={12} />
              </button>
            </div>
          </div>

          <button
            type="button"
            className="am-mt-curve-btn"
            disabled={activeProp.keyframes.length < 2}
            onClick={() => setCurveTarget(activeTarget)}
            title="Edit Easing Curve"
          >
            <AmIcon name="ic_animate_curve" fallback="curve" size={19} />
          </button>
        </div>

        {/* Center APK ControlPad / RotateView / ValueSpinner */}
        <div className="am-mt-center-pad">
          {/* Top Coordinate Readout Boxes (locationX, locationY, locationZ 63x25dp #191C25) */}
          <div className="am-mt-coord-row">
            {mode === 'location' && !editPivot && (
              <>
                <div className="am-mt-coord-pill">
                  <span>X</span>
                  <strong>{Math.round(loc[0])}</strong>
                </div>
                <div className="am-mt-coord-pill">
                  <span>Y</span>
                  <strong>{Math.round(loc[1])}</strong>
                </div>
                <div className="am-mt-coord-pill">
                  <span>Z</span>
                  <strong>{Math.round(loc[2] ?? 0)}</strong>
                </div>
              </>
            )}
            {mode === 'location' && editPivot && (
              <>
                <div className="am-mt-coord-pill">
                  <span>PX</span>
                  <strong>{Math.round(pivot[0])}</strong>
                </div>
                <div className="am-mt-coord-pill">
                  <span>PY</span>
                  <strong>{Math.round(pivot[1])}</strong>
                </div>
              </>
            )}
            {mode === 'rotation' && !is3D && (
              <div className="am-mt-coord-pill wide">
                <span>Angle</span>
                <strong>{rot.toFixed(1)}°</strong>
              </div>
            )}
            {mode === 'rotation' && is3D && (
              <>
                <button
                  type="button"
                  className="am-mt-coord-pill"
                  style={{
                    cursor: 'pointer',
                    border: rotAxis === 'x' ? '1px solid #00FFA8' : undefined,
                  }}
                  onClick={() => setRotAxis('x')}
                  title="Select X Rotation axis"
                >
                  <span>X</span>
                  <strong>{rotX.toFixed(1)}°</strong>
                </button>
                <button
                  type="button"
                  className="am-mt-coord-pill"
                  style={{
                    cursor: 'pointer',
                    border: rotAxis === 'y' ? '1px solid #00FFA8' : undefined,
                  }}
                  onClick={() => setRotAxis('y')}
                  title="Select Y Rotation axis"
                >
                  <span>Y</span>
                  <strong>{rotY.toFixed(1)}°</strong>
                </button>
                <button
                  type="button"
                  className="am-mt-coord-pill"
                  style={{
                    cursor: 'pointer',
                    border: rotAxis === 'z' ? '1px solid #00FFA8' : undefined,
                  }}
                  onClick={() => setRotAxis('z')}
                  title="Select Z Rotation axis"
                >
                  <span>Z</span>
                  <strong>{rot.toFixed(1)}°</strong>
                </button>
              </>
            )}
            {mode === 'scale' && (
              <>
                <div className="am-mt-coord-pill" title={`Resolution: ${resolvedW}×${resolvedH}px`}>
                  <span>W</span>
                  <strong>{resolvedW}px</strong>
                </div>
                <button
                  type="button"
                  className={`am-mt-link-btn ${layer.transform.scaleLinked ? 'active' : ''}`}
                  onClick={() =>
                    updateLayer((l) => {
                      l.transform.scaleLinked = !l.transform.scaleLinked;
                    })
                  }
                  title="Link X & Y Scale"
                >
                  <AmIcon name={layer.transform.scaleLinked ? 'ic_size_link' : 'ic_size_unlink'} fallback="link" size={14} />
                </button>
                <div className="am-mt-coord-pill" title={`Resolution: ${resolvedW}×${resolvedH}px`}>
                  <span>H</span>
                  <strong>{resolvedH}px</strong>
                </div>
              </>
            )}
            {mode === 'skew' && (
              <>
                <div className="am-mt-coord-pill">
                  <span>X</span>
                  <strong>{skew[0].toFixed(1)}°</strong>
                </div>
                <div className="am-mt-coord-pill">
                  <span>Y</span>
                  <strong>{skew[1].toFixed(1)}°</strong>
                </div>
              </>
            )}
          </div>

          {/* Interactive Touch ControlPad (#1E2239) */}
          <div className="am-trackpad" onPointerDown={handlePadDown}>
            <span className="am-pad-corner nw" />
            <span className="am-pad-corner ne" />
            <span className="am-pad-corner sw" />
            <span className="am-pad-corner se" />
            <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 11, color: 'var(--am-text-secondary)', fontWeight: 600 }}>
                {mode === 'location'
                  ? editPivot
                    ? 'Swipe here to move pivot'
                    : 'Swipe here to move layer'
                  : mode === 'rotation'
                    ? 'Drag horizontally to rotate'
                    : mode === 'scale'
                      ? 'Drag to scale layer'
                      : 'Drag to skew layer'}
              </div>
            </div>
          </div>

          {mode === 'rotation' && is3D && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              {(['x', 'y', 'z'] as const).map((ax) => (
                <button
                  key={ax}
                  type="button"
                  className={`am-pill ${rotAxis === ax ? 'active' : ''}`}
                  onClick={() => setRotAxis(ax)}
                >
                  Rot {ax.toUpperCase()}
                </button>
              ))}
              <button
                type="button"
                className="am-pill"
                onClick={() =>
                  updateLayer((l) => {
                    if (!l.transform.rotationX) l.transform.rotationX = { value: 0, keyframes: [] };
                    if (!l.transform.rotationY) l.transform.rotationY = { value: 0, keyframes: [] };
                    setAnimValue(l.transform.rotationX, 0);
                    setAnimValue(l.transform.rotationY, 0);
                    setAnimValue(l.transform.rotation, 0);
                  })
                }
              >
                Reset
              </button>
            </div>
          )}

          {mode === 'location' && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              <button type="button" className={`am-pill ${!editPivot ? 'active' : ''}`} onClick={() => setEditPivot(false)}>
                Location
              </button>
              <button type="button" className={`am-pill ${editPivot ? 'active' : ''}`} onClick={() => setEditPivot(true)}>
                Pivot
              </button>
              <button
                type="button"
                className="am-pill"
                onClick={() =>
                  updateLayer((l) => {
                    if (editPivot) setAnimValue(l.transform.pivot, [0, 0]);
                    else setAnimValue(l.transform.location, [project.width / 2, project.height / 2, 0]);
                  })
                }
              >
                Center
              </button>
            </div>
          )}
        </div>

        {/* Right 4-Mode Vertical Tab Rail (Move / Rotate / Scale / Skew) */}
        <div className="am-mt-right-rail">
          {(
            [
              ['location', 'ac_ic_movetransform', 'Move'],
              ['rotation', 'ic_rotate', 'Rotate'],
              ['scale', 'ic_scale', 'Scale'],
              ['skew', 'ic_skew', 'Skew'],
            ] as [Mode, string, string][]
          ).map(([m, icon, lbl]) => (
            <button
              key={m}
              type="button"
              className={`am-mt-mode-tab ${mode === m ? 'active' : ''}`}
              onClick={() => setMode(m)}
              title={lbl}
            >
              <AmIcon name={icon} fallback="sliders" size={18} color={mode === m ? '#00FFA8' : '#9AA1AF'} />
            </button>
          ))}
        </div>
      </div>

      {/* Exact Numeric Spinners */}
      {mode === 'location' && !editPivot && (
        <>
          <SpinnerControl
            label="X Position"
            value={loc[0]}
            min={-4000}
            max={4000}
            step={1}
            unit="px"
            onChange={(v) => updateLayer((l) => setAnimValue(l.transform.location, [v, loc[1], loc[2] ?? 0]))}
          />
          <SpinnerControl
            label="Y Position"
            value={loc[1]}
            min={-4000}
            max={4000}
            step={1}
            unit="px"
            onChange={(v) => updateLayer((l) => setAnimValue(l.transform.location, [loc[0], v, loc[2] ?? 0]))}
          />
          <SpinnerControl
            label="Z Depth (Camera Parallax)"
            value={loc[2] ?? 0}
            min={-3000}
            max={3000}
            step={1}
            unit="px"
            onChange={(v) => updateLayer((l) => setAnimValue(l.transform.location, [loc[0], loc[1], v]))}
          />
        </>
      )}

      {mode === 'location' && editPivot && (
        <>
          <SpinnerControl
            label="Pivot X"
            value={pivot[0]}
            min={-2000}
            max={2000}
            step={1}
            unit="px"
            onChange={(v) => updateLayer((l) => setAnimValue(l.transform.pivot, [v, pivot[1]]))}
          />
          <SpinnerControl
            label="Pivot Y"
            value={pivot[1]}
            min={-2000}
            max={2000}
            step={1}
            unit="px"
            onChange={(v) => updateLayer((l) => setAnimValue(l.transform.pivot, [pivot[0], v]))}
          />
        </>
      )}

      {mode === 'rotation' && !is3D && (
        <SpinnerControl
          label="Rotation Angle (Z)"
          value={rot}
          min={-1440}
          max={1440}
          step={0.5}
          unit="°"
          onChange={(v) => updateLayer((l) => setAnimValue(l.transform.rotation, v))}
        />
      )}

      {mode === 'rotation' && is3D && (
        <>
          <div onPointerDown={() => setRotAxis('x')}>
            <SpinnerControl
              label="X Rotation (Pitch)"
              value={rotX}
              min={-1440}
              max={1440}
              step={0.5}
              unit="°"
              onChange={(v) =>
                updateLayer((l) => {
                  if (!l.transform.rotationX) l.transform.rotationX = { value: 0, keyframes: [] };
                  setAnimValue(l.transform.rotationX, v);
                })
              }
            />
          </div>
          <div onPointerDown={() => setRotAxis('y')}>
            <SpinnerControl
              label="Y Rotation (Yaw)"
              value={rotY}
              min={-1440}
              max={1440}
              step={0.5}
              unit="°"
              onChange={(v) =>
                updateLayer((l) => {
                  if (!l.transform.rotationY) l.transform.rotationY = { value: 0, keyframes: [] };
                  setAnimValue(l.transform.rotationY, v);
                })
              }
            />
          </div>
          <div onPointerDown={() => setRotAxis('z')}>
            <SpinnerControl
              label="Z Rotation (Roll)"
              value={rot}
              min={-1440}
              max={1440}
              step={0.5}
              unit="°"
              onChange={(v) => updateLayer((l) => setAnimValue(l.transform.rotation, v))}
            />
          </div>
        </>
      )}

      {mode === 'scale' && (
        <>
          <SpinnerControl
            label={layer.transform.scaleLinked ? `Scale Width (${resolvedW}×${resolvedH})` : 'Scale X (Width)'}
            value={scale[0]}
            min={0.01}
            max={20}
            step={1 / Math.max(1, baseW)}
            multiplier={baseW}
            decimals={0}
            unit="px"
            onChange={(v) =>
              updateLayer((l) =>
                setAnimValue(l.transform.scale, l.transform.scaleLinked ? [v, v] : [v, scale[1]])
              )
            }
          />
          {!layer.transform.scaleLinked && (
            <SpinnerControl
              label="Scale Y (Height)"
              value={scale[1]}
              min={0.01}
              max={20}
              step={1 / Math.max(1, baseH)}
              multiplier={baseH}
              decimals={0}
              unit="px"
              onChange={(v) => updateLayer((l) => setAnimValue(l.transform.scale, [scale[0], v]))}
            />
          )}
        </>
      )}

      {mode === 'skew' && (
        <>
          <SpinnerControl
            label="Skew X"
            value={skew[0]}
            min={-80}
            max={80}
            step={0.5}
            unit="°"
            onChange={(v) => updateLayer((l) => setAnimValue(l.transform.skew, [v, skew[1]]))}
          />
          <SpinnerControl
            label="Skew Y"
            value={skew[1]}
            min={-80}
            max={80}
            step={0.5}
            unit="°"
            onChange={(v) => updateLayer((l) => setAnimValue(l.transform.skew, [skew[0], v]))}
          />
        </>
      )}
    </div>
  );
};
