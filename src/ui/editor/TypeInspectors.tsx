import React from 'react';
import { evalAnimatable } from '../../engine/animation';
import { getShapeById, parseDefaultParamValue } from '../../engine/catalog';
import { useEditorStore } from '../../store/useEditorStore';
import { ColorPicker } from '../components/ColorPicker';
import { SpinnerControl } from '../components/SpinnerControl';
import { useSelectedLayer } from './useSelectedLayer';

export const ShapeEditPanel: React.FC = () => {
  const { toggleKeyframeOnProp, setCurveTarget } = useEditorStore();
  const { layer, normT, updateLayer, setAnimValue, hasKfHere } = useSelectedLayer();
  if (!layer || layer.type !== 'shape' || !layer.shapeId) return null;
  const def = getShapeById(layer.shapeId);
  if (!def) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--am-accent)' }}>{def.name} Parameters</div>
      {def.params.map((pd) => {
        if (!pd.id) return null;
        const pid = pd.id;
        const anim = layer.shapeParams?.[pid];
        const val = evalAnimatable(anim, normT, parseDefaultParamValue(pd));
        const target = { label: pd.label || pid, kind: 'shapeParam' as const, key: pid };

        if (pd.tag === 'point') {
          const pt = Array.isArray(val) ? val : [100, 100];
          return (
            <div key={pid} style={{ background: 'var(--am-a1)', padding: 10, borderRadius: 11, border: '1px solid var(--am-border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{pd.label || pid}</div>
              <SpinnerControl
                label={`${pd.label || pid} X`}
                value={Number(pt[0]) || 0}
                min={-2000}
                max={2000}
                step={1}
                hasKeyframe={hasKfHere(anim)}
                onToggleKeyframe={() => toggleKeyframeOnProp(target, normT)}
                canOpenCurve={(anim?.keyframes.length ?? 0) >= 2}
                onOpenCurve={() => setCurveTarget(target)}
                onChange={(nx) =>
                  updateLayer((l) => {
                    l.shapeParams = l.shapeParams ?? {};
                    if (!l.shapeParams[pid]) l.shapeParams[pid] = { value: [nx, pt[1]], keyframes: [] };
                    else setAnimValue(l.shapeParams[pid], [nx, pt[1]]);
                  })
                }
              />
              <SpinnerControl
                label={`${pd.label || pid} Y`}
                value={Number(pt[1]) || 0}
                min={-2000}
                max={2000}
                step={1}
                onChange={(ny) =>
                  updateLayer((l) => {
                    l.shapeParams = l.shapeParams ?? {};
                    if (!l.shapeParams[pid]) l.shapeParams[pid] = { value: [pt[0], ny], keyframes: [] };
                    else setAnimValue(l.shapeParams[pid], [pt[0], ny]);
                  })
                }
              />
            </div>
          );
        }

        if (pd.tag === 'switch') {
          return (
            <label key={pid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, background: 'var(--am-a1)', borderRadius: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{pd.label || pid}</span>
              <input
                type="checkbox"
                checked={Boolean(val)}
                onChange={(e) =>
                  updateLayer((l) => {
                    l.shapeParams = l.shapeParams ?? {};
                    l.shapeParams[pid] = { value: e.target.checked, keyframes: [] };
                  })
                }
                style={{ width: 18, height: 18, accentColor: 'var(--am-accent)' }}
              />
            </label>
          );
        }

        return (
          <SpinnerControl
            key={pid}
            label={pd.label || pid}
            value={Number(val) || 0}
            min={pd.min ? parseFloat(pd.min) : -3600}
            max={pd.max ? parseFloat(pd.max) : 3600}
            step={pd.step ? parseFloat(pd.step) : 1}
            hasKeyframe={hasKfHere(anim)}
            onToggleKeyframe={() => toggleKeyframeOnProp(target, normT)}
            canOpenCurve={(anim?.keyframes.length ?? 0) >= 2}
            onOpenCurve={() => setCurveTarget(target)}
            onChange={(nv) =>
              updateLayer((l) => {
                l.shapeParams = l.shapeParams ?? {};
                if (!l.shapeParams[pid]) l.shapeParams[pid] = { value: nv, keyframes: [] };
                else setAnimValue(l.shapeParams[pid], nv);
              })
            }
          />
        );
      })}
    </div>
  );
};

export const TextEditPanel: React.FC = () => {
  const { layer, updateLayer } = useSelectedLayer();
  if (!layer || layer.type !== 'text' || !layer.textData) return null;
  const td = layer.textData;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="am-field">
        <label htmlFor="txt-content">Text Content</label>
        <textarea
          id="txt-content"
          className="am-input"
          rows={3}
          value={td.content}
          onChange={(e) => updateLayer((l) => { if (l.textData) l.textData.content = e.target.value; })}
        />
      </div>

      <div className="am-field">
        <label htmlFor="txt-font">Font Family (APK Bundled)</label>
        <select
          id="txt-font"
          className="am-select"
          value={td.fontFamily}
          onChange={(e) => updateLayer((l) => { if (l.textData) l.textData.fontFamily = e.target.value; })}
        >
          <option value="Space Grotesk">Space Grotesk</option>
          <option value="Roboto">Roboto</option>
          <option value="Hind">Hind</option>
          <option value="Serif Pro">Serif Pro</option>
          <option value="monospace">Monospace</option>
        </select>
      </div>

      <SpinnerControl
        label="Font Size"
        value={td.fontSize}
        min={8}
        max={400}
        step={1}
        unit="px"
        onChange={(v) => updateLayer((l) => { if (l.textData) l.textData.fontSize = v; })}
      />

      <SpinnerControl
        label="Letter Spacing"
        value={td.letterSpacing}
        min={-40}
        max={120}
        step={1}
        unit="px"
        onChange={(v) => updateLayer((l) => { if (l.textData) l.textData.letterSpacing = v; })}
      />

      <div className="am-pill-row">
        {(['left', 'center', 'right'] as const).map((al) => (
          <button
            key={al}
            type="button"
            className={`am-pill ${td.align === al ? 'active' : ''}`}
            onClick={() => updateLayer((l) => { if (l.textData) l.textData.align = al; })}
          >
            Align: {al}
          </button>
        ))}
      </div>

      <ColorPicker
        value={td.color}
        onChange={(hex) => updateLayer((l) => { if (l.textData) l.textData.color = hex; })}
      />
    </div>
  );
};

