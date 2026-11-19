import React, { useEffect, useMemo, useRef, useState } from 'react';
import { downloadGoogleFamily } from '../../engine/fontDownload';
import { humaniseFamily, weightToLabel } from '../../engine/fontNames';
import {
  getCatalogFamilies,
  getRegisteredFacesForFamily,
  isFaceRegistered,
  onFontEpochChange,
  type FaceStyle,
} from '../../engine/fontRegistry';
import {
  deleteUserFont,
  getUserFonts,
  importFontFile,
  onUserFontsChange,
  type UserFontMeta,
} from '../../store/fontStore';
import { useEditorStore } from '../../store/useEditorStore';
import type { Layer } from '../../types/project';

interface FontPickerModalProps {
  currentFamily: string;
  currentWeight: number;
  currentItalic: boolean;
  sampleText: string;
  onSelect: (family: string, weight: number, italic: boolean) => void;
  onClose: () => void;
  onFontDeleted?: () => void;
}

function collectProjectFonts(layers: Layer[], out: Set<string>): void {
  for (const l of layers) {
    if (l.type === 'text' && l.textData) {
      out.add(humaniseFamily(l.textData.fontFamily));
    }
    if (l.groupLayers?.length) collectProjectFonts(l.groupLayers, out);
  }
}

export const FontPickerModal: React.FC<FontPickerModalProps> = ({
  currentFamily,
  currentWeight,
  currentItalic,
  sampleText,
  onSelect,
  onClose,
  onFontDeleted,
}) => {
  const { currentProject, showToast } = useEditorStore();
  const [search, setSearch] = useState('');
  const [expandedFamily, setExpandedFamily] = useState<string | null>(humaniseFamily(currentFamily));
  const [downloadingFam, setDownloadingFam] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const u1 = onFontEpochChange(() => setTick((t) => t + 1));
    const u2 = onUserFontsChange(() => setTick((t) => t + 1));
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const sample = (sampleText || 'Sample text').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Aa Bb Cc';
  const q = search.trim().toLowerCase();

  const projectFamilies = useMemo(() => {
    const set = new Set<string>();
    if (currentProject) collectProjectFonts(currentProject.layers, set);
    return Array.from(set)
      .filter((f) => !q || f.toLowerCase().includes(q))
      .sort();
  }, [currentProject, q]);

  const userFonts = getUserFonts();
  const userByFamily = useMemo(() => {
    const map = new Map<string, UserFontMeta[]>();
    for (const u of userFonts) {
      if (q && !u.family.toLowerCase().includes(q)) continue;
      const list = map.get(u.family) ?? [];
      list.push(u);
      map.set(u.family, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [userFonts, q]);

  const catalogFamilies = useMemo(() => {
    return getCatalogFamilies()
      .filter((c) => !q || c.family.toLowerCase().includes(q))
      .slice(0, 50);
  }, [q]);

  const handleFiles = async (files: FileList | File[]) => {
    setImportError(null);
    const arr = Array.from(files);
    let imported = 0;
    let lastMeta: UserFontMeta | undefined;
    for (const file of arr) {
      const res = await importFontFile(file);
      if (!res.ok) {
        setImportError(`${file.name}: ${res.error || 'Import failed'}`);
      } else {
        imported++;
        lastMeta = res.meta;
        if (res.warning) showToast(res.warning);
      }
    }
    if (imported > 0 && lastMeta) {
      showToast(imported === 1 ? `Imported "${lastMeta.family}"` : `Imported ${imported} fonts`);
      setExpandedFamily(lastMeta.family);
    }
  };

  const handleDownloadAndApply = async (family: string, weight: number, style: FaceStyle) => {
    if (isFaceRegistered(family, weight, style)) {
      onSelect(family, weight, style === 'italic');
      onClose();
      return;
    }
    setDownloadingFam(`${family}|${weight}|${style}`);
    const res = await downloadGoogleFamily(family, [weight], [style]);
    setDownloadingFam(null);
    if (res.ok) {
      onSelect(family, weight, style === 'italic');
      onClose();
    } else {
      showToast(`Download failed for ${family}: ${res.error || 'Offline'}`);
    }
  };

  const handleDeleteUserFont = async (meta: UserFontMeta) => {
    await deleteUserFont(meta.id);
    showToast(`Removed "${meta.family}" (${weightToLabel(meta.weight)})`);
    onFontDeleted?.();
  };

  const renderFamilyRow = (
    family: string,
    weights: number[],
    styles: FaceStyle[],
    thumbs?: Record<string, string>,
    userItems?: UserFontMeta[]
  ) => {
    const isExpanded = expandedFamily === family;
    const isCurrent = humaniseFamily(currentFamily).toLowerCase() === family.toLowerCase();
    const regFaces = getRegisteredFacesForFamily(family);
    const hasLoaded = regFaces.length > 0;
    const defaultThumb =
      thumbs?.['400|normal'] || thumbs?.['700|normal'] || Object.values(thumbs || {})[0];

    return (
      <div
        key={family}
        style={{
          borderBottom: '1px solid var(--am-border)',
          background: isCurrent ? 'rgba(0, 212, 170, 0.08)' : 'transparent',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            cursor: 'pointer',
          }}
          onClick={() => setExpandedFamily(isExpanded ? null : family)}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: isCurrent ? 'var(--am-accent)' : 'var(--am-text)',
                }}
              >
                {family}
              </span>
              <span style={{ fontSize: 10, color: 'var(--am-text-muted)' }}>
                {weights.length} {weights.length === 1 ? 'weight' : 'weights'}
              </span>
            </div>
            {hasLoaded ? (
              <div
                style={{
                  fontFamily: `"${family}", sans-serif`,
                  fontWeight: regFaces[0]?.weight ?? 400,
                  fontSize: 14,
                  color: 'var(--am-text-dim)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 2,
                }}
              >
                {sample}
              </div>
            ) : defaultThumb ? (
              <img
                src={`/am/fontthumb/${encodeURIComponent(defaultThumb)}`}
                alt={family}
                loading="lazy"
                style={{
                  height: 18,
                  maxWidth: 160,
                  objectFit: 'contain',
                  objectPosition: 'left center',
                  filter: 'invert(0.88)',
                  marginTop: 3,
                  opacity: 0.85,
                }}
              />
            ) : (
              <div style={{ fontSize: 11, color: 'var(--am-text-muted)', marginTop: 2 }}>
                Not downloaded
              </div>
            )}
          </div>
          <span style={{ fontSize: 11, color: hasLoaded ? 'var(--am-accent)' : 'var(--am-text-muted)' }}>
            {hasLoaded ? '✓' : '↓'} {isExpanded ? '▴' : '▾'}
          </span>
        </div>

        {isExpanded && (
          <div
            style={{
              padding: '4px 10px 10px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              background: 'rgba(0,0,0,0.16)',
            }}
          >
            {styles.map((st) =>
              weights.map((w) => {
                const loaded = isFaceRegistered(family, w, st);
                const busy = downloadingFam === `${family}|${w}|${st}`;
                const active =
                  isCurrent && currentWeight === w && (currentItalic ? 'italic' : 'normal') === st;
                const userItem = userItems?.find((u) => u.weight === w && u.style === st);
                return (
                  <div
                    key={`${w}-${st}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 6,
                      background: active ? 'rgba(0, 212, 170, 0.16)' : 'var(--am-surface)',
                      border: active ? '1px solid var(--am-accent)' : '1px solid var(--am-border)',
                    }}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDownloadAndApply(family, w, st)}
                      style={{
                        flex: 1,
                        background: 'none',
                        border: 'none',
                        color: 'var(--am-text)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: 0,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: loaded ? `"${family}", sans-serif` : 'inherit',
                          fontWeight: w,
                          fontStyle: st,
                          fontSize: 13,
                        }}
                      >
                        {weightToLabel(w)} {st === 'italic' ? 'Italic' : ''} ({w})
                      </span>
                      <span style={{ fontSize: 11, color: loaded ? 'var(--am-accent)' : 'var(--am-text-muted)' }}>
                        {busy ? 'Downloading…' : loaded ? 'Apply' : '↓ Download'}
                      </span>
                    </button>
                    {userItem && (
                      <button
                        type="button"
                        className="am-btn"
                        style={{ padding: '2px 6px', fontSize: 10, color: '#FF6B81' }}
                        onClick={() => handleDeleteUserFont(userItem)}
                        title="Delete imported font"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="am-modal-backdrop" onClick={onClose}>
      <div
        className="am-modal-sheet"
        style={{ maxWidth: 460, width: '94vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="am-modal-header">
          <strong>Fonts</strong>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="am-btn am-btn-accent"
              style={{ padding: '4px 10px', fontSize: 11 }}
              onClick={() => fileInputRef.current?.click()}
            >
              + Import TTF/OTF/WOFF2
            </button>
            <button type="button" className="am-icon-btn" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2,.ttc"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--am-border)' }}>
          <input
            type="text"
            className="am-input"
            placeholder="Search fonts (e.g. Poppins, Montserrat, Space Grotesk)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{ width: '100%' }}
          />
          {dragActive && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--am-accent)', fontWeight: 700 }}>
              Drop .ttf / .otf / .woff2 font files to import…
            </div>
          )}
          {importError && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#FF6B81' }}>{importError}</div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {projectFamilies.length > 0 && (
            <>
              <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--am-text-muted)', background: 'rgba(255,255,255,0.03)' }}>
                Project Fonts ({projectFamilies.length})
              </div>
              {projectFamilies.map((fam) => {
                const reg = getRegisteredFacesForFamily(fam);
                const weights = Array.from(new Set(reg.length ? reg.map((r) => r.weight) : [400, 700])).sort((a, b) => a - b);
                const styles = Array.from(new Set(reg.length ? reg.map((r) => r.style) : (['normal'] as FaceStyle[])));
                return renderFamilyRow(fam, weights, styles);
              })}
            </>
          )}

          {userByFamily.length > 0 && (
            <>
              <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--am-text-muted)', background: 'rgba(255,255,255,0.03)' }}>
                My Fonts ({userByFamily.length})
              </div>
              {userByFamily.map(([fam, items]) => {
                const weights = Array.from(new Set(items.map((i) => i.weight))).sort((a, b) => a - b);
                const styles = Array.from(new Set(items.map((i) => i.style)));
                return renderFamilyRow(fam, weights, styles, undefined, items);
              })}
            </>
          )}

          <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--am-text-muted)', background: 'rgba(255,255,255,0.03)' }}>
            Alight Catalogue ({catalogFamilies.length})
          </div>
          {catalogFamilies.map((c) => renderFamilyRow(c.family, c.weights, c.styles, c.thumbs))}
        </div>
      </div>
    </div>
  );
};
