#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source build/env.sh
# env.sh sets THIRD/PREFIX/OUT as local vars; export them so child scripts can use them.
export ROOT THIRD OUT PREFIX

# Dependency order: zlib before freetype/libwebp; ogg before vorbis;
# freetype+fribidi+harfbuzz before libass.
LIBS=(zlib lame ogg vorbis opus libwebp
      x264 x265 libvpx dav1d svtav1
      freetype fribidi harfbuzz libass zimg)

for lib in "${LIBS[@]}"; do
  if built "$lib"; then echo "== $lib: cached"; continue; fi
  echo "== building $lib"
  bash "build/libs/$lib.sh"
  mark "$lib"
done
echo "all libraries built into $PREFIX"
ls "$PREFIX/lib"
