import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../../engine/audioEngine';
import { AlightRenderer } from '../../engine/renderer';
import { useEditorStore } from '../../store/useEditorStore';
import { AddLayerPopup } from './AddLayerPopup';
import { EditorActionBar } from './EditorActionBar';
import { EffectBrowserDialog } from './EffectBrowserDialog';
import { ExportDialog } from './ExportDialog';
import { LayerInspector } from './LayerInspector';
import { Playbar } from './Playbar';
import { PreviewCanvas } from './PreviewCanvas';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { Timeline } from './Timeline';

declare global {
  interface Window {
    __verifyAllShaders?: () => ReturnType<AlightRenderer['verifyAllShaders']> | { error: string };
  }
}

export const EditorScreen: React.FC = () => {
  const {
    currentProject,
    currentTimeMs,
    isPlaying,
    loop,
    layoutMode,
    selectedLayerIds,
    groupStack,
    previewQuality,
    setCurrentTimeMs,
    setIsPlaying,
    togglePlay,
    setAudioLevel,
    undo,
    redo,
    deleteSelectedLayers,
  } = useEditorStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<AlightRenderer | null>(null);
  const isExportingRef = useRef(false);
  const mediaRedrawRafRef = useRef(0);
  const [visibilityPaused, setVisibilityPaused] = useState(false);
  const [viewModeOpen, setViewModeOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 860);

  // Auto-select Mobile APK (classic) vs iPad Desktop (widescreen) on viewport resize
  useEffect(() => {
    const syncLayout = () => {
      const mobile = window.innerWidth <= 860;
      useEditorStore.getState().setLayoutMode(mobile ? 'classic' : 'widescreen');
    };
    syncLayout();
    window.addEventListener('resize', syncLayout);
    return () => window.removeEventListener('resize', syncLayout);
  }, []);

  // Initialize WebGL2 AlightRenderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new AlightRenderer(canvas);
    rendererRef.current = renderer;
    renderer.onMediaReady = () => {
      if (isExportingRef.current || mediaRedrawRafRef.current) return;
      mediaRedrawRafRef.current = requestAnimationFrame(() => {
        mediaRedrawRafRef.current = 0;
        if (isExportingRef.current) return;
        const store = useEditorStore.getState();
        const proj = store.currentProject;
        if (!proj || store.isPlaying) return;
        renderer.renderProject(proj, store.currentTimeMs, {
          previewScale: store.previewQuality,
          selectedIds: store.selectedLayerIds,
          activeGroupStack: store.groupStack,
        });
      });
    };
    window.__verifyAllShaders = () => renderer.verifyAllShaders();

    return () => {
      if (mediaRedrawRafRef.current) {
        cancelAnimationFrame(mediaRedrawRafRef.current);
        mediaRedrawRafRef.current = 0;
      }
      renderer.onMediaReady = undefined;
      delete window.__verifyAllShaders;
      renderer.dispose();
      rendererRef.current = null;
      audioEngine.stopPlayback();
    };
  }, []);

  // Render single frame whenever project, playhead, quality, or visibility changes while paused
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !currentProject || visibilityPaused || isPlaying || isExportingRef.current) return;
    renderer.syncVideosForPlayback(currentProject, currentTimeMs, false);
    renderer.renderProject(currentProject, currentTimeMs, {
      previewScale: previewQuality,
      selectedIds: selectedLayerIds,
      activeGroupStack: groupStack,
    });
  }, [currentProject, currentTimeMs, selectedLayerIds, groupStack, previewQuality, visibilityPaused, isPlaying]);

  // Playback rAF loop: renders directly to WebGL2 canvas + syncs HTMLVideo & Web Audio without React commit lag
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!isPlaying || !currentProject || visibilityPaused || !renderer) {
      renderer?.pauseAllVideos();
      audioEngine.stopPlayback();
      setAudioLevel(0);
      return;
    }

    let playheadMs = useEditorStore.getState().currentTimeMs;
    if (playheadMs >= currentProject.durationMs) {
      playheadMs = 0;
      useEditorStore.getState().setCurrentTimeMs(0);
    }

    renderer.syncVideosForPlayback(currentProject, playheadMs, true);
    audioEngine.startPlayback(currentProject, playheadMs);
    let lastTs = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dt = Math.min(100, Math.max(0, now - lastTs));
      lastTs = now;
      const store = useEditorStore.getState();
      const proj = store.currentProject;
      if (!proj || !store.isPlaying || isExportingRef.current) return;

      playheadMs += dt;
      if (playheadMs >= proj.durationMs) {
        if (store.loop) {
          playheadMs = 0;
          audioEngine.startPlayback(proj, 0);
        } else {
          playheadMs = proj.durationMs;
          renderer.syncVideosForPlayback(proj, playheadMs, false);
          renderer.renderProject(proj, playheadMs, {
            previewScale: store.previewQuality,
            selectedIds: store.selectedLayerIds,
            activeGroupStack: store.groupStack,
          });
          store.setCurrentTimeMs(proj.durationMs);
          store.setIsPlaying(false);
          return;
        }
      }

      renderer.syncVideosForPlayback(proj, playheadMs, true);
      renderer.renderProject(proj, playheadMs, {
        previewScale: store.previewQuality,
        selectedIds: store.selectedLayerIds,
        activeGroupStack: store.groupStack,
      });
      store.setCurrentTimeMs(playheadMs);
      const lvl = audioEngine.sampleLevel();
      if (lvl !== store.audioLevel) {
        store.setAudioLevel(lvl);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      renderer.pauseAllVideos();
      audioEngine.stopPlayback();
    };
    // Intentionally start/stop only on isPlaying / visibilityPaused / currentProject?.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, visibilityPaused, currentProject?.id]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedLayers();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const fps = currentProject?.fps || 30;
        setIsPlaying(false);
        setCurrentTimeMs(useEditorStore.getState().currentTimeMs - 1000 / fps);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const fps = currentProject?.fps || 30;
        setIsPlaying(false);
        setCurrentTimeMs(useEditorStore.getState().currentTimeMs + 1000 / fps);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, undo, redo, deleteSelectedLayers, setIsPlaying, setCurrentTimeMs, currentProject?.fps]);

  if (!currentProject) return null;

  return (
    <div className="am-editor">
      <EditorActionBar />

      <div className={`am-editor-body ${layoutMode}`}>
        <PreviewCanvas
          canvasRef={canvasRef}
          onVisibilityPauseChange={setVisibilityPaused}
          viewModeOpen={viewModeOpen}
        />
        <Playbar viewModeOpen={viewModeOpen} onToggleViewMode={() => setViewModeOpen((v) => !v)} />
        <Timeline />
        <LayerInspector />
      </div>

      <AddLayerPopup />
      <EffectBrowserDialog />
      <ExportDialog rendererRef={rendererRef} isExportingRef={isExportingRef} />
      <ProjectSettingsDialog />
    </div>
  );
};
