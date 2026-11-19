import React, { useRef, useState } from 'react';
import { importAlightMotionLink, importAmProjZip, parseAlightShareUrl } from '../engine/amLinkImporter';
import { importProjectFromAmXml } from '../engine/amXmlCodec';
import { getEffects } from '../engine/catalog';
import { useEditorStore } from '../store/useEditorStore';
import type { Project } from '../types/project';
import { AmDialog } from './components/AmDialog';
import { AmIcon } from './components/AmIcon';
import { NewProjectDialog } from './NewProjectDialog';

export const HomeScreen: React.FC = () => {
  const {
    homeTab,
    setHomeTab,
    projects,
    elements,
    theme,
    setTheme,
    openProject,
    duplicateProject,
    deleteProject,
    deleteElement,
    importProject,
    setModal,
    showDrawer,
    clearCache,
  } = useEditorStore();

  const [search, setSearch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkStatus, setLinkStatus] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectsCount = getEffects().filter((e) => !e.internal).length;
  const filteredProjects = projects.filter((p) =>
    p.title.toLowerCase().includes(search.trim().toLowerCase())
  );

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.amproj') || lower.endsWith('.zip')) {
        const res = await importAmProjZip(file);
        for (const proj of res.projects) importProject(proj);
        return;
      }
      const text = await file.text();
      if (lower.endsWith('.xml') || text.trimStart().startsWith('<')) {
        const proj = importProjectFromAmXml(text);
        importProject(proj);
      } else {
        const parsed = JSON.parse(text) as Project;
        if (!parsed || !Array.isArray(parsed.layers)) throw new Error('Invalid project JSON');
        parsed.id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        parsed.modifiedTime = Date.now();
        importProject(parsed);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import project file.');
    }
  };

  const handleImportLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim()) return;
    setLinkBusy(true);
    setLinkError(null);
    setLinkStatus('Starting import...');
    try {
      const res = await importAlightMotionLink(linkUrl, setLinkStatus);
      for (const proj of res.projects) {
        importProject(proj);
      }
      setShowLinkDialog(false);
      setLinkUrl('');
      setLinkStatus('');
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to import Alight Motion link.');
      setLinkStatus('');
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="am-home">
      {/* Top Bar */}
      <header className="am-home-header">
        <div className="am-brand">
          <button
            type="button"
            className="am-icon-btn"
            onClick={() => setModal('showDrawer', true)}
            aria-label="Menu"
          >
            <AmIcon name="menu" fallback="menu" size={20} />
          </button>
          <div className="am-brand-badge">A</div>
          <span className="am-brand-title">Alight Motion</span>
          <span className="am-brand-ver">5.0.280 WEB</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <input
              id="home-project-search"
              name="projectSearch"
              aria-label="Search projects"
              type="search"
              className="am-input"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 200, padding: '6px 10px 6px 30px', fontSize: 12 }}
            />
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.6 }}>
              <AmIcon name="ic_effectbrowser_search" fallback="search" size={14} />
            </span>
          </div>
          <button
            type="button"
            className="am-btn am-btn-primary"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => {
              setLinkError(null);
              setLinkStatus('');
              setShowLinkDialog(true);
            }}
          >
            <AmIcon name="ic_layer_parent" fallback="link" size={15} color="#091318" />
            Import Link
          </button>
          <button
            type="button"
            className="am-btn"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => fileInputRef.current?.click()}
          >
            <AmIcon name="ic_xml_upload" fallback="xml" size={16} />
            Import XML / .amproj
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.json,.amweb.json,.amproj,.zip"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="am-home-main am-scroll">
        {importError && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(224,20,69,0.2)', border: '1px solid var(--am-danger)', marginBottom: 14, fontSize: 13 }}>
            {importError}
          </div>
        )}

        {homeTab === 'home' && (
          <>
            <section className="am-hero-banner">
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--am-accent)', letterSpacing: '0.08em' }}>
                  APK 5.0.280 WEBGL2 ENGINE
                </div>
                <h1 style={{ margin: '6px 0', fontSize: 24 }}>Alight Motion Web Studio</h1>
                <p style={{ margin: 0, color: 'var(--am-text-secondary)', fontSize: 13, maxWidth: 580 }}>
                  Full WebGL2 GLSL shader pipeline with {effectsCount || 280}+ effects, 20 procedural shapes,
                  26 GLSL blend modes, cubic-bezier easing curves, multi-track keyframing, camera parallax,
                  and XML/Video/GIF/PNG export.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="am-btn am-btn-primary"
                  onClick={() => setModal('showNewProjectDialog', true)}
                >
                  <AmIcon name="ic_add_project_plus" fallback="plus" size={16} />
                  New Project
                </button>
                {projects[0] && (
                  <button
                    type="button"
                    className="am-btn"
                    onClick={() => openProject(projects[0].id)}
                  >
                    Open Latest
                  </button>
                )}
              </div>
            </section>

            <h2 className="am-section-title">Featured & Recent Projects</h2>
            <div className="am-project-grid">
              {filteredProjects.map((p) => (
                <article key={p.id} className="am-project-card">
                  <div className="am-project-thumb" onClick={() => openProject(p.id)}>
                    <span className="am-project-ratio-chip">
                      {p.width}×{p.height} · {p.fps}fps
                    </span>
                    <AmIcon name="ic_play_onthumbnail" fallback="play" size={34} color="var(--am-accent)" />
                    <span style={{ fontSize: 11, color: 'var(--am-text-secondary)', marginTop: 8 }}>
                      {p.layers.length} layers · {(p.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <div className="am-project-card-body">
                    <div className="am-project-meta" onClick={() => openProject(p.id)}>
                      <div className="am-project-title">{p.title}</div>
                      <div className="am-project-sub">
                        Updated {new Date(p.modifiedTime).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button
                        type="button"
                        className="am-icon-btn"
                        title="Duplicate Project"
                        onClick={() => duplicateProject(p.id)}
                      >
                        <AmIcon name="ic_project_duplicate" fallback="copy" size={16} />
                      </button>
                      <button
                        type="button"
                        className="am-icon-btn"
                        title="Delete Project"
                        onClick={() => deleteProject(p.id)}
                      >
                        <AmIcon name="ic_project_delete" fallback="delete" size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {homeTab === 'projects' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 className="am-section-title" style={{ margin: 0 }}>
                All Projects ({filteredProjects.length})
              </h2>
              <button
                type="button"
                className="am-btn am-btn-primary"
                onClick={() => setModal('showNewProjectDialog', true)}
              >
                + Create Project
              </button>
            </div>
            <div className="am-project-grid">
              {filteredProjects.map((p) => (
                <article key={p.id} className="am-project-card">
                  <div className="am-project-thumb" onClick={() => openProject(p.id)}>
                    <span className="am-project-ratio-chip">
                      {p.width}×{p.height} · {p.fps}fps
                    </span>
                    <AmIcon name="ic_play_onthumbnail" fallback="play" size={34} color="var(--am-accent)" />
                    <span style={{ fontSize: 11, color: 'var(--am-text-secondary)', marginTop: 8 }}>
                      {p.layers.length} layers · {(p.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <div className="am-project-card-body">
                    <div className="am-project-meta" onClick={() => openProject(p.id)}>
                      <div className="am-project-title">{p.title}</div>
                      <div className="am-project-sub">Tap to edit in Studio</div>
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button type="button" className="am-icon-btn" onClick={() => duplicateProject(p.id)} title="Duplicate">
                        <AmIcon name="ic_project_duplicate" fallback="copy" size={16} />
                      </button>
                      <button type="button" className="am-icon-btn" onClick={() => deleteProject(p.id)} title="Delete">
                        <AmIcon name="ic_project_delete" fallback="delete" size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {homeTab === 'elements' && (
          <>
            <h2 className="am-section-title">Saved Elements ({elements.length})</h2>
            {elements.length === 0 ? (
              <div style={{ padding: 36, textAlign: 'center', background: 'var(--am-a1)', borderRadius: 14, border: '1px solid var(--am-border)' }}>
                <p style={{ margin: 0, color: 'var(--am-text-secondary)' }}>
                  No saved elements yet. Select any layer or group inside a project and click <strong>Save Element</strong> in the quick action rail to reuse it across projects.
                </p>
              </div>
            ) : (
              <div className="am-project-grid">
                {elements.map((el) => (
                  <div key={el.id} className="am-project-card" style={{ padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{el.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--am-text-muted)', margin: '4px 0 10px' }}>
                      {el.layers.length} layer(s)
                    </div>
                    <button type="button" className="am-btn am-btn-danger" onClick={() => deleteElement(el.id)}>
                      Delete Element
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {homeTab === 'tutorials' && (
          <>
            <h2 className="am-section-title">Alight Motion Workflow Guides</h2>
            <div className="am-project-grid">
              {[
                {
                  t: 'Keyframes & Easing Curves',
                  d: 'Select any property (Position, Scale, Rotation, or any Effect Parameter), scrub the timeline, tap the Keyframe Diamond, then open the Curve Graph to shape custom cubic-bezier overshoot or bounce easing.',
                },
                {
                  t: 'Tiles + Oscillate + Motion Blur',
                  d: 'Add Tiles (enable Mirror), stack Oscillate or Swing, and add Motion Blur. The WebGL2 engine computes real finite-difference velocity and runs the exact APK shader stack.',
                },
                {
                  t: 'Groups, Masks & Parenting',
                  d: 'Multi-select layers in the Timeline to Group, Mask Group, or Exclude Mask Group. Use the Parent picker in the right rail to link layers hierarchically, or add a Camera layer for 3D Z-depth parallax.',
                },
                {
                  t: 'XML Import & Video/GIF Export',
                  d: 'Import official Alight Motion .xml scene files from the top bar, or export Video (WebM/MP4), Animated GIF, PNG sequence ZIP, or Alight Motion XML straight from the editor.',
                },
              ].map((g) => (
                <div key={g.t} className="am-project-card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--am-accent)', marginBottom: 8 }}>{g.t}</div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--am-text-secondary)' }}>{g.d}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Bottom Navigation Bar (#43486B) + Central Floating Mint + Button */}
      <nav className="am-bottom-nav" aria-label="Primary Navigation">
        <button
          type="button"
          className={`am-nav-tab ${homeTab === 'home' ? 'active' : ''}`}
          onClick={() => setHomeTab('home')}
        >
          <AmIcon name={homeTab === 'home' ? 'ic_home_on' : 'ic_home_off'} fallback="home" size={20} />
          <span>Home</span>
        </button>
        <button
          type="button"
          className={`am-nav-tab ${homeTab === 'tutorials' ? 'active' : ''}`}
          onClick={() => setHomeTab('tutorials')}
        >
          <AmIcon name={homeTab === 'tutorials' ? 'ic_tutorials_on' : 'ic_tutorials_off'} fallback="tutorials" size={20} />
          <span>Tutorials</span>
        </button>

        <button
          type="button"
          className="am-fab-create"
          onClick={() => setModal('showNewProjectDialog', true)}
          aria-label="Create New Project"
          title="Create New Project"
        >
          <AmIcon name="ic_add_project_plus" fallback="plus" size={26} />
        </button>

        <button
          type="button"
          className={`am-nav-tab ${homeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setHomeTab('projects')}
        >
          <AmIcon name={homeTab === 'projects' ? 'ic_projects_on' : 'ic_projects_off'} fallback="projects" size={20} />
          <span>Projects</span>
        </button>
        <button
          type="button"
          className={`am-nav-tab ${homeTab === 'elements' ? 'active' : ''}`}
          onClick={() => setHomeTab('elements')}
        >
          <AmIcon name={homeTab === 'elements' ? 'ic_templates_on' : 'ic_templates_off'} fallback="elements" size={20} />
          <span>Elements</span>
        </button>
      </nav>

      {/* Slide-out Settings Drawer */}
      {showDrawer && (
        <div className="am-drawer-backdrop" onClick={() => setModal('showDrawer', false)}>
          <aside className="am-drawer" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="am-brand">
                <div className="am-brand-badge">A</div>
                <span className="am-brand-title">Settings</span>
              </div>
              <button type="button" className="am-icon-btn" onClick={() => setModal('showDrawer', false)}>
                <AmIcon name="ic_btn_close" fallback="close" size={18} />
              </button>
            </div>

            <div className="am-field" style={{ marginTop: 12 }}>
              <label>Interface Theme</label>
              <div className="am-pill-row">
                <button
                  type="button"
                  className={`am-pill ${theme === 'navy' ? 'active' : ''}`}
                  onClick={() => setTheme('navy')}
                >
                  Alight Navy
                </button>
                <button
                  type="button"
                  className={`am-pill ${theme === 'desat' ? 'active' : ''}`}
                  onClick={() => setTheme('desat')}
                >
                  Desaturated Dark
                </button>
              </div>
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="am-btn am-btn-danger"
                onClick={async () => {
                  await clearCache();
                  setModal('showDrawer', false);
                }}
              >
                Reset Local Storage & Demos
              </button>
              <div style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>
                Alight Motion 5.0.280 WebGL2 Studio · All effects & shapes reconstructed locally.
              </div>
            </div>
          </aside>
        </div>
      )}

      <AmDialog
        open={showLinkDialog}
        onClose={() => !linkBusy && setShowLinkDialog(false)}
        title="Import Alight Motion Link"
      >
        <form onSubmit={handleImportLink} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="am-field" style={{ marginBottom: 0 }}>
            <label htmlFor="am-link-input">Alight Motion Share Link</label>
            <input
              id="am-link-input"
              name="amShareLink"
              type="url"
              className="am-input"
              placeholder="https://alightcreative.com/am/share/u/.../p/..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              disabled={linkBusy}
              autoFocus
            />
          </div>

          <div style={{ fontSize: 12, color: 'var(--am-text-muted)' }}>
            Downloads the project XML, beat bookmarks, effects, and all bundled images, videos, and audio into your studio.
          </div>

          {linkStatus && (
            <div style={{ fontSize: 12, color: 'var(--am-accent)', fontWeight: 600 }}>{linkStatus}</div>
          )}

          {linkError && (
            <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(224,20,69,0.2)', border: '1px solid var(--am-danger)', fontSize: 12 }}>
              <div>{linkError}</div>
              {parseAlightShareUrl(linkUrl) && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a
                    href={parseAlightShareUrl(linkUrl)!.zipUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="am-btn am-btn-primary"
                    style={{ fontSize: 11, padding: '5px 10px' }}
                  >
                    Download projectfiles.zip
                  </a>
                  <button
                    type="button"
                    className="am-btn"
                    style={{ fontSize: 11, padding: '5px 10px' }}
                    onClick={() => {
                      setShowLinkDialog(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    Upload .zip / .amproj
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="am-btn" disabled={linkBusy} onClick={() => setShowLinkDialog(false)}>
              Cancel
            </button>
            <button type="submit" className="am-btn am-btn-primary" disabled={linkBusy || !linkUrl.trim()}>
              {linkBusy ? 'Importing...' : 'Import Package'}
            </button>
          </div>
        </form>
      </AmDialog>

      <NewProjectDialog />
    </div>
  );
};
