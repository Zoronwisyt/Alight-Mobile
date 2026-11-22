import type { Layer, Project } from '../types/project';
import { evalAnimatable, evalRemappedTime } from './animation';
import { extractAacAdts } from './mp4Audio';
import { loadMediaArrayBuffer, loadMediaUrl } from '../store/storage';

function buildSilentWavBlobUrl(): string {
  // 0.25s 8kHz mono 16-bit PCM silent WAV (2000 samples = 4000 data bytes + 44 header bytes)
  const numSamples = 2000;
  const dataBytes = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true); // 8kHz
  v.setUint32(28, 16000, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  v.setUint32(40, dataBytes, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function xhrArrayBuffer(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
        if (xhr.response instanceof ArrayBuffer) {
          resolve(xhr.response);
          return;
        }
      }
      reject(new Error(`XHR failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('XHR network error'));
    xhr.send();
  });
}

function safeDecodeAudioData(ctx: AudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onOk = (decoded: AudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(decoded);
      }
    };
    const onErr = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err ?? 'decodeAudioData failed')));
      }
    };
    try {
      const p = ctx.decodeAudioData(buf, onOk, onErr);
      if (p && typeof p.then === 'function') {
        p.then(onOk, onErr);
      }
    } catch (err) {
      onErr(err);
    }
  });
}

/**
 * Mobile audio is governed by two platform rules the desktop build never had to care about:
 *
 * 1. **iOS mutes Web Audio behind the hardware ring/silent switch.** A page gets a `playback`
 *    audio session by setting `navigator.audioSession.type` (Safari 17.4+); without it a video
 *    editor goes silent the moment the switch is flipped, which reads to the user as "audio is
 *    broken even with the ringer on".
 * 2. **`decodeAudioData` is not reliable for a video container on iOS.** The MP4's audio track
 *    frequently fails to decode, so the whole `startLayerAudio` path throws and swallows it — the
 *    video plays, silent, forever. When that happens the `<video>` element's own audio track takes
 *    over: it is unaffected by the ring switch and needs no second download.
 *
 * Both fallbacks are explicit state, not heuristics inside the playback loop.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArr: Uint8Array<ArrayBuffer> | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private failedAudioSrcs = new Set<string>();
  /** Sources whose sound is played by their own `<video>` element instead of a buffer source. */
  private elementAudioSrcs = new Set<string>();
  private activeSources: AudioBufferSourceNode[] = [];
  private fallbackAudioEls = new Map<string, HTMLAudioElement>();
  private activeFallbackEls: HTMLAudioElement[] = [];
  private fallbackTimers: number[] = [];
  private loading = new Map<string, Promise<AudioBuffer>>();
  private playbackStartCtxTime = 0;
  private playbackStartSceneMs = 0;
  private playbackActive = false;
  private playbackSessionId = 0;
  /**
   * Every running Web-Audio layer (buffer source or fallback element), keyed by layer id, so a
   * volume edit can ramp the live gain instead of restarting playback. A full `startPlayback()`
   * restart on every slider tick was cutting every other track out mid-frame — the preview audio
   * "bugging out" while editing volume.
   */
  private liveMix = new Map<
    string,
    {
      isVideo: boolean;
      localOffsetMs: number;
      absStart: number;
      absEnd: number;
      gain: GainNode | null;
      el: HTMLAudioElement | null;
      /** Fallback elements started muted keep their trigger params so a live volume-up can start them. */
      trimSec?: number;
      speed?: number;
      started?: boolean;
      sessionId?: number;
    }
  >();
  private lastMixVolumes = new Map<string, number>();
  private unlockInstalled = false;
  private iosRouteUnlocked = false;
  private silentAudioEl: HTMLAudioElement | null = null;
  private silentWavUrl: string | null = null;
  private visibilityHooked = false;

  /**
   * `layers` scopes the scan to the group currently open in the editor: AM plays a group as its own
   * timeline, so its audio is scheduled in the group's local time base. Without it, pressing play
   * inside a group was silent — which is exactly where a shared project spends most of its time.
   */
  public hasAudio(project: Project, layers?: Layer[]): boolean {
    const out: { layer: Layer; absStart: number; absEnd: number; localOffsetMs: number }[] = [];
    this.collectAudioLayers(layers ?? project.layers, 0, Infinity, out);
    return out.length > 0;
  }

  public getPlaybackPositionMs(): number | null {
    if (!this.playbackActive || !this.ctx || this.ctx.state !== 'running') return null;
    const elapsedSec = Math.max(0, this.ctx.currentTime - this.playbackStartCtxTime);
    return this.playbackStartSceneMs + elapsedSec * 1000;
  }

  /**
   * True when this source's sound is produced by its `<video>` element rather than a buffer source,
   * which happens when `decodeAudioData` refuses the container (common for MP4 with a video track on
   * iOS). The renderer must then leave the element unmuted and apply the layer's volume.
   */
  public isElementAudioOwned(src: string, mediaId?: string): boolean {
    return this.elementAudioSrcs.has(src) || (Boolean(mediaId) && this.elementAudioSrcs.has(mediaId!));
  }

  public hasElementOwnedAudio(): boolean {
    return this.elementAudioSrcs.size > 0;
  }

  /** Pre-decodes audio & video audio tracks in the background so pressing Play has zero audio lag */
  public preloadProjectAudio(project: Project): void {
    const items: { layer: Layer; absStart: number; absEnd: number; localOffsetMs: number }[] = [];
    this.collectAudioLayers(project.layers, 0, Infinity, items);
    for (const { layer } of items) {
      const src = layer.type === 'audio' ? layer.audioData?.src : layer.mediaData?.src;
      const mediaId = layer.type === 'audio' ? layer.audioData?.mediaId : layer.mediaData?.mediaId;
      const synth = layer.type === 'audio' ? layer.audioData?.synthPattern : undefined;
      if (src || synth || mediaId) {
        void this.loadAudioBuffer(src || '', synth, mediaId).catch(() => {});
      }
    }
  }

  private applyAudioSessionType(): void {
    if (typeof navigator === 'undefined') return;
    const session = (navigator as Navigator & { audioSession?: { type?: string } }).audioSession;
    if (!session || !('type' in session)) return;
    try {
      // Claim playback so the ring/silent switch does not mute the editor's Web Audio graph.
      session.type = 'playback';
    } catch {
      // Older WebKit exposes a read-only stub; the element fallback covers it.
    }
  }

  private ensureSilentAudioEl(): HTMLAudioElement | null {
    if (typeof document === 'undefined') return null;
    if (!this.silentAudioEl) {
      const a = document.createElement('audio');
      a.setAttribute('playsinline', '');
      a.setAttribute('webkit-playsinline', '');
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0.01;
      a.style.display = 'none';
      if (!this.silentWavUrl) {
        this.silentWavUrl = buildSilentWavBlobUrl();
      }
      a.src = this.silentWavUrl;
      if (document.body) {
        document.body.appendChild(a);
      }
      this.silentAudioEl = a;
    } else if (!this.silentAudioEl.isConnected && document.body) {
      document.body.appendChild(this.silentAudioEl);
    }
    return this.silentAudioEl;
  }

  /**
   * Synchronously unlocks both Web Audio (via a 1-sample buffer source) and iOS Home Screen
   * standalone WKWebView's AVAudioSession playback route (via a looping DOM-attached silent WAV
   * <audio playsinline>). Must be called directly inside a user gesture handler (touchend/click).
   */
  public unlockFromGesture(): void {
    this.applyAudioSessionType();
    try {
      const ctx = this.ensureContext();
      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => {});
      }
      // Play a 1-frame silent buffer synchronously inside the gesture to wake WebKit's audio output thread
      const warmBuf = ctx.createBuffer(1, 1, 22050);
      const warmSrc = ctx.createBufferSource();
      warmSrc.buffer = warmBuf;
      warmSrc.connect(ctx.destination);
      warmSrc.start(0);
    } catch {
      // ignore
    }

    try {
      const a = this.ensureSilentAudioEl();
      if (a && (!this.iosRouteUnlocked || this.playbackActive)) {
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            this.iosRouteUnlocked = true;
            if (!this.playbackActive && !a.paused) {
              a.pause();
            }
          }).catch(() => {});
        }
      }
    } catch {
      // ignore
    }

    // Prime any fallback HTMLAudioElements already registered (always muted + immediately paused so
    // tapping during playback never launches muted, hidden, or out-of-range fallback audio tracks).
    if (!this.playbackActive) {
      for (const el of this.fallbackAudioEls.values()) {
        if ((el as HTMLAudioElement & { _unlocked?: boolean })._unlocked) continue;
        el.muted = true;
        const p = el.play();
        if (p && typeof p.then === 'function') {
          void p
            .then(() => {
              (el as HTMLAudioElement & { _unlocked?: boolean })._unlocked = true;
              if (!el.paused) el.pause();
              el.muted = true;
            })
            .catch(() => {
              el.muted = true;
            });
        }
      }
    }
  }

  private installUnlock(): void {
    if (this.unlockInstalled || typeof window === 'undefined') return;
    this.unlockInstalled = true;
    const unlock = (ev?: Event) => {
      this.unlockFromGesture();
      const isConfirmingGesture =
        !ev || ev.type === 'touchend' || ev.type === 'pointerup' || ev.type === 'click' || ev.type === 'keydown';
      if (isConfirmingGesture && this.ctx && this.ctx.state === 'running' && this.iosRouteUnlocked) {
        this.removeUnlock();
      }
    };
    this.unlockHandler = unlock;
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('touchend', unlock, { capture: true, passive: true });
    window.addEventListener('pointerup', unlock, { capture: true, passive: true });
    window.addEventListener('click', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
  }

  private unlockHandler: ((ev?: Event) => void) | null = null;

  private removeUnlock(): void {
    if (!this.unlockHandler || typeof window === 'undefined') return;
    window.removeEventListener('touchstart', this.unlockHandler, true);
    window.removeEventListener('pointerdown', this.unlockHandler, true);
    window.removeEventListener('touchend', this.unlockHandler, true);
    window.removeEventListener('pointerup', this.unlockHandler, true);
    window.removeEventListener('click', this.unlockHandler, true);
    window.removeEventListener('keydown', this.unlockHandler, true);
    this.unlockHandler = null;
    this.unlockInstalled = false;
  }

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      this.applyAudioSessionType();
      const Ctor =
        typeof window !== 'undefined'
          ? window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
      if (!Ctor) throw new Error('Web Audio is not available in this browser.');
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.ctx.destination);
      this.dataArr = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      // Re-arm unlock when iOS Home Screen PWA drops AudioContext to 'interrupted' on app switch
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx && this.ctx.state !== 'running') {
          this.iosRouteUnlocked = false;
          this.installUnlock();
        }
      });
      if (!this.visibilityHooked && typeof document !== 'undefined') {
        this.visibilityHooked = true;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.applyAudioSessionType();
            if (this.ctx && this.ctx.state !== 'running') {
              this.iosRouteUnlocked = false;
              this.installUnlock();
              this.ctx.resume().catch(() => {});
            }
          }
        });
      }
    }
    // Registered outside the creation guard: the listener must exist even when the context was made
    // during a preload (no gesture), which is the normal path on a cold project load.
    this.installUnlock();
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private async fetchAudioBytes(src: string, mediaId?: string): Promise<ArrayBuffer> {
    if (mediaId) {
      const idbBytes = await loadMediaArrayBuffer(mediaId);
      if (idbBytes && idbBytes.byteLength > 0) return idbBytes;
    }
    if (!src) throw new Error('Missing audio source');
    try {
      const res = await fetch(src);
      if (res.ok) return await res.arrayBuffer();
    } catch {
      // iOS Home Screen WKWebView often rejects fetch(blob:...) — fall back to XHR or rehydrated IDB URL
    }
    try {
      return await xhrArrayBuffer(src);
    } catch (xhrErr) {
      if (mediaId) {
        const freshUrl = await loadMediaUrl(mediaId);
        if (freshUrl) return await xhrArrayBuffer(freshUrl);
      }
      throw xhrErr;
    }
  }

  public async loadAudioBuffer(
    src: string,
    synthPattern?: 'beat' | 'ambient' | 'pulse',
    mediaId?: string
  ): Promise<AudioBuffer> {
    const key = synthPattern ? `__synth_${synthPattern}` : mediaId || src;
    const cached = this.buffers.get(key) ?? (src ? this.buffers.get(src) : undefined);
    if (cached) return cached;

    const ctx = this.ensureContext();
    if (synthPattern) {
      const sr = ctx.sampleRate;
      const dur = 4.0;
      const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        const t = i / sr;
        if (synthPattern === 'beat') {
          const beatT = t % 0.5;
          const kick = Math.sin(2 * Math.PI * (120 * Math.exp(-beatT * 20) + 45) * beatT) * Math.exp(-beatT * 10);
          const hat = (t % 0.25) < 0.04 ? (Math.random() * 2 - 1) * 0.25 * Math.exp(-(t % 0.25) * 45) : 0;
          ch[i] = Math.max(-1, Math.min(1, kick * 0.7 + hat));
        } else if (synthPattern === 'pulse') {
          const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
          ch[i] = (Math.sin(2 * Math.PI * 220 * t) * 0.4 + Math.sin(2 * Math.PI * 330 * t) * 0.25) * env;
        } else {
          ch[i] = (Math.sin(2 * Math.PI * 196 * t) + 0.5 * Math.sin(2 * Math.PI * 293.66 * t)) * 0.25;
        }
      }
      this.buffers.set(key, buf);
      return buf;
    }

    if (this.failedAudioSrcs.has(key)) {
      throw new Error('No audio track');
    }
    const inflight = this.loading.get(key);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const arr = await this.fetchAudioBytes(src, mediaId);
        // Keep an in-memory copy before decodeAudioData detaches arr so ADTS rescue never needs a second fetch
        const backup = arr.slice(0);
        try {
          const buf = await safeDecodeAudioData(ctx, arr);
          this.buffers.set(key, buf);
          if (src) this.buffers.set(src, buf);
          return buf;
        } catch (firstErr) {
          const recovered = await this.decodeViaAdtsBytes(backup, ctx);
          if (recovered) {
            this.buffers.set(key, recovered);
            if (src) this.buffers.set(src, recovered);
            return recovered;
          }
          throw firstErr;
        }
      } catch (err) {
        this.failedAudioSrcs.add(key);
        // A container that will not decode at all still has a usable track inside its element.
        if (src) this.elementAudioSrcs.add(src);
        if (mediaId) this.elementAudioSrcs.add(mediaId);
        throw err;
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, promise);
    return promise;
  }

  /**
   * Second chance for a container the browser's decoder refuses as a whole: pull the AAC track out
   * of the ISO-BMFF boxes, re-wrap it as ADTS, and let the same decoder read that.
   */
  private async decodeViaAdtsBytes(bytes: ArrayBuffer, ctx: AudioContext): Promise<AudioBuffer | null> {
    try {
      const track = extractAacAdts(bytes);
      if (!track) return null;
      const copy = track.adts.slice().buffer;
      return await safeDecodeAudioData(ctx, copy);
    } catch {
      return null;
    }
  }

  public extractPeaks(buf: AudioBuffer, bars = 96): number[] {
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * step;
      for (let j = 0; j < step && start + j < ch.length; j += Math.max(1, Math.floor(step / 16))) {
        const v = Math.abs(ch[start + j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    return peaks;
  }

  private collectAudioLayers(
    layers: Layer[],
    offsetMs: number,
    parentEndMs: number,
    out: { layer: Layer; absStart: number; absEnd: number; localOffsetMs: number }[]
  ) {
    for (const l of layers) {
      if (!l.visible) continue;
      const absStart = Math.max(offsetMs, offsetMs + l.startTime);
      const absEnd = Math.min(parentEndMs, offsetMs + l.endTime);
      if (absEnd <= absStart) continue;
      if (l.type === 'group' && l.groupLayers?.length) {
        // If children inside the group are stored in local 0..groupDur time, offset by absStart;
        // if children are already in parent timeline space (>= l.startTime), preserve their offset.
        const minChildStart = l.groupLayers.reduce((m, c) => Math.min(m, c.startTime), Infinity);
        const childOffset = minChildStart >= l.startTime && l.startTime > 0 ? offsetMs : absStart;
        this.collectAudioLayers(l.groupLayers, childOffset, absEnd, out);
      } else if (l.type === 'audio' && l.audioData && !l.audioData.muted) {
        out.push({ layer: l, absStart, absEnd, localOffsetMs: offsetMs });
      } else if (carriesAudio(l)) {
        out.push({ layer: l, absStart, absEnd, localOffsetMs: offsetMs });
      }
    }
  }

  public startPlayback(project: Project, startMs: number, layers?: Layer[]): void {
    this.stopPlayback();
    this.playbackActive = true;
    this.unlockFromGesture();
    const ctx = this.ensureContext();
    const sessionId = ++this.playbackSessionId;
    this.playbackStartCtxTime = ctx.currentTime;
    this.playbackStartSceneMs = startMs;
    const audioLayers: { layer: Layer; absStart: number; absEnd: number; localOffsetMs: number }[] = [];
    this.collectAudioLayers(layers ?? project.layers, 0, Infinity, audioLayers);

    for (const item of audioLayers) {
      void this.startLayerAudio(item.layer, item.absStart, item.absEnd, item.localOffsetMs, startMs, ctx, sessionId);
    }
  }

  private async startFallbackHtmlAudio(
    layer: Layer,
    mediaSrc: string,
    mediaId: string | undefined,
    absStart: number,
    absEnd: number,
    localOffsetMs: number,
    sceneMs: number,
    sessionId: number
  ) {
    if (typeof document === 'undefined') return;
    const key = mediaId || mediaSrc;
    let el = this.fallbackAudioEls.get(key);
    if (!el) {
      el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.preload = 'auto';
      el.src = mediaSrc;
      this.fallbackAudioEls.set(key, el);
    }
    if (mediaId && (!el.src || el.error)) {
      const fresh = await loadMediaUrl(mediaId);
      if (fresh) el.src = fresh;
    }
    if (sessionId !== this.playbackSessionId || !this.playbackActive) return;

    const isVideo = layer.type !== 'audio';
    const speed = isVideo ? Math.max(0.1, Math.min(4, layer.mediaData?.playbackSpeed || 1)) : 1;
    const trimSec = Math.max(0, ((isVideo ? layer.mediaData?.trimStartMs : layer.audioData?.trimStartMs) ?? 0) / 1000);
    const { remappedNormT } = evalRemappedTime(layer, Math.max(layer.startTime, sceneMs - localOffsetMs));
    const vol = isVideo
      ? (layer.mediaData?.volume ?? 1)
      : evalAnimatable(layer.audioData!.volume, remappedNormT, 1);

    if (vol <= 0.001) {
      el.muted = true;
      el.volume = 0;
      // Registered unstarted: raising the volume during playback starts it in place (updateLiveVolumes)
      // instead of restarting the whole graph.
      this.liveMix.set(layer.id, {
        isVideo,
        localOffsetMs,
        absStart,
        absEnd,
        gain: null,
        el,
        trimSec,
        speed,
        started: false,
        sessionId,
      });
      return;
    }
    el.muted = false;
    el.volume = Math.max(0, Math.min(1, vol));
    el.playbackRate = speed;
    const delayMs = Math.max(0, absStart - sceneMs);
    const elapsedSec = Math.max(0, (sceneMs - absStart) / 1000);
    const offsetSec = trimSec + elapsedSec * speed;

    const trigger = () => {
      if (sessionId !== this.playbackSessionId || !this.playbackActive || !el) return;
      try {
        if (Math.abs(el.currentTime - offsetSec) > 0.08) {
          el.currentTime = offsetSec;
        }
      } catch {
        // ignore seek before metadata
      }
      el.muted = false;
      this.activeFallbackEls.push(el);
      const live = this.liveMix.get(layer.id);
      if (live) live.started = true;
      else this.liveMix.set(layer.id, { isVideo, localOffsetMs, absStart, absEnd, gain: null, el, trimSec, speed, started: true, sessionId });
      void el.play().catch(() => {});
      const stopDelayMs = Math.max(0, absEnd - Math.max(sceneMs, absStart));
      if (Number.isFinite(stopDelayMs) && stopDelayMs > 0) {
        const stopId = window.setTimeout(() => {
          if (sessionId !== this.playbackSessionId || !el) return;
          if (!el.paused) el.pause();
          el.muted = true;
        }, stopDelayMs);
        this.fallbackTimers.push(stopId);
      }
    };

    if (delayMs <= 16) {
      trigger();
    } else {
      const startId = window.setTimeout(trigger, delayMs);
      this.fallbackTimers.push(startId);
    }
  }

  private async startLayerAudio(
    layer: Layer,
    absStart: number,
    absEnd: number,
    localOffsetMs: number,
    sceneMs: number,
    ctx: AudioContext,
    sessionId: number
  ) {
    const isVideo = layer.type !== 'audio';
    const mediaSrc = isVideo ? layer.mediaData?.src : layer.audioData?.src;
    const mediaId = isVideo ? layer.mediaData?.mediaId : layer.audioData?.mediaId;
    const synthPattern = isVideo ? undefined : layer.audioData?.synthPattern;
    if (!mediaSrc && !synthPattern && !mediaId) return;
    if (sceneMs > absEnd) return;
    if (isVideo && this.isElementAudioOwned(mediaSrc || '', mediaId)) {
      // The <video> element owns this track in renderer.ts
      return;
    }
    try {
      const buf = await this.loadAudioBuffer(mediaSrc || '', synthPattern, mediaId);
      // Abort if playback was paused, stopped, or restarted while decoding
      if (sessionId !== this.playbackSessionId || !this.playbackActive) return;

      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => {});
      }

      // Compensate for any async decode latency so audio locks tightly to the hardware clock
      const decodeElapsedMs = Math.max(0, (ctx.currentTime - this.playbackStartCtxTime) * 1000);
      const effectiveSceneMs = sceneMs + decodeElapsedMs;
      if (effectiveSceneMs >= absEnd) return;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const speed = isVideo ? Math.max(0.1, Math.min(4, layer.mediaData?.playbackSpeed || 1)) : 1;
      src.playbackRate.value = speed;

      const gain = ctx.createGain();
      const { remappedNormT } = evalRemappedTime(layer, Math.max(layer.startTime, effectiveSceneMs - localOffsetMs));
      const vol = isVideo
        ? (layer.mediaData?.volume ?? 1)
        : evalAnimatable(layer.audioData!.volume, remappedNormT, 1);
      gain.gain.value = Math.max(0, Math.min(2, vol));
      src.connect(gain);
      gain.connect(this.analyser!);

      const trimSec = Math.max(0, ((isVideo ? layer.mediaData?.trimStartMs : layer.audioData?.trimStartMs) ?? 0) / 1000);
      const delaySec = Math.max(0, (absStart - effectiveSceneMs) / 1000);
      const elapsedSec = Math.max(0, (effectiveSceneMs - absStart) / 1000);
      const rawOffset = trimSec + elapsedSec * speed;
      if (buf.duration > 0 && rawOffset >= buf.duration - 0.02) return;
      const offsetSec = buf.duration > 0 ? Math.min(rawOffset, Math.max(0, buf.duration - 0.02)) : 0;
      const remainingClipSec = Math.max(0.05, (absEnd - Math.max(effectiveSceneMs, absStart)) / 1000);
      const remainingBufSec = Math.max(0.02, (buf.duration - offsetSec) / speed);
      src.start(ctx.currentTime + delaySec, offsetSec, Math.min(remainingClipSec, remainingBufSec));
      this.activeSources.push(src);
      this.liveMix.set(layer.id, { isVideo, localOffsetMs, absStart, absEnd, gain, el: null });
    } catch {
      // Decode failed: for standalone <audio> layers, play via HTMLAudioElement fallback
      if (!isVideo && (mediaSrc || mediaId)) {
        void this.startFallbackHtmlAudio(layer, mediaSrc || '', mediaId, absStart, absEnd, localOffsetMs, sceneMs, sessionId);
      }
    }
  }

  /**
   * Re-evaluate the live mix against the (possibly edited) layer list and ramp any gain that moved.
   * Called from the playback loop, so volume keyframes actually animate in the preview — previously
   * the gain was set once at play and the exported file (which bakes the automation) sounded
   * different from the preview. Cheap: it early-returns while nothing is running or nothing changed.
   */
  public updateLiveVolumes(layers: Layer[]): void {
    if (!this.playbackActive || this.liveMix.size === 0 || !this.ctx) return;
    const fresh: { layer: Layer; absStart: number; absEnd: number; localOffsetMs: number }[] = [];
    this.collectAudioLayers(layers, 0, Infinity, fresh);
    const byId = new Map(fresh.map((f) => [f.layer.id, f]));
    const sceneMs = this.getPlaybackPositionMs() ?? this.playbackStartSceneMs;
    const now = this.ctx.currentTime;
    for (const [id, entry] of this.liveMix) {
      const item = byId.get(id);
      let vol = 0;
      if (item) {
        const layer = item.layer;
        if (entry.isVideo) {
          vol = Math.max(0, Math.min(2, layer.mediaData?.volume ?? 1));
        } else if (layer.audioData) {
          const { remappedNormT } = evalRemappedTime(layer, Math.max(layer.startTime, sceneMs - entry.localOffsetMs));
          vol = Math.max(0, Math.min(2, evalAnimatable(layer.audioData.volume, remappedNormT, 1)));
        }
      }
      const prev = this.lastMixVolumes.get(id);
      if (prev !== undefined && Math.abs(prev - vol) < 0.0015) continue;
      this.lastMixVolumes.set(id, vol);
      if (entry.gain) {
        // setTargetAtTime keeps drags and per-tick keyframe steps click-free.
        entry.gain.gain.setTargetAtTime(vol, now, 0.015);
      }
      if (entry.el) {
        entry.el.volume = Math.max(0, Math.min(1, vol));
        entry.el.muted = vol <= 0.001;
        if (!entry.started && vol > 0.001 && entry.sessionId === this.playbackSessionId && sceneMs >= entry.absStart && sceneMs < entry.absEnd) {
          entry.started = true;
          try {
            entry.el.currentTime = (entry.trimSec ?? 0) + ((sceneMs - entry.absStart) / 1000) * (entry.speed || 1);
          } catch {
            // seek before metadata
          }
          this.activeFallbackEls.push(entry.el);
          void entry.el.play().catch(() => {});
          const stopDelayMs = Math.max(0, entry.absEnd - sceneMs);
          if (Number.isFinite(stopDelayMs) && stopDelayMs > 0) {
            const sid = this.playbackSessionId;
            const stopId = window.setTimeout(() => {
              if (sid !== this.playbackSessionId || !entry.el) return;
              if (!entry.el.paused) entry.el.pause();
              entry.el.muted = true;
            }, stopDelayMs);
            this.fallbackTimers.push(stopId);
          }
        }
      }
    }
  }

  public stopPlayback(): void {
    this.playbackActive = false;
    this.playbackSessionId++;
    this.liveMix.clear();
    this.lastMixVolumes.clear();
    for (const s of this.activeSources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    for (const tid of this.fallbackTimers) {
      window.clearTimeout(tid);
    }
    this.fallbackTimers = [];
    for (const el of this.activeFallbackEls) {
      try {
        if (!el.paused) el.pause();
        el.muted = true;
      } catch {
        // ignore
      }
    }
    this.activeFallbackEls = [];
    for (const el of this.fallbackAudioEls.values()) {
      try {
        if (!el.paused) el.pause();
        el.muted = true;
      } catch {
        // ignore
      }
    }
    if (this.silentAudioEl && !this.silentAudioEl.paused && this.iosRouteUnlocked) {
      try {
        this.silentAudioEl.pause();
      } catch {
        // ignore
      }
    }
  }

  public sampleLevel(): number {
    if (!this.analyser || !this.dataArr) return 0;
    this.analyser.getByteTimeDomainData(this.dataArr);
    let peak = 0;
    for (let i = 0; i < this.dataArr.length; i++) {
      const v = Math.abs((this.dataArr[i] - 128) / 128);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak * 1.6);
  }
}

/**
 * True when a layer owns an audio track that should be heard on playback. AM imports a video as a
 * `shape` element whose fill is media, so the fill type counts as a video carrier too — otherwise a
 * shared project's clip plays silent while its own `<video>` sits right there with the track.
 */
function carriesAudio(layer: Layer): boolean {
  const md = layer.mediaData;
  if (!md?.src) return false;
  const isMediaLayer = layer.type === 'video' || (layer.type === 'shape' && layer.fill?.type === 'media');
  if (!isMediaLayer) return false;
  if (md.muted) return false;
  const vol = md.volume ?? 1;
  if (vol <= 0.001) return false;
  // Exclude chromakey/lumakey/screen-blend VFX overlay clips that kept default volume=1 from leaking background noise
  if (
    Math.abs(vol - 1) < 1e-4 &&
    (layer.blendMode === 'screen' ||
      layer.effects.some((e) => e.enabled && (e.effectId.includes('chromakey') || e.effectId.includes('lumakey'))))
  ) {
    return false;
  }
  return true;
}

export const audioEngine = new AudioEngine();
