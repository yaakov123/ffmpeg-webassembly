#!/bin/bash
set -euo pipefail
cd "$THIRD/x264"
make distclean 2>/dev/null || true
emconfigure ./configure --prefix="$PREFIX" --host=i686-gnu \
  --enable-static --disable-cli --disable-asm \
  --extra-cflags="$CFLAGS"
emmake make -j"$NPROC" install
