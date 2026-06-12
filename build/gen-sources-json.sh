#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source build/versions.sh
for pkg in packages/core packages/core-gpl; do
  cat > "$pkg/sources.json" <<EOF
{
  "note": "Exact upstream sources for all compiled components, per LGPL/GPL source-offer requirements.",
  "ffmpeg": "$FFMPEG_URL",
  "ffmpeg-patches": "build/patches/ in this package's source repository",
  "x264": "$X264_URL",
  "x265": "$X265_URL",
  "libvpx": "$LIBVPX_URL",
  "dav1d": "$DAV1D_URL",
  "svt-av1": "$SVTAV1_URL",
  "lame": "$LAME_URL",
  "opus": "$OPUS_URL",
  "ogg": "$OGG_URL",
  "vorbis": "$VORBIS_URL",
  "zlib": "$ZLIB_URL",
  "libwebp": "$LIBWEBP_URL",
  "freetype": "$FREETYPE_URL",
  "fribidi": "$FRIBIDI_URL",
  "harfbuzz": "$HARFBUZZ_URL",
  "libass": "$LIBASS_URL",
  "zimg": "$ZIMG_GIT#$ZIMG_BRANCH"
}
EOF
done
echo "wrote sources.json"
