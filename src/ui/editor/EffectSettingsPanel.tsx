import React from 'react';
import { evalAnimatable } from '../../engine/animation';
import { formatEffectDisplayName, getEffectById, parseDefaultParamValue } from '../../engine/catalog';
import { useEditorStore, type ActiveCurveTarget } from '../../store/useEditorStore';
import type { EffectParamDef } from '../../types/project';
import { ColorPicker } from '../components/ColorPicker';
import { SpinnerControl } from '../components/SpinnerControl';
import { useSelectedLayer } from './useSelectedLayer';

export const EffectSettingsPanel: React.FC = () => {
  const {
    activeEffectUid,
    setInspectorTab,
    toggleKeyframeOnProp,
    stepKeyframe,
    setCurveTarget,
  } = useEditorStore();
  const { layer, normT, updateLayer, setAnimValue, hasKfHere } = useSelectedLayer();

  if (!layer || !activeEffectUid) return null;
  const inst = layer.effects.find((e) => e.uid === activeEffectUid);
  const def = inst ? getEffectById(inst.effectId) : undefined;
  if (!inst || !def) {
    return (
      <div>
        <button type="button" className="am-btn" onClick={() => setInspectorTab('effects')}>
          ← Back to Effects
        </button>
      </div>
    );
  }

  // Evaluate enableTargets chains from selectors & switches
  const disabledTargets = new Set<string>();
  const allTargeted = new Set<string>();
  const enabledTargets = new Set<string>();
  for (const pd of def.params) {
    if (pd.enabled === 'false' && pd.id) disabledTargets.add(pd.id);
    if (pd.tag === 'selector' && pd.choices && pd.id) {
      const curVal = String(evalAnimatable(inst.params[pd.id], normT, parseDefaultParamValue(pd)));
      for (const ch of pd.choices) {
        for (const t of ch.enableTargets.split(',').map((s) => s.trim()).filter(Boolean)) {
          allTargeted.add(t);
          if (ch.value === curVal) enabledTargets.add(t);
        }
      }
    }
    if (pd.tag === 'switch' && (pd as any).enableTargets && pd.id) {
      const curBool = Boolean(evalAnimatable(inst.params[pd.id], normT, parseDefaultParamValue(pd)));
      for (const t of String((pd as any).enableTargets).split(',').map((s) => s.trim()).filter(Boolean)) {
        allTargeted.add(t);
        if (curBool) enabledTargets.add(t);
      }
    }
  }

  const isParamVisible = (pd: EffectParamDef): boolean => {
    if (!pd.id) return true;
    if (allTargeted.has(pd.id)) return enabledTargets.has(pd.id);
    if (disabledTargets.has(pd.id)) return false;
    return true;
  };

  const setParamVal = (paramId: string, nextVal: any) => {
    updateLayer((l) => {
      const e = l.effects.find((x) => x.uid === inst.uid);
      if (!e) return;
      if (!e.params[paramId]) {
        e.params[paramId] = { value: nextVal, keyframes: [] };
      } else {
        setAnimValue(e.params[paramId], nextVal);
      }
    });
  };

  const makeTarget = (pd: EffectParamDef): ActiveCurveTarget => ({
    label: pd.label || pd.id || 'Param',
    kind: 'effectParam',
    key: pd.id || '',
    effectUid: inst.uid,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="am-btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setInspectorTab('effects')}>
          ← Effects
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: def.deprecated ? 'var(--am-gold)' : 'var(--am-accent)' }}>
          {formatEffectDisplayName(def, inst.effectId)}
        </span>
      </div>

      {def.params.map((pd, i) => {
        if (pd.tag === 'texture' || pd.tag === 'float') return null;
        if (!isParamVisible(pd)) return null;

        if (pd.tag === 'section') {
          return (
            <div
              key={`sec_${i}`}
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: 'var(--am-accent)',
                borderBottom: '1px solid var(--am-border)',
                paddingBottom: 4,
                marginTop: 6,
              }}
            >
              {pd.text || pd.label}
            </div>
          );
        }

        if (pd.tag === 'tip') {
          return (
            <div
              key={`tip_${i}`}
              style={{
                fontSize: 12,
                color: 'var(--am-text-secondary)',
                background: 'rgba(92, 229, 255, 0.08)',
                border: '1px solid rgba(92, 229, 255, 0.25)',
                borderRadius: 9,
                padding: '8px 10px',
              }}
            >
              {pd.text}
            </div>
          );
        }

        const pid = pd.id!;
        const anim = inst.params[pid];
        const val = evalAnimatable(anim, normT, parseDefaultParamValue(pd));
        const kfTarget = makeTarget(pd);
        const kfHere = hasKfHere(anim);
        const canCurve = (anim?.keyframes.length ?? 0) >= 2;

        if (pd.tag === 'spinner' || pd.tag === 'slider') {
          const min = pd.min !== undefined ? parseFloat(pd.min) : -1000;
          const max = pd.max !== undefined ? parseFloat(pd.max) : 1000;
          const step = pd.step !== undefined ? parseFloat(pd.step) : pd.type === 'integer' ? 1 : 0.01;
          const mult = pd.multiplier !== undefined ? parseFloat(pd.multiplier) : pd.type === 'percent' ? 100 : 1;
          const unit = pd.type === 'percent' ? '%' : pd.type === 'angle' ? '°' : pd.type === 'hz' ? 'Hz' : '';
          return (
            <SpinnerControl
              key={pid}
              label={pd.label || pid}
              value={Number(val) || 0}
              min={min}
              max={max}
              step={step}
              multiplier={mult}
              unit={unit}
              hasKeyframe={kfHere}
              onToggleKeyframe={() => toggleKeyframeOnProp(kfTarget, normT)}
              onStepKeyframe={(d) => stepKeyframe(kfTarget, d)}
              canOpenCurve={canCurve}
              onOpenCurve={() => setCurveTarget(kfTarget)}
              onChange={(nv) => setParamVal(pid, nv)}
            />
          );
        }

        if (pd.tag === 'point') {
          const pt = Array.isArray(val) ? val : [0, 0];
          return (
            <div key={pid} style={{ background: 'var(--am-a1)', borderRadius: 11, padding: 10, border: '1px solid var(--am-border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{pd.label || pid}</div>
              <SpinnerControl
                label={`${pd.label || pid} X`}
                value={Number(pt[0]) || 0}
                min={-3000}
                max={3000}
                step={1}
                hasKeyframe={kfHere}
                onToggleKeyframe={() => toggleKeyframeOnProp(kfTarget, normT)}
                canOpenCurve={canCurve}
                onOpenCurve={() => setCurveTarget(kfTarget)}
                onChange={(nx) => setParamVal(pid, [nx, pt[1] ?? 0])}
              />
              <SpinnerControl
                label={`${pd.label || pid} Y`}
                value={Number(pt[1]) || 0}
                min={-3000}
                max={3000}
                step={1}
                onChange={(ny) => setParamVal(pid, [pt[0] ?? 0, ny])}
              />
            </div>
          );
        }

        if (pd.tag === 'xyz' || pd.tag === 'orient' || pd.tag === 'hue-disc') {
          const v3 = Array.isArray(val) ? val : [0, 0, 0];
          const labels =
            pd.tag === 'hue-disc'
              ? ['Hue (°)', 'Saturation', 'Bias / Gamma']
              : [`${pd.label || pid} X`, `${pd.label || pid} Y`, `${pd.label || pid} Z`];
          const maxes = pd.tag === 'hue-disc' ? [360, 1, 1] : [3600, 3600, 3600];
          const mins = pd.tag === 'hue-disc' ? [-360, 0, -1] : [-3600, -3600, -3600];
          const steps = pd.tag === 'hue-disc' ? [1, 0.01, 0.01] : [1, 1, 1];
          return (
            <div key={pid} style={{ background: 'var(--am-a1)', borderRadius: 11, padding: 10, border: '1px solid var(--am-border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{pd.label || pid}</div>
              {[0, 1, 2].map((axis) => (
                <SpinnerControl
                  key={axis}
                  label={labels[axis]}
                  value={Number(v3[axis]) || 0}
                  min={mins[axis]}
                  max={maxes[axis]}
                  step={steps[axis]}
                  hasKeyframe={axis === 0 ? kfHere : false}
                  onToggleKeyframe={axis === 0 ? () => toggleKeyframeOnProp(kfTarget, normT) : undefined}
                  canOpenCurve={axis === 0 && canCurve}
                  onOpenCurve={axis === 0 ? () => setCurveTarget(kfTarget) : undefined}
                  onChange={(nv) => {
                    const next = [...v3];
                    next[axis] = nv;
                    setParamVal(pid, next);
                  }}
                />
              ))}
            </div>
          );
        }

        if (pd.tag === 'color') {
          return (
            <div key={pid} style={{ background: 'var(--am-a1)', borderRadius: 11, padding: 10, border: '1px solid var(--am-border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{pd.label || pid}</div>
              <ColorPicker
                value={String(val || '#FFFFFFFF')}
                showAlpha={pd.alpha !== 'false'}
                onChange={(hex) => setParamVal(pid, hex)}
              />
            </div>
          );
        }

        if (pd.tag === 'selector') {
          return (
            <div key={pid} className="am-field" style={{ background: 'var(--am-a1)', borderRadius: 11, padding: 10, border: '1px solid var(--am-border)' }}>
              <label>{pd.label || pid}</label>
              <div className="am-pill-row">
                {(pd.choices ?? []).map((ch) => (
                  <button
                    key={ch.value}
                    type="button"
                    className={`am-pill ${String(val) === String(ch.value) ? 'active' : ''}`}
                    onClick={() => setParamVal(pid, parseInt(ch.value, 10) || 0)}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        if (pd.tag === 'switch') {
          return (
            <label
              key={pid}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 11px',
                background: 'var(--am-a1)',
                borderRadius: 10,
                border: '1px solid var(--am-border)',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{pd.label || pid}</span>
              <input
                type="checkbox"
                checked={Boolean(val)}
                onChange={(e) => setParamVal(pid, e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--am-accent)' }}
              />
            </label>
          );
        }

        return null;
      })}
    </div>
  );
};
