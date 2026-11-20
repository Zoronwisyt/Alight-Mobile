import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import type { BlendModeId } from '../../types/project';
import { SpinnerControl } from '../components/SpinnerControl';
import { useSelectedLayer } from './useSelectedLayer';

const BLEND_GROUPS: { group: string; items: { id: BlendModeId; label: string }[] }[] = [
  {
    group: 'Normal & Masking',
    items: [
      { id: 'normal', label: 'Normal' },
      { id: 'mask', label: 'Mask' },
      { id: 'exclude', label: 'Exclude' },
    ],
  },
  {
    group: 'Darken',
    items: [
      { id: 'com.alightcreative.blend.darken', label: 'Darken' },
      { id: 'com.alightcreative.blend.multiply', label: 'Multiply' },
      { id: 'com.alightcreative.blend.colorburn', label: 'Color Burn' },
      { id: 'com.alightcreative.blend.linearburn', label: 'Linear Burn' },
      { id: 'com.alightcreative.blend.darkercolor', label: 'Darker Color' },
    ],
  },
  {
    group: 'Lighten',
    items: [
      { id: 'com.alightcreative.blend.lighten', label: 'Lighten' },
      { id: 'com.alightcreative.blend.screen', label: 'Screen' },
      { id: 'com.alightcreative.blend.colordodge', label: 'Color Dodge' },
      { id: 'com.alightcreative.blend.lineardodge', label: 'Linear Dodge (Add)' },
      { id: 'com.alightcreative.blend.lightercolor', label: 'Lighter Color' },
    ],
  },
  {
    group: 'Contrast',
    items: [
      { id: 'com.alightcreative.blend.overlay', label: 'Overlay' },
      { id: 'com.alightcreative.blend.softlight', label: 'Soft Light' },
      { id: 'com.alightcreative.blend.hardlight', label: 'Hard Light' },
      { id: 'com.alightcreative.blend.vividlight', label: 'Vivid Light' },
      { id: 'com.alightcreative.blend.linearlight', label: 'Linear Light' },
      { id: 'com.alightcreative.blend.pinlight', label: 'Pin Light' },
    ],
  },
  {
    group: 'Difference',
    items: [
      { id: 'com.alightcreative.blend.difference', label: 'Difference' },
      { id: 'com.alightcreative.blend.exclusion', label: 'Exclusion' },
      { id: 'com.alightcreative.blend.subtract', label: 'Subtract' },
      { id: 'com.alightcreative.blend.divide', label: 'Divide' },
    ],
  },
  {
    group: 'Color',
    items: [
      { id: 'com.alightcreative.blend.hue', label: 'Hue' },
      { id: 'com.alightcreative.blend.saturation', label: 'Saturation' },
      { id: 'com.alightcreative.blend.color', label: 'Color' },
      { id: 'com.alightcreative.blend.luminosity', label: 'Luminosity' },
    ],
  },
];

export const BlendingOpacityPanel: React.FC = () => {
  const { toggleKeyframeOnProp, stepKeyframe, setCurveTarget } = useEditorStore(
    useShallow((s) => ({
      toggleKeyframeOnProp: s.toggleKeyframeOnProp,
      stepKeyframe: s.stepKeyframe,
      setCurveTarget: s.setCurveTarget,
    }))
  );
  const { layer, normT, updateLayer, setAnimValue, hasKfHere, readAnim } = useSelectedLayer();
  const [openGroup, setOpenGroup] = useState('Darken');

  if (!layer) return null;
  const opacity = readAnim(layer.opacity, 1);
  const opTarget = { label: 'Opacity', kind: 'opacity' as const, key: 'opacity' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SpinnerControl
        label="Layer Opacity"
        value={opacity}
        min={0}
        max={1}
        step={0.01}
        multiplier={100}
        unit="%"
        hasKeyframe={hasKfHere(layer.opacity)}
        onToggleKeyframe={() => toggleKeyframeOnProp(opTarget, normT)}
        onStepKeyframe={(d) => stepKeyframe(opTarget, d)}
        canOpenCurve={layer.opacity.keyframes.length >= 2}
        onOpenCurve={() => setCurveTarget(opTarget)}
        onChange={(v) => updateLayer((l) => setAnimValue(l.opacity, v))}
      />

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--am-text-muted)' }}>
        Blending Mode (Exact GLSL Shaders)
      </div>

      {BLEND_GROUPS.map((grp) => {
        const isOpen = openGroup === grp.group || grp.items.some((i) => i.id === layer.blendMode);
        return (
          <div key={grp.group} style={{ background: 'var(--am-a1)', borderRadius: 10, border: '1px solid var(--am-border)', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? '' : grp.group)}
              style={{
                width: '100%',
                padding: '9px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span>{grp.group}</span>
              <span style={{ color: 'var(--am-text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: '4px 10px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {grp.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`am-pill ${layer.blendMode === item.id ? 'active' : ''}`}
                    onClick={() => updateLayer((l) => { l.blendMode = item.id; })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
