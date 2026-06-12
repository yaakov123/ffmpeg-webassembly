# ffweb (working name)

A fast, modern WebAssembly port of FFmpeg 8.x for browsers and Node.
Multithreaded + SIMD cores, worker-based API, LGPL and GPL variants.

Design: `docs/superpowers/specs/2026-06-11-ffmpeg-wasm-port-design.md`

## Usage

    import { FFmpeg } from '@ffweb/ffmpeg';

    const ff = await FFmpeg.create({
      // In browsers, point at a self-hosted or CDN copy of the core:
      coreURL: '/vendor/ffmpeg-core.js',          // from @ffweb/core (LGPL)
      // variant: 'gpl',                          // @ffweb/core-gpl: + x264/x265
    });

    await ff.writeFile('/in.webm', new Uint8Array(await file.arrayBuffer()));
    const ret = await ff.exec(['-i', '/in.webm', '-c:v', 'libsvtav1', '/out.mp4'], {
      onProgress: (p) => console.log(`${Math.round((p.ratio ?? 0) * 100)}%`),
      onLog: (l) => console.debug(l.message),
    });
    const out = await ff.readFile('/out.mp4');
    ff.terminate();

Zero-copy input from a `File`/`Blob` (browser):

    await ff.mount('/work', { files: [file] });
    await ff.exec(['-i', `/work/${file.name}`, '/out.mp3']);

### Browser requirements

The multithreaded core needs cross-origin isolation. Serve your page with:

    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp

(A single-thread fallback core that lifts this requirement is Phase 2.)

Node 22+ works out of the box (`FFmpeg.create()` resolves the installed
`@ffweb/core` automatically).

## Performance notes

**Always pass `-threads` (≤ 8) to threaded encoders.** On Chromium, omitting
`-threads` lets encoders like libvpx auto-detect all cores and spawn that many
wasm threads mid-encode, which can deadlock the page (confirmed on ≥12-core
machines; Firefox/WebKit are unaffected). `-threads 4` is a good default.
A core-level fix (clamping reported core count) is planned.

## Building the cores

Requires Docker and Node >= 22.

    make image   # build the toolchain image (once)
    make fetch   # download pinned source tarballs into third_party/
    make libs    # build all codec libraries
    make cores   # build LGPL + GPL FFmpeg cores into packages/*/dist
    npm run test:smoke

## Library development

    npm install && npm run build:lib
    npm run test:unit && npm run test:node
    npx playwright install && npm run test:browser

## Packages

| Package | License | Contents |
|---|---|---|
| `@ffweb/ffmpeg` | MIT | TypeScript API (this is what you import) |
| `@ffweb/core` | LGPL-2.1 | wasm core: all native codecs + VP8/9, AV1, MP3, Opus, Vorbis encoders |
| `@ffweb/core-gpl` | GPL-2.0 | everything above + x264, x265 |
