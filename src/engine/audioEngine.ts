import type { Layer, Project } from '../types/project';
import { evalAnimatable, evalRemappedTime } from './animation';

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
  private loading = new Map<string, Promise<AudioBuffer>>();
  private playbackStartCtxTime = 0;
  private playbackStartSceneMs = 0;
  private playbackActive = false;
  private playbackSessionId = 0;
  private unlockInstalled = false;

  /**
   * `layers` scopes the scan to the group currently open in the editor: AM plays a group as its own
   * timeline, so its audio is scheduled in the group's local time base. Without it, pressing play
   * inside a group was silent — which is exactly where a shared project spends most of its time.
   */
  public hasAudio(project: Project, layers?: Layer[]): boolean {
    const out: { layer: Layer; absStart: number; absEnd: number }[] = [];
    this.collectAudioLayers(layers ?? project.layers, 0, out);
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
  public isElementAudioOwned(src: string): boolean {
    return this.elementAudioSrcs.has(src);
  }

  /** Pre-decodes audio & video audio tracks in the background so pressing Play has zero audio lag */
  public preloadProjectAudio(project: Project): void {
    const items: { layer: Layer; absStart: number; absEnd: number }[] = [];
    this.collectAudioLayers(project.layers, 0, items);
    for (const { layer } of items) {
      const src = layer.type === 'audio' ? layer.audioData?.src : layer.mediaData?.src;
      const synth = layer.type === 'audio' ? layer.audioData?.synthPattern : undefined;
      if (src || synth) {
        void this.loadAudioBuffer(src || '', synth).catch(() => {});
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

  /**
   * iOS only lets an AudioContext leave `suspended` inside a user gesture. Import, project load and
   * preload all happen without one, so the context is primed by the first touch/keypress anywhere in
   * the app rather than by the play button alone.
   */
  private installUnlock(): void {
    if (this.unlockInstalled || typeof window === 'undefined') return;
    this.unlockInstalled = true;
    const unlock = () => {
      this.ensureContext();
      this.removeUnlock();
    };
    this.unlockHandler = unlock;
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchend', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private unlockHandler: (() => void) | null = null;

  private removeUnlock(): void {
    if (!this.unlockHandler || typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', this.unlockHandler);
    window.removeEventListener('touchend', this.unlockHandler);
    window.removeEventListener('keydown', this.unlockHandler);
    this.unlockHandler = null;
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
      this.installUnlock();
    }
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public async loadAudioBuffer(src: string, synthPattern?: 'beat' | 'ambient' | 'pulse'): Promise<AudioBuffer> {
    const key = synthPattern ? `__synth_${synthPattern}` : src;
    const cached = this.buffers.get(key);
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
        const res = await fetch(src);
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr);
        this.buffers.set(key, buf);
        return buf;
      } catch (err) {
        this.failedAudioSrcs.add(key);
        // A video container that will not decode still has a usable audio track inside its element.
        this.elementAudioSrcs.add(key);
        throw err;
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, promise);
    return promise;
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

  private collectAudioLayers(layers: Layer[], offsetMs: number, out: { layer: Layer; absStart: number; absEnd: number }[]) {
    for (const l of layers) {
      if (!l.visible) continue;
      if (l.type === 'group' && l.groupLayers?.length) {
        this.collectAudioLayers(l.groupLayers, offsetMs + l.startTime, out);
      } else if (l.type === 'audio' && l.audioData && !l.audioData.muted) {
        out.push({ layer: l, absStart: offsetMs + l.startTime, absEnd: offsetMs + l.endTime });
      } else if (carriesAudio(l)) {
        out.push({ layer: l, absStart: offsetMs + l.startTime, absEnd: offsetMs + l.endTime });
      }
    }
  }

  public startPlayback(project: Project, startMs: number, layers?: Layer[]): void {
    this.stopPlayback();
    const ctx = this.ensureContext();
    const sessionId = ++this.playbackSessionId;
    this.playbackStartCtxTime = ctx.currentTime;
    this.playbackStartSceneMs = startMs;
    this.playbackActive = true;
    const audioLayers: { layer: Layer; absStart: number; absEnd: number }[] = [];
    this.collectAudioLayers(layers ?? project.layers, 0, audioLayers);

    for (const item of audioLayers) {
      void this.startLayerAudio(item.layer, item.absStart, item.absEnd, startMs, ctx, sessionId);
    }
  }

  private async startLayerAudio(
    layer: Layer,
    absStart: number,
    absEnd: number,
    sceneMs: number,
    ctx: AudioContext,
    sessionId: number
  ) {
    const isVideo = layer.type !== 'audio';
    const mediaSrc = isVideo ? layer.mediaData?.src : layer.audioData?.src;
    const synthPattern = isVideo ? undefined : layer.audioData?.synthPattern;
    if (!mediaSrc && !synthPattern) return;
    if (sceneMs > absEnd) return;
    if (isVideo && mediaSrc && this.elementAudioSrcs.has(mediaSrc)) {
      // The element owns this track; decoding it again would double the download for nothing.
      return;
    }
    try {
      const buf = await this.loadAudioBuffer(mediaSrc || '', synthPattern);
      // Abort if playback was paused, stopped, or restarted while decoding
      if (sessionId !== this.playbackSessionId || !this.playbackActive) return;

      // Compensate for any async decode latency so audio locks tightly to the hardware clock
      const decodeElapsedMs = Math.max(0, (ctx.currentTime - this.playbackStartCtxTime) * 1000);
      const effectiveSceneMs = sceneMs + decodeElapsedMs;
      if (effectiveSceneMs >= absEnd) return;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const speed = isVideo ? Math.max(0.1, Math.min(4, layer.mediaData?.playbackSpeed || 1)) : 1;
      src.playbackRate.value = speed;

      const gain = ctx.createGain();
      const { remappedNormT } = evalRemappedTime(layer, effectiveSceneMs);
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
    } catch {
      // fetch/decode failure: the source is now element-owned (see loadAudioBuffer), or silent
    }
  }

  public stopPlayback(): void {
    this.playbackActive = false;
    this.playbackSessionId++;
    for (const s of this.activeSources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
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
  return (md.volume ?? 1) > 0.001;
}

export const audioEngine = new AudioEngine();
