#!/bin/bash
# Usage: link.sh <lgpl|gpl>
set -euo pipefail
VARIANT=${1:?usage: link.sh <lgpl|gpl>}
cd "$(dirname "$0")/.."
source build/env.sh

FFSRC=$THIRD/ffmpeg
FFBUILD=$OUT/ffmpeg-$VARIANT
PKG=packages/core; [ "$VARIANT" = gpl ] && PKG=packages/core-gpl
DIST=$ROOT/$PKG/dist
mkdir -p "$DIST"

INCLUDES=(-I"$FFBUILD" -I"$FFSRC" -I"$FFSRC/fftools")

# Recompile only the two main()-bearing TUs under unique names so both CLIs
# coexist in one module. All other fftools objects come from FFmpeg's make.
emcc -c "$FFSRC/fftools/ffmpeg.c"  -Dmain=ffmpeg_main  "${INCLUDES[@]}" $CFLAGS \
  -o "$FFBUILD/fftools/ffmpeg_main.o"
emcc -c "$FFSRC/fftools/ffprobe.c" -Dmain=ffprobe_main "${INCLUDES[@]}" $CFLAGS \
  -o "$FFBUILD/fftools/ffprobe_main.o"

# Compile x86 dispatch stubs for zimg: libzimg.a was built on an x86_64 host
# with ZIMG_X86 defined (configure detected the build machine) even though
# --disable-simd was passed. The dispatch objects reference these symbols;
# stubs return nullptr so callers fall through to portable paths.
ZIMG_STUB="$FFBUILD/zimg_x86_stubs.o"
em++ -c "$ROOT/build/stubs/zimg_x86_stubs.cpp" \
  -I"$THIRD/zimg/src" -I"$THIRD/zimg/src/zimg" \
  -DZIMG_X86=1 \
  $CFLAGS \
  -o "$ZIMG_STUB"

mapfile -t FFTOOL_OBJS < <(find "$FFBUILD/fftools" -name '*.o' \
  ! -name 'ffmpeg.o' ! -name 'ffprobe.o' ! -name 'ffplay*')

EXTRA_LIBS=(-lvpx -lSvtAv1Enc -ldav1d -lmp3lame -lopus -lvorbis -lvorbisenc
            -logg -lwebpmux -lwebp -lsharpyuv -lass -lharfbuzz -lfribidi
            -lfreetype -lzimg -lz)
[ "$VARIANT" = gpl ] && EXTRA_LIBS+=(-lx264 -lx265)

emcc "${FFTOOL_OBJS[@]}" "$ZIMG_STUB" \
  -L"$FFBUILD/libavdevice" -L"$FFBUILD/libavfilter" -L"$FFBUILD/libavformat" \
  -L"$FFBUILD/libavcodec" -L"$FFBUILD/libswresample" -L"$FFBUILD/libswscale" \
  -L"$FFBUILD/libavutil" -L"$PREFIX/lib" \
  -lavdevice -lavfilter -lavformat -lavcodec -lswresample -lswscale -lavutil \
  "${EXTRA_LIBS[@]}" \
  -O3 -msimd128 -pthread \
  -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createFFmpegCore \
  -sENVIRONMENT=web,worker,node \
  -sWASM_BIGINT -sSTACK_SIZE=5MB \
  -sINITIAL_MEMORY=256MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB \
  -sPTHREAD_POOL_SIZE=32 \
  -sEXPORTED_FUNCTIONS=_ffmpeg_main,_ffprobe_main,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=FS,setValue,getValue,UTF8ToString,stringToUTF8,lengthBytesUTF8 \
  -sFORCE_FILESYSTEM -lworkerfs.js \
  -Wl,--allow-multiple-definition \
  --pre-js "$ROOT/src/bind/bind.js" \
  -o "$DIST/ffmpeg-core.js"

ls -lh "$DIST"
