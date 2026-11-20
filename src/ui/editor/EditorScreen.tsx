import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioEngine } from '../../engine/audioEngine';
import {
  collectMissingFonts,
  onFontEpochChange,
  type MissingFontEntry,
} from '../../engine/fontRegistry';
import { AlightRenderer } from '../../engine/renderer';
import { useEditorStore } from '../../store/useEditorStore';
import { AddLayerPopup } from './AddLayerPopup';
import { EditorActionBar } from './EditorActionBar';
import { EffectBrowserDialog } from './EffectBrowserDialog';
import { ExportDialog } from './ExportDialog';
import { LayerInspector } from './LayerInspector';
import { MissingFontsDialog } from './MissingFontsDialog';
import { Playbar } from './Playbar';
import { PreviewCanvas } from './PreviewCanvas';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { ShortcutOverlay } from './ShortcutOverlay';
import { Timeline } from './Timeline';

declare global {
  interface Window {
    __verifyAllShaders?: () => ReturnType<AlightRenderer['verifyAllShaders']> | { error: string };
    __rendererRef?: React.RefObject<AlightRenderer | null>;
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
    toastMessage,
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
  const [cacheVersion, setCacheVersion] = useState(0);
  const [missingFonts, setMissingFonts] = useState<MissingFontEntry[]>([]);
  const [showMissingFontsModal, setShowMissingFontsModal] = useState(false);
  const lastAutoPromptProjectIdRef = useRef<string | null>(null);
  const lastModifiedTimeRef = useRef<number>(0);

  const missingFontLayerIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of missingFonts) {
      for (const id of m.layerIds) set.add(id);
    }
    return set;
  }, [missingFonts]);

  const refreshMissingFonts = useCallback((autoOpenIfNew = false) => {
    const proj = useEditorStore.getState().currentProject;
    if (!proj) {
      setMissingFonts([]);
      return;
    }
    const found = collectMissingFonts(proj);
    setMissingFonts(found);
    if (found.length === 0) {
      setShowMissingFontsModal(false);
    } else if (autoOpenIfNew && lastAutoPromptProjectIdRef.current !== proj.id) {
      lastAutoPromptProjectIdRef.current = proj.id;
      setShowMissingFontsModal(true);
    }
  }, []);

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
          useCache: false,
        });
      });
    };
    let cacheNotifyTimer = 0;
    renderer.onCacheChange = () => {
      if (cacheNotifyTimer) return;
      cacheNotifyTimer = window.setTimeout(() => {
        cacheNotifyTimer = 0;
        setCacheVersion((v) => v + 1);
      }, 180);
    };
    window.__verifyAllShaders = () => renderer.verifyAllShaders();
    window.__rendererRef = rendererRef;

    const unsubFont = onFontEpochChange(() => {
      renderer.invalidatePreviewCache();
      refreshMissingFonts(false);
      renderer.onMediaReady?.();
    });

    return () => {
      unsubFont();
      if (cacheNotifyTimer) clearTimeout(cacheNotifyTimer);
      if (mediaRedrawRafRef.current) {
        cancelAnimationFrame(mediaRedrawRafRef.current);
        mediaRedrawRafRef.current = 0;
      }
      renderer.onMediaReady = undefined;
      renderer.onCacheChange = undefined;
      delete window.__verifyAllShaders;
      delete window.__rendererRef;
      renderer.dispose();
      rendererRef.current = null;
      audioEngine.stopPlayback();
    };
  }, [refreshMissingFonts]);

  // Detect missing fonts, verify project shaders (K-2/K-1), & invalidate L2 cache on project mutations
  useEffect(() => {
    if (!currentProject) return;
    if (lastModifiedTimeRef.current !== currentProject.modifiedTime) {
      lastModifiedTimeRef.current = currentProject.modifiedTime;
      rendererRef.current?.invalidatePreviewCache();
    }
    refreshMissingFonts(true);
  }, [currentProject, currentProject?.id, currentProject?.modifiedTime, refreshMissingFonts]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !currentProject) return;
    const check = renderer.verifyProjectEffects(currentProject);
    if (check.failed.length > 0) {
      console.warn('[shader-verify] Failed effects in project:', check.failed);
      useEditorStore.getState().showToast(`Shader compile failed: ${check.failed[0].id}`);
    } else if (check.groupChromaKeyWarnings.length > 0) {
      useEditorStore
        .getState()
        .showToast(`Chroma Key on group "${check.groupChromaKeyWarnings[0]}" — apply directly to media layer instead`);
    }
  }, [currentProject?.id]);

  // Render single frame whenever project, playhead, quality, or visibility changes while paused (always exact native res)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !currentProject || visibilityPaused || isPlaying || isExportingRef.current) return;
    renderer.syncVideosForPlayback(currentProject, currentTimeMs, false);
    renderer.renderProject(currentProject, currentTimeMs, {
      previewScale: previewQuality,
      selectedIds: selectedLayerIds,
      activeGroupStack: groupStack,
      useCache: false,
    });
  }, [currentProject, currentTimeMs, selectedLayerIds, groupStack, previewQuality, visibilityPaused, isPlaying]);

  // Idle render-ahead (After Effects RAM Preview): walks outward from playhead on idle turns, cancels on interaction
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !currentProject || isPlaying || visibilityPaused || isExportingRef.current) return;
    const totalFrames = Math.max(1, Math.ceil((currentProject.durationMs / 1000) * Math.max(1, currentProject.fps)));
    const centerFrame = Math.max(0, Math.round((currentTimeMs / 1000) * Math.max(1, currentProject.fps)));
    const order: number[] = [];
    for (let d = 1; d < totalFrames; d++) {
      if (centerFrame + d < totalFrames) order.push(centerFrame + d);
      if (centerFrame - d >= 0) order.push(centerFrame - d);
    }
    let cursor = 0;
    let cancelled = false;
    let idleHandle = 0;
    const win = window as Window & {
      requestIdleCallback?: (cb: (d: { timeRemaining: () => number }) => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const rIC = win.requestIdleCallback
      ? (cb: (d: { timeRemaining: () => number }) => void) => win.requestIdleCallback!(cb)
      : (cb: (d: { timeRemaining: () => number }) => void) =>
          globalThis.setTimeout(() => cb({ timeRemaining: () => 8 }), 40) as unknown as number;
    const cIC = win.cancelIdleCallback
      ? (id: number) => win.cancelIdleCallback!(id)
      : (id: number) => globalThis.clearTimeout(id);

    const abortSlice = () => {
      cancelled = true;
      if (idleHandle) {
        cIC(idleHandle);
        idleHandle = 0;
      }
    };

    const pump = (deadline: { timeRemaining: () => number }) => {
      if (cancelled || isExportingRef.current) return;
      const store = useEditorStore.getState();
      if (store.isPlaying || !store.currentProject || store.currentProject.id !== currentProject.id) return;
      const start = performance.now();
      // P-6: Hard timeRemaining() > 6 check so idle precache never steals a UI frame
      while (
        cursor < order.length &&
        deadline.timeRemaining() > 6 &&
        performance.now() - start < 8
      ) {
        const frameIdx = order[cursor++];
        renderer.precacheFrame(currentProject, frameIdx, previewQuality);
      }
      if (cursor < order.length && !cancelled) {
        idleHandle = rIC(pump);
      }
    };

    window.addEventListener('pointerdown', abortSlice, true);
    window.addEventListener('keydown', abortSlice, true);
    window.addEventListener('blur', abortSlice);

    const delayTimer = window.setTimeout(() => {
      if (!cancelled) idleHandle = rIC(pump);
    }, 350);

    return () => {
      abortSlice();
      clearTimeout(delayTimer);
      window.removeEventListener('pointerdown', abortSlice, true);
      window.removeEventListener('keydown', abortSlice, true);
      window.removeEventListener('blur', abortSlice);
    };
  }, [currentProject, currentTimeMs, previewQuality, isPlaying, visibilityPaused]);

  // Playback rAF loop: audio-master clock (or fixed-step without audio) + L2 RAM cache hit path + throttled store sync
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

    const hasAudioTrack = audioEngine.hasAudio(currentProject);
    const frameMs = 1000 / Math.max(1, currentProject.fps);
    renderer.syncVideosForPlayback(currentProject, playheadMs, true);
    audioEngine.startPlayback(currentProject, playheadMs);
    let lastTs = performance.now();
    let accumMs = 0;
    let commitTick = 0;
    let rafId = 0;

    const tick = (now: number) => {
      const store = useEditorStore.getState();
      const proj = store.currentProject;
      if (!proj || !store.isPlaying || isExportingRef.current) return;

      if (hasAudioTrack) {
        const audioPos = audioEngine.getPlaybackPositionMs();
        if (audioPos !== null) {
          playheadMs = audioPos;
        } else {
          playheadMs += Math.min(frameMs * 2, Math.max(0, now - lastTs));
        }
        lastTs = now;
      } else {
        // Fixed-step accumulator: advances by exact frame steps without swallowing hitches silently
        const rawDt = Math.max(0, now - lastTs);
        lastTs = now;
        accumMs += Math.min(rawDt, frameMs * 3);
        const steps = Math.max(1, Math.floor(accumMs / frameMs));
        if (accumMs >= frameMs) {
          accumMs -= steps * frameMs;
          playheadMs += steps * frameMs;
        } else {
          playheadMs += rawDt;
        }
      }

      if (playheadMs >= proj.durationMs) {
        if (store.loop) {
          playheadMs = 0;
          accumMs = 0;
          audioEngine.startPlayback(proj, 0);
        } else {
          playheadMs = proj.durationMs;
          renderer.syncVideosForPlayback(proj, playheadMs, false);
          renderer.renderProject(proj, playheadMs, {
            previewScale: store.previewQuality,
            selectedIds: store.selectedLayerIds,
            activeGroupStack: store.groupStack,
            useCache: true,
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
        useCache: true,
      });

      // Throttle React store playhead commits to every 4th frame (~15 Hz) while playing
      commitTick++;
      if (commitTick % 4 === 0) {
        store.setCurrentTimeMs(playheadMs);
        const lvl = audioEngine.sampleLevel();
        if (lvl !== store.audioLevel) {
          store.setAudioLevel(lvl);
        }
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

  // Track C: Capture-phase global keyboard handler (suspends in inputs and open dialogs except Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }

      const store = useEditorStore.getState();
      const proj = store.currentProject;
      if (!proj) return;

      const modalOpen =
        store.showNewProjectDialog ||
        store.showAddLayerPopup ||
        store.showEffectBrowser ||
        store.showExportDialog ||
        store.showProjectSettings ||
        store.showDrawer ||
        store.showShortcutOverlay;

      if (e.key === 'Escape') {
        if (store.showShortcutOverlay) store.setShowShortcutOverlay(false);
        else if (store.showEffectBrowser) store.setModal('showEffectBrowser', false);
        else if (store.showAddLayerPopup) store.setModal('showAddLayerPopup', false);
        else if (store.showExportDialog) store.setModal('showExportDialog', false);
        else if (store.showProjectSettings) store.setModal('showProjectSettings', false);
        else if (store.groupStack.length > 0) store.exitGroup();
        else if (store.inspectorTab !== 'none') store.setInspectorTab('none');
        return;
      }
      if (modalOpen) return;

      if (e.key === 'Enter' && store.selectedLayerIds.length === 1) {
        const active = store.getActiveLayers();
        const sel = active.find((l) => l.id === store.selectedLayerIds[0]);
        if (sel?.type === 'group') {
          e.preventDefault();
          store.enterGroup(sel.id);
          return;
        }
      }

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const fps = proj.fps || 30;
      const frameMs = 1000 / fps;

      if (e.key === '?') {
        e.preventDefault();
        store.setShowShortcutOverlay(true);
      } else if (e.code === 'Space') {
        e.preventDefault();
        store.togglePlay();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          store.redo();
          store.showToast('Redo');
        } else {
          store.undo();
          store.showToast('Undo');
        }
      } else if (mod && key === 'y') {
        e.preventDefault();
        store.redo();
        store.showToast('Redo');
      } else if (mod && key === 'd') {
        e.preventDefault();
        store.duplicateSelectedLayers();
        store.showToast('Duplicated layer');
      } else if (mod && key === 'c') {
        e.preventDefault();
        store.copySelectedLayers();
        store.showToast('Copied layer');
      } else if (mod && key === 'v') {
        e.preventDefault();
        store.pasteLayers();
        store.showToast('Pasted layer');
      } else if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) store.ungroupSelectedLayer();
        else store.groupSelectedLayers('none');
      } else if (mod && e.shiftKey && key === 'e') {
        e.preventDefault();
        store.setModal('showExportDialog', true);
      } else if (mod && key === 'e') {
        e.preventDefault();
        if (store.selectedLayerIds.length === 1) store.setModal('showEffectBrowser', true);
      } else if (!mod && key === 'e') {
        if (store.selectedLayerIds.length === 1) {
          e.preventDefault();
          store.setInspectorTab(store.inspectorTab === 'effects' ? 'menu' : 'effects');
        }
      } else if (!mod && key === 'g') {
        e.preventDefault();
        store.toggleGrid();
      } else if (!mod && key === 'f') {
        e.preventDefault();
        store.setPreviewZoom(1);
        store.setPreviewPan([0, 0]);
      } else if (!mod && key === '0') {
        e.preventDefault();
        store.setPreviewZoom(1);
        store.setPreviewPan([0, 0]);
      } else if (!mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        store.setPreviewZoom(store.previewZoom * 1.15);
      } else if (!mod && e.key === '-') {
        e.preventDefault();
        store.setPreviewZoom(store.previewZoom / 1.15);
      } else if (!mod && e.key === ',') {
        e.preventDefault();
        store.setIsPlaying(false);
        store.setCurrentTimeMs(store.currentTimeMs - frameMs * (e.shiftKey ? 10 : 1));
      } else if (!mod && e.key === '.') {
        e.preventDefault();
        store.setIsPlaying(false);
        store.setCurrentTimeMs(store.currentTimeMs + frameMs * (e.shiftKey ? 10 : 1));
      } else if (!mod && e.key === 'Home') {
        e.preventDefault();
        store.setIsPlaying(false);
        store.setCurrentTimeMs(0);
      } else if (!mod && e.key === 'End') {
        e.preventDefault();
        store.setIsPlaying(false);
        store.setCurrentTimeMs(proj.durationMs);
      } else if (!mod && key === 'i') {
        e.preventDefault();
        store.trimSelectedLeft();
      } else if (!mod && key === 'o') {
        e.preventDefault();
        store.trimSelectedRight();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedLayerIds.length > 0) {
          e.preventDefault();
          store.deleteSelectedLayers();
          store.showToast('Deleted layer');
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (store.selectedLayerIds.length === 1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.shiftKey)) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const selId = store.selectedLayerIds[0];
          store.mutateProject((p) => {
            const targetLayer = p.layers.find((l) => l.id === selId);
            if (!targetLayer) return;
            const loc = targetLayer.transform.location.value;
            targetLayer.transform.location.value = [loc[0] + dx, loc[1] + dy, loc[2] ?? 0];
          });
        } else if (e.key === 'ArrowLeft') {
          store.setIsPlaying(false);
          store.setCurrentTimeMs(store.currentTimeMs - frameMs);
        } else if (e.key === 'ArrowRight') {
          store.setIsPlaying(false);
          store.setCurrentTimeMs(store.currentTimeMs + frameMs);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [togglePlay, undo, redo, deleteSelectedLayers, setIsPlaying, setCurrentTimeMs]);

  if (!currentProject) return null;

  const handleClearCache = () => {
    rendererRef.current?.clearPreviewCache();
    useEditorStore.getState().showToast('Preview RAM cache cleared');
  };

  const handleRenderCacheNow = () => {
    const renderer = rendererRef.current;
    if (!renderer || !currentProject) return;
    const totalFrames = Math.max(1, Math.ceil((currentProject.durationMs / 1000) * Math.max(1, currentProject.fps)));
    let idx = 0;
    useEditorStore.getState().showToast(`Pre-rendering ${totalFrames} preview frames…`);
    const step = () => {
      if (!rendererRef.current || useEditorStore.getState().isPlaying) return;
      const start = performance.now();
      while (idx < totalFrames && performance.now() - start < 12) {
        rendererRef.current.precacheFrame(currentProject, idx++, previewQuality);
      }
      if (idx < totalFrames) requestAnimationFrame(step);
      else useEditorStore.getState().showToast('Preview RAM cache ready');
    };
    requestAnimationFrame(step);
  };

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
        <Timeline
          rendererRef={rendererRef}
          cacheVersion={cacheVersion}
          missingFontLayerIds={missingFontLayerIds}
          onOpenMissingFonts={() => setShowMissingFontsModal(true)}
          onClearCache={handleClearCache}
          onRenderCacheNow={handleRenderCacheNow}
        />
        <LayerInspector />
      </div>

      <AddLayerPopup />
      <EffectBrowserDialog />
      <ExportDialog rendererRef={rendererRef} isExportingRef={isExportingRef} />
      <ProjectSettingsDialog />
      <ShortcutOverlay />
      {showMissingFontsModal && missingFonts.length > 0 && (
        <MissingFontsDialog
          projectTitle={currentProject.title}
          missing={missingFonts}
          onResolved={() => {
            rendererRef.current?.invalidatePreviewCache();
            refreshMissingFonts(false);
          }}
          onClose={() => setShowMissingFontsModal(false)}
        />
      )}
      {toastMessage && (
        <div className="am-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  );
};
