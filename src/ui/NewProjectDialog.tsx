import React, { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { AmDialog } from './components/AmDialog';

const ASPECT_PRESETS = [
  { id: '16:9', label: '16:9', rw: 16, rh: 9 },
  { id: '9:16', label: '9:16', rw: 9, rh: 16 },
  { id: '4:5', label: '4:5', rw: 4, rh: 5 },
  { id: '1:1', label: '1:1', rw: 1, rh: 1 },
  { id: '4:3', label: '4:3', rw: 4, rh: 3 },
  { id: '2.35:1', label: '2.35:1', rw: 235, rh: 100 },
  { id: 'custom', label: 'Custom', rw: 1, rh: 1 },
];

const RESOLUTIONS = [
  { label: '2160p (4K)', base: 2160 },
  { label: '1080p (FHD)', base: 1080 },
  { label: '720p (HD)', base: 720 },
  { label: '540p', base: 540 },
  { label: '360p', base: 360 },
];

const FPS_OPTIONS = [60, 50, 30, 25, 24, 15, 12];

const BG_PRESETS = [
  { label: 'Black', value: '#FF000000' },
  { label: 'Dark Navy', value: '#FF0E1317' },
  { label: 'White', value: '#FFFFFFFF' },
  { label: 'Light Gray', value: '#FFD8D8D8' },
  { label: 'Transparent', value: 'transparent' },
];

export const NewProjectDialog: React.FC = () => {
  const open = useEditorStore((s) => s.showNewProjectDialog);
  const setModal = useEditorStore((s) => s.setModal);
  const createProject = useEditorStore((s) => s.createProject);

  const [title, setTitle] = useState('New Project');
  const [aspectId, setAspectId] = useState('9:16');
  const [resBase, setResBase] = useState(1080);
  const [customW, setCustomW] = useState(1080);
  const [customH, setCustomH] = useState(1920);
  const [fps, setFps] = useState(30);
  const [bgColor, setBgColor] = useState('#FF000000');

  const computeDims = (): [number, number] => {
    if (aspectId === 'custom') return [Math.max(64, customW), Math.max(64, customH)];
    const asp = ASPECT_PRESETS.find((a) => a.id === aspectId) ?? ASPECT_PRESETS[1];
    if (asp.rw >= asp.rh) {
      const h = resBase;
      const w = Math.round((resBase * asp.rw) / asp.rh / 2) * 2;
      return [w, h];
    } else {
      const w = resBase;
      const h = Math.round((resBase * asp.rh) / asp.rw / 2) * 2;
      return [w, h];
    }
  };

  const [w, h] = computeDims();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createProject({ title, width: w, height: h, fps, bgColor });
  };

  return (
    <AmDialog open={open} onClose={() => setModal('showNewProjectDialog', false)} title="Create Project">
      <form onSubmit={handleSubmit}>
        <div className="am-field">
          <label htmlFor="proj-title">Project Name</label>
          <input
            id="proj-title"
            className="am-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My Motion Edit"
            autoFocus
          />
        </div>

        <div className="am-field">
          <label>Aspect Ratio ({w} × {h})</label>
          <div className="am-pill-row">
            {ASPECT_PRESETS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`am-pill ${aspectId === a.id ? 'active' : ''}`}
                onClick={() => setAspectId(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {aspectId === 'custom' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="am-field">
              <label htmlFor="cw">Width (px)</label>
              <input id="cw" type="number" className="am-input" value={customW} min={64} max={3840} onChange={(e) => setCustomW(Number(e.target.value) || 1080)} />
            </div>
            <div className="am-field">
              <label htmlFor="ch">Height (px)</label>
              <input id="ch" type="number" className="am-input" value={customH} min={64} max={3840} onChange={(e) => setCustomH(Number(e.target.value) || 1080)} />
            </div>
          </div>
        ) : (
          <div className="am-field">
            <label htmlFor="proj-res">Resolution</label>
            <select id="proj-res" className="am-select" value={resBase} onChange={(e) => setResBase(Number(e.target.value))}>
              {RESOLUTIONS.map((r) => (
                <option key={r.base} value={r.base}>{r.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="am-field">
          <label>Frame Rate</label>
          <div className="am-pill-row">
            {FPS_OPTIONS.map((f) => (
              <button key={f} type="button" className={`am-pill ${fps === f ? 'active' : ''}`} onClick={() => setFps(f)}>
                {f} fps
              </button>
            ))}
          </div>
        </div>

        <div className="am-field">
          <label>Background</label>
          <div className="am-pill-row">
            {BG_PRESETS.map((bg) => (
              <button
                key={bg.value}
                type="button"
                className={`am-pill ${bgColor === bg.value ? 'active' : ''}`}
                onClick={() => setBgColor(bg.value)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span
                  className={bg.value === 'transparent' ? 'am-checker-bg' : ''}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: bg.value === 'transparent' ? undefined : `#${bg.value.slice(3)}`,
                    border: '1px solid var(--am-border-strong)',
                  }}
                />
                {bg.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" className="am-btn" onClick={() => setModal('showNewProjectDialog', false)}>
            Cancel
          </button>
          <button type="submit" className="am-btn am-btn-primary">
            CREATE PROJECT
          </button>
        </div>
      </form>
    </AmDialog>
  );
};
