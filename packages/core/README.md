# @ffweb/core

FFmpeg 8.1 compiled to WebAssembly (multithreaded + SIMD). **LGPL-2.1 build** —
contains no GPL components (no x264/x265).

Includes: all native FFmpeg codecs/muxers/demuxers/filters, libvpx (VP8/VP9
encode), SVT-AV1 (AV1 encode), dav1d (AV1 decode), LAME (MP3 encode), Opus,
Vorbis, libwebp, libass subtitle rendering, zimg scaling.

H.264/HEVC *encoding* is not in this build: use the browser's hardware encoder
via the `@ffweb/ffmpeg` pipeline API, or `@ffweb/core-gpl`.

`sources.json` lists the exact upstream sources for every compiled component.
Patent note: H.264/HEVC/AAC are patent-encumbered technologies; shipping and
using codecs may require licenses in some jurisdictions. The pipeline API's
WebCodecs path uses the browser/OS codecs, which carry their own licensing.
