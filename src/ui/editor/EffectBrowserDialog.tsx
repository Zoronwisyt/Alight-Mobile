import React, { useMemo, useRef, useState } from 'react';
import {
  createEffectInstance,
  EFFECT_CATEGORIES,
  formatEffectDisplayName,
  getBuiltInEffectIds,
  getEffects,
  getPresetsForEffect,
} from '../../engine/catalog';
import {
  buildCustomEffectRecord,
  validateCustomEffectXml,
  type CustomEffectValidationError,
  type CustomEffectValidationResult,
} from '../../engine/customEffects';
import { useEditorStore } from '../../store/useEditorStore';
import type { CustomEffectRecord, EffectDef, EffectPreset } from '../../types/project';
import { AmDialog } from '../components/AmDialog';
import { AmIcon } from '../components/AmIcon';
import { useSelectedLayer } from './useSelectedLayer';

export const EffectBrowserDialog: React.FC = () => {
  const {
    showEffectBrowser,
    setModal,
    setActiveEffectUid,
    setInspectorTab,
    customEffects,
    addCustomEffect,
    deleteCustomEffect,
    toggleCustomEffect,
    showToast,
  } = useEditorStore();
  const { layer, updateLayer } = useSelectedLayer();

  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [detailEffect, setDetailEffect] = useState<EffectDef | null>(null);

  // Track D: Custom XML effect import state
  const [xmlInput, setXmlInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationErr, setValidationErr] = useState<CustomEffectValidationError | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    res: CustomEffectValidationResult;
    xml: string;
    source: 'paste' | 'file';
    duplicate?: CustomEffectRecord;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allEffects = getEffects();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEffects.filter((e) => {
      if (e.internal) return false;
      if (category === 'custom') {
        if (!e.isCustom) return false;
      } else {
        if (e.isCustom) return false;
        if (!includeLegacy && (e.deprecated || e.experimental)) return false;
        if (category !== 'all' && e.category !== category) return false;
      }
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
    showToast(`Added ${formatEffectDisplayName(def)}`);
  };

  const runValidation = async (rawXml: string, source: 'paste' | 'file') => {
    setValidating(true);
    setValidationErr(null);
    setPendingImport(null);
    try {
      const res = await validateCustomEffectXml(rawXml, getBuiltInEffectIds());
      if (!res.ok || !res.def || !res.hash) {
        setValidationErr(res.error ?? { rule: 4, message: 'Invalid effect XML.', hint: 'Check XML syntax.' });
      } else {
        const duplicate = customEffects.find((c) => c.hash === res.hash || c.id === res.def!.id);
        setPendingImport({ res, xml: rawXml, source, duplicate });
      }
    } finally {
      setValidating(false);
    }
  };

  const confirmCustomImport = async (mode: 'save' | 'replace' | 'keepBoth') => {
    if (!pendingImport?.res.def || !pendingImport.res.hash) return;
    let def = pendingImport.res.def;
    let replaceUid: string | undefined;
    if (mode === 'replace' && pendingImport.duplicate) {
      replaceUid = pendingImport.duplicate.uid;
    } else if (mode === 'keepBoth' && pendingImport.duplicate) {
      const suffix = Math.random().toString(36).slice(2, 6);
      def = { ...def, id: `${def.id}_${suffix}`, name: `${def.name} (${suffix})` };
    }
    const rec = buildCustomEffectRecord(def, pendingImport.xml, pendingImport.res.hash, pendingImport.source);
    await addCustomEffect(rec, replaceUid);
    setXmlInput('');
    setPendingImport(null);
    setValidationErr(null);
  };

  const exportCustomXml = (rec: CustomEffectRecord) => {
    const blob = new Blob([rec.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.id}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const presets = detailEffect ? getPresetsForEffect(detailEffect.id) : [];

  return (
    <AmDialog
      open={showEffectBrowser}
      onClose={() => {
        setDetailEffect(null);
        setModal('showEffectBrowser', false);
      }}
      title={detailEffect ? formatEffectDisplayName(detailEffect) : `Add Effect (${category === 'custom' ? customEffects.length : filtered.length})`}
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
              {detailEffect.thumbBg && <img src={`${import.meta.env.BASE_URL}am/thumb/${detailEffect.thumbBg}`} alt="" />}
              {detailEffect.thumb ? (
                <img src={`${import.meta.env.BASE_URL}am/thumb/${detailEffect.thumb}`} alt={detailEffect.name} />
              ) : (
                <AmIcon name="effects" fallback="effects" size={30} color="var(--am-accent)" />
              )}
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{formatEffectDisplayName(detailEffect)}</div>
              <div style={{ fontSize: 12, color: 'var(--am-accent)', margin: '2px 0 6px' }}>
                {detailEffect.isCustom ? 'CUSTOM EFFECT' : detailEffect.category.toUpperCase()}
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
              <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>Default parameters</span>
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
            {category !== 'custom' && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--am-text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeLegacy}
                  onChange={(e) => setIncludeLegacy(e.target.checked)}
                  style={{ accentColor: 'var(--am-accent)' }}
                />
                Show Legacy & Experimental ({allEffects.filter((e) => !e.internal && !e.isCustom && (e.deprecated || e.experimental)).length})
              </label>
            )}
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
            <button
              type="button"
              className={`am-pill ${category === 'custom' ? 'active' : ''}`}
              onClick={() => setCategory('custom')}
            >
              Custom ({customEffects.length})
            </button>
          </div>

          {category === 'custom' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                className="am-custom-import-box"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    if (!file.name.toLowerCase().endsWith('.xml')) {
                      setValidationErr({ rule: 4, message: 'Only effect XML can be imported.', hint: 'Drop a single .xml file containing <effect>.' });
                      return;
                    }
                    file.text().then((txt) => {
                      setXmlInput(txt);
                      runValidation(txt, 'file');
                    });
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>Import Effect XML (Effects Only, ≤ 64 KB)</strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xml,application/xml,text/xml"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        file.text().then((txt) => {
                          setXmlInput(txt);
                          runValidation(txt, 'file');
                        });
                        e.target.value = '';
                      }}
                    />
                    <button type="button" className="am-btn" onClick={() => fileInputRef.current?.click()}>
                      Pick .xml File
                    </button>
                    <button
                      type="button"
                      className="am-btn-primary"
                      disabled={validating || !xmlInput.trim()}
                      onClick={() => runValidation(xmlInput, 'paste')}
                    >
                      {validating ? 'Validating…' : 'Validate & Import'}
                    </button>
                  </div>
                </div>

                <textarea
                  className="am-input"
                  rows={5}
                  placeholder='<effect id="custom.myfx" name="My Glow"><params><texture id="inputImg" srcType="content" /></params><shader type="fragment">void main() { gl_FragColor = texture2DCv(inputImg.texture, acScreenNorm); }</shader></effect>'
                  value={xmlInput}
                  onChange={(e) => setXmlInput(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
                />

                {validationErr && (
                  <div style={{ background: 'rgba(224,20,69,0.16)', border: '1px solid var(--am-danger)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: '#FF7090' }}>
                      Rule {validationErr.rule}: {validationErr.message}
                    </div>
                    <div style={{ color: 'var(--am-text-secondary)', marginTop: 2 }}>{validationErr.hint}</div>
                  </div>
                )}

                {pendingImport?.res.summary && (
                  <div style={{ background: 'rgba(0,255,168,0.1)', border: '1px solid var(--am-accent)', borderRadius: 8, padding: '10px 12px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <strong>{pendingImport.res.summary.name}</strong> ({pendingImport.res.summary.id}) —{' '}
                      {pendingImport.res.summary.paramCount} params · {pendingImport.res.summary.shaderCount} shaders · Script:{' '}
                      {pendingImport.res.summary.hasScript ? 'Yes (sandboxed)' : 'No'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {pendingImport.duplicate ? (
                        <>
                          <button type="button" className="am-btn-primary" onClick={() => confirmCustomImport('replace')}>
                            Replace Existing
                          </button>
                          <button type="button" className="am-btn" onClick={() => confirmCustomImport('keepBoth')}>
                            Keep Both
                          </button>
                        </>
                      ) : (
                        <button type="button" className="am-btn-primary" onClick={() => confirmCustomImport('save')}>
                          Save to Custom Library
                        </button>
                      )}
                      <button type="button" className="am-btn" onClick={() => setPendingImport(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {customEffects.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--am-text-muted)', padding: '18px 0', fontSize: 12 }}>
                  No custom effects imported yet. Paste or drop an &lt;effect&gt; XML file above.
                </div>
              ) : (
                <div className="am-effect-grid">
                  {customEffects.map((rec) => (
                    <div
                      key={rec.uid}
                      className="am-effect-card"
                      style={{ opacity: rec.enabled ? 1 : 0.5, alignItems: 'stretch', textAlign: 'left', gap: 6 }}
                    >
                      <button
                        type="button"
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                        onClick={() => rec.enabled && setDetailEffect(rec.def)}
                        disabled={!rec.enabled}
                      >
                        <AmIcon name="effects" fallback="effects" size={26} color="var(--am-accent)" />
                        <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'center' }}>{rec.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--am-accent)' }}>
                          Custom · {rec.source}
                        </span>
                      </button>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4 }}>
                        <button type="button" className="am-pill" style={{ padding: '2px 7px', fontSize: 10 }} onClick={() => toggleCustomEffect(rec.uid)}>
                          {rec.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" className="am-pill" style={{ padding: '2px 7px', fontSize: 10 }} onClick={() => exportCustomXml(rec)}>
                          .xml
                        </button>
                        <button
                          type="button"
                          className="am-pill"
                          style={{ padding: '2px 7px', fontSize: 10, color: '#FF7090' }}
                          onClick={() => deleteCustomEffect(rec.uid)}
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="am-effect-grid">
              {filtered.map((eff) => (
                <button
                  key={eff.id}
                  type="button"
                  className="am-effect-card"
                  onClick={() => setDetailEffect(eff)}
                >
                  <div className="am-effect-thumb-wrap">
                    {eff.thumbBg && <img src={`${import.meta.env.BASE_URL}am/thumb/${eff.thumbBg}`} alt="" loading="lazy" />}
                    {eff.thumb ? (
                      <img src={`${import.meta.env.BASE_URL}am/thumb/${eff.thumb}`} alt={eff.name} loading="lazy" />
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
          )}
        </div>
      )}
    </AmDialog>
  );
};
