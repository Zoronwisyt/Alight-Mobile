import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { AmDialog } from '../components/AmDialog';

export const ProjectSettingsDialog: React.FC = () => {
  const { showProjectSettings, setModal, currentProject, mutateProject } = useEditorStore();
  const [title, setTitle] = useState('');
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [durationSec, setDurationSec] = useState(5);
  const [bgColor, setBgColor] = useState('#FF000000');

  useEffect(() => {
    if (currentProject && showProjectSettings) {
      setTitle(currentProject.title);
      setWidth(currentProject.width);
      setHeight(currentProject.height);
      setFps(currentProject.fps);
      setDurationSec(Number((currentProject.durationMs / 1000).toFixed(2)));
      setBgColor(currentProject.bgColor);
    }
  }, [currentProject, showProjectSettings]);

  if (!currentProject) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    mutateProject((p) => {
      p.title = title.trim() || 'Untitled';
      p.width = Math.max(64, Math.min(3840, width));
      p.height = Math.max(64, Math.min(3840, height));
      p.fps = Math.max(12, Math.min(60, fps));
      p.durationMs = Math.max(500, Math.round(durationSec * 1000));
      p.bgColor = bgColor;
    });
    setModal('showProjectSettings', false);
  };

  return (
    <AmDialog open={showProjectSettings} onClose={() => setModal('showProjectSettings', false)} title="Project Settings">
      <form onSubmit={handleSave}>
        <div className="am-field">
          <label htmlFor="ps-title">Title</label>
          <input id="ps-title" className="am-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="am-field">
            <label htmlFor="ps-w">Width</label>
            <input id="ps-w" type="number" className="am-input" value={width} onChange={(e) => setWidth(Number(e.target.value) || 1080)} />
          </div>
          <div className="am-field">
            <label htmlFor="ps-h">Height</label>
            <input id="ps-h" type="number" className="am-input" value={height} onChange={(e) => setHeight(Number(e.target.value) || 1080)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="am-field">
            <label htmlFor="ps-fps">Frame Rate (FPS)</label>
            <input id="ps-fps" type="number" className="am-input" value={fps} min={12} max={60} onChange={(e) => setFps(Number(e.target.value) || 30)} />
          </div>
          <div className="am-field">
            <label htmlFor="ps-dur">Duration (Seconds)</label>
            <input id="ps-dur" type="number" step="0.1" className="am-input" value={durationSec} min={0.5} onChange={(e) => setDurationSec(Number(e.target.value) || 4)} />
          </div>
        </div>
        <div className="am-field">
          <label>Background</label>
          <div className="am-pill-row">
            {[
              ['Black', '#FF000000'],
              ['Dark Navy', '#FF0E1317'],
              ['White', '#FFFFFFFF'],
              ['Transparent', 'transparent'],
            ].map(([lbl, val]) => (
              <button key={val} type="button" className={`am-pill ${bgColor === val ? 'active' : ''}`} onClick={() => setBgColor(val)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className="am-btn" onClick={() => setModal('showProjectSettings', false)}>Cancel</button>
          <button type="submit" className="am-btn am-btn-primary">Save Settings</button>
        </div>
      </form>
    </AmDialog>
  );
};
