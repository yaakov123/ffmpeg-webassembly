#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source build/versions.sh
mkdir -p third_party && cd third_party

get() { # get <dirname> <url>
  local dir=$1 url=$2
  [ -d "$dir" ] && { echo "have $dir"; return; }
  echo "fetching $dir"
  local tmp=$dir.dl
  curl -fL --retry 3 -o "$tmp" "$url"
  mkdir "$dir"
  case "$url" in
    *.tar.gz|*.tgz) tar xzf "$tmp" -C "$dir" --strip-components=1 ;;
    *.tar.xz)       tar xJf "$tmp" -C "$dir" --strip-components=1 ;;
    *.tar.bz2)      tar xjf "$tmp" -C "$dir" --strip-components=1 ;;
  esac
  rm "$tmp"
}

get ffmpeg   "$FFMPEG_URL"
get x264     "$X264_URL"
get x265     "$X265_URL"
get libvpx   "$LIBVPX_URL"
get dav1d    "$DAV1D_URL"
get svtav1   "$SVTAV1_URL"
get lame     "$LAME_URL"
get opus     "$OPUS_URL"
get ogg      "$OGG_URL"
get vorbis   "$VORBIS_URL"
get zlib     "$ZLIB_URL"
get libwebp  "$LIBWEBP_URL"
get freetype "$FREETYPE_URL"
get fribidi  "$FRIBIDI_URL"
get harfbuzz "$HARFBUZZ_URL"
get libass   "$LIBASS_URL"
[ -d zimg ] || git clone --recursive --depth 1 --branch "$ZIMG_BRANCH" "$ZIMG_GIT" zimg
echo "fetch complete"
