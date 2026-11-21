import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { audioEngine } from '../../engine/audioEngine';
import {
  collectMissingFonts,
  onFontEpochChange,
  type MissingFontEntry,
} from '../../engine/fontRegistry';
import { AlightRenderer } from '../../engine/renderer';
import { resolveActiveGroup, useEditorStore } from '../../store/useEditorStore';
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
    inspectorTab,
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
  } = useEditorStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      currentTimeMs: s.currentTimeMs,
      isPlaying: s.isPlaying,
      loop: s.loop,
      layoutMode: s.layoutMode,
      inspectorTab: s.inspectorTab,
      selectedLayerIds: s.selectedLayerIds,
      groupStack: s.groupStack,
      previewQuality: s.previewQuality,
      toastMessage: s.toastMessage,
      setCurrentTimeMs: s.setCurrentTimeMs,
      setIsPlaying: s.setIsPlaying,
      togglePlay: s.togglePlay,
      setAudioLevel: s.setAudioLevel,
      undo: s.undo,
      redo: s.redo,
      deleteSelectedLayers: s.deleteSelectedLayers,
    }))
  );

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
          useCache: true,
        });
      });
    };
    let cacheNotifyTimer = 0;
    renderer.onCacheChange = () => {
      if (cacheNotifyTimer) return;
      // G-4: Coarser throttle (600ms) so idle cache bar updates never churn EditorScreen
      cacheNotifyTimer = window.setTimeout(() => {
        cacheNotifyTimer = 0;
        setCacheVersion((v) => v + 1);
      }, 600);
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
    audioEngine.preloadProjectAudio(currentProject);
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

  // Render single frame whenever project, playhead, quality, or visibility changes while paused (I-6: coalesced to 1 per rAF)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !currentProject || visibilityPaused || isPlaying || isExportingRef.current) return;
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled || isExportingRef.current) return;
      const store = useEditorStore.getState();
      if (store.isPlaying || !store.currentProject) return;
      renderer.syncVideosForPlayback(store.currentProject, store.currentTimeMs, false, store.groupStack);
      // FL-1: Use unified playbackScale (useCache: true) on paused render too -> zero 2-3x sharpness pop on play/pause
      renderer.renderProject(store.currentProject, store.currentTimeMs, {
        previewScale: store.previewQuality,
        selectedIds: store.selectedLayerIds,
        activeGroupStack: store.groupStack,
        useCache: true,
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [currentProject, currentTimeMs, selectedLayerIds, groupStack, previewQuality, visibilityPaused, isPlaying]);

  // Idle render-ahead (After Effects RAM Preview): walks FORWARD monotonically, never restarts on playhead scrub (G-3)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !currentProject || isPlaying || visibilityPaused || isExportingRef.current) return;
    const totalFrames = Math.max(1, Math.ceil((currentProject.durationMs / 1000) * Math.max(1, currentProject.fps)));
    const startFrame = Math.max(
      0,
      Math.round((useEditorStore.getState().currentTimeMs / 1000) * Math.max(1, currentProject.fps))
    );
    // Strictly monotonic forward order (never ping-pong +d/-d which causes video decoders to thrash)
    const order: number[] = [];
    for (let f = startFrame; f < totalFrames; f++) order.push(f);
    for (let f = 0; f < startFrame; f++) order.push(f);

    let cursor = 0;
    let cancelled = false;
    let busy = false;
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

    const pump = async (deadline: { timeRemaining: () => number }) => {
      if (cancelled || busy || isExportingRef.current) return;
      const store = useEditorStore.getState();
      if (store.isPlaying || !store.currentProject || store.currentProject.id !== currentProject.id) return;
      if (deadline.timeRemaining() <= 6) {
        if (!cancelled) idleHandle = rIC(pump);
        return;
      }
      busy = true;
      let stopSweep = false;
      try {
        // ST-1: Distinguish 'stored' / 'present' / 'full' / 'blocked' so pump yields cleanly and never spins
        while (cursor < order.length && !cancelled) {
          const frameIdx = order[cursor++];
          const r = await renderer.precacheFrameAsync(currentProject, frameIdx, previewQuality);
          if (r === 'stored') break;
          if (r === 'full' || r === 'blocked') {
            stopSweep = true;
            break;
          }
          // 'present' -> already cached, advance immediately to next frame
        }
      } finally {
        busy = false;
      }
      if (!stopSweep && cursor < order.length && !cancelled) {
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
  }, [currentProject, previewQuality, isPlaying, visibilityPaused]);

  // Playback rAF loop: audio-master clock (or fixed-step without audio) + L2 RAM cache hit path + throttled store sync
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!isPlaying || !currentProject || visibilityPaused || !renderer) {
      renderer?.pauseAllVideos();
      audioEngine.stopPlayback();
      setAudioLevel(0);
      return;
    }

    const initStore = useEditorStore.getState();
    const initScope = resolveActiveGroup(currentProject, initStore.groupStack);
    let playheadMs = initStore.currentTimeMs;
    if (playheadMs >= initScope.durationMs) {
      playheadMs = 0;
      initStore.setCurrentTimeMs(0);
    }

    const hasAudioTrack = audioEngine.hasAudio(currentProject, initScope.layers);
    renderer.syncVideosForPlayback(currentProject, playheadMs, true, initStore.groupStack);
    audioEngine.startPlayback(currentProject, playheadMs, initScope.layers);
    let startSceneMs = playheadMs;
    let startWallMs = performance.now();
    let lastTs = startWallMs;
    let commitTick = 0;
    let consecutiveHits = 0;
    let rafId = 0;

    const tick = (now: number) => {
      const store = useEditorStore.getState();
      const proj = store.currentProject;
      if (!proj || !store.isPlaying || isExportingRef.current) return;

      const rawDt = Math.max(0, now - lastTs);
      lastTs = now;

      if (hasAudioTrack) {
        const audioPos = audioEngine.getPlaybackPositionMs();
        if (audioPos !== null) {
          playheadMs = audioPos;
        } else {
          if (rawDt > 250) startWallMs += rawDt - 16;
          playheadMs = startSceneMs + (now - startWallMs);
        }
      } else {
        // Monotonic real-time clock (never double-counts sub-frame deltas on 60/120Hz displays)
        if (rawDt > 250) startWallMs += rawDt - 16;
        playheadMs = startSceneMs + (now - startWallMs);
      }

      const activeDur = resolveActiveGroup(proj, store.groupStack).durationMs;
      if (playheadMs >= activeDur) {
        if (store.loop) {
          playheadMs = 0;
          startSceneMs = 0;
          startWallMs = now;
          audioEngine.startPlayback(proj, 0, resolveActiveGroup(proj, store.groupStack).layers);
        } else {
          playheadMs = activeDur;
          renderer.syncVideosForPlayback(proj, playheadMs, false, store.groupStack);
          renderer.renderProject(proj, playheadMs, {
            previewScale: store.previewQuality,
            selectedIds: store.selectedLayerIds,
            activeGroupStack: store.groupStack,
            useCache: true,
          });
          store.setCurrentTimeMs(activeDur);
          store.setIsPlaying(false);
          return;
        }
      }

      // ST-2: Hysteresis on pausing live HTMLVideo decoders (pause only after 4 consecutive cache hits)
      const isHit =
        store.groupStack.length === 0 &&
        renderer.hasCachedFrame(proj, playheadMs, store.previewQuality);
      if (isHit) {
        consecutiveHits++;
        if (consecutiveHits >= 4) {
          renderer.pauseAllVideos(true);
        }
      } else {
        consecutiveHits = 0;
        renderer.syncVideosForPlayback(proj, playheadMs, true, store.groupStack);
      }
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
        store.setCurrentTimeMs(resolveActiveGroup(proj, store.groupStack).durationMs);
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
    useEditorStore.getState().showToast(`Pre-rendering ${totalFrames} preview frames…`);
    void (async () => {
      for (let idx = 0; idx < totalFrames; idx++) {
        if (!rendererRef.current || useEditorStore.getState().isPlaying) return;
        const proj = useEditorStore.getState().currentProject;
        if (!proj || proj.id !== currentProject.id) return;
        await rendererRef.current.precacheFrameAsync(proj, idx, previewQuality);
        if (idx % 4 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      useEditorStore.getState().showToast('Preview RAM cache ready');
    })();
  };

  const mobileSheetOpen = layoutMode === 'classic' && selectedLayerIds.length === 1 && inspectorTab !== 'none';

  return (
    <div className="am-editor">
      <EditorActionBar />

      <div className={`am-editor-body ${layoutMode}${mobileSheetOpen ? ' sheet-open' : ''}`}>
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