export const EditPointsPanel: React.FC = () => {
  const { layer, updateLayer } = useSelectedLayer();
  if (!layer || layer.type !== 'vector' || !layer.vectorPath) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--am-text-secondary)' }}>
        Drag the glowing mint points directly on the preview stage to reshape this vector path.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="am-btn am-btn-primary"
          onClick={() =>
            updateLayer((l) => {
              l.vectorPath?.points.push({
                x: Math.round((Math.random() - 0.5) * 260),
                y: Math.round((Math.random() - 0.5) * 260),
                inX: -30,
                inY: 0,
                outX: 30,
                outY: 0,
              });
            })
          }
        >
          + Add Point
        </button>
        <button
          type="button"
          className="am-btn"
          onClick={() => updateLayer((l) => { if (l.vectorPath) l.vectorPath.closed = !l.vectorPath.closed; })}
        >
          {layer.vectorPath.closed ? 'Open Path' : 'Close Path'}
        </button>
      </div>
    </div>
  );
};

export const DrawingToolbar: React.FC = () => {
  const { drawingBrushColor, drawingBrushWidth, drawingBrushOpacity, setDrawingBrush } = useEditorStore();
  const { layer, updateLayer } = useSelectedLayer();
  if (!layer || layer.type !== 'freehand') return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--am-accent)', fontWeight: 700 }}>
        Draw strokes directly on the preview stage ({layer.freehandStrokes?.length ?? 0} strokes)
      </div>
      <SpinnerControl
        label="Brush Size"
        value={drawingBrushWidth}
        min={2}
        max={120}
        step={1}
        unit="px"
        onChange={(v) => setDrawingBrush({ width: v })}
      />
      <SpinnerControl
        label="Brush Opacity"
        value={drawingBrushOpacity}
        min={0.05}
        max={1}
        step={0.05}
        multiplier={100}
        unit="%"
        onChange={(v) => setDrawingBrush({ opacity: v })}
      />
      <ColorPicker value={drawingBrushColor} showAlpha={false} onChange={(c) => setDrawingBrush({ color: c })} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="am-btn"
          onClick={() => updateLayer((l) => { l.freehandStrokes?.pop(); })}
        >
          Undo Stroke
        </button>
        <button
          type="button"
          className="am-btn am-btn-danger"
          onClick={() => updateLayer((l) => { l.freehandStrokes = []; })}
        >
          Clear All
        </button>
      </div>
    </div>
  );
};

