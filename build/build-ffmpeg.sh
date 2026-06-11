#!/bin/bash
# Usage: build-ffmpeg.sh <lgpl|gpl>
set -euo pipefail
VARIANT=${1:?usage: build-ffmpeg.sh <lgpl|gpl>}
cd "$(dirname "$0")/.."
source build/env.sh

FFSRC=$THIRD/ffmpeg
FFBUILD=$OUT/ffmpeg-$VARIANT
mkdir -p "$FFBUILD"
cd "$FFBUILD"

VARIANT_FLAGS=()
if [ "$VARIANT" = gpl ]; then
  VARIANT_FLAGS+=(--enable-gpl --enable-libx264 --enable-libx265)
fi

emconfigure "$FFSRC/configure" \
  --target-os=none --arch=wasm32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc \
  --ar=emar --ranlib=emranlib --nm=emnm \
  --disable-stripping --disable-doc --disable-debug \
  --disable-runtime-cpudetect --disable-autodetect --disable-network \
  --enable-ffmpeg --enable-ffprobe --disable-ffplay \
  --enable-zlib --enable-libvpx --enable-libsvtav1 --enable-libdav1d \
  --enable-libmp3lame --enable-libopus --enable-libvorbis \
  --enable-libwebp --enable-libfreetype --enable-libfribidi \
  --enable-libass --enable-libzimg \
  "${VARIANT_FLAGS[@]}" \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="$CFLAGS -I$PREFIX/include" \
  --extra-cxxflags="$CXXFLAGS -I$PREFIX/include" \
  --extra-ldflags="$LDFLAGS"

# simd128 must have been autodetected — hard-fail if not.
grep -q '^#define HAVE_SIMD128 1' config.h \
  || { echo "FATAL: simd128 not enabled (missing -msimd128?)"; exit 1; }
grep -q '^#define HAVE_PTHREADS 1' config.h \
  || { echo "FATAL: pthreads not enabled"; exit 1; }

# Build everything. The final emcc link of the ffmpeg/ffprobe *programs* may
# fail (we link them ourselves in link.sh) — object files are what we need.
emmake make -j"$NPROC" -k || true

# Assert the objects we depend on exist.
test -f fftools/ffmpeg.o && test -f fftools/ffprobe.o \
  && test -f libavcodec/libavcodec.a && test -f libavformat/libavformat.a \
  || { echo "FATAL: expected FFmpeg objects missing"; exit 1; }
echo "ffmpeg $VARIANT build complete"
