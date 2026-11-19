import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';

export const EditorActionBar: React.FC = () => {
  const {
    currentProject,
    groupStack,
    exitGroup,
    closeEditor,
    undo,
    redo,
    past,
    future,
    gridVisible,
    toggleGrid,
    snapEnabled,
    toggleSnap,
    mutateProject,
    layoutMode,
    setLayoutMode,
    setModal,
  } = useEditorStore();

  if (!currentProject) return null;

  // Build group breadcrumb names
  const crumbs: { label: string; depth: number }[] = [{ label: currentProject.title, depth: 0 }];
  let list = currentProject.layers;
  groupStack.forEach((gid, idx) => {
    const grp = list.find((l) => l.id === gid && l.type === 'group');
    if (grp) {
      crumbs.push({ label: grp.label, depth: idx + 1 });
      list = grp.groupLayers ?? [];
    }
  });

  return (
    <header className="am-actionbar">
      <div className="am-actionbar-group">
        <button
          type="button"
          className="am-icon-btn"
          onClick={() => (groupStack.length > 0 ? exitGroup() : closeEditor())}
          title={groupStack.length > 0 ? 'Exit Group' : 'Back to Projects'}
        >
          <AmIcon name="ic_back_button_white" fallback="back" size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
          {crumbs.map((c, idx) => (
            <React.Fragment key={c.depth}>
              {idx > 0 && <span style={{ color: 'var(--am-text-muted)', fontSize: 12 }}>/</span>}
              <button
                type="button"
                onClick={() => exitGroup(c.depth)}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: idx === crumbs.length - 1 ? 'var(--am-text-primary)' : 'var(--am-accent)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 160,
                }}
              >
                {c.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="am-actionbar-group">
        <button type="button" className="am-icon-btn" disabled={past.length === 0} onClick={undo} title="Undo (Ctrl+Z)">
          <AmIcon name="ic_edit_undo" fallback="undo" size={18} />
        </button>
        <button type="button" className="am-icon-btn" disabled={future.length === 0} onClick={redo} title="Redo (Ctrl+Y)">
          <AmIcon name="ic_edit_redo" fallback="redo" size={18} />
        </button>

        <button
          type="button"
          className={`am-icon-btn ${gridVisible ? 'active' : ''}`}
          onClick={toggleGrid}
          title="Toggle Safe Area & Grid"
        >
          <AmIcon name="ic_preview_mode_grid_off" fallback="grid" size={18} />
        </button>
        <button
          type="button"
          className={`am-icon-btn ${snapEnabled ? 'active' : ''}`}
          onClick={toggleSnap}
          title="Toggle Snapping"
        >
          <AmIcon name="snap" fallback="snap" size={17} />
        </button>
        <button
          type="button"
          className={`am-icon-btn ${currentProject.cameraEnabled ? 'active' : ''}`}
          onClick={() => mutateProject((p) => { p.cameraEnabled = !p.cameraEnabled; })}
          title="Toggle Active 3D Camera"
        >
          <AmIcon
            name={currentProject.cameraEnabled ? 'ic_preview_mode_camera_on' : 'ic_preview_mode_camera_off'}
            fallback="camera"
            size={18}
          />
        </button>

        <button
          type="button"
          className="am-btn"
          style={{ padding: '4px 9px', fontSize: 11 }}
          onClick={() => setLayoutMode(layoutMode === 'widescreen' ? 'classic' : 'widescreen')}
          title="Switch Classic Portrait / Widescreen Studio Layout"
        >
          {layoutMode === 'widescreen' ? 'Widescreen' : 'Classic'}
        </button>

        <button
          type="button"
          className="am-icon-btn"
          onClick={() => setModal('showProjectSettings', true)}
          title="Project Settings"
        >
          <AmIcon name="settings" fallback="settings" size={18} />
        </button>

        <button
          type="button"
          className="am-btn am-btn-primary"
          style={{ padding: '5px 12px', fontSize: 12 }}
          onClick={() => setModal('showExportDialog', true)}
          title="Export Video / GIF / PNG / XML"
        >
          <AmIcon name="ic_project_export" fallback="export" size={15} />
          Export
        </button>
      </div>
    </header>
  );
};
