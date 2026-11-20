import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import type { BlendModeId } from '../../types/project';
import { BLEND_MODE_TABLE, canonicalizeBlendMode, type BlendGroupName } from '../../engine/blendModes';
import { SpinnerControl } from '../components/SpinnerControl';
import { useSelectedLayer } from './useSelectedLayer';

const GROUP_ORDER: BlendGroupName[] = [
  'Normal & Masking',
  'Darken',
  'Lighten',
  'Contrast',
  'Difference',
  'Color',
];

// Built from the APK's own BlendingMode table so the UI can never drift from the renderer.
const BLEND_GROUPS: { group: BlendGroupName; items: { id: BlendModeId; label: string }[] }[] =
  GROUP_ORDER.map((group) => ({
    group,
    items: BLEND_MODE_TABLE.filter((d) => d.group === group).map((d) => ({
      id: d.effectId ?? (d.xmlId as BlendModeId),
      label: d.label,
    })),
  }));

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
        const isOpen =
          openGroup === grp.group || grp.items.some((i) => i.id === canonicalizeBlendMode(layer.blendMode));
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
                    className={`am-pill ${canonicalizeBlendMode(layer.blendMode) === item.id ? 'active' : ''}`}
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
