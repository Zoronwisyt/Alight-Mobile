# MOBILE_AUDIO

Why the editor is silent on a phone while the same project has sound on a desktop, and what the
playback path now does about it.

Scope: **audio during preview playback**. Not export encoding (`PREVIEW_PERF_CHROMA_EXPORT.md`), not
mixer UI. Markers: ✅ verified in the tree this session · ⚠️ predicted, mechanism read from code,
magnitude needs a device trace · ❌ open, needs hardware.

> [!note] The one-sentence version
> Audio was silent for three independent reasons at once — iOS muting Web Audio behind the ring switch,
> an `AudioContext` that never left `suspended` because nothing resumed it inside a gesture, and a
> `decodeAudioData` failure on MP4-with-video that was swallowed while every `<video>` was muted on the
> assumption that Web Audio owned the sound.

---

## 1. The report

> "I can't hear the audio even if I turn my ring on."

The ring switch is a real mechanism, but it is not the only one and on its own it does not explain
silence with the switch on. Three separate breaks produce the same symptom.

## 2. The three breaks

| # | Break | Evidence | What the user sees |
| --- | --- | --- | --- |
| **MA-1** | iOS routes Web Audio through the hardware ring/silent switch unless the page claims a `playback` audio session | `audioEngine.ts:73` (`applyAudioSessionType`) — the code did not exist before | sound only with the switch on; muted with it off, like a game that forgot it is a media app |
| **MA-2** | The context is created by `preloadProjectAudio` at project load, which is **not** a user gesture, so iOS parks it in `suspended` and nothing resumed it | `audioEngine.ts:90` (`installUnlock`), `:115` (resume on every `ensureContext`) | playhead moves, no sound, forever — the clock falls back to wall time in `EditorScreen.tsx:347` |
| **MA-3** | `decodeAudioData` refuses an MP4 that carries video on iOS, `startLayerAudio` swallowed the throw, and `renderer.ts` muted every video because Web Audio was assumed to own the track | `audioEngine.ts:180` marks the source element-owned; `renderer.ts:982` leaves it unmuted | picture plays, silence, and no error anywhere |

The three are independent: fixing one still leaves the other two. That is why "turn the ringer on"
changed nothing that could be observed.

## 3. What playback does now

### 3.1 iOS audio session ✅

```ts
// audioEngine.ts:73
const session = (navigator as Navigator & { audioSession?: { type?: string } }).audioSession;
session.type = 'playback';
```

`navigator.audioSession` is Safari 17.4+. A video editor is a media app: it must not inherit the
ring-switch policy of a web page. ⚠️ predicted for iOS < 17.4, where the property does not exist and
the element fallback in §3.3 is the only path.

### 3.2 Gesture unlock ✅

`ensureContext()` now resumes whenever the state is not `running` (not only when it is `suspended`,
which misses the `interrupted` state iOS enters after a phone call or a background/foreground cycle),
and the first `pointerdown` / `touchend` / `keydown` anywhere in the app resumes the context once.
Import, project open and preload all happen without a gesture; the play button is the *second*
interaction, not the first.

### 3.3 Element-owned video audio ✅

`loadAudioBuffer` records the source in `elementAudioSrcs` when the decode throws, and the renderer
consumes that:

```ts
// renderer.ts:982
if (audioEngine.isElementAudioOwned(md.src)) {
  v.muted = md.muted === true;
  v.volume = Math.max(0, Math.min(1, md.volume ?? 1));
} else {
  v.muted = true;
}
```

The element's own track is unaffected by the ring switch and needs no second download of the file.
This is a **fallback**, not a heuristic: Web Audio stays the primary path because it survives frame
cache hits, which pause the video element. ⚠️ predicted on iOS autoplay policy — a video that starts
playing muted from a `requestAnimationFrame` callback may refuse to unmute until the next gesture.

### 3.4 Group playback no longer hardcoded silent ✅

`EditorScreen.tsx:327` read `const hasAudioTrack = !inGroup && …` and `startPlayback` only ran outside
a group. A shared project is groups all the way down, so entering one — the natural thing to do in a
shared project — muted the project. `hasAudio` and `startPlayback` now take the open group's layer
list (`audioEngine.ts:39`, `:219`) and schedule in that group's own time base, which is how AM plays a
group: as its own timeline.

### 3.5 Media-fill shapes count as audio carriers ✅

