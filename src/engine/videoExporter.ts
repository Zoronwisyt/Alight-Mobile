import { ArrayBufferTarget as Mp4ArrayBufferTarget, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmArrayBufferTarget, Muxer as WebmMuxer } from 'webm-muxer';
import type { Layer, Project } from '../types/project';
import { evalAnimatable, evalRemappedTime } from './animation';
import { audioEngine } from './audioEngine';
import type { AlightRenderer } from './renderer';

export type VideoContainer = 'mp4' | 'webm';

export interface VideoExportOptions {
  fps: number;
  width: number;
  height: number;
  bitrateMbps: number;
  container: VideoContainer;
  includeAudio?: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number, label: string) => void;
}

export interface VideoExportResult {
  blob: Blob;
  ext: VideoContainer;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrateMbps: number;
  codec: string;
  hasAudio: boolean;
}

function makeEven(n: number): number {
  return Math.max(16, Math.round(n / 2) * 2);
}

const AVC_CANDIDATES = [
  'avc1.640033', // High 5.1 (4K60)
  'avc1.640032', // High 5.0 (1080p60 / 1440p60)
  'avc1.64002a', // High 4.2 (1080p60)
  'avc1.640029', // High 4.1
  'avc1.640028', // High 4.0
  'avc1.4d0032', // Main 5.0
  'avc1.4d002a', // Main 4.2
  'avc1.4d0028', // Main 4.0
  'avc1.42002a', // Baseline 4.2
  'avc1.42001f', // Baseline 3.1
];

const WEBM_CANDIDATES = [
  'vp09.00.41.08', // VP9 Level 4.1 (1080p60+)
  'vp09.00.31.08', // VP9 Level 3.1
  'vp09.00.21.08',
  'vp8',
];

async function pickSupportedVideoConfig(
  container: VideoContainer,
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<{ config: VideoEncoderConfig; muxCodec: 'avc' | 'V_VP9' | 'V_VP8' } | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }
  const candidates = container === 'mp4' ? AVC_CANDIDATES : WEBM_CANDIDATES;
  const accelModes: HardwareAcceleration[] = ['prefer-hardware', 'no-preference', 'prefer-software'];

  for (const hardwareAcceleration of accelModes) {
    for (const codec of candidates) {
      const base: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        bitrateMode: 'variable',
        hardwareAcceleration,
        ...(container === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
      };
      try {
        const res = await VideoEncoder.isConfigSupported(base);
        if (res.supported) {
          const muxCodec = container === 'mp4' ? 'avc' : codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8';
          return { config: res.config ?? base, muxCodec };
        }
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

function collectAudioLayers(layers: Layer[], offsetMs: number, out: { layer: Layer; absStart: number; absEnd: number }[]) {
  for (const l of layers) {
    if (!l.visible) continue;
    if (l.type === 'group' && l.groupLayers?.length) {
      collectAudioLayers(l.groupLayers, offsetMs + l.startTime, out);
    } else if (l.type === 'audio' && l.audioData && !l.audioData.muted) {
      out.push({ layer: l, absStart: offsetMs + l.startTime, absEnd: offsetMs + l.endTime });
    }
  }
}

async function renderProjectAudioMix(project: Project, durationSec: number): Promise<AudioBuffer | null> {
  const audioLayers: { layer: Layer; absStart: number; absEnd: number }[] = [];
  collectAudioLayers(project.layers, 0, audioLayers);
  if (audioLayers.length === 0) return null;

  const sampleRate = 48000;
  const totalSamples = Math.max(1, Math.ceil(durationSec * sampleRate));
  const offline = new OfflineAudioContext(2, totalSamples, sampleRate);
  let attached = 0;

  for (const { layer, absStart, absEnd } of audioLayers) {
    if (!layer.audioData) continue;
    try {
      const buf = await audioEngine.loadAudioBuffer(layer.audioData.src, layer.audioData.synthPattern);
      const src = offline.createBufferSource();
      src.buffer = buf;
      const gain = offline.createGain();
      const { remappedNormT } = evalRemappedTime(layer, absStart);
      const vol = evalAnimatable(layer.audioData.volume, remappedNormT, 1);
      gain.gain.value = Math.max(0, Math.min(2, vol));
      src.connect(gain);
      gain.connect(offline.destination);

      const startSec = Math.max(0, absStart / 1000);
      const playDur = Math.max(0.02, Math.min(durationSec - startSec, (absEnd - absStart) / 1000, buf.duration));
      if (playDur > 0.02 && startSec < durationSec) {
        src.start(startSec, 0, playDur);
        attached++;
      }
    } catch {
      // skip unreadable audio track
    }
  }

  if (attached === 0) return null;
  return offline.startRendering();
}

async function encodeAudioBuffer(
  audioBuf: AudioBuffer,
  container: VideoContainer,
  onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void
): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  const codec = container === 'mp4' ? 'mp4a.40.2' : 'opus';
  const cfg: AudioEncoderConfig = {
    codec,
    numberOfChannels: audioBuf.numberOfChannels,
    sampleRate: audioBuf.sampleRate,
    bitrate: 192_000,
  };
  try {
    const sup = await AudioEncoder.isConfigSupported(cfg);
    if (!sup.supported) return false;
  } catch {
    return false;
  }

  let encError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => onChunk(chunk, meta),
    error: (err) => {
      encError = err instanceof Error ? err : new Error(String(err));
    },
  });
  encoder.configure(cfg);

  const chunkFrames = 1024;
  const numCh = audioBuf.numberOfChannels;
  const totalFrames = audioBuf.length;

  for (let offset = 0; offset < totalFrames; offset += chunkFrames) {
    if (encError) throw encError;
    const frames = Math.min(chunkFrames, totalFrames - offset);
    const planar = new Float32Array(frames * numCh);
    for (let ch = 0; ch < numCh; ch++) {
      planar.set(audioBuf.getChannelData(ch).subarray(offset, offset + frames), ch * frames);
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: audioBuf.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: numCh,
      timestamp: Math.round((offset * 1_000_000) / audioBuf.sampleRate),
      data: planar,
    });
    encoder.encode(audioData);
    audioData.close();
  }

  await encoder.flush();
  encoder.close();
  if (encError) throw encError;
  return true;
}

