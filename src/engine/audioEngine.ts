import type { Layer, Project } from '../types/project';
import { evalAnimatable, evalRemappedTime } from './animation';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArr: Uint8Array<ArrayBuffer> | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private activeSources: AudioBufferSourceNode[] = [];
  private loading = new Set<string>();

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.ctx.destination);
      this.dataArr = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    }
    if (this.ctx.state === 'suspended') {
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

    if (this.loading.has(key)) {
      throw new Error('Loading');
    }
    this.loading.add(key);
    try {
      const res = await fetch(src);
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      this.buffers.set(key, buf);
      return buf;
    } finally {
      this.loading.delete(key);
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

  public startPlayback(project: Project, startMs: number): void {
    this.stopPlayback();
    const ctx = this.ensureContext();
    const audioLayers = project.layers.filter(
      (l) => l.type === 'audio' && l.visible && l.audioData && !l.audioData.muted
    );

    for (const l of audioLayers) {
      this.startLayerAudio(l, startMs, ctx);
    }
  }

  private async startLayerAudio(layer: Layer, sceneMs: number, ctx: AudioContext) {
    if (!layer.audioData) return;
    if (sceneMs > layer.endTime) return;
    try {
      const buf = await this.loadAudioBuffer(layer.audioData.src, layer.audioData.synthPattern);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      const { remappedNormT } = evalRemappedTime(layer, sceneMs);
      const vol = evalAnimatable(layer.audioData.volume, remappedNormT, 1);
      gain.gain.value = Math.max(0, Math.min(2, vol));
      src.connect(gain);
      gain.connect(this.analyser!);

      const delaySec = Math.max(0, (layer.startTime - sceneMs) / 1000);
      const offsetSec = Math.max(0, (sceneMs - layer.startTime) / 1000) % buf.duration;
      const playDur = Math.max(0.05, (layer.endTime - Math.max(sceneMs, layer.startTime)) / 1000);
      src.start(ctx.currentTime + delaySec, offsetSec, Math.min(playDur, buf.duration - offsetSec));
      this.activeSources.push(src);
    } catch {
      // ignore fetch/decode failure
    }
  }

  public stopPlayback(): void {
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

export const audioEngine = new AudioEngine();
