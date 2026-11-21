import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { audioEngine } from '../../engine/audioEngine';
import { replaceMediaOnLayers } from '../../engine/mediaReplace';
import type { AlightRenderer } from '../../engine/renderer';
import { playbackClock } from '../../store/playbackClock';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';

interface PlaybarProps {
  viewModeOpen: boolean;
  onToggleViewMode: () => void;
}

export const Playbar: React.FC<PlaybarProps> = ({ viewModeOpen, onToggleViewMode }) => {
  const {
    currentProject,
    isPlaying,
    hasBookmarkHere,
    selectedLayerIds,
    groupStack,
    pastCount,
    futureCount,
    hasLayerClipboard,
    hasEffectsClipboard,
    undo,
    redo,
    setCurrentTimeMs,
    togglePlay,
    setIsPlaying,
    toggleBookmarkAtPlayhead,
    jumpBookmark,
    copySelectedLayers,
    pasteLayers,
    duplicateSelectedLayers,
    copyLayerEffects,
    pasteLayerEffects,
    mutateProject,
  } = useEditorStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      isPlaying: s.isPlaying,
      hasBookmarkHere: !s.isPlaying && Boolean(s.currentProject?.bookmarks.some((b) => Math.abs(b - s.currentTimeMs) < 35)),
      selectedLayerIds: s.selectedLayerIds,
      groupStack: s.groupStack,
      pastCount: s.past.length,
      futureCount: s.future.length,
      hasLayerClipboard: Boolean(s.layerClipboard),
      hasEffectsClipboard: Boolean(s.effectsClipboard),
      undo: s.undo,
      redo: s.redo,
      setCurrentTimeMs: s.setCurrentTimeMs,
      togglePlay: s.togglePlay,
      setIsPlaying: s.setIsPlaying,
      toggleBookmarkAtPlayhead: s.toggleBookmarkAtPlayhead,
      jumpBookmark: s.jumpBookmark,
      copySelectedLayers: s.copySelectedLayers,
      pasteLayers: s.pasteLayers,
      duplicateSelectedLayers: s.duplicateSelectedLayers,
      copyLayerEffects: s.copyLayerEffects,
      pasteLayerEffects: s.pasteLayerEffects,
      mutateProject: s.mutateProject,
    }))
  );

  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const vuFillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncVu = () => {
      if (vuFillRef.current) {
        vuFillRef.current.style.width = `${Math.round(playbackClock.getAudioLevel() * 100)}%`;
      }
    };
    syncVu();
    return playbackClock.subscribeAudio(syncVu);
  }, []);

  if (!currentProject) return null;
  const frameMs = 1000 / Math.max(1, currentProject.fps);
  const hasSel = selectedLayerIds.length > 0;

  return (
    <div className="am-playbar">
      {/* APK LevelMeterView (2dp) */}
      <div className="am-vu-meter" aria-hidden="true">
        <div ref={vuFillRef} className="am-vu-fill" style={{ width: '0%' }} />
      </div>

      {/* APK activity_edit_playbar.xml (46dp #191B27) */}
      <div className="am-playbar-row">
        {/* Left: buttonUndo + buttonRedo */}
        <div className="am-playbar-section">
          <button
            type="button"
            className="am-playbar-btn"
            disabled={pastCount === 0}
            onClick={undo}
            title="Undo (Ctrl+Z)"
          >
            <AmIcon name="ic_edit_undo" fallback="undo" size={20} />
          </button>
          <button
            type="button"
            className="am-playbar-btn"
            disabled={futureCount === 0}
            onClick={redo}
            title="Redo (Ctrl+Y)"
          >
            <AmIcon name="ic_edit_redo" fallback="redo" size={20} />
          </button>
        </div>

        {/* Center: buttonSkipBack + buttonPlay + buttonSkipFwd */}
        <div className="am-playbar-section am-playbar-center">
          <button
            type="button"
            className="am-playbar-btn"
            onClick={() => {
              const st = useEditorStore.getState();
              const baseMs = st.isPlaying ? playbackClock.get() : st.currentTimeMs;
              setIsPlaying(false);
              setCurrentTimeMs(baseMs - frameMs);
            }}
            title="Previous Frame (ArrowLeft)"
          >
            <AmIcon name="ic_edit_prevframe" fallback="prevFrame" size={21} />
          </button>

          <button
            type="button"
            className={`am-playbar-btn am-play-trigger ${isPlaying ? 'playing' : ''}`}
            onPointerDown={() => {
              audioEngine.unlockFromGesture();
              (window as unknown as { __rendererRef?: React.RefObject<AlightRenderer | null> }).__rendererRef?.current?.primeElementAudio(true);
            }}
            onClick={() => {
              audioEngine.unlockFromGesture();
              (window as unknown as { __rendererRef?: React.RefObject<AlightRenderer | null> }).__rendererRef?.current?.primeElementAudio(true);
              togglePlay();
            }}
            title="Play / Pause (Space)"
          >
            <AmIcon name={isPlaying ? 'ac_ic_pause' : 'ac_ic_play'} fallback={isPlaying ? 'pause' : 'play'} size={24} />
          </button>

          <button
            type="button"
            className="am-playbar-btn"
            onClick={() => {
              const st = useEditorStore.getState();
              const baseMs = st.isPlaying ? playbackClock.get() : st.currentTimeMs;
              setIsPlaying(false);
              setCurrentTimeMs(baseMs + frameMs);
            }}
            title="Next Frame (ArrowRight)"
          >
            <AmIcon name="ic_edit_nextframe" fallback="nextFrame" size={21} />
          </button>
        </div>

        {/* Right: buttonCopyPasteOverflow + buttonBookmark + buttonPreviewMode */}
        <div className="am-playbar-section" style={{ position: 'relative' }}>
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                replaceMediaOnLayers(e.target.files, selectedLayerIds, groupStack, mutateProject);
              }
              e.target.value = '';
              setShowCopyMenu(false);
            }}
          />

          <button
            type="button"
            className={`am-playbar-btn ${showCopyMenu ? 'active' : ''}`}
            onClick={() => setShowCopyMenu((v) => !v)}
            title="Copy / Paste / Duplicate Menu"
          >
            <AmIcon name="ic_layer_copy_paste_menu" fallback="copy" size={20} />
          </button>

          {showCopyMenu && (
            <div className="am-popup-menu" style={{ right: 76, bottom: 48 }}>
              <button
                type="button"
                className="am-popup-item"
                disabled={!hasSel}
                onClick={() => {
                  copySelectedLayers();
                  setShowCopyMenu(false);
                }}
              >
                Copy {selectedLayerIds.length > 1 ? `${selectedLayerIds.length} Layers` : 'Layer'}
              </button>
              <button
                type="button"
                className="am-popup-item"
                disabled={!hasLayerClipboard}
                onClick={() => {
                  pasteLayers();
                  setShowCopyMenu(false);
                }}
              >
                Paste Layer(s)
              </button>
              <button
                type="button"
                className="am-popup-item"
                disabled={!hasSel}
                onClick={() => {
                  duplicateSelectedLayers();
                  setShowCopyMenu(false);
                }}
              >
                Duplicate Layer(s)
              </button>
              <div className="am-popup-sep" />
              <button
                type="button"
                className="am-popup-item"
                disabled={!hasSel}
                onClick={() => {
                  copyLayerEffects();
                  setShowCopyMenu(false);
                }}
              >
                Copy Effects
              </button>
              <button
                type="button"
                className="am-popup-item"
                disabled={!hasSel || !hasEffectsClipboard}
                onClick={() => {
                  pasteLayerEffects();
                  setShowCopyMenu(false);
                }}
              >
                Paste Effects
              </button>
              <div className="am-popup-sep" />
              <button
                type="button"
                className="am-popup-item"
                disabled={!hasSel}
                onClick={() => replaceInputRef.current?.click()}
              >
                Replace Media ({selectedLayerIds.length || 0})
              </button>
            </div>
          )}

          <button
            type="button"
            className="am-playbar-btn"
            onClick={() => jumpBookmark(-1)}
            title="Previous Bookmark"
            style={{ width: 24 }}
          >
            <AmIcon name="ic_prev_element" fallback="back" size={14} />
          </button>

          <button
            type="button"
            className={`am-playbar-btn ${hasBookmarkHere ? 'bookmark-active' : ''}`}
            onClick={toggleBookmarkAtPlayhead}
            title="Add / Remove Beat Bookmark"
          >
            <AmIcon
              name={hasBookmarkHere ? 'ic_bookmark_remove' : 'ic_bookmark_add'}
              fallback="bookmark"
              size={20}
              color={hasBookmarkHere ? '#FFCD4B' : undefined}
            />
          </button>

          <button
            type="button"
            className="am-playbar-btn"
            onClick={() => jumpBookmark(1)}
            title="Next Bookmark"
            style={{ width: 24 }}
          >
            <AmIcon name="ic_next_element" fallback="next" size={14} />
          </button>

          <button
            type="button"
            className={`am-playbar-btn ${viewModeOpen ? 'active' : ''}`}
            onClick={onToggleViewMode}
            title="Toggle Preview View Options Drawer"
          >
            <AmIcon name="ic_viewmode_panel_close" fallback="grid" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};
