import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import JSZip from 'jszip';
import { exportProjectToAmXml } from '../../engine/amXmlCodec';
import { encodeAnimatedGif } from '../../engine/gifEncoder';
import type { AlightRenderer } from '../../engine/renderer';
import { exportProjectVideo, isWebCodecsExportSupported, type VideoContainer } from '../../engine/videoExporter';
import { useEditorStore } from '../../store/useEditorStore';
import { AmDialog } from '../components/AmDialog';
import { AmIcon } from '../components/AmIcon';

interface ExportDialogProps {
  rendererRef: React.RefObject<AlightRenderer | null>;
  isExportingRef: React.MutableRefObject<boolean>;
}

type ExportFormat = 'video' | 'gif' | 'png' | 'seq' | 'xml' | 'json';

const EXPORT_FPS_CHOICES = [24, 25, 30, 50, 60];

function makeEven(n: number): number {
  return Math.max(16, Math.round(n / 2) * 2);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ rendererRef, isExportingRef }) => {
  const { showExportDialog, setModal, currentProject, currentTimeMs, setIsPlaying } = useEditorStore(
    useShallow((s) => ({
      showExportDialog: s.showExportDialog,
      setModal: s.setModal,
      currentProject: s.currentProject,
      currentTimeMs: s.currentTimeMs,
      setIsPlaying: s.setIsPlaying,
    }))
  );
  const [format, setFormat] = useState<ExportFormat>('video');
  const [container, setContainer] = useState<VideoContainer>('mp4');
  const [exportFps, setExportFps] = useState(30);
  const [exportScale, setExportScale] = useState(1);
  const [qualityMbps, setQualityMbps] = useState(12);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [includeVideoAudio, setIncludeVideoAudio] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressLabel, setProgressLabel] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (showExportDialog && currentProject) {
      setExportFps(currentProject.fps);
      setStatusMsg('');
    }
  }, [showExportDialog, currentProject?.id, currentProject?.fps]);

  if (!currentProject) return null;
  const safeSlug = currentProject.title.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'alight_project';
  const outW = makeEven(currentProject.width * exportScale);
  const outH = makeEven(currentProject.height * exportScale);
  const previewRestoreScale = Math.max(currentProject.width, currentProject.height) > 1440 ? 0.5 : 0.75;

  const cancelExport = () => {
    abortRef.current?.abort();
  };

  const runExport = async () => {
    const renderer = rendererRef.current;
    setIsPlaying(false);
    setStatusMsg('');
    setProgressLabel('');

    try {
      if (format === 'xml') {
        const xml = exportProjectToAmXml(currentProject);
        downloadBlob(new Blob([xml], { type: 'application/xml' }), `${safeSlug}.xml`);
        setStatusMsg('Exported Alight Motion .xml project!');
        return;
      }

      if (format === 'json') {
        const json = JSON.stringify(currentProject, null, 2);
        downloadBlob(new Blob([json], { type: 'application/json' }), `${safeSlug}.amweb.json`);
        setStatusMsg('Exported lossless .amweb.json backup!');
        return;
      }

      if (!renderer) throw new Error('Renderer not ready.');

      isExportingRef.current = true;
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        if (format === 'png') {
          await renderer.prepareMediaAtTime(currentProject, currentTimeMs);
          renderer.renderProject(currentProject, currentTimeMs, { renderWidth: outW, renderHeight: outH });
          const blob = await renderer.captureFrameBlob();
          downloadBlob(blob, `${safeSlug}_${outW}x${outH}_frame.png`);
          setStatusMsg(`Exported ${outW}×${outH} PNG frame!`);
          return;
        }

        const fps = Math.max(12, Math.min(120, Math.round(exportFps || currentProject.fps)));
        const totalFrames = Math.max(1, Math.round((currentProject.durationMs / 1000) * fps));

        if (format === 'seq') {
          const zip = new JSZip();
          setProgress(0);
          for (let f = 0; f < totalFrames; f++) {
            if (ctrl.signal.aborted) throw new Error('Export cancelled.');
            const tMs = (f * 1000) / fps;
            await renderer.prepareMediaAtTime(currentProject, tMs);
            renderer.renderProject(currentProject, tMs, { renderWidth: outW, renderHeight: outH });
            const blob = await renderer.captureFrameBlob();
            zip.file(`frame_${String(f).padStart(4, '0')}.png`, blob);
            setProgress((f + 1) / totalFrames);
            setProgressLabel(`Rendering PNG ${f + 1} / ${totalFrames} (${outW}×${outH} @ ${fps} fps)`);
            if (f % 4 === 0) await new Promise((r) => setTimeout(r, 0));
          }
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          downloadBlob(zipBlob, `${safeSlug}_${fps}fps_sequence.zip`);
          setProgress(null);
          setStatusMsg(`Exported ${totalFrames} PNG frames (${outW}×${outH} @ ${fps} fps)!`);
          return;
        }

        if (format === 'gif') {
          setProgress(0);
          const gifFps = Math.min(50, Math.max(10, fps));
          const gifFrames = Math.max(1, Math.round((currentProject.durationMs / 1000) * gifFps));
          const maxDim = 480;
          const sc = Math.min(1, maxDim / Math.max(currentProject.width, currentProject.height));
          const gw = makeEven(currentProject.width * sc);
          const gh = makeEven(currentProject.height * sc);
          const tmp = document.createElement('canvas');
          tmp.width = gw;
          tmp.height = gh;
          const ctx = tmp.getContext('2d', { willReadFrequently: true })!;
          const framesData: ImageData[] = [];

          for (let f = 0; f < gifFrames; f++) {
            if (ctrl.signal.aborted) throw new Error('Export cancelled.');
            const tMs = (f * 1000) / gifFps;
            await renderer.prepareMediaAtTime(currentProject, tMs);
            renderer.renderProject(currentProject, tMs, { renderWidth: gw, renderHeight: gh });
            ctx.clearRect(0, 0, gw, gh);
            ctx.drawImage(renderer.canvas, 0, 0, gw, gh);
            framesData.push(ctx.getImageData(0, 0, gw, gh));
            setProgress((f + 1) / gifFrames);
            setProgressLabel(`Encoding GIF frame ${f + 1} / ${gifFrames} (${gifFps} fps)`);
            await new Promise((r) => setTimeout(r, 0));
          }

          const gifBlob = encodeAnimatedGif(framesData, 100 / gifFps, gw, gh);
          downloadBlob(gifBlob, `${safeSlug}_${gifFps}fps.gif`);
          setProgress(null);
          setStatusMsg(`Exported ${gw}×${gh} GIF @ ${gifFps} fps (${gifFrames} frames)!`);
          return;
        }

        if (format === 'video') {
          setProgress(0);
          setProgressLabel(`Initializing ${container.toUpperCase()} encoder (${outW}×${outH} @ ${fps} fps)...`);
          const res = await exportProjectVideo(renderer, currentProject, {
            fps,
            width: outW,
            height: outH,
            bitrateMbps: qualityMbps,
            container,
            includeAudio,
            includeVideoAudio,
            signal: ctrl.signal,
            onProgress: (fraction, label) => {
              setProgress(fraction);
              setProgressLabel(label);
            },
          });
          downloadBlob(res.blob, `${safeSlug}_${res.width}x${res.height}_${res.fps}fps.${res.ext}`);
          setProgress(null);
          setStatusMsg(
            `Exported ${res.ext.toUpperCase()}: ${res.width}×${res.height} @ ${res.fps} fps (${res.totalFrames} frames, ${res.actualBitrateMbps} Mbps actual / ${res.bitrateMbps} Mbps target, ${res.codec}${res.hasAudio ? ' + Audio' : ''})`
          );
        }
      } finally {
        abortRef.current = null;
        isExportingRef.current = false;
        renderer.renderProject(currentProject, currentTimeMs, { previewScale: previewRestoreScale });
      }
    } catch (err) {
      setProgress(null);
      setProgressLabel('');
      setStatusMsg(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  return (
    <AmDialog open={showExportDialog} onClose={() => progress === null && setModal('showExportDialog', false)} title="Export Project">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(
          [
            ['video', 'Video (MP4 / WebM)', 'ic_export_video', 'Exact CFR WebCodecs export with effects & curves'],
            ['gif', 'Animated GIF', 'ic_export_gif', 'Looping 256-color animated GIF'],
            ['png', 'Current Frame (PNG)', 'ic_export_currentframe', 'Lossless still frame at playhead'],
            ['seq', 'Image Sequence (PNG ZIP)', 'ic_export_imagesequence', 'Every frame packaged as PNG files'],
            ['xml', 'XML Project (.xml)', 'ic_export_xml', 'Alight Motion native XML scene format'],
            ['json', 'Studio Backup (.amweb.json)', 'ic_export_package', 'Full lossless project archive'],
          ] as [ExportFormat, string, string, string][]
        ).map(([fid, lbl, icon, desc]) => (
          <button
            key={fid}
            type="button"
            disabled={progress !== null}
            onClick={() => setFormat(fid)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 12,
              textAlign: 'left',
              background: format === fid ? 'rgba(0,255,168,0.14)' : 'var(--am-a1)',
              border: `1px solid ${format === fid ? 'var(--am-accent)' : 'var(--am-border)'}`,
            }}
          >
            <AmIcon name={icon} fallback="export" size={24} color={format === fid ? 'var(--am-accent)' : 'var(--am-text-secondary)'} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{lbl}</div>
              <div style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>{desc}</div>
            </div>
            <AmIcon name="ic_export_arrow_right" fallback="next" size={16} />
          </button>
        ))}

        {format === 'video' && !isWebCodecsExportSupported() && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(255, 196, 61, 0.14)',
              border: '1px solid rgba(255, 196, 61, 0.45)',
              fontSize: 11,
              color: '#FFD166',
            }}
          >
            WebCodecs is unavailable in this browser. Export will fall back to real-time MediaRecorder (audio omitted; complex scenes may drop frames). Use Chrome, Edge, or Safari 17+ for deterministic CFR MP4 export.
          </div>
        )}

        {(format === 'video' || format === 'png' || format === 'seq' || format === 'gif') && (
          <div style={{ background: 'var(--am-a1)', padding: 12, borderRadius: 12, border: '1px solid var(--am-border)' }}>
            {format !== 'gif' && (
              <div className="am-field" style={{ marginBottom: 10 }}>
                <label>
                  Resolution ({outW} × {outH})
                </label>
                <div className="am-pill-row">
                  {[0.5, 0.75, 1].map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      disabled={progress !== null}
                      className={`am-pill ${exportScale === sc ? 'active' : ''}`}
                      onClick={() => setExportScale(sc)}
                    >
                      {Math.round(sc * 100)}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(format === 'video' || format === 'seq' || format === 'gif') && (
              <div className="am-field" style={{ marginBottom: format === 'video' ? 10 : 0 }}>
                <label>Frame Rate ({exportFps} fps — exact constant frame rate)</label>
                <div className="am-pill-row">
                  {EXPORT_FPS_CHOICES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      disabled={progress !== null}
                      className={`am-pill ${exportFps === f ? 'active' : ''}`}
                      onClick={() => setExportFps(f)}
                    >
                      {f} fps{f === currentProject.fps ? ' •' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {format === 'video' && (
              <>
                <div className="am-field" style={{ marginBottom: 10 }}>
                  <label>Container & Codec</label>
                  <div className="am-pill-row">
                    <button
                      type="button"
                      disabled={progress !== null}
                      className={`am-pill ${container === 'mp4' ? 'active' : ''}`}
                      onClick={() => setContainer('mp4')}
                    >
                      MP4 (H.264)
                    </button>
                    <button
                      type="button"
                      disabled={progress !== null}
                      className={`am-pill ${container === 'webm' ? 'active' : ''}`}
                      onClick={() => setContainer('webm')}
                    >
                      WebM (VP9)
                    </button>
                  </div>
                </div>

                <div className="am-field" style={{ marginBottom: 10 }}>
                  <label htmlFor="export-bitrate">Bitrate Quality ({qualityMbps} Mbps)</label>
                  <input
                    id="export-bitrate"
                    name="exportBitrate"
                    type="range"
                    className="am-export-range"
                    min={2}
                    max={100}
                    step={1}
                    disabled={progress !== null}
                    value={qualityMbps}
                    onInput={(e) => setQualityMbps(Number((e.target as HTMLInputElement).value))}
                    onChange={(e) => setQualityMbps(Number(e.target.value))}
                    onPointerDown={(e) => {
                      if (progress !== null) return;
                      const el = e.currentTarget;
                      const updateFromClientX = (clientX: number) => {
                        const rect = el.getBoundingClientRect();
                        const pad = 11;
                        const span = Math.max(1, rect.width - pad * 2);
                        const frac = Math.max(0, Math.min(1, (clientX - (rect.left + pad)) / span));
                        setQualityMbps(Math.round(2 + frac * 98));
                      };
                      el.setPointerCapture(e.pointerId);
                      updateFromClientX(e.clientX);
                      const onMove = (ev: PointerEvent) => updateFromClientX(ev.clientX);
                      const onUp = () => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        window.removeEventListener('pointercancel', onUp);
                      };
                      window.addEventListener('pointermove', onMove);
                      window.addEventListener('pointerup', onUp);
                      window.addEventListener('pointercancel', onUp);
                    }}
                    style={{ '--range-pct': `${((qualityMbps - 2) / 98) * 100}%` } as React.CSSProperties}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    {[12, 40, 100].map((mbps) => (
                      <button
                        key={mbps}
                        type="button"
                        disabled={progress !== null}
                        className={`am-pill ${qualityMbps === mbps ? 'active' : ''}`}
                        onClick={() => setQualityMbps(mbps)}
                        title={mbps === 100 ? 'Mastering ceiling — 100 Mbps' : undefined}
                      >
                        {mbps} Mbps
                      </button>
                    ))}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--am-text-muted)' }}>
                      ≈ {((qualityMbps * Math.max(0.1, currentProject.durationMs / 1000)) / 8).toFixed(1)} MB
                    </span>
                  </div>
                </div>

                <label
                  htmlFor="export-include-audio"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--am-text-secondary)', cursor: 'pointer' }}
                >
                  <input
                    id="export-include-audio"
                    name="exportIncludeAudio"
                    type="checkbox"
                    disabled={progress !== null}
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                    style={{ accentColor: 'var(--am-accent)' }}
                  />
                  Include Audio Track (AAC / Opus)
                </label>

                {includeAudio && (
                  <label
                    htmlFor="export-include-video-audio"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--am-text-secondary)', cursor: 'pointer', marginTop: 6 }}
                  >
                    <input
                      id="export-include-video-audio"
                      name="exportIncludeVideoAudio"
                      type="checkbox"
                      disabled={progress !== null}
                      checked={includeVideoAudio}
                      onChange={(e) => setIncludeVideoAudio(e.target.checked)}
                      style={{ accentColor: 'var(--am-accent)' }}
                    />
                    Include Unmuted Video Layer Audio
                  </label>
                )}
              </>
            )}
          </div>
        )}

        {progress !== null && (
          <div style={{ background: 'var(--am-a11)', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              {progressLabel || `Rendering... ${Math.round(progress * 100)}%`}
            </div>
            <div style={{ height: 6, background: 'var(--am-a6)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, progress * 100)}%`, height: '100%', background: 'var(--am-accent-grad)' }} />
            </div>
          </div>
        )}

        {statusMsg && (
          <div style={{ fontSize: 12, color: 'var(--am-accent)', fontWeight: 600 }}>{statusMsg}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {progress !== null ? (
            <button type="button" className="am-btn" onClick={cancelExport}>
              Cancel
            </button>
          ) : (
            <button type="button" className="am-btn" onClick={() => setModal('showExportDialog', false)}>
              Close
            </button>
          )}
          <button type="button" className="am-btn am-btn-primary" disabled={progress !== null} onClick={runExport}>
            EXPORT
          </button>
        </div>
      </div>
    </AmDialog>
  );
};
