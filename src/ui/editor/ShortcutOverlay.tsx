import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import { AmDialog } from '../components/AmDialog';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Playback & Timeline',
    items: [
      ['Play / Pause', 'Space'],
      ['Jog ±1 Frame', ', / .'],
      ['Jog ±10 Frames', 'Shift+, / Shift+.'],
      ['Jump Start / End', 'Home / End'],
      ['Trim In / Out', 'I / O'],
    ],
  },
  {
    title: 'Layers & Transform',
    items: [
      ['Duplicate Layer', `${MOD}+D`],
      ['Delete Layer', 'Delete / Backspace'],
      ['Copy / Paste Layer', `${MOD}+C / ${MOD}+V`],
      ['Undo / Redo', `${MOD}+Z / ${MOD}+Shift+Z`],
      ['Group / Ungroup', `${MOD}+G / ${MOD}+Shift+G`],
      ['Nudge 1px / 10px', 'Arrows / Shift+Arrows'],
    ],
  },
  {
    title: 'Panels, Stage & Export',
    items: [
      ['Toggle Effects Panel', 'E'],
      ['Add Effect Browser', `${MOD}+E`],
      ['Zoom Fit / 100%', 'F / 0'],
      ['Zoom In / Out', '+ / -'],
      ['Toggle Safe Grid', 'G'],
      ['Export Dialog', `${MOD}+Shift+E`],
      ['Shortcut Overlay / Close', '? / Esc'],
    ],
  },
];

export const ShortcutOverlay: React.FC = () => {
  const { showShortcutOverlay, setShowShortcutOverlay, density, setDensity, uiScale, setUiScale } = useEditorStore(
    useShallow((s) => ({
      showShortcutOverlay: s.showShortcutOverlay,
      setShowShortcutOverlay: s.setShowShortcutOverlay,
      density: s.density,
      setDensity: s.setDensity,
      uiScale: s.uiScale,
      setUiScale: s.setUiScale,
    }))
  );

  return (
    <AmDialog
      open={showShortcutOverlay}
      onClose={() => setShowShortcutOverlay(false)}
      title="Keyboard Shortcuts & Desktop Density"
      wide
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--am-a1)',
            border: '1px solid var(--am-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--am-text-secondary)' }}>Density:</span>
            <button
              type="button"
              className={`am-pill ${density === 'compact' ? 'active' : ''}`}
              onClick={() => setDensity('compact')}
            >
              Compact
            </button>
            <button
              type="button"
              className={`am-pill ${density === 'comfortable' ? 'active' : ''}`}
              onClick={() => setDensity('comfortable')}
            >
              Comfortable
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--am-text-secondary)' }}>
              UI Scale ({Math.round(uiScale * 100)}%):
            </span>
            {[0.9, 1, 1.1, 1.15, 1.25].map((sc) => (
              <button
                key={sc}
                type="button"
                className={`am-pill ${Math.abs(uiScale - sc) < 0.02 ? 'active' : ''}`}
                onClick={() => setUiScale(sc)}
              >
                {sc}×
              </button>
            ))}
          </div>
        </div>

        <div className="am-shortcut-grid">
          {GROUPS.map((g) => (
            <div key={g.title} className="am-shortcut-card">
              <div className="am-shortcut-title">{g.title}</div>
              {g.items.map(([label, keys]) => (
                <div key={label} className="am-shortcut-row">
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AmDialog>
  );
};