export const CameraOptionsPanel: React.FC = () => {
  const { layer, normT, updateLayer, setAnimValue, readAnim } = useSelectedLayer();
  if (!layer || layer.type !== 'camera' || !layer.cameraData) return null;
  const cd = layer.cameraData;
  const fov = readAnim(cd.fov, 60);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SpinnerControl
        label="Field of View (FOV)"
        value={fov}
        min={15}
        max={140}
        step={1}
        unit="°"
        onChange={(v) => updateLayer((l) => { if (l.cameraData) setAnimValue(l.cameraData.fov, v); })}
      />
      <div style={{ fontSize: 12, color: 'var(--am-text-secondary)' }}>
        Tip: Toggle the active Camera icon in the top action bar and adjust Z-Depth in Move &amp; Transform on any layer to create true 3D parallax!
      </div>
    </div>
  );
};

export const SpeedRemapPanel: React.FC = () => {
  const { toggleKeyframeOnProp, stepKeyframe, setCurveTarget } = useEditorStore();
  const { layer, normT, updateLayer, setAnimValue, hasKfHere, readAnim } = useSelectedLayer();
  if (!layer) return null;
  const spd = readAnim(layer.speed, 1);
  const target = { label: 'Speed', kind: 'speed' as const, key: 'speed' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SpinnerControl
        label="Playback Speed Multiplier"
        value={spd}
        min={0.1}
        max={5}
        step={0.05}
        multiplier={100}
        unit="%"
        hasKeyframe={hasKfHere(layer.speed)}
        onToggleKeyframe={() => toggleKeyframeOnProp(target, normT)}
        onStepKeyframe={(d) => stepKeyframe(target, d)}
        canOpenCurve={layer.speed.keyframes.length >= 2}
        onOpenCurve={() => setCurveTarget(target)}
        onChange={(v) => updateLayer((l) => setAnimValue(l.speed, v))}
      />
      <p style={{ margin: 0, fontSize: 12, color: 'var(--am-text-muted)' }}>
        Keyframe Speed over time to create speed ramps and velocity edits!
      </p>
    </div>
  );
};

export const VolumePanel: React.FC = () => {
  const { layer, normT, updateLayer, setAnimValue, readAnim } = useSelectedLayer();
  if (!layer || layer.type !== 'audio' || !layer.audioData) return null;
  const vol = readAnim(layer.audioData.volume, 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SpinnerControl
        label="Track Volume"
        value={vol}
        min={0}
        max={2}
        step={0.05}
        multiplier={100}
        unit="%"
        onChange={(v) => updateLayer((l) => { if (l.audioData) setAnimValue(l.audioData.volume, v); })}
      />
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 10, background: 'var(--am-a1)', borderRadius: 10 }}>
        <span>Mute Audio Track</span>
        <input
          type="checkbox"
          checked={layer.audioData.muted}
          onChange={(e) => updateLayer((l) => { if (l.audioData) l.audioData.muted = e.target.checked; })}
          style={{ width: 18, height: 18, accentColor: 'var(--am-accent)' }}
        />
      </label>
    </div>
  );
};
