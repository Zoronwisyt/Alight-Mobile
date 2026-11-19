import React, { useRef, useState } from 'react';
import { downloadGoogleFamily } from '../../engine/fontDownload';
import { weightToLabel } from '../../engine/fontNames';
import {
  getRegisteredFamilies,
  type MissingFontEntry,
} from '../../engine/fontRegistry';
import { importFontFile, parseSfntMetadata } from '../../store/fontStore';
import { useEditorStore } from '../../store/useEditorStore';

interface MissingFontsDialogProps {
  projectTitle: string;
  missing: MissingFontEntry[];
  onResolved: () => void;
  onClose: () => void;
}

export const MissingFontsDialog: React.FC<MissingFontsDialogProps> = ({
  projectTitle,
  missing,
  onResolved,
  onClose,
}) => {
  const { mutateProject, showToast } = useEditorStore();
  const [rowStatus, setRowStatus] = useState<Record<string, string>>({});
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [mismatchPrompt, setMismatchPrompt] = useState<{
    requestedFamily: string;
    detectedFamily: string;
    file: File;
  } | null>(null);
  const locateTargetRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const registeredFamilies = getRegisteredFamilies();

  const handleDownloadOne = async (entry: MissingFontEntry) => {
    setRowStatus((s) => ({ ...s, [entry.family]: 'Downloading…' }));
    const res = await downloadGoogleFamily(entry.family, entry.weights, entry.styles);
    if (res.ok) {
      setRowStatus((s) => ({ ...s, [entry.family]: 'Installed' }));
      onResolved();
    } else {
      setRowStatus((s) => ({ ...s, [entry.family]: `Download failed — retry (${res.error || 'offline'})` }));
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    const downloadable = missing.filter((m) => m.inCatalog);
    await Promise.allSettled(downloadable.map((entry) => handleDownloadOne(entry)));
    setDownloadingAll(false);
  };

  const handleSubstitute = (missingFamily: string, subFamily: string) => {
    if (!subFamily) return;
    mutateProject((p) => {
      if (!p.fontSubstitutions) p.fontSubstitutions = {};
      p.fontSubstitutions[missingFamily] = subFamily;
    });
    showToast(`Substituted "${missingFamily}" → "${subFamily}"`);
    onResolved();
  };

  const handleUseAllSubstitutes = () => {
    const fallback = registeredFamilies.includes('Roboto')
      ? 'Roboto'
      : registeredFamilies[0] || 'Roboto';
    mutateProject((p) => {
      if (!p.fontSubstitutions) p.fontSubstitutions = {};
      for (const m of missing) {
        if (!p.fontSubstitutions[m.family]) {
          p.fontSubstitutions[m.family] = fallback;
        }
      }
    });
    showToast(`Substituted ${missing.length} missing font(s) with ${fallback}`);
    onResolved();
    onClose();
  };

  const handleLocateFile = async (file: File) => {
    const requested = locateTargetRef.current;
    if (!requested) return;
    const buf = await file.arrayBuffer();
    const meta = parseSfntMetadata(buf, file.name);
    if (meta.family.toLowerCase() !== requested.toLowerCase()) {
      setMismatchPrompt({ requestedFamily: requested, detectedFamily: meta.family, file });
      return;
    }
    const res = await importFontFile(file, requested);
    if (res.ok) {
      showToast(`Installed "${requested}" from ${file.name}`);
      onResolved();
    } else {
      setRowStatus((s) => ({ ...s, [requested]: res.error || 'Import failed' }));
    }
  };

  const handleConfirmMismatchImport = async () => {
    if (!mismatchPrompt) return;
    const res = await importFontFile(mismatchPrompt.file, mismatchPrompt.requestedFamily);
    if (res.ok) {
      showToast(`Imported "${mismatchPrompt.detectedFamily}" as "${mismatchPrompt.requestedFamily}"`);
      setMismatchPrompt(null);
      onResolved();
    } else {
      showToast(res.error || 'Import failed');
      setMismatchPrompt(null);
    }
  };

  const downloadableCount = missing.filter((m) => m.inCatalog).length;

  return (
    <div className="am-modal-backdrop" onClick={onClose}>
      <div
        className="am-modal-sheet"
        style={{ maxWidth: 520, width: '94vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="am-modal-header">
          <strong>Missing Fonts ({missing.length})</strong>
          <button type="button" className="am-icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--am-text-dim)', borderBottom: '1px solid var(--am-border)' }}>
          <div>
            <strong>{missing.length}</strong> {missing.length === 1 ? 'font' : 'fonts'} used in{' '}
            <strong>&ldquo;{projectTitle}&rdquo;</strong> {missing.length === 1 ? 'is' : 'are'} not installed.
            Preview falls back to Roboto until resolved.
          </div>
          <div style={{ fontSize: 10, color: 'var(--am-text-muted)', marginTop: 4 }}>
            Downloaded and imported fonts are cached locally in this browser (IndexedDB), not installed to your OS.
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,.ttc"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleLocateFile(f);
            e.target.value = '';
          }}
        />

        {mismatchPrompt && (
          <div
            style={{
              margin: '10px 14px 0',
              padding: 10,
              borderRadius: 8,
              background: 'rgba(255, 196, 61, 0.12)',
              border: '1px solid rgba(255, 196, 61, 0.45)',
              fontSize: 12,
            }}
          >
            <div>
              File family is <strong>{mismatchPrompt.detectedFamily}</strong>, but project expects{' '}
              <strong>{mismatchPrompt.requestedFamily}</strong>.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="am-btn am-btn-accent" onClick={handleConfirmMismatchImport}>
                Import anyway as &ldquo;{mismatchPrompt.requestedFamily}&rdquo;
              </button>
              <button type="button" className="am-btn" onClick={() => setMismatchPrompt(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {missing.map((entry) => {
            const status = rowStatus[entry.family];
            const weightSummary = entry.weights.map(weightToLabel).join(', ');
            return (
              <div
                key={entry.family}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  background: 'var(--am-surface)',
                  border: '1px solid var(--am-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{entry.family}</div>
                    <div style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>
                      {weightSummary} · {entry.layerIds.length} {entry.layerIds.length === 1 ? 'layer' : 'layers'}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: '"Roboto", sans-serif',
                      fontSize: 13,
                      color: 'var(--am-text-dim)',
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title="Current fallback preview"
                  >
                    {entry.sampleText}
                  </div>
                </div>

                {status && (
                  <div
                    style={{
                      fontSize: 11,
                      color: status.startsWith('Download failed') ? '#FF6B81' : 'var(--am-accent)',
                    }}
                  >
                    {status}
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {entry.inCatalog && (
                    <button
                      type="button"
                      className="am-btn am-btn-accent"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      disabled={status === 'Downloading…' || downloadingAll}
                      onClick={() => handleDownloadOne(entry)}
                    >
                      {status?.startsWith('Download failed') ? 'Retry Download' : 'Download'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="am-btn"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    onClick={() => {
                      locateTargetRef.current = entry.family;
                      fileInputRef.current?.click();
                    }}
                  >
                    Locate file…
                  </button>
                  <select
                    className="am-select"
                    style={{ fontSize: 11, padding: '4px 8px', flex: 1, minWidth: 120 }}
                    defaultValue=""
                    onChange={(e) => handleSubstitute(entry.family, e.target.value)}
                  >
                    <option value="" disabled>
                      Substitute with…
                    </option>
                    {registeredFamilies.map((fam) => (
                      <option key={fam} value={fam}>
                        {fam}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--am-border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          {downloadableCount > 0 && (
            <button
              type="button"
              className="am-btn am-btn-accent"
              disabled={downloadingAll}
              onClick={handleDownloadAll}
            >
              {downloadingAll ? 'Downloading…' : `Download all (${downloadableCount})`}
            </button>
          )}
          <button type="button" className="am-btn" onClick={handleUseAllSubstitutes}>
            Use substitutes
          </button>
          <button type="button" className="am-btn" onClick={onClose}>
            Ignore
          </button>
        </div>
      </div>
    </div>
  );
};
