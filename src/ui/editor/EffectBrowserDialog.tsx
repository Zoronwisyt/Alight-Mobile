import React, { useMemo, useState } from 'react';
import {
  createEffectInstance,
  EFFECT_CATEGORIES,
  formatEffectDisplayName,
  getEffects,
  getPresetsForEffect,
} from '../../engine/catalog';
import { useEditorStore } from '../../store/useEditorStore';
import type { EffectDef, EffectPreset } from '../../types/project';
import { AmDialog } from '../components/AmDialog';
import { AmIcon } from '../components/AmIcon';
import { useSelectedLayer } from './useSelectedLayer';

export const EffectBrowserDialog: React.FC = () => {
  const { showEffectBrowser, setModal, setActiveEffectUid, setInspectorTab } = useEditorStore();
  const { layer, updateLayer } = useSelectedLayer();

  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [detailEffect, setDetailEffect] = useState<EffectDef | null>(null);

  const allEffects = getEffects();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEffects.filter((e) => {
      if (e.internal) return false;
      if (!includeLegacy && (e.deprecated || e.experimental)) return false;
      if (category !== 'all' && e.category !== category) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [allEffects, category, query, includeLegacy]);

  const applyEffect = (def: EffectDef, preset?: EffectPreset) => {
    if (!layer) return;
    const inst = createEffectInstance(def, preset);
    updateLayer((l) => {
      l.effects.push(inst);
    });
    setActiveEffectUid(inst.uid);
    setInspectorTab('effectSettings');
    setDetailEffect(null);
    setModal('showEffectBrowser', false);
  };

  const presets = detailEffect ? getPresetsForEffect(detailEffect.id) : [];

  return (
    <AmDialog
      open={showEffectBrowser}
      onClose={() => {
        setDetailEffect(null);
        setModal('showEffectBrowser', false);
      }}
      title={detailEffect ? formatEffectDisplayName(detailEffect) : `Add Effect (${filtered.length})`}
      wide
    >
      {detailEffect ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button
            type="button"
            className="am-btn"
            style={{ alignSelf: 'flex-start', padding: '5px 12px' }}
            onClick={() => setDetailEffect(null)}
          >
            ← Back to Effect Browser
          </button>

          <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: 'var(--am-a1)', padding: 14, borderRadius: 14, border: '1px solid var(--am-border)' }}>
            <div className="am-effect-thumb-wrap" style={{ width: 84, height: 84, flexShrink: 0 }}>
              {detailEffect.thumbBg && <img src={`/am/thumb/${detailEffect.thumbBg}`} alt="" />}
              {detailEffect.thumb ? (
                <img src={`/am/thumb/${detailEffect.thumb}`} alt={detailEffect.name} />
              ) : (
                <AmIcon name="effects" fallback="effects" size={30} color="var(--am-accent)" />
              )}
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{formatEffectDisplayName(detailEffect)}</div>
              <div style={{ fontSize: 12, color: 'var(--am-accent)', margin: '2px 0 6px' }}>
                {detailEffect.category.toUpperCase()}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--am-text-secondary)', lineHeight: 1.4 }}>
                {detailEffect.desc || 'GPU-accelerated Alight Motion effect.'}
              </p>
            </div>
          </div>

          <h3 className="am-section-title" style={{ marginBottom: 4 }}>Presets & Standard Settings</h3>
          <div className="am-effect-grid">
            <button
              type="button"
              className="am-effect-card"
              style={{ borderColor: 'var(--am-accent)' }}
              onClick={() => applyEffect(detailEffect)}
            >
              <AmIcon name="ic_premade_preset" fallback="sliders" size={26} color="var(--am-accent)" />
              <span style={{ fontWeight: 700, fontSize: 13 }}>Standard Settings</span>
              <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>Default APK parameters</span>
            </button>

            {presets.map((pr, idx) => (
              <button key={idx} type="button" className="am-effect-card" onClick={() => applyEffect(detailEffect, pr)}>
                <AmIcon name="ic_premade_preset" fallback="effects" size={26} color="#5CE5FF" />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{pr.name}</span>
                <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>
                  {pr.props.some((p) => p.kfs.length > 0) ? 'Animated Preset' : 'Static Preset'}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <input
              id="effect-browser-search"
              name="effectSearch"
              aria-label="Search effects"
              type="search"
              className="am-input"
              placeholder="Search effects (e.g. blur, glow, tiles, oscillate, wave, box, split)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
              autoFocus
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--am-text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeLegacy}
                onChange={(e) => setIncludeLegacy(e.target.checked)}
                style={{ accentColor: 'var(--am-accent)' }}
              />
              Show Legacy & Experimental ({allEffects.filter((e) => !e.internal && (e.deprecated || e.experimental)).length})
            </label>
          </div>

          <div className="am-pill-row">
            {EFFECT_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`am-pill ${category === c.id ? 'active' : ''}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="am-effect-grid">
            {filtered.map((eff) => (
              <button
                key={eff.id}
                type="button"
                className="am-effect-card"
                onClick={() => setDetailEffect(eff)}
              >
                <div className="am-effect-thumb-wrap">
                  {eff.thumbBg && <img src={`/am/thumb/${eff.thumbBg}`} alt="" loading="lazy" />}
                  {eff.thumb ? (
                    <img src={`/am/thumb/${eff.thumb}`} alt={eff.name} loading="lazy" />
                  ) : (
                    <AmIcon name="effects" fallback="effects" size={26} color="var(--am-accent)" />
                  )}
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>{formatEffectDisplayName(eff)}</span>
                {(eff.deprecated || eff.experimental) && (
                  <span style={{ fontSize: 10, color: 'var(--am-gold)' }}>
                    {eff.experimental ? 'Experimental' : 'Compatibility'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </AmDialog>
  );
};
