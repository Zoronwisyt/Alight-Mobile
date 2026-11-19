import React, { useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { ColorPicker } from '../components/ColorPicker';
import { SpinnerControl } from '../components/SpinnerControl';
import { useSelectedLayer } from './useSelectedLayer';

export const BorderShadowPanel: React.FC = () => {
  const { toggleKeyframeOnProp, stepKeyframe, setCurveTarget } = useEditorStore();
  const { layer, normT, updateLayer, setAnimValue, hasKfHere, readAnim } = useSelectedLayer();
  const [subTab, setSubTab] = useState<'stroke' | 'shadow'>('stroke');

  if (!layer) return null;

  const strokeWidth = readAnim(layer.stroke.width, 6);
  const strokeColor = readAnim(layer.stroke.color, '#FFFFFFFF');
  const shadowAlpha = readAnim(layer.shadow.alpha, 0.75);
  const shadowSize = readAnim(layer.shadow.size, 18);
  const shadowX = readAnim(layer.shadow.offsetX, 0);
  const shadowY = readAnim(layer.shadow.offsetY, 8);
  const shadowCol = readAnim(layer.shadow.color, '#99000000');

  const swTarget = { label: 'Stroke Width', kind: 'strokeWidth' as const, key: 'width' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="am-pill-row">
        <button type="button" className={`am-pill ${subTab === 'stroke' ? 'active' : ''}`} onClick={() => setSubTab('stroke')}>
          Stroke {layer.stroke.enabled ? '●' : ''}
        </button>
        <button type="button" className={`am-pill ${subTab === 'shadow' ? 'active' : ''}`} onClick={() => setSubTab('shadow')}>
          Shadow {layer.shadow.enabled ? '●' : ''}
        </button>
      </div>

      {subTab === 'stroke' && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--am-a1)', borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Enable Stroke / Border</span>
            <input
              type="checkbox"
              checked={layer.stroke.enabled}
              onChange={(e) => updateLayer((l) => { l.stroke.enabled = e.target.checked; })}
              style={{ width: 18, height: 18, accentColor: 'var(--am-accent)' }}
            />
          </label>

          {layer.stroke.enabled && (
            <>
              <SpinnerControl
                label="Stroke Width"
                value={strokeWidth}
                min={0.5}
                max={200}
                step={0.5}
                unit="px"
                hasKeyframe={hasKfHere(layer.stroke.width)}
                onToggleKeyframe={() => toggleKeyframeOnProp(swTarget, normT)}
                onStepKeyframe={(d) => stepKeyframe(swTarget, d)}
                canOpenCurve={layer.stroke.width.keyframes.length >= 2}
                onOpenCurve={() => setCurveTarget(swTarget)}
                onChange={(v) => updateLayer((l) => setAnimValue(l.stroke.width, v))}
              />
              <div className="am-pill-row">
                {(['butt', 'round', 'square'] as const).map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    className={`am-pill ${layer.stroke.cap === cap ? 'active' : ''}`}
                    onClick={() => updateLayer((l) => { l.stroke.cap = cap; })}
                  >
                    Cap: {cap}
                  </button>
                ))}
                <button
                  type="button"
                  className={`am-pill ${layer.stroke.dash ? 'active' : ''}`}
                  onClick={() => updateLayer((l) => { l.stroke.dash = !l.stroke.dash; })}
                >
                  Dashed
                </button>
              </div>
              <ColorPicker
                value={strokeColor}
                onChange={(hex) => updateLayer((l) => setAnimValue(l.stroke.color, hex))}
              />
            </>
          )}
        </>
      )}

      {subTab === 'shadow' && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--am-a1)', borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Enable Drop Shadow</span>
            <input
              type="checkbox"
              checked={layer.shadow.enabled}
              onChange={(e) => updateLayer((l) => { l.shadow.enabled = e.target.checked; })}
              style={{ width: 18, height: 18, accentColor: 'var(--am-accent)' }}
            />
          </label>

          {layer.shadow.enabled && (
            <>
              <SpinnerControl label="Size" value={shadowSize} min={0} max={120} step={1} unit="px" onChange={(v) => updateLayer((l) => setAnimValue(l.shadow.size, v))} />
              <SpinnerControl label="Alpha" value={shadowAlpha} min={0} max={1} step={0.01} multiplier={100} unit="%" onChange={(v) => updateLayer((l) => setAnimValue(l.shadow.alpha, v))} />
              <SpinnerControl label="Position X" value={shadowX} min={-200} max={200} step={1} unit="px" onChange={(v) => updateLayer((l) => setAnimValue(l.shadow.offsetX, v))} />
              <SpinnerControl label="Position Y" value={shadowY} min={-200} max={200} step={1} unit="px" onChange={(v) => updateLayer((l) => setAnimValue(l.shadow.offsetY, v))} />
              <ColorPicker value={shadowCol} onChange={(hex) => updateLayer((l) => setAnimValue(l.shadow.color, hex))} />
            </>
          )}
        </>
      )}
    </div>
  );
};
