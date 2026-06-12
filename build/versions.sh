#!/bin/bash
# Pinned upstream versions. Known-good combinations from ffmpeg.wasm /
# libav.js research (see spec §4.3).
FFMPEG_VERSION=n8.1.1
FFMPEG_URL="https://github.com/FFmpeg/FFmpeg/archive/refs/tags/${FFMPEG_VERSION}.tar.gz"

X264_COMMIT=b35605ace3ddf7c1a5d67a2eb553f034aef41d55
X264_URL="https://code.videolan.org/videolan/x264/-/archive/${X264_COMMIT}/x264-${X264_COMMIT}.tar.bz2"
X265_VERSION=3.4
X265_URL="https://anduin.linuxfromscratch.org/BLFS/x265/x265_${X265_VERSION}.tar.gz"
LIBVPX_VERSION=1.15.2
LIBVPX_URL="https://github.com/webmproject/libvpx/archive/refs/tags/v${LIBVPX_VERSION}.tar.gz"
DAV1D_VERSION=1.5.3
DAV1D_URL="https://code.videolan.org/videolan/dav1d/-/archive/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.gz"
SVTAV1_VERSION=3.1.2
SVTAV1_URL="https://gitlab.com/AOMediaCodec/SVT-AV1/-/archive/v${SVTAV1_VERSION}/SVT-AV1-v${SVTAV1_VERSION}.tar.gz"
LAME_VERSION=3.100
LAME_URL="https://downloads.sourceforge.net/project/lame/lame/${LAME_VERSION}/lame-${LAME_VERSION}.tar.gz"
OPUS_VERSION=1.5.2
OPUS_URL="https://downloads.xiph.org/releases/opus/opus-${OPUS_VERSION}.tar.gz"
OGG_VERSION=1.3.6
OGG_URL="https://downloads.xiph.org/releases/ogg/libogg-${OGG_VERSION}.tar.gz"
VORBIS_VERSION=1.3.7
VORBIS_URL="https://downloads.xiph.org/releases/vorbis/libvorbis-${VORBIS_VERSION}.tar.gz"
ZLIB_VERSION=1.3.1
ZLIB_URL="https://zlib.net/fossils/zlib-${ZLIB_VERSION}.tar.gz"
LIBWEBP_VERSION=1.3.2
LIBWEBP_URL="https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-${LIBWEBP_VERSION}.tar.gz"
FREETYPE_VERSION=2.13.3
FREETYPE_URL="https://download.savannah.gnu.org/releases/freetype/freetype-${FREETYPE_VERSION}.tar.xz"
FRIBIDI_VERSION=1.0.16
FRIBIDI_URL="https://github.com/fribidi/fribidi/releases/download/v${FRIBIDI_VERSION}/fribidi-${FRIBIDI_VERSION}.tar.xz"
HARFBUZZ_VERSION=5.2.0
HARFBUZZ_URL="https://github.com/harfbuzz/harfbuzz/releases/download/${HARFBUZZ_VERSION}/harfbuzz-${HARFBUZZ_VERSION}.tar.xz"
LIBASS_VERSION=0.15.0
LIBASS_URL="https://github.com/libass/libass/releases/download/${LIBASS_VERSION}/libass-${LIBASS_VERSION}.tar.xz"
ZIMG_BRANCH=release-3.0.5   # cloned with submodules (graphengine)
ZIMG_COMMIT=e5b0de6bebbcbc66732ed5afaafef6b2c7dfef87
ZIMG_GIT="https://github.com/sekrit-twc/zimg.git"
