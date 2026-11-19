import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';

function fmtTimecode(ms: number, fps: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const frame = Math.floor(((safe % 1000) / 1000) * fps);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
}

export const Playbar: React.FC = () => {
  const {
    currentProject,
    currentTimeMs,
    isPlaying,
    loop,
    audioLevel,
    selectedLayerIds,
    timelinePxPerSec,
    setCurrentTimeMs,
    togglePlay,
    setLoop,
    setIsPlaying,
    toggleBookmarkAtPlayhead,
    jumpBookmark,
    trimSelectedLeft,
    splitSelectedAtPlayhead,
    trimSelectedRight,
    setTimelineZoom,
  } = useEditorStore();

  if (!currentProject) return null;
  const frameMs = 1000 / Math.max(1, currentProject.fps);
  const hasSel = selectedLayerIds.length > 0;
  const hasBookmarkHere = currentProject.bookmarks.some((b) => Math.abs(b - currentTimeMs) < 35);

  return (
    <div className="am-playbar">
      {/* LevelMeterView */}
      <div className="am-vu-meter" aria-hidden="true">
        <div className="am-vu-fill" style={{ width: `${Math.round(audioLevel * 100)}%` }} />
      </div>

      <div className="am-playbar-row">
        {/* Timecode */}
        <div className="am-timecode">
          {fmtTimecode(currentTimeMs, currentProject.fps)}{' '}
          <span>/ {fmtTimecode(currentProject.durationMs, currentProject.fps)}</span>
        </div>

        {/* Transport Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            className="am-icon-btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentTimeMs(0);
            }}
            title="Jump to Start"
          >
            <AmIcon name="ic_start_time" fallback="back" size={17} />
          </button>
          <button
            type="button"
            className="am-icon-btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentTimeMs(currentTimeMs - frameMs);
            }}
            title="Previous Frame (ArrowLeft)"
          >
            <AmIcon name="ic_edit_prevframe" fallback="back" size={18} />
          </button>
          <button
            type="button"
            className="am-icon-btn active"
            style={{ width: 38, height: 34 }}
            onClick={togglePlay}
            title="Play / Pause (Space)"
          >
            <AmIcon
              name={isPlaying ? 'ic_pause_white_24dp' : 'ic_play_arrow_white_24dp'}
              fallback={isPlaying ? 'pause' : 'play'}
              size={22}
            />
          </button>
          <button
            type="button"
            className="am-icon-btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentTimeMs(currentTimeMs + frameMs);
            }}
            title="Next Frame (ArrowRight)"
          >
            <AmIcon name="ic_edit_nextframe" fallback="next" size={18} />
          </button>
          <button
            type="button"
            className="am-icon-btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentTimeMs(currentProject.durationMs);
            }}
            title="Jump to End"
          >
            <AmIcon name="ic_exportpreview_next" fallback="next" size={17} />
          </button>
          <button
            type="button"
            className={`am-icon-btn ${loop ? 'active' : ''}`}
            onClick={() => setLoop(!loop)}
            title="Toggle Loop Playback"
          >
            <AmIcon name="ic_autoreplay_pause" fallback="reset" size={16} />
          </button>
        </div>

        {/* Bookmarks, Trim/Split, Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button type="button" className="am-icon-btn" onClick={() => jumpBookmark(-1)} title="Previous Bookmark">
            <AmIcon name="ic_left_move" fallback="back" size={15} />
          </button>
          <button
            type="button"
            className={`am-icon-btn ${hasBookmarkHere ? 'active' : ''}`}
            onClick={toggleBookmarkAtPlayhead}
            title="Add / Remove Beat Bookmark"
          >
            <AmIcon name={hasBookmarkHere ? 'ic_bookmark_delete' : 'ic_bookmark_add'} fallback="bookmark" size={17} />
          </button>
          <button type="button" className="am-icon-btn" onClick={() => jumpBookmark(1)} title="Next Bookmark">
            <AmIcon name="ic_right_move" fallback="next" size={15} />
          </button>

          <div style={{ width: 1, height: 18, background: 'var(--am-border)', margin: '0 4px' }} />

          <button type="button" className="am-icon-btn" disabled={!hasSel} onClick={trimSelectedLeft} title="Trim Layer Left to Playhead">
            <AmIcon name="ic_videotrim_grip_left" fallback="back" size={16} />
          </button>
          <button type="button" className="am-icon-btn" disabled={!hasSel} onClick={splitSelectedAtPlayhead} title="Split Layer at Playhead">
            <AmIcon name="split" fallback="split" size={16} />
          </button>
          <button type="button" className="am-icon-btn" disabled={!hasSel} onClick={trimSelectedRight} title="Trim Layer Right to Playhead">
            <AmIcon name="ic_videotrim_grip_right" fallback="next" size={16} />
          </button>

          <input
            id="timeline-zoom-slider"
            name="timelineZoom"
            aria-label="Timeline Zoom"
            type="range"
            min={40}
            max={360}
            value={timelinePxPerSec}
            onChange={(e) => setTimelineZoom(Number(e.target.value))}
            title="Timeline Zoom"
            style={{ width: 64, marginLeft: 6, accentColor: 'var(--am-accent)' }}
          />
        </div>
      </div>
    </div>
  );
};
