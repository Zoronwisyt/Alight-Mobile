import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { evalAnimatable } from '../../engine/animation';
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
  const { toggleKeyframeOnProp, stepKeyframe, setCurveTarget } = useEditorStore(
    useShallow((s) => ({
      toggleKeyframeOnProp: s.toggleKeyframeOnProp,
      stepKeyframe: s.stepKeyframe,
      setCurveTarget: s.setCurveTarget,
    }))
  );
  const { project, layer, normT, updateLayer, setAnimValue, hasKfHere, readAnim } = useSelectedLayer();
  const [mode, setMode] = useState<Mode>('location');
  const [editPivot, setEditPivot] = useState(false);

  if (!layer || !project) return null;

  const loc = readAnim(layer.transform.location, [project.width / 2, project.height / 2, 0]);
  const rot = readAnim(layer.transform.rotation, 0);
  const scale = readAnim(layer.transform.scale, [1, 1]);
  const [baseW, baseH] = getLayerBaseDimensions(layer, project, normT);
  const resolvedW = Math.max(1, Math.round(baseW * scale[0]));
  const resolvedH = Math.max(1, Math.round(baseH * scale[1]));
  const pivot = readAnim(layer.transform.pivot, [0, 0]);
  const skew = readAnim(layer.transform.skew, [0, 0]);

  const activeTarget: ActiveCurveTarget =
    mode === 'location' && editPivot
      ? { label: 'Pivot', kind: 'transform', key: 'pivot' }
      : {
          label: mode === 'location' ? 'Location' : mode === 'rotation' ? 'Rotation' : mode === 'scale' ? 'Scale' : 'Skew',
          kind: 'transform',
          key: mode,
        };

  const activeProp = mode === 'location' && editPivot ? layer.transform.pivot : layer.transform[mode];
  const kfActive = hasKfHere(activeProp);

  const handlePadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const sLoc = [...loc] as [number, number, number];
    const sRot = rot;
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
            setAnimValue(l.transform.location, [Math.round(sLoc[0] + dx * 2), Math.round(sLoc[1] + dy * 2), sLoc[2]]);
          }
        } else if (mode === 'rotation') {
          setAnimValue(l.transform.rotation, Math.round((sRot + dx * 0.5) * 10) / 10);
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
            {mode === 'rotation' && (
              <div className="am-mt-coord-pill wide">
                <span>Angle</span>
                <strong>{rot.toFixed(1)}°</strong>
              </div>
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

      {mode === 'rotation' && (
        <SpinnerControl
          label="Rotation Angle"
          value={rot}
          min={-1440}
          max={1440}
          step={0.5}
          unit="°"
          onChange={(v) => updateLayer((l) => setAnimValue(l.transform.rotation, v))}
        />
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
