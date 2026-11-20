import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';
import { ColorPicker } from '../components/ColorPicker';
import { useSelectedLayer } from './useSelectedLayer';

export const ColorFillPanel: React.FC = () => {
  const { toggleKeyframeOnProp, stepKeyframe } = useEditorStore(
    useShallow((s) => ({
      toggleKeyframeOnProp: s.toggleKeyframeOnProp,
      stepKeyframe: s.stepKeyframe,
    }))
  );
  const { layer, normT, updateLayer, setAnimValue, hasKfHere, readAnim } = useSelectedLayer();
  const [activeStopIdx, setActiveStopIdx] = useState(0);

  if (!layer) return null;
  const fillCol = readAnim(layer.fill.color, '#FF00FFA8');
  const target = { label: 'Fill Color', kind: 'fillColor' as const, key: 'color' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="am-pill-row">
        {(
          [
            ['none', 'No Fill'],
            ['solid', 'Color'],
            ['gradient', 'Gradient'],
          ] as ['none' | 'solid' | 'gradient', string][]
        ).map(([t, lbl]) => (
          <button
            key={t}
            type="button"
            className={`am-pill ${layer.fill.type === t ? 'active' : ''}`}
            onClick={() => updateLayer((l) => { l.fill.type = t; })}
          >
            {lbl}
          </button>
        ))}
      </div>

      {layer.fill.type === 'solid' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--am-text-secondary)' }}>Solid Fill Color</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" className="am-icon-btn" onClick={() => stepKeyframe(target, -1)}>
                <AmIcon name="ic_prev_element" fallback="back" size={14} />
              </button>
              <button
                type="button"
                className={`am-icon-btn ${hasKfHere(layer.fill.color) ? 'active' : ''}`}
                onClick={() => toggleKeyframeOnProp(target, normT)}
              >
                <AmIcon name={hasKfHere(layer.fill.color) ? 'ic_keyframe_sign' : 'ic_keyframe_add_hollow'} fallback="plus" size={16} />
              </button>
              <button type="button" className="am-icon-btn" onClick={() => stepKeyframe(target, 1)}>
                <AmIcon name="ic_next_element" fallback="next" size={14} />
              </button>
            </div>
          </div>
          <ColorPicker
            value={fillCol}
            onChange={(hex) => updateLayer((l) => setAnimValue(l.fill.color, hex))}
          />
        </>
      )}

      {layer.fill.type === 'gradient' && (
        <>
          <div className="am-pill-row">
            {(['linear', 'radial', 'sweep'] as const).map((gt) => (
              <button
                key={gt}
                type="button"
                className={`am-pill ${layer.fill.gradientType === gt ? 'active' : ''}`}
                onClick={() => updateLayer((l) => { l.fill.gradientType = gt; })}
              >
                {gt[0].toUpperCase() + gt.slice(1)}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {layer.fill.gradientStops.map((st, idx) => (
              <button
                key={idx}
                type="button"
                className={`am-pill ${activeStopIdx === idx ? 'active' : ''}`}
                onClick={() => setActiveStopIdx(idx)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 4, background: `#${st.color.slice(3)}` }} />
                Stop {idx + 1} ({Math.round(st.offset * 100)}%)
              </button>
            ))}
            <button
              type="button"
              className="am-pill"
              onClick={() =>
                updateLayer((l) => {
                  l.fill.gradientStops.push({ offset: 0.5, color: '#FFFFFFFF' });
                  l.fill.gradientStops.sort((a, b) => a.offset - b.offset);
                })
              }
            >
              + Stop
            </button>
          </div>

          {layer.fill.gradientStops[activeStopIdx] && (
            <>
              <div className="am-field">
                <label>Stop Offset ({Math.round(layer.fill.gradientStops[activeStopIdx].offset * 100)}%)</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={layer.fill.gradientStops[activeStopIdx].offset}
                  onChange={(e) =>
                    updateLayer((l) => {
                      l.fill.gradientStops[activeStopIdx].offset = Number(e.target.value);
                    })
                  }
                  style={{ accentColor: 'var(--am-accent)' }}
                />
              </div>
              <ColorPicker
                value={layer.fill.gradientStops[activeStopIdx].color}
                onChange={(hex) =>
                  updateLayer((l) => {
                    l.fill.gradientStops[activeStopIdx].color = hex;
                  })
                }
              />
            </>
          )}
        </>
      )}
    </div>
  );
};