AM imports a video as `<shape fillType="media" fillVideo="amproj:…">`. If the media map does not
resolve, the layer keeps `type: 'shape'` and the old collector — which only looked at
`type === 'video'` — skipped it. `carriesAudio` (`audioEngine.ts:321`) now accepts a media-filled
shape.

## 4. Export was dropping video audio too ✅

`videoExporter.ts:104` collected only `audio` layers, so an exported MP4 had the picture and none of
the clip's own sound while the preview had both. Video and media-fill layers now join the offline mix
with `playbackSpeed`, `trimStartMs` and `volume` applied (`videoExporter.ts:112`, `:130`).

❌ Still open for export: a source whose decode fails (MA-3) cannot be mixed offline, because
`OfflineAudioContext` has no media-element source, so a source that cannot be decoded at all was
audible in the preview (through its element) and silent in the exported file. **Closed in §4.1** for
AAC: the mix now has a buffer to schedule, because the track is recovered from the container.

### 4.1 AAC track rescue — the export gap, closed ✅

`decodeAudioData` refusing a container does not mean the audio is gone. `src/engine/mp4Audio.ts`
walks the ISO-BMFF boxes the file already carries — `moov` → `trak` → `mdia/hdlr == 'soun'` →
`minf/stbl` — reads `stsd`/`stsz`/`stsc`/`stco`, pulls the `esds` AudioSpecificConfig for the profile,
frequency index and channel count, and re-wraps every access unit behind a 7-byte ADTS header:

```ts
// audioEngine.ts - decodeViaAdts, called only when the first decode throws
const track = extractAacAdts(bytes);          // null when the file has no AAC track
return await ctx.decodeAudioData(track.adts.slice().buffer);
```

ADTS is the framing every browser's decoder accepts, so this turns "the container is refused" into
"the audio decodes", in the preview and in the offline mix at the same time. `decodeAudioData`
detaches the buffer it is given, which is why the recovery re-fetches instead of holding a second
copy of a whole video file in memory.

Verified by `scripts/audit/check_mp4_audio.ts` (`npm run audit:mp4`): it builds an MP4 in memory with
one `soun` trak and two access units, then asserts the syncword, `0xF1` (MPEG-4, no CRC), the
profile/frequency/channel byte, the 13-bit `frame_length` split across bytes 3-5, and that both
access units come back byte-for-byte. It also asserts that a non-sound trak, garbage, an empty buffer
and a truncated file all yield `null` rather than a fabricated frame.

⚠️ predicted, not device-verified: whether a given iOS build needs this path at all. It only runs when
the primary decode throws, so it cannot regress a file that already decodes.
❌ Still open: ALAC, AC-3 and Opus-in-MP4 have no ADTS equivalent and fall back to the element, which
the offline mix cannot use.

## 5. The gesture hook was spending its grant on nothing ✅

`MA-2`'s first version installed the resume listener from inside `ensureContext`'s context-creation
branch, and removed it the first time it fired. On iOS that is backwards: a tap on the home screen
before a project is loaded creates nothing and consumes the listener, after which the context is
created by a preload - not a gesture - and `resume()` is rejected forever. The listener is now
installed on every `ensureContext` path and only removed once the context is actually observed
`running`; the play gesture also resumes the graph itself and calls `renderer.primeElementAudio()`,
which starts each element-owned `<video>` inside the gesture and parks it again. iOS grants playback
and unmuting per element, and it does not count a `requestAnimationFrame` callback as a gesture.


## 5. Verify on hardware

| Check | Expected |
| --- | --- |
| iOS with the silent switch ON | video audio audible (MA-1) |
| Tap the home screen once, then open a project and play | audio plays — the unlock listener survived (MA-2, §5) |
| Background the app mid-playback, return, press play | audio returns without a reload (MA-2) |
| Enter a group, press play | that group's audio plays (MA-4) |
| Shared link project whose video plays silently on desktop too | audio present from the element path (MA-3) |
| Export MP4 | audio track present, including a clip that only played via its element (MA-5, §4.1) |

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[MOBILE_AUDIO]]` |
| Shipped in | `45e2fa4` (MA-1…MA-5), this revision adds §4.1 and §5 |
| Gate | `npm run audit:mp4` |
| Related | `[[MOBILE_SMOOTHNESS]]`, `[[PLAYBACK_PREVIEW_DECOMPILED]]` |
| Status | shipped, device verification open |
