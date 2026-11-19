import React, { useRef } from 'react';
import { replaceMediaOnLayers } from '../../engine/mediaReplace';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';

function fmtTimecodeShort(ms: number, fps: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const frame = Math.floor(((safe % 1000) / 1000) * fps);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
}

export const EditorActionBar: React.FC = () => {
  const {
    currentProject,
    currentTimeMs,
    selectedLayerIds,
    groupStack,
    exitGroup,
    closeEditor,
    mutateProject,
    selectLayer,
    groupSelectedLayers,
    deleteSelectedLayers,
    layoutMode,
    setLayoutMode,
    setModal,
    setShowShortcutOverlay,
  } = useEditorStore();

  const replaceMultiRef = useRef<HTMLInputElement>(null);

  if (!currentProject) return null;

  // APK activity_edit_selectbar.xml (#00FFA8 42dp selection bar when 2+ layers are selected)
  if (selectedLayerIds.length > 1) {
    return (
      <header className="am-actionbar am-selectbar">
        <input
          ref={replaceMultiRef}
          type="file"
          accept="image/*,video/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              replaceMediaOnLayers(e.target.files, selectedLayerIds, groupStack, mutateProject);
            }
            e.target.value = '';
          }}
        />
        <div className="am-actionbar-group">
          <span className="am-selectbar-count">{selectedLayerIds.length} Selected</span>
        </div>

        <div className="am-actionbar-group">
          <button
            type="button"
            className="am-selectbar-btn"
            onClick={() => groupSelectedLayers('none')}
            title="Group Selected Layers"
          >
            <AmIcon name="ac_ic_groupelements" fallback="elements" size={19} color="#091318" />
          </button>
          <button
            type="button"
            className="am-selectbar-btn"
            onClick={() => groupSelectedLayers('mask')}
            title="Create Masking Group"
          >
            <AmIcon name="ic_masking_group_bl" fallback="elements" size={19} color="#091318" />
          </button>
          <button
            type="button"
            className="am-selectbar-btn"
            onClick={() => groupSelectedLayers('exclude')}
            title="Create Exclude Group"
          >
            <AmIcon name="ic_exclude_group_bl" fallback="elements" size={19} color="#091318" />
          </button>
          <button
            type="button"
            className="am-selectbar-btn"
            onClick={() => replaceMultiRef.current?.click()}
            title={`Replace Media on ${selectedLayerIds.length} Layers`}
          >
            <AmIcon name="ic_add_media" fallback="image" size={19} color="#091318" />
          </button>
          <button
            type="button"
            className="am-selectbar-btn"
            onClick={deleteSelectedLayers}
            title="Delete Selected Layers"
          >
            <AmIcon name="ac_ic_delete" fallback="delete" size={19} color="#091318" />
          </button>
          <button
            type="button"
            className="am-selectbar-btn"
            onClick={() => selectLayer('')}
            title="Cancel Multi-Select"
          >
            <AmIcon name="ac_ic_cancel" fallback="close" size={19} color="#091318" />
          </button>
        </div>
      </header>
    );
  }

  // Build group breadcrumb names (editNestedNaviRecyclerView)
  const crumbs: { label: string; depth: number }[] = [{ label: currentProject.title, depth: 0 }];
  let list = currentProject.layers;
  groupStack.forEach((gid, idx) => {
    const grp = list.find((l) => l.id === gid && l.type === 'group');
    if (grp) {
      crumbs.push({ label: grp.label, depth: idx + 1 });
      list = grp.groupLayers ?? [];
    }
  });

  // APK activity_edit_navbar.xml (42dp #191B27)
  return (
    <header className="am-actionbar">
      <div className="am-actionbar-group" style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          className="am-nav-icon-btn"
          onClick={() => (groupStack.length > 0 ? exitGroup() : closeEditor())}
          title={groupStack.length > 0 ? 'Exit Group' : 'Back to Projects'}
        >
          <AmIcon name="ic_exitproject" fallback="back" size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', minWidth: 0 }}>
          {crumbs.map((c, idx) => (
            <React.Fragment key={c.depth}>
              {idx > 0 && <span style={{ color: 'var(--am-text-muted)', fontSize: 12 }}>›</span>}
              <button
                type="button"
                onClick={() => exitGroup(c.depth)}
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: idx === crumbs.length - 1 ? '#FFFFFF' : 'var(--am-accent)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 180,
                }}
              >
                {c.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="am-actionbar-group">
        <span className="am-nav-time" title="Playhead / Duration">
          {fmtTimecodeShort(currentTimeMs, currentProject.fps)}
        </span>

        <button
          type="button"
          className="am-layout-chip"
          onClick={() => setShowShortcutOverlay(true)}
          title="Keyboard Shortcuts & Density (?)"
        >
          ?
        </button>

        <button
          type="button"
          className="am-layout-chip"
          onClick={() => setLayoutMode(layoutMode === 'widescreen' ? 'classic' : 'widescreen')}
          title="Switch Mobile APK / iPad Desktop Layout"
        >
          {layoutMode === 'widescreen' ? 'iPad UI' : 'Mobile UI'}
        </button>

        <button
          type="button"
          className="am-nav-icon-btn"
          onClick={() => setModal('showProjectSettings', true)}
          title="Project Settings"
        >
          <AmIcon name="ac_ic_settings" fallback="settings" size={19} />
        </button>

        <button
          type="button"
          className="am-nav-icon-btn"
          onClick={() => setModal('showExportDialog', true)}
          aria-label="Export"
          title="Export Video / GIF / PNG / XML"
        >
          <AmIcon name="ac_ic_share" fallback="export" size={19} color="var(--am-accent)" />
        </button>
      </div>
    </header>
  );
};
