#!/bin/bash
set -euo pipefail
cd "$THIRD/vorbis"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static --disable-oggtest \
  --with-ogg="$PREFIX"
emmake make -j"$NPROC" install
