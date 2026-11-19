import React, { useRef, useState } from 'react';
import { replaceMediaOnLayers } from '../../engine/mediaReplace';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';

export const LayerQuickActions: React.FC = () => {
  const {
    selectedLayerIds,
    getActiveLayers,
    groupStack,
    mutateProject,
    enterGroup,
    groupSelectedLayers,
    ungroupSelectedLayer,
    copySelectedLayers,
    pasteLayers,
    copyLayerEffects,
    pasteLayerEffects,
    layerClipboard,
    effectsClipboard,
    duplicateSelectedLayers,
    deleteSelectedLayers,
    toggleLayerVisible,
    toggleLayerLocked,
    saveSelectedAsElement,
    setInspectorTab,
  } = useEditorStore();

  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [showParentMenu, setShowParentMenu] = useState(false);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const layers = getActiveLayers();
  const selLayers = layers.filter((l) => selectedLayerIds.includes(l.id));
  if (selLayers.length === 0) return null;

  const single = selLayers.length === 1 ? selLayers[0] : null;
  const parentCandidates = single ? layers.filter((l) => l.id !== single.id && l.type !== 'audio') : [];

  const setParent = (pid: string | null) => {
    if (!single) return;
    mutateProject((proj) => {
      let list = proj.layers;
      for (const gid of groupStack) {
        const g = list.find((x) => x.id === gid);
        if (g?.groupLayers) list = g.groupLayers;
      }
      const target = list.find((x) => x.id === single.id);
      if (target) target.parentId = pid;
    });
    setShowParentMenu(false);
  };

  return (
    <div className="am-quick-rail" role="toolbar" aria-label="Layer Quick Actions">
      {single && single.type === 'group' && (
        <>
          <button
            type="button"
            className="am-icon-btn active"
            onClick={() => enterGroup(single.id)}
            title="Edit Group Contents"
          >
            <AmIcon name="ic_group_settings_" fallback="elements" size={17} />
          </button>
          <button
            type="button"
            className="am-icon-btn"
            onClick={ungroupSelectedLayer}
            title="Ungroup"
          >
            <AmIcon name="ic_empty_group" fallback="box" size={17} />
          </button>
        </>
      )}

      {selLayers.length >= 1 && (
        <>
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) {
                replaceMediaOnLayers(files, selectedLayerIds, groupStack, mutateProject);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="am-icon-btn"
            onClick={() => replaceInputRef.current?.click()}
            title={selLayers.length > 1 ? `Replace Media on ${selLayers.length} Selected Layers` : 'Replace Media'}
          >
            <AmIcon name="ic_add_media" fallback="image" size={17} />
          </button>
          <button type="button" className="am-icon-btn" onClick={() => groupSelectedLayers('none')} title="Group Selected Layers">
            <AmIcon name="ic_add_elements" fallback="elements" size={17} />
          </button>
          {selLayers.length >= 2 && (
            <>
              <button type="button" className="am-icon-btn" onClick={() => groupSelectedLayers('mask')} title="Create Mask Group">
                <AmIcon name="ic_masking_group_bl" fallback="elements" size={17} />
              </button>
              <button type="button" className="am-icon-btn" onClick={() => groupSelectedLayers('exclude')} title="Create Exclude Mask Group">
                <AmIcon name="ic_exclude_group_bl" fallback="elements" size={17} />
              </button>
            </>
          )}
        </>
      )}

      {single && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={`am-icon-btn ${single.parentId ? 'active' : ''}`}
            onClick={() => {
              setShowParentMenu(!showParentMenu);
              setShowCopyMenu(false);
            }}
            title="Parent Layer"
          >
            <AmIcon name="ic_layer_parent" fallback="link" size={17} />
          </button>
          {showParentMenu && (
            <div
              style={{
                position: 'absolute',
                right: 42,
                top: 0,
                width: 190,
                background: 'var(--am-dialog-bg)',
                border: '1px solid var(--am-border-strong)',
                borderRadius: 12,
                padding: 6,
                boxShadow: '0 10px 28px rgba(0,0,0,0.6)',
                zIndex: 40,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', color: 'var(--am-text-muted)' }}>
                Parent To Layer
              </div>
              <button
                type="button"
                className="am-btn"
                style={{ width: '100%', justifyContent: 'flex-start', padding: '6px 8px', marginBottom: 4, fontSize: 12 }}
                onClick={() => setParent(null)}
              >
                None {!single.parentId && '✓'}
              </button>
              {parentCandidates.map((cand) => (
                <button
                  key={cand.id}
                  type="button"
                  className="am-btn"
                  style={{ width: '100%', justifyContent: 'flex-start', padding: '6px 8px', marginBottom: 3, fontSize: 12 }}
                  onClick={() => setParent(cand.id)}
                >
                  {cand.label} {single.parentId === cand.id && '✓'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="am-icon-btn"
          onClick={() => {
            setShowCopyMenu(!showCopyMenu);
            setShowParentMenu(false);
          }}
          title="Copy / Paste Layer or Effects"
        >
          <AmIcon name="ic_layer_copy_paste_menu" fallback="copy" size={17} />
        </button>
        {showCopyMenu && (
          <div
            style={{
              position: 'absolute',
              right: 42,
              top: 0,
              width: 175,
              background: 'var(--am-dialog-bg)',
              border: '1px solid var(--am-border-strong)',
              borderRadius: 12,
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              boxShadow: '0 10px 28px rgba(0,0,0,0.6)',
              zIndex: 40,
            }}
          >
            <button type="button" className="am-btn" style={{ justifyContent: 'flex-start', fontSize: 12 }} onClick={() => { duplicateSelectedLayers(); setShowCopyMenu(false); }}>
              Duplicate Layer
            </button>
            <button type="button" className="am-btn" style={{ justifyContent: 'flex-start', fontSize: 12 }} onClick={() => { copySelectedLayers(); setShowCopyMenu(false); }}>
              Copy Layer
            </button>
            <button type="button" className="am-btn" disabled={!layerClipboard} style={{ justifyContent: 'flex-start', fontSize: 12 }} onClick={() => { pasteLayers(); setShowCopyMenu(false); }}>
              Paste Layer
            </button>
            <button type="button" className="am-btn" style={{ justifyContent: 'flex-start', fontSize: 12 }} onClick={() => { copyLayerEffects(); setShowCopyMenu(false); }}>
              Copy Effects
            </button>
            <button type="button" className="am-btn" disabled={!effectsClipboard} style={{ justifyContent: 'flex-start', fontSize: 12 }} onClick={() => { pasteLayerEffects(); setShowCopyMenu(false); }}>
              Paste Effects
            </button>
            <button type="button" className="am-btn am-btn-primary" style={{ justifyContent: 'flex-start', fontSize: 12 }} onClick={() => { saveSelectedAsElement(); setShowCopyMenu(false); }}>
              Save as Element
            </button>
          </div>
        )}
      </div>

      {single && (
        <>
          <button type="button" className="am-icon-btn" onClick={() => toggleLayerVisible(single.id)} title="Toggle Visibility">
            <AmIcon name={single.visible ? 'ic_visibility' : 'ic_visibility_off'} fallback={single.visible ? 'eye' : 'eyeOff'} size={17} />
          </button>
          <button type="button" className={`am-icon-btn ${single.locked ? 'active' : ''}`} onClick={() => toggleLayerLocked(single.id)} title="Lock Layer">
            <AmIcon name={single.locked ? 'lock' : 'unlock'} fallback={single.locked ? 'lock' : 'unlock'} size={16} />
          </button>
          <button type="button" className="am-icon-btn" onClick={() => setInspectorTab('menu')} title="Open Inspector">
            <AmIcon name="sliders" fallback="sliders" size={16} />
          </button>
        </>
      )}

      <button type="button" className="am-icon-btn" onClick={deleteSelectedLayers} title="Delete Selected Layer(s)" style={{ color: '#ff6b8d' }}>
        <AmIcon name="ic_project_delete" fallback="delete" size={17} />
      </button>
    </div>
  );
};
