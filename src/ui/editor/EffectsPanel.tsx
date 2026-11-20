import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatEffectDisplayName, getEffectById } from '../../engine/catalog';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';
import { useSelectedLayer } from './useSelectedLayer';

export const EffectsPanel: React.FC = () => {
  const {
    setModal,
    setInspectorTab,
    setActiveEffectUid,
    copyLayerEffects,
    pasteLayerEffects,
    effectsClipboard,
  } = useEditorStore(
    useShallow((s) => ({
      setModal: s.setModal,
      setInspectorTab: s.setInspectorTab,
      setActiveEffectUid: s.setActiveEffectUid,
      copyLayerEffects: s.copyLayerEffects,
      pasteLayerEffects: s.pasteLayerEffects,
      effectsClipboard: s.effectsClipboard,
    }))
  );
  const { layer, updateLayer } = useSelectedLayer();

  if (!layer) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="am-btn am-btn-primary"
          style={{ flex: 1 }}
          onClick={() => setModal('showEffectBrowser', true)}
        >
          <AmIcon name="ic_add_project_plus" fallback="plus" size={16} />
          ADD EFFECT
        </button>
        <button type="button" className="am-btn" onClick={copyLayerEffects} disabled={layer.effects.length === 0} title="Copy Effects">
          Copy
        </button>
        <button type="button" className="am-btn" onClick={pasteLayerEffects} disabled={!effectsClipboard} title="Paste Effects">
          Paste
        </button>
      </div>

      {layer.effects.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', background: 'var(--am-a1)', borderRadius: 12, border: '1px solid var(--am-border)', color: 'var(--am-text-muted)', fontSize: 13 }}>
          No effects applied to this layer yet. Tap <strong>ADD EFFECT</strong> to browse all effects.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {layer.effects.map((eff, idx) => {
            const def = getEffectById(eff.effectId);
            return (
              <div
                key={eff.uid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 11,
                  background: 'var(--am-a1)',
                  border: '1px solid var(--am-border)',
                  opacity: eff.enabled ? 1 : 0.48,
                }}
              >
                <button
                  type="button"
                  className="am-icon-btn"
                  style={{ width: 28, height: 28 }}
                  onClick={() =>
                    updateLayer((l) => {
                      const t = l.effects.find((x) => x.uid === eff.uid);
                      if (t) t.enabled = !t.enabled;
                    })
                  }
                  title={eff.enabled ? 'Disable Effect' : 'Enable Effect'}
                >
                  <AmIcon name={eff.enabled ? 'ic_visibility' : 'ic_visibility_off'} fallback={eff.enabled ? 'eye' : 'eyeOff'} size={16} />
                </button>

                <button
                  type="button"
                  style={{ flex: 1, textAlign: 'left', minWidth: 0 }}
                  onClick={() => {
                    setActiveEffectUid(eff.uid);
                    setInspectorTab('effectSettings');
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatEffectDisplayName(def, eff.effectId)}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: !def ? 'var(--am-danger)' : def.isCustom ? 'var(--am-accent)' : def.deprecated ? 'var(--am-gold)' : 'var(--am-text-muted)',
                    }}
                  >
                    {!def
                      ? 'Missing effect (re-import XML or remove)'
                      : `${def.isCustom ? 'Custom · ' : def.deprecated ? 'Compatibility · ' : ''}${def.category || 'effect'} · Tap to edit parameters`}
                  </div>
                </button>

                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    className="am-icon-btn"
                    style={{ width: 26, height: 26 }}
                    disabled={idx === 0}
                    onClick={() =>
                      updateLayer((l) => {
                        const [m] = l.effects.splice(idx, 1);
                        l.effects.splice(idx - 1, 0, m);
                      })
                    }
                    title="Move Effect Up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="am-icon-btn"
                    style={{ width: 26, height: 26 }}
                    disabled={idx === layer.effects.length - 1}
                    onClick={() =>
                      updateLayer((l) => {
                        const [m] = l.effects.splice(idx, 1);
                        l.effects.splice(idx + 1, 0, m);
                      })
                    }
                    title="Move Effect Down"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="am-icon-btn"
                    style={{ width: 26, height: 26, color: '#ff6b8d' }}
                    onClick={() =>
                      updateLayer((l) => {
                        l.effects = l.effects.filter((x) => x.uid !== eff.uid);
                      })
                    }
                    title="Delete Effect"
                  >
                    <AmIcon name="ic_project_delete" fallback="delete" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
