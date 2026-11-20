import React, { useEffect, useState } from 'react';
import { ensureCatalogLoaded } from './engine/catalog';
import { initFontRegistry } from './engine/fontRegistry';
import { hydrateUserFonts } from './store/fontStore';
import { useEditorStore } from './store/useEditorStore';
import { EditorScreen } from './ui/editor/EditorScreen';
import { HomeScreen } from './ui/HomeScreen';

export const App: React.FC = () => {
  const screen = useEditorStore((s) => s.screen);
  const initApp = useEditorStore((s) => s.initApp);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // F-1: Request persistent browser storage at boot so IndexedDB user fonts & media resist eviction
    navigator.storage?.persist?.().catch(() => {});
    // MO-9: Track visualViewport height (--vvh) so mobile on-screen keyboards don't shove layout off-screen
    const syncVvh = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`);
    };
    syncVvh();
    window.visualViewport?.addEventListener('resize', syncVvh);
    window.visualViewport?.addEventListener('scroll', syncVvh);
    Promise.all([
      ensureCatalogLoaded(),
      initApp(),
      initFontRegistry().then(() => hydrateUserFonts()),
    ]).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [initApp]);

  if (!ready) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          background: 'var(--am-bg-gradient)',
        }}
      >
        <div className="am-brand-badge" style={{ width: 52, height: 52, fontSize: 24, borderRadius: 14 }}>
          A
        </div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Alight Motion Web Studio</div>
        <div style={{ fontSize: 12, color: 'var(--am-text-muted)' }}>
          Loading 315 shaders, 250 presets &amp; 20 procedural shapes...
        </div>
      </div>
    );
  }

  return screen === 'editor' ? <EditorScreen /> : <HomeScreen />;
};

export default App;
