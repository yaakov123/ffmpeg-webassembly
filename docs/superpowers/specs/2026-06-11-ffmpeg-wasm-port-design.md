# FFmpeg WebAssembly Port — Design

**Date:** 2026-06-11
**Status:** Approved by user (architecture Approach C; dual LGPL/GPL variants; WebCodecs hybrid in v1; targets browsers + Node + workers)

## 1. Goal

A WebAssembly port of FFmpeg, distributed as an npm library, that is:

1. **Fast** — as close to native FFmpeg as the platform allows. WebCodecs hardware paths are native-class; pure-wasm software paths target 2–4x of native (vs ffmpeg.wasm's measured 12–25x).
2. **Cross-browser** — evergreen Chrome/Edge/Firefox/Safari (floor: Safari 16.4), with and without cross-origin isolation, plus Node 18+ and Web Workers.
3. **Easy to use as a library** — one import, lazy-loaded cores, familiar `exec()` CLI interface plus high-level convenience methods.
4. **All possible codecs** — every native FFmpeg codec plus the external encoder libraries, split across LGPL and GPL variants.

## 2. Why ffmpeg.wasm is beatable (research findings, June 2026)

- ffmpeg.wasm pins **FFmpeg n5.1.4** with `--disable-asm` (no SIMD beyond late-added `-msimd128` autovectorization), is capped at 1024MB heap on its mt build, copies all I/O through MEMFS, and has had no core development since Jan 2025. Measured: 25x slower than native (st), 12x (mt).
- **FFmpeg 8.1.1 "Hoare"** (latest stable, 2026-05-04) has first-class wasm support: `--arch=wasm32`, autodetected `simd128` arch extension (requires `-msimd128` in CFLAGS or it is *silently disabled*), hand-written SIMD128 for HEVC (idct 4x4–32x32 8/10-bit, SAO band/edge filters; kernel speedups 2.0–8.7x; whole-file HEVC decode ~4–4.6x vs C), and autovectorization no longer disabled.
- FFmpeg ≥6 CLI **requires threads** (why ffmpeg.wasm never upgraded). libav.js proved the workaround: fiber-emulated threads (Asyncify/emfiberthreads) for non-pthread builds.
- **WebCodecs** is cross-browser now: video decode/encode Chrome 94+/Firefox 130+/Safari 16.4+; audio everywhere incl. Safari 26+. H.264 encode is universally available (hardware). Gaps that wasm must fill: MP3/FLAC encode (no browser), AV1 on non-HW Safari, Firefox Android, AAC encode on Firefox/Linux.
- **Threads** still require cross-origin isolation in every browser (Safari lacks `COEP: credentialless`; Chrome 137+ has Document-Isolation-Policy as a Chromium-only easing). SIMD128 is universal. Relaxed SIMD is Chrome+Firefox only (Safari behind flag) — optional later optimization. JSPI is Chrome 137+/Firefox 139+ but Safari-27-beta-only → cannot rely on it in v1; ST builds use Asyncify.
- **Memory:** wasm32 with `ALLOW_MEMORY_GROWTH` to 4GB. Memory64 exists (Chrome 133+/FF 134+, no Safari) but costs 10–100% perf — not used.
- **OPFS sync access handles** (universal, worker-only, no isolation needed) + WORKERFS give streaming I/O without whole-file copies.

## 3. Architecture (Approach C: CLI + pipeline API)

```
┌────────────────────────── @ffweb/ffmpeg (TS, MIT) ──────────────────────────┐
│  Public API (main thread / worker / Node)                                   │
│   ├─ exec(args), ffprobe(args)            ── CLI compatibility layer        │
│   ├─ transcode(), probe(), thumbnail(),   ── convenience methods            │
│   │  extractAudio(), trim()                  (ride on pipeline)             │
│   └─ pipeline primitives: Demuxer, Decoder, Filter, Encoder, Muxer          │
│  Orchestrator: per-stream codec routing                                     │
│   ├─ WebCodecs (isConfigSupported → hardware)                               │
│   └─ wasm libavcodec fallback                                               │
│  Worker RPC bridge (Comlink-style message protocol, transferables)          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ dedicated Worker
┌──────────────────────────────────┴──────────────────────────────────────────┐
│  wasm core (one of 4 binaries, lazy-loaded)                                 │
│   ├─ fftools entry points: _ffmpeg(argc, argv), _ffprobe(argc, argv)        │
│   ├─ C glue: thin exported fns over libavformat/codec/filter for pipeline   │
│   └─ I/O: WORKERFS (File/Blob), MEMFS, JS-backed AVIO protocol (streams),   │
│           OPFS sync handles                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Layer 1 — `exec()` (CLI compatibility)

Vendor FFmpeg 8.1.1 `fftools/` with the ffmpeg.wasm-style patch set, ported to 8.x:

- `main()` → exported `ffmpeg(argc, argv)` / `ffprobe(argc, argv)`.
- `exit_program()` → store return code on `Module.ret`, `abort()` (catchable in JS) instead of `exit()`.
- Globals reset (`init_globals()`) at entry for re-entrancy across calls.
- Progress/log via `EM_JS` callbacks (`Module.receiveProgress`, logger), plus a timeout check in the transcode loop.

This layer gives 100% of FFmpeg behavior (filters, bitstream filters, maps, complex graphs) with the API every FFmpeg user already knows.

### 3.2 Layer 2 — pipeline API + WebCodecs hybrid

Thin C glue (modelled on libav.js's approach, written fresh for FFmpeg 8.1) exposing:

- demux: open input (any AVIO source) → stream info → packet reader
- decode/encode: codec contexts with packet/frame in/out
- filter: AVFilterGraph build/run
- mux: open output (any AVIO sink) → packet writer
- utilities: parsers, BSFs (`h264_mp4toannexb` etc. needed for WebCodecs), timestamp math

The TS orchestrator builds a per-stream plan:

1. Demux in wasm (libavformat handles every container).
2. For each codec stage, query `VideoDecoder/VideoEncoder/AudioDecoder/AudioEncoder.isConfigSupported()`; route to WebCodecs when supported, wasm otherwise. Routing is per-stage: hardware H.264 decode can feed wasm x265 encode and vice versa.
3. Packet/frame bridging: AVPacket ↔ `EncodedVideoChunk`/`EncodedAudioChunk` (with BSF conversion where needed, e.g. AVCC↔Annex B); `VideoFrame.copyTo()` into wasm heap when filtering is needed; zero-copy `VideoFrame` pass-through when decode→encode are both WebCodecs and no wasm filter intervenes.
4. Mux in wasm.

Failure semantics: if a WebCodecs stage errors mid-stream (hardware quirks happen), the orchestrator restarts that stage on the wasm path. Output correctness is never dependent on hardware availability — WebCodecs is purely an accelerator.

### 3.3 I/O — streaming-first

- **Inputs:** `File`/`Blob` → WORKERFS mount (zero-copy reads); `ReadableStream`/URL → custom JS-backed AVIO protocol (pull-based, with seek support when the source allows ranged reads); OPFS paths; `Uint8Array` → MEMFS.
- **Outputs:** `WritableStream`; OPFS (sync access handles in the worker — fastest path, also how >RAM outputs work); `Uint8Array` buffer.
- **Compatibility:** `writeFile`/`readFile`/`deleteFile`/`listDir`/`mount` matching ffmpeg.wasm's surface, for easy migration.

### 3.4 Worker & environment model

The core always runs in a dedicated worker the library spawns (never blocks the caller's thread). The public API is callable from the main thread, from inside a user's own worker, and from Node (where "worker" = `worker_threads`). Emscripten output: `-sEXPORT_ES6 -sMODULARIZE`, environment `web,worker,node`.

## 4. The wasm cores

### 4.1 Build matrix

2 license variants × 2 threading models = 4 binaries. The JS lib auto-selects mt vs st via `crossOriginIsolated`; the user selects gpl vs lgpl (default: lgpl).

| | mt | st |
|---|---|---|
| Threading | pthreads (`-pthread`, pool sized to `navigator.hardwareConcurrency`) | fiber-emulated threads (Asyncify, libav.js's emfiberthreads approach) so FFmpeg 8's thread-requiring code still runs |
| Requires | COOP/COEP (cross-origin isolation) | nothing |
| Memory | `INITIAL_MEMORY=256MB, ALLOW_MEMORY_GROWTH, MAXIMUM_MEMORY=4GB` | `INITIAL_MEMORY=32MB, ALLOW_MEMORY_GROWTH, MAXIMUM_MEMORY=4GB` |

### 4.2 Toolchain & flags

- emsdk 4.x (latest stable) via Docker (`emscripten/emsdk` image) — fully reproducible builds; no host toolchain needed beyond Docker.
- FFmpeg configure: `--target-os=none --arch=wasm32 --enable-cross-compile --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --disable-network`, `--extra-cflags="-O3 -msimd128 [-pthread]"`, matching ldflags. **`-msimd128` is mandatory** — without it FFmpeg silently disables simd128.
- Link: `-O3 -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createFFmpegCore -sWASM_BIGINT -sSTACK_SIZE=5MB` (emscripten default 64KB stack overflows FFmpeg; 5MB also needed by libopus), exported functions/runtime methods per layer needs, `-lworkerfs.js`.
- External codec libs each built with emscripten using known-good recipes (asm disabled, `--host` tricks per library; see §4.3 evidence column sources: ffmpeg.wasm `build/*.sh`, libav.js `mk/*.mk`).

### 4.3 Codec sets

**LGPL core** (`--enable-version3` as needed, no `--enable-gpl`):

- All native FFmpeg codecs: every decoder (H.264, HEVC, AV1, VP8/9, MPEG-1/2/4, ProRes, DNxHD, Theora, ...), AAC encode/decode, FLAC/ALAC/MP2/PCM encode, all native audio decoders, all muxers/demuxers (mp4, mkv/webm, mpegts, hls, ogg, flac, wav, mov, avi, ...), parsers, BSFs, libavfilter (full filter set incl. scale via zimg), libswscale, libswresample.
- External: **libvpx** (VP8/VP9 encode), **SVT-AV1** (AV1 encode), **dav1d** (fast AV1 decode), **lame** (MP3 encode — no native), **opus** (quality encode), **libvorbis+libogg** (Vorbis encode), **zlib**, **libwebp**, **freetype+fribidi+harfbuzz+libass** (subtitle burn-in, drawtext), **zimg**.
- Deliberately excluded: **openh264** (Cisco's patent grant covers only Cisco's binaries, not self-compiled wasm; H.264 encode is served by WebCodecs — universally supported in hardware — or the GPL core), **fdk-aac** (license makes binaries non-redistributable; native AAC encoder is adequate).

**GPL core**: LGPL set **+ x264 + x265** (8/10/12-bit). The binary is GPL-2.0; documented clearly.

Patent note (documented in README, modelled on libav.js): we ship source for all LGPL components, and note that H.264/HEVC/AAC are patent-encumbered; users in affected jurisdictions can rely on WebCodecs (browser/OS-licensed codecs) via the pipeline layer.

### 4.4 Single-thread `exec()` caveat

FFmpeg 8 fftools assumes threads. The st core runs them on Asyncify fibers (cooperative scheduling). This is correctness-first: st exists so the library *works* on non-isolated pages; performance guidance steers users to mt (docs include copy-paste COOP/COEP and Chrome DIP header setups).

## 5. Public API sketch

```ts
import { FFmpeg } from '@ffweb/ffmpeg';

const ff = await FFmpeg.create({ variant: 'lgpl' });    // auto mt/st, lazy core load

// Layer 1 — CLI compatibility
await ff.writeFile('in.webm', file);                     // or mount/streams
await ff.exec(['-i', 'in.webm', '-c:v', 'libsvtav1', 'out.mp4'],
              { onProgress: p => bar.set(p.progress) });
const out = await ff.readFile('out.mp4');

// Layer 2 — convenience (WebCodecs-accelerated automatically)
const mp4 = await ff.transcode(file, { to: 'mp4', video: 'h264', audio: 'aac' });
const meta = await ff.probe(file);
const jpg  = await ff.thumbnail(file, { at: 12.5 });

// Streaming
await ff.transcode(url, { to: 'webm', output: writableStream });
```

Type-safe options throughout (`@ffweb/ffmpeg` ships its own types); errors are typed (`FFmpegError` with ffmpeg log tail attached).

## 6. Packaging & distribution

- Monorepo (npm workspaces): `packages/ffmpeg` (TS lib), `packages/core` (LGPL binaries), `packages/core-gpl` (GPL binaries), `build/` (Dockerfile + per-library build scripts), `tests/`, `bench/`, `examples/`, `docs/`.
- Cores are separate packages so the MIT JS lib never bundles (L)GPL bits; loaded at runtime from self-host path or CDN (jsDelivr/unpkg) with the ffmpeg.wasm-style `locateFile` fragment hack for nested worker URLs.
- ESM-first; UMD bundle for `<script>` users. Node 18+.

## 7. Testing

- **Unit (Vitest):** TS layer — option mapping, routing decisions (mocked `isConfigSupported`), RPC protocol, FS API.
- **Integration (Playwright):** real Chromium/Firefox/WebKit. Matrix: {mt, st} × {isolated, non-isolated} × {WebCodecs available, forced-wasm}. Golden-file transcodes (small fixtures, hash/probe-verified outputs), probe correctness vs native ffprobe JSON.
- **Node smoke tests** for the same API.
- **Benchmarks (`bench/`):** standard clips (Big Buck Bunny 720p/1080p) — this project vs ffmpeg.wasm vs native ffmpeg; tracked in CI table so the performance claim stays honest.

## 8. Error handling

- Core crashes (`abort()`) are contained in the worker; the worker is recycled and the call rejects with a typed error carrying the ffmpeg log tail.
- WebCodecs stage failures fall back to wasm mid-job (per §3.2) — at most a stage restart, never a corrupt output.
- OOM: growth to 4GB, then a typed `OutOfMemoryError` recommending streaming I/O.
- ST-on-non-isolated-page is silent and automatic; a `ff.capabilities` object reports what was selected and why, so apps can show "enable COOP/COEP for 4x speed" hints.

## 9. Phases (each independently shippable)

1. **Foundation** — Docker build infra; LGPL+GPL **mt** cores (FFmpeg 8.1.1, SIMD, full codec sets); fftools patch port; worker JS lib with `exec()`/`ffprobe()`/FS API; Vitest+Playwright harness; CI. *Outcome: a maintained, drop-in-shaped ffmpeg.wasm replacement that is multiples faster with more codecs and 4GB memory.*
2. **Universality** — st fiber cores; streaming I/O (WORKERFS/streams/OPFS); Node support; mt/st auto-detection; migration-compat FS surface complete.
3. **Hybrid speed** — pipeline C glue; WebCodecs orchestrator with per-stage routing and fallback; convenience APIs (`transcode`, `probe`, `thumbnail`, `extractAudio`, `trim`).
4. **Polish** — benchmark suite in CI; docs site with COOP/COEP recipes; CDN publishing; migration guide from ffmpeg.wasm.

## 10. Non-goals (v1)

- Memory64/>4GB in-memory files (streaming I/O is the answer); relaxed-SIMD builds; JSPI (revisit when Safari 27 ships); networking protocols inside wasm (http/rtmp — browser fetch handles input URLs); GPU filters (WebGPU) — possible future phase; encoding via rav1e/kvazaar/fdk-aac.

## 11. Open questions resolved

- **Licensing variants:** dual (LGPL core + GPL full) — user decision.
- **WebCodecs in v1:** yes — user decision.
- **Targets:** browsers + Node + workers — user decision.
- **Architecture:** Approach C (CLI + pipeline) — user decision.
- **Naming:** `@ffweb/*` is a placeholder; pick the real npm scope before first publish.
