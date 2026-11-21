import React, { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { reparentLayerPreservingPosition } from '../../engine/animation';
import { replaceMediaOnLayers } from '../../engine/mediaReplace';
import { resolveActiveGroup, useEditorStore, type InspectorTab } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';
import { BlendingOpacityPanel } from './BlendingOpacityPanel';
import { BorderShadowPanel } from './BorderShadowPanel';
import { ColorFillPanel } from './ColorFillPanel';
import { EasingCurvePanel } from './EasingCurvePanel';
import { EffectSettingsPanel } from './EffectSettingsPanel';
import { EffectsPanel } from './EffectsPanel';
import { MoveTransformPanel } from './MoveTransformPanel';
import {
  CameraOptionsPanel,
  DrawingToolbar,
  EditPointsPanel,
  ShapeEditPanel,
  SpeedRemapPanel,
  TextEditPanel,
  VolumePanel,
} from './TypeInspectors';
import { useSelectedLayer } from './useSelectedLayer';

export const LayerInspector: React.FC = () => {
  const {
    inspectorTab,
    setInspectorTab,
    curveTarget,
    setCurveTarget,
    layoutMode,
    enterGroup,
    selectedLayerIds,
    groupStack,
    currentTimeMs,
    isPlaying,
    pastCount,
    futureCount,
    setCurrentTimeMs,
    setIsPlaying,
    togglePlay,
    undo,
    redo,
    getActiveLayers,
    selectLayer,
    trimSelectedLeft,
    splitSelectedAtPlayhead,
    trimSelectedRight,
    duplicateSelectedLayers,
    copyLayerEffects,
    pasteLayerEffects,
    effectsClipboard,
    saveSelectedAsElement,
    groupSelectedLayers,
    deleteSelectedLayers,
    mutateProject,
  } = useEditorStore(
    useShallow((s) => ({
      inspectorTab: s.inspectorTab,
      setInspectorTab: s.setInspectorTab,
      curveTarget: s.curveTarget,
      setCurveTarget: s.setCurveTarget,
      layoutMode: s.layoutMode,
      enterGroup: s.enterGroup,
      selectedLayerIds: s.selectedLayerIds,
      groupStack: s.groupStack,
      currentTimeMs: s.currentTimeMs,
      isPlaying: s.isPlaying,
      pastCount: s.past.length,
      futureCount: s.future.length,
      setCurrentTimeMs: s.setCurrentTimeMs,
      setIsPlaying: s.setIsPlaying,
      togglePlay: s.togglePlay,
      undo: s.undo,
      redo: s.redo,
      getActiveLayers: s.getActiveLayers,
      selectLayer: s.selectLayer,
      trimSelectedLeft: s.trimSelectedLeft,
      splitSelectedAtPlayhead: s.splitSelectedAtPlayhead,
      trimSelectedRight: s.trimSelectedRight,
      duplicateSelectedLayers: s.duplicateSelectedLayers,
      copyLayerEffects: s.copyLayerEffects,
      pasteLayerEffects: s.pasteLayerEffects,
      effectsClipboard: s.effectsClipboard,
      saveSelectedAsElement: s.saveSelectedAsElement,
      groupSelectedLayers: s.groupSelectedLayers,
      deleteSelectedLayers: s.deleteSelectedLayers,
      mutateProject: s.mutateProject,
    }))
  );

  const { project, layer, updateLayer } = useSelectedLayer();
  const replaceMediaRef = useRef<HTMLInputElement>(null);
  const [showParentMenu, setShowParentMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const handleReplaceMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && selectedLayerIds.length > 0) {
      await replaceMediaOnLayers(files, selectedLayerIds, groupStack, mutateProject);
    }
    e.target.value = '';
    setShowMoreMenu(false);
  };

  if (!layer) {
    if (layoutMode === 'classic') return null;
    return (
      <aside className="am-inspector-dock am-inspector-empty">
        <AmIcon name="ic_add_object" fallback="sliders" size={38} color="var(--am-text-dim)" />
        <h3 style={{ margin: '10px 0 4px', fontSize: 15 }}>No Layer Selected</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--am-text-muted)' }}>
          Select any track in the timeline or tap an element on the stage to open the Alight Motion Element Editor.
        </p>
      </aside>
    );
  }

  if (layoutMode === 'classic' && inspectorTab === 'none') return null;

  const layers = getActiveLayers();
  const parentCandidates = layers.filter((l) => l.id !== layer.id && l.type !== 'audio');

  const setParent = (pid: string | null) => {
    const tMs = useEditorStore.getState().currentTimeMs;
    const activeLayers = getActiveLayers();
    updateLayer((l) => {
      reparentLayerPreservingPosition(l, pid, activeLayers, tMs);
    });
    setShowParentMenu(false);
  };

  const moveLayerStartToPlayhead = () => {
    updateLayer((l) => {
      const dur = Math.max(100, l.endTime - l.startTime);
      const ns = Math.max(0, Math.round(currentTimeMs));
      l.startTime = ns;
      l.endTime = ns + dur;
    });
  };

  const moveLayerEndToPlayhead = () => {
    updateLayer((l) => {
      const dur = Math.max(100, l.endTime - l.startTime);
      const ne = Math.max(dur, Math.round(currentTimeMs));
      l.startTime = ne - dur;
      l.endTime = ne;
    });
  };

  const titles: Record<InspectorTab, string> = {
    none: layer.label,
    menu: layer.label,
    colorFill: 'Color & Fill',
    borderShadow: 'Border & Shadow',
    moveTransform: 'Move & Transform',
    blending: 'Blending & Opacity',
    effects: 'Effects',
    effectSettings: 'Effect Settings',
    editShape: 'Edit Shape',
    editPoints: 'Edit Points',
    editText: 'Edit Text',
    cameraOptions: 'Camera Options',
    speed: 'Speed',
    volume: 'Volume',
    drawing: 'Edit Drawing',
  };

  const isRootMenu = !curveTarget && (inspectorTab === 'menu' || inspectorTab === 'none');
  const isMobileClassic = layoutMode === 'classic';
  const activeScope = project ? resolveActiveGroup(project, groupStack) : null;
  const activeDurMs = activeScope?.durationMs ?? project?.durationMs ?? 5000;
  const frameMs = 1000 / Math.max(1, project?.fps ?? 30);

  const fmtMiniTime = (ms: number) => {
    const fps = Math.max(1, project?.fps ?? 30);
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const f = Math.floor(((ms % 1000) / 1000) * fps);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
  };

  const handleMobileSheetDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const startY = e.clientY;
    const sheetEl = e.currentTarget.parentElement;
    const startH = sheetEl ? sheetEl.getBoundingClientRect().height : window.innerHeight * 0.46;
    const minH = Math.round(window.innerHeight * 0.28);
    const maxH = Math.round(window.innerHeight * 0.72);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const onMove = (ev: PointerEvent) => {
      const nextH = Math.max(minH, Math.min(maxH, Math.round(startH - (ev.clientY - startY))));
      document.documentElement.style.setProperty('--am-mobile-sheet-h', `${nextH}px`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const mobileQuickTabs: { id: InspectorTab; label: string; action?: () => void }[] = [
    { id: 'moveTransform', label: 'Move' },
    { id: 'effects', label: layer.effects.length > 0 ? `FX (${layer.effects.length})` : 'Effects' },
    ...(layer.type !== 'audio' && layer.type !== 'null' && layer.type !== 'camera'
      ? [{ id: 'blending' as InspectorTab, label: 'Blend' }]
      : []),
    ...(layer.type === 'shape' || layer.type === 'vector' || layer.type === 'text'
      ? [
          { id: 'colorFill' as InspectorTab, label: 'Color' },
          { id: 'borderShadow' as InspectorTab, label: 'Border' },
        ]
      : []),
    ...(layer.type === 'text' ? [{ id: 'editText' as InspectorTab, label: 'Text' }] : []),
    ...(layer.type === 'shape' ? [{ id: 'editShape' as InspectorTab, label: 'Shape' }] : []),
    ...(layer.type === 'group'
      ? [{ id: 'menu' as InspectorTab, label: 'Edit Group', action: () => enterGroup(layer.id) }]
      : []),
  ];

  return (
    <aside className="am-inspector-dock">
      {isMobileClassic && (
        <div
          className="am-mobile-sheet-handle"
          onPointerDown={handleMobileSheetDrag}
          onDoubleClick={() => document.documentElement.style.removeProperty('--am-mobile-sheet-h')}
          title="Drag to resize panel (double-tap to reset)"
        >
          <span className="am-mobile-sheet-grip" />
        </div>
      )}

      <input
        ref={replaceMediaRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleReplaceMedia}
      />

      {/* APK fragment_element_actionbar.xml (#202332, 42dp) / fragment_setting_actionbar.xml (#292D40, 42dp) */}
      <div className={`am-insp-head ${isRootMenu ? 'root-bar' : 'sub-bar'}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
          <button
            type="button"
            className="am-nav-icon-btn"
            onClick={() => {
              if (curveTarget) {
                setCurveTarget(null);
              } else if (!isRootMenu) {
                setInspectorTab('menu');
              } else if (layoutMode === 'classic') {
                selectLayer('');
              } else {
                setInspectorTab('none');
              }
            }}
            title={isRootMenu ? 'Close Element Panel' : 'Back to Layer Menu'}
          >
            <AmIcon name="ac_ic_back" fallback="back" size={19} />
          </button>

          {isRootMenu ? (
            <input
              id="layer-rename"
              aria-label="Layer Label"
              className="am-element-label-input"
              value={layer.label}
              onChange={(e) =>
                updateLayer((l) => {
                  l.label = e.target.value;
                }, false)
              }
            />
          ) : (
            <span className="am-setting-title">
              {curveTarget ? `Easing · ${curveTarget.label}` : titles[inspectorTab]}
            </span>
          )}
        </div>

        {/* APK fragment_element_actionbar right icons: layerParent + replaceMedia + delete + overflow */}
        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button
            type="button"
            className={`am-nav-icon-btn ${layer.parentId ? 'active' : ''}`}
            onClick={() => {
              setShowParentMenu((v) => !v);
              setShowMoreMenu(false);
            }}
            title="Parent Layer (ic_layer_parent)"
          >
            <AmIcon name="ic_layer_parent" fallback="link" size={18} color={layer.parentId ? '#00FFA8' : undefined} />
          </button>

          {showParentMenu && (
            <div className="am-popup-menu" style={{ right: 80, top: 42, width: 200 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--am-text-muted)', padding: '4px 10px' }}>
                PARENT LAYER
              </div>
              <button
                type="button"
                className="am-popup-item"
                style={{ color: !layer.parentId ? 'var(--am-accent)' : undefined }}
                onClick={() => setParent(null)}
              >
                None
              </button>
              {parentCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="am-popup-item"
                  style={{ color: layer.parentId === c.id ? 'var(--am-accent)' : undefined }}
                  onClick={() => setParent(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="am-nav-icon-btn"
            onClick={() => replaceMediaRef.current?.click()}
            title={selectedLayerIds.length > 1 ? `Replace Media (${selectedLayerIds.length})` : 'Replace Media'}
          >
            <AmIcon name="ic_add_media" fallback="image" size={18} color="#00FFA8" />
          </button>

          <button
            type="button"
            className="am-nav-icon-btn"
            onClick={deleteSelectedLayers}
            title="Delete Layer"
          >
            <AmIcon name="ac_ic_delete" fallback="delete" size={18} />
          </button>

          <button
            type="button"
            className="am-nav-icon-btn"
            onClick={() => {
              setShowMoreMenu((v) => !v);
              setShowParentMenu(false);
            }}
            title="Layer Options"
          >
            <AmIcon name="ic_more_vert_white_24dp" fallback="more" size={18} />
          </button>

          {showMoreMenu && (
            <div className="am-popup-menu" style={{ right: 4, top: 42, width: 205 }}>
              <button
                type="button"
                className="am-popup-item"
                onClick={() => {
                  duplicateSelectedLayers();
                  setShowMoreMenu(false);
                }}
              >
                Duplicate Layer
              </button>
              <button
                type="button"
                className="am-popup-item"
                onClick={() => replaceMediaRef.current?.click()}
              >
                {selectedLayerIds.length > 1 ? `Replace All Media (${selectedLayerIds.length})` : 'Replace Media'}
              </button>
              <button
                type="button"
                className="am-popup-item"
                onClick={() => {
                  groupSelectedLayers('none');
                  setShowMoreMenu(false);
                }}
              >
                Convert to Group
              </button>
              <button
                type="button"
                className="am-popup-item"
                onClick={() => {
                  saveSelectedAsElement();
                  setShowMoreMenu(false);
                }}
              >
                Save to Elements
              </button>
              <div className="am-popup-sep" />
              <button
                type="button"
                className="am-popup-item"
                onClick={() => {
                  copyLayerEffects();
                  setShowMoreMenu(false);
                }}
              >
                Copy Effects ({layer.effects.length})
              </button>
              <button
                type="button"
                className="am-popup-item"
                disabled={!effectsClipboard}
                onClick={() => {
                  pasteLayerEffects();
                  setShowMoreMenu(false);
                }}
              >
                Paste Effects
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Live Mini-Transport + Scrub Bar + One-Tap Property Switcher */}
      {isMobileClassic && (
        <>
          <div className="am-mobile-mini-transport">
            <button
              type="button"
              className="am-mobile-mini-btn play"
              onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              <AmIcon name={isPlaying ? 'ic_edit_pause' : 'ic_edit_play'} fallback={isPlaying ? 'pause' : 'play'} size={16} color="#00FFA8" />
            </button>
            <button
              type="button"
              className="am-mobile-mini-btn"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTimeMs(currentTimeMs - frameMs);
              }}
              title="Previous Frame"
            >
              <AmIcon name="ic_edit_prevframe" fallback="prevFrame" size={14} />
            </button>
            <button
              type="button"
              className="am-mobile-mini-btn"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTimeMs(currentTimeMs + frameMs);
              }}
              title="Next Frame"
            >
              <AmIcon name="ic_edit_nextframe" fallback="nextFrame" size={14} />
            </button>
            <input
              type="range"
              className="am-mobile-scrub-range"
              aria-label="Scrub timeline while editing"
              min={0}
              max={Math.max(100, activeDurMs)}
              step={Math.max(1, Math.round(frameMs))}
              value={Math.min(activeDurMs, Math.max(0, Math.round(currentTimeMs)))}
              onChange={(e) => {
                setIsPlaying(false);
                setCurrentTimeMs(Number(e.target.value));
              }}
            />
            <span className="am-mobile-mini-time">{fmtMiniTime(currentTimeMs)}</span>
            <button
              type="button"
              className="am-mobile-mini-btn"
              disabled={pastCount === 0}
              onClick={undo}
              title="Undo"
            >
              <AmIcon name="ic_edit_undo" fallback="undo" size={14} />
            </button>
            <button
              type="button"
              className="am-mobile-mini-btn"
              disabled={futureCount === 0}
              onClick={redo}
              title="Redo"
            >
              <AmIcon name="ic_edit_redo" fallback="redo" size={14} />
            </button>
          </div>

          <div className="am-mobile-tab-bar">
            <div className="am-mobile-tab-strip">
              {mobileQuickTabs.map((t) => {
                const active =
                  !curveTarget &&
                  (inspectorTab === t.id || (t.id === 'effects' && inspectorTab === 'effectSettings'));
                return (
                  <button
                    key={t.label}
                    type="button"
                    className={`am-mobile-tab-pill ${active ? 'active' : ''}`}
                    onClick={() => {
                      if (t.action) {
                        t.action();
                      } else {
                        setCurveTarget(null);
                        setInspectorTab(t.id);
                      }
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="am-mobile-tab-pill timeline-exit"
              onClick={() => {
                setCurveTarget(null);
                setInspectorTab('none');
              }}
            >
              Timeline
            </button>
          </div>
        </>
      )}

      {/* APK fragment_element_edit.xml (#202332) */}
      <div className="am-insp-scroll am-scroll">
        {curveTarget ? (
          <EasingCurvePanel />
        ) : isRootMenu ? (
          <div className="am-element-edit-root">
            {/* Row 1: APK 38dp Trim / Split / Speed / Volume Strip */}
            <div className="am-element-strip-row">
              <button
                type="button"
                className="am-strip-btn"
                onClick={() => setInspectorTab('speed')}
                title="Speed / Time Remap"
              >
                <AmIcon name="ac_ic_speed" fallback="curve" size={18} />
              </button>

              {(layer.type === 'audio' || layer.type === 'video') && (
                <button
                  type="button"
                  className="am-strip-btn"
                  onClick={() => setInspectorTab('volume')}
                  title="Audio Volume"
                >
                  <AmIcon name="ac_ic_audio" fallback="audio" size={18} />
                </button>
              )}

              <div className="am-strip-group">
                <button
                  type="button"
                  className="am-strip-seg left"
                  onClick={trimSelectedLeft}
                  title="Trim Start to Playhead"
                >
                  <AmIcon name="ac_ic_trimleft" fallback="trimLeft" size={18} />
                </button>
                <button
                  type="button"
                  className="am-strip-seg center"
                  onClick={splitSelectedAtPlayhead}
                  title="Split Layer at Playhead"
                >
                  <AmIcon name="ac_ic_split" fallback="split" size={18} />
                </button>
                <button
                  type="button"
                  className="am-strip-seg right"
                  onClick={trimSelectedRight}
                  title="Trim End to Playhead"
                >
                  <AmIcon name="ac_ic_trimright" fallback="trimRight" size={18} />
                </button>
              </div>

              <div className="am-strip-group">
                <button
                  type="button"
                  className="am-strip-seg left"
                  onClick={moveLayerStartToPlayhead}
                  title="Move Layer Start to Playhead"
                >
                  <AmIcon name="ic_left_move" fallback="prevFrame" size={18} />
                </button>
                <button
                  type="button"
                  className="am-strip-seg right"
                  onClick={moveLayerEndToPlayhead}
                  title="Move Layer End to Playhead"
                >
                  <AmIcon name="ic_right_move" fallback="nextFrame" size={18} />
                </button>
              </div>
            </div>

            {/* Row 2 & 3: APK 57dp Feature Tiles (#2B2E3C rounded 5dp) */}
            <div className="am-apk-tile-grid">
              {layer.type !== 'audio' && layer.type !== 'null' && layer.type !== 'camera' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('colorFill')}>
                  <AmIcon name="ic_fill" fallback="sliders" size={20} />
                  <span>Color &amp; Fill</span>
                </button>
              )}

              {layer.type !== 'audio' && layer.type !== 'camera' && layer.type !== 'null' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('borderShadow')}>
                  <AmIcon name="ic_border" fallback="box" size={20} />
                  <span>Border &amp; Shadow</span>
                </button>
              )}

              {layer.type !== 'audio' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('moveTransform')}>
                  <AmIcon name="ac_ic_movetransform" fallback="sliders" size={20} />
                  <span>Move &amp; Transform</span>
                </button>
              )}

              {layer.type !== 'audio' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('blending')}>
                  <AmIcon name="ic_masking_group_bl" fallback="elements" size={20} />
                  <span>Blending &amp; Opacity</span>
                </button>
              )}

              {layer.type === 'shape' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('editShape')}>
                  <AmIcon name="ic_add_polygon" fallback="shape" size={20} />
                  <span>Edit Shape</span>
                </button>
              )}

              {layer.type === 'vector' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('editPoints')}>
                  <AmIcon name="ic_add_vectordrawing" fallback="draw" size={20} />
                  <span>Edit Points</span>
                </button>
              )}

              {layer.type === 'freehand' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('drawing')}>
                  <AmIcon name="ic_add_freehanddrawing" fallback="draw" size={20} />
                  <span>Edit Drawing</span>
                </button>
              )}

              {layer.type === 'text' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('editText')}>
                  <AmIcon name="ic_add_text" fallback="text" size={20} />
                  <span>Edit Text</span>
                </button>
              )}

              {layer.type === 'camera' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('cameraOptions')}>
                  <AmIcon name="ic_camera_options" fallback="camera" size={20} />
                  <span>Camera Options</span>
                </button>
              )}

              {layer.type === 'group' && (
                <button type="button" className="am-apk-tile" onClick={() => enterGroup(layer.id)}>
                  <AmIcon name="ic_group_settings_" fallback="elements" size={20} />
                  <span>Edit Group ({layer.groupLayers?.length ?? 0})</span>
                </button>
              )}

              {layer.type !== 'audio' && (
                <button type="button" className="am-apk-tile" onClick={() => setInspectorTab('effects')}>
                  <AmIcon name="ac_ic_effects" fallback="effects" size={20} />
                  <span>Effects ({layer.effects.length})</span>
                </button>
              )}

              <button type="button" className="am-apk-tile" onClick={() => replaceMediaRef.current?.click()}>
                <AmIcon name="ic_add_media" fallback="image" size={20} color="#00FFA8" />
                <span>{selectedLayerIds.length > 1 ? `Replace All (${selectedLayerIds.length})` : 'Replace Media'}</span>
              </button>
            </div>
          </div>
        ) : inspectorTab === 'moveTransform' ? (
          <MoveTransformPanel />
        ) : inspectorTab === 'colorFill' ? (
          <ColorFillPanel />
        ) : inspectorTab === 'borderShadow' ? (
          <BorderShadowPanel />
        ) : inspectorTab === 'blending' ? (
          <BlendingOpacityPanel />
        ) : inspectorTab === 'effects' ? (
          <EffectsPanel />
        ) : inspectorTab === 'effectSettings' ? (
          <EffectSettingsPanel />
        ) : inspectorTab === 'editShape' ? (
          <ShapeEditPanel />
        ) : inspectorTab === 'editPoints' ? (
          <EditPointsPanel />
        ) : inspectorTab === 'editText' ? (
          <TextEditPanel />
        ) : inspectorTab === 'cameraOptions' ? (
          <CameraOptionsPanel />
        ) : inspectorTab === 'drawing' ? (
          <DrawingToolbar />
        ) : inspectorTab === 'speed' ? (
          <SpeedRemapPanel />
        ) : inspectorTab === 'volume' ? (
          <VolumePanel />
        ) : null}
      </div>
    </aside>
  );
};
