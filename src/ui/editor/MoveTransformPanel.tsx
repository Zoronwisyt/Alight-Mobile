import React, { useState } from 'react';
import { useEditorStore, type ActiveCurveTarget } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';
import { SpinnerControl } from '../components/SpinnerControl';
import { useSelectedLayer } from './useSelectedLayer';

type Mode = 'location' | 'rotation' | 'scale' | 'skew';

export const MoveTransformPanel: React.FC = () => {
  const { toggleKeyframeOnProp, stepKeyframe, setCurveTarget } = useEditorStore();
  const { project, layer, normT, updateLayer, setAnimValue, hasKfHere, readAnim } = useSelectedLayer();
  const [mode, setMode] = useState<Mode>('location');
  const [editPivot, setEditPivot] = useState(false);

  if (!layer || !project) return null;

  const loc = readAnim(layer.transform.location, [project.width / 2, project.height / 2, 0]);
  const rot = readAnim(layer.transform.rotation, 0);
  const scale = readAnim(layer.transform.scale, [1, 1]);
  const pivot = readAnim(layer.transform.pivot, [0, 0]);
  const skew = readAnim(layer.transform.skew, [0, 0]);

  const activeTarget: ActiveCurveTarget =
    mode === 'location' && editPivot
      ? { label: 'Pivot', kind: 'transform', key: 'pivot' }
      : { label: mode === 'location' ? 'Position' : mode === 'rotation' ? 'Rotation' : mode === 'scale' ? 'Scale' : 'Skew', kind: 'transform', key: mode };

  const activeProp =
    mode === 'location' && editPivot
      ? layer.transform.pivot
      : layer.transform[mode];

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

    const onMove = (ev: PointerEvent) => apply(ev.clientX, ev.clientY, false);
    const onUp = (ev: PointerEvent) => {
      apply(ev.clientX, ev.clientY, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Keyframe & Curve Top Strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--am-a1)', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--am-border)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--am-accent)' }}>{activeTarget.label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" className="am-icon-btn" onClick={() => stepKeyframe(activeTarget, -1)} title="Previous Keyframe">
            <AmIcon name="ic_prev_element" fallback="back" size={15} />
          </button>
          <button
            type="button"
            className={`am-icon-btn ${hasKfHere(activeProp) ? 'active' : ''}`}
            onClick={() => toggleKeyframeOnProp(activeTarget, normT)}
            title="Add / Remove Keyframe"
          >
            <AmIcon name={hasKfHere(activeProp) ? 'ic_keyframe_sign' : 'ic_keyframe_add_hollow'} fallback="plus" size={18} />
          </button>
          <button type="button" className="am-icon-btn" onClick={() => stepKeyframe(activeTarget, 1)} title="Next Keyframe">
            <AmIcon name="ic_next_element" fallback="next" size={15} />
          </button>
          <button
            type="button"
            className="am-icon-btn"
            disabled={activeProp.keyframes.length < 2}
            onClick={() => setCurveTarget(activeTarget)}
            title="Edit Easing Curve"
          >
            <AmIcon name="ic_animate_curve" fallback="curve" size={17} />
          </button>
        </div>
      </div>

      {/* Mode Selector + Trackpad */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 78px', gap: 8 }}>
        <div className="am-trackpad" onPointerDown={handlePadDown}>
          <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 11, color: 'var(--am-text-muted)', marginBottom: 4 }}>
              SWIPE HERE TO ADJUST
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--am-accent)' }}>
              {mode === 'location' && !editPivot && `X: ${Math.round(loc[0])}  Y: ${Math.round(loc[1])}  Z: ${Math.round(loc[2] ?? 0)}`}
              {mode === 'location' && editPivot && `Pivot X: ${Math.round(pivot[0])}  Y: ${Math.round(pivot[1])}`}
              {mode === 'rotation' && `${rot.toFixed(1)}°`}
              {mode === 'scale' && `${Math.round(scale[0] * 100)}% × ${Math.round(scale[1] * 100)}%`}
              {mode === 'skew' && `X: ${skew[0].toFixed(1)}°  Y: ${skew[1].toFixed(1)}°`}
            </div>
          </div>
        </div>

        {/* 4-Mode Vertical Rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(
            [
              ['location', 'Move'],
              ['rotation', 'Rotate'],
              ['scale', 'Scale'],
              ['skew', 'Skew'],
            ] as [Mode, string][]
          ).map(([m, lbl]) => (
            <button
              key={m}
              type="button"
              className={`am-pill ${mode === m ? 'active' : ''}`}
              style={{ width: '100%', padding: '7px 4px', textAlign: 'center', fontSize: 11 }}
              onClick={() => setMode(m)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Exact Numeric Spinners */}
      {mode === 'location' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button type="button" className={`am-pill ${!editPivot ? 'active' : ''}`} onClick={() => setEditPivot(false)}>
              Position
            </button>
            <button type="button" className={`am-pill ${editPivot ? 'active' : ''}`} onClick={() => setEditPivot(true)}>
              Edit Pivot Anchor
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

          {!editPivot ? (
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
          ) : (
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
        </>
      )}

      {mode === 'rotation' && (
        <SpinnerControl
          label="Rotation Angle"
          value={rot}
          min={-3600}
          max={3600}
          step={0.5}
          unit="°"
          onChange={(v) => updateLayer((l) => setAnimValue(l.transform.rotation, v))}
        />
      )}

      {mode === 'scale' && (
        <>
          <button
            type="button"
            className={`am-pill ${layer.transform.scaleLinked ? 'active' : ''}`}
            style={{ alignSelf: 'flex-start' }}
            onClick={() => updateLayer((l) => { l.transform.scaleLinked = !l.transform.scaleLinked; })}
          >
            {layer.transform.scaleLinked ? '🔗 Uniform Scale Locked' : '🔓 Independent X / Y'}
          </button>
          <SpinnerControl
            label="Scale X"
            value={scale[0]}
            min={0.01}
            max={10}
            step={0.01}
            multiplier={100}
            unit="%"
            onChange={(v) =>
              updateLayer((l) => setAnimValue(l.transform.scale, [v, l.transform.scaleLinked ? v : scale[1]]))
            }
          />
          {!layer.transform.scaleLinked && (
            <SpinnerControl
              label="Scale Y"
              value={scale[1]}
              min={0.01}
              max={10}
              step={0.01}
              multiplier={100}
              unit="%"
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