/**
 * Deterministic offline constant-framerate (CFR) video exporter powered by WebCodecs + mp4-muxer / webm-muxer.
 * Guarantees exact frame rate (e.g. 60.000 fps), exact even pixel dimensions, and exact bitrate.
 */
export async function exportProjectVideo(
  renderer: AlightRenderer,
  project: Project,
  options: VideoExportOptions
): Promise<VideoExportResult> {
  const fps = Math.max(12, Math.min(120, Math.round(options.fps)));
  const width = makeEven(options.width);
  const height = makeEven(options.height);
  const bitrate = Math.max(1_000_000, Math.round(options.bitrateMbps * 1_000_000));
  const durationSec = Math.max(0.1, project.durationMs / 1000);
  const totalFrames = Math.max(1, Math.round(durationSec * fps));

  let container: VideoContainer = options.container;
  let picked = await pickSupportedVideoConfig(container, width, height, fps, bitrate);
  if (!picked) {
    const fallbackContainer: VideoContainer = container === 'mp4' ? 'webm' : 'mp4';
    picked = await pickSupportedVideoConfig(fallbackContainer, width, height, fps, bitrate);
    if (picked) container = fallbackContainer;
  }

  // Fallback only for browsers lacking WebCodecs VideoEncoder
  if (!picked) {
    return exportViaMediaRecorderFallback(renderer, project, { ...options, fps, width, height, container });
  }

  // Prepare optional offline audio mix
  let audioBuf: AudioBuffer | null = null;
  let audioSupported = false;
  if (options.includeAudio !== false && typeof AudioEncoder !== 'undefined') {
    options.onProgress?.(0, 'Mixing audio tracks...');
    audioBuf = await renderProjectAudioMix(project, durationSec);
    if (audioBuf) {
      try {
        const check = await AudioEncoder.isConfigSupported({
          codec: container === 'mp4' ? 'mp4a.40.2' : 'opus',
          numberOfChannels: audioBuf.numberOfChannels,
          sampleRate: audioBuf.sampleRate,
          bitrate: 192_000,
        });
        audioSupported = Boolean(check.supported);
      } catch {
        audioSupported = false;
      }
    }
  }

  const mp4Target = container === 'mp4' ? new Mp4ArrayBufferTarget() : null;
  const webmTarget = container === 'webm' ? new WebmArrayBufferTarget() : null;

  const mp4Muxer =
    container === 'mp4' && mp4Target
      ? new Mp4Muxer({
          target: mp4Target,
          video: {
            codec: 'avc',
            width,
            height,
            frameRate: fps,
          },
          audio:
            audioBuf && audioSupported
              ? {
                  codec: 'aac',
                  numberOfChannels: audioBuf.numberOfChannels,
                  sampleRate: audioBuf.sampleRate,
                }
              : undefined,
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        })
      : null;

  const webmMuxer =
    container === 'webm' && webmTarget
      ? new WebmMuxer({
          target: webmTarget,
          video: {
            codec: picked.muxCodec === 'V_VP8' ? 'V_VP8' : 'V_VP9',
            width,
            height,
            frameRate: fps,
          },
          audio:
            audioBuf && audioSupported
              ? {
                  codec: 'A_OPUS',
                  numberOfChannels: audioBuf.numberOfChannels,
                  sampleRate: audioBuf.sampleRate,
                }
              : undefined,
          firstTimestampBehavior: 'offset',
        })
      : null;

  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (mp4Muxer) mp4Muxer.addVideoChunk(chunk, meta);
      else if (webmMuxer) webmMuxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  videoEncoder.configure(picked.config);
  const keyFrameInterval = Math.max(1, Math.round(fps * 2));

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (options.signal?.aborted) {
        throw new Error('Export cancelled.');
      }
      if (encoderError) throw encoderError;

      // Exact frame time in milliseconds
      const tMs = (f * 1000) / fps;
      await renderer.prepareMediaAtTime(project, tMs);
      renderer.renderProject(project, tMs, {
        renderWidth: width,
        renderHeight: height,
      });

      // Exact CFR timestamps in microseconds (no floating-point drift across 60fps streams)
      const timestampUs = Math.round((f * 1_000_000) / fps);
      const nextTimestampUs = Math.round(((f + 1) * 1_000_000) / fps);
      const durationUs = Math.max(1, nextTimestampUs - timestampUs);

      const frame = new VideoFrame(renderer.canvas, {
        timestamp: timestampUs,
        duration: durationUs,
      });
      videoEncoder.encode(frame, { keyFrame: f === 0 || f % keyFrameInterval === 0 });
      frame.close();

      // Backpressure so GPU & encoder queue stay healthy on long 60fps renders
      while (videoEncoder.encodeQueueSize > 8) {
        if (options.signal?.aborted) throw new Error('Export cancelled.');
        if (encoderError) throw encoderError;
        await new Promise((r) => setTimeout(r, 4));
      }

      if (f % 2 === 0 || f === totalFrames - 1) {
        options.onProgress?.(
          (f + 1) / (totalFrames + (audioBuf && audioSupported ? 4 : 0)),
          `Encoding frame ${f + 1} / ${totalFrames} (${width}×${height} @ ${fps} fps)`
        );
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    options.onProgress?.(0.96, 'Flushing video stream...');
    await videoEncoder.flush();
    videoEncoder.close();
    if (encoderError) throw encoderError;

    let hasAudio = false;
    if (audioBuf && audioSupported) {
      options.onProgress?.(0.98, 'Encoding audio track...');
      hasAudio = await encodeAudioBuffer(audioBuf, container, (chunk, meta) => {
        if (mp4Muxer) mp4Muxer.addAudioChunk(chunk, meta);
        else if (webmMuxer) webmMuxer.addAudioChunk(chunk, meta);
      });
    }

    let buffer: ArrayBuffer;
    let mimeType: string;
    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize();
      buffer = mp4Target.buffer;
      mimeType = 'video/mp4';
    } else if (webmMuxer && webmTarget) {
      webmMuxer.finalize();
      buffer = webmTarget.buffer;
      mimeType = 'video/webm';
    } else {
      throw new Error('Muxer initialization failed.');
    }

    options.onProgress?.(1, 'Done');
    return {
      blob: new Blob([buffer], { type: mimeType }),
      ext: container,
      mimeType,
      width,
      height,
      fps,
      totalFrames,
      bitrateMbps: options.bitrateMbps,
      codec: picked.config.codec,
      hasAudio,
    };
  } catch (err) {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

async function exportViaMediaRecorderFallback(
  renderer: AlightRenderer,
  project: Project,
  options: VideoExportOptions
): Promise<VideoExportResult> {
  const { fps, width, height, bitrateMbps } = options;
  const totalFrames = Math.max(1, Math.round((project.durationMs / 1000) * fps));
  const mimeTypes =
    options.container === 'mp4'
      ? ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const ext: VideoContainer = mimeType.includes('mp4') ? 'mp4' : 'webm';

  await renderer.prepareMediaAtTime(project, 0);
  renderer.renderProject(project, 0, { renderWidth: width, renderHeight: height });

  const stream = renderer.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrateMbps * 1_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(100);

  const frameMs = 1000 / fps;
  const startWall = performance.now();
  for (let f = 0; f < totalFrames; f++) {
    if (options.signal?.aborted) {
      recorder.stop();
      throw new Error('Export cancelled.');
    }
    const tMs = (f * 1000) / fps;
    await renderer.prepareMediaAtTime(project, tMs);
    renderer.renderProject(project, tMs, { renderWidth: width, renderHeight: height });
    track.requestFrame?.();
    options.onProgress?.((f + 1) / totalFrames, `Recording frame ${f + 1} / ${totalFrames} (${fps} fps)`);
    const targetWall = startWall + (f + 1) * frameMs;
    const wait = targetWall - performance.now();
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
  }
  recorder.stop();
  await stopped;

  return {
    blob: new Blob(chunks, { type: mimeType }),
    ext,
    mimeType,
    width,
    height,
    fps,
    totalFrames,
    bitrateMbps,
    codec: mimeType,
    hasAudio: false,
  };
}
