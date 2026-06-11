#!/bin/bash
set -euo pipefail
cd "$THIRD/libass"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static --disable-asm \
  --disable-fontconfig --disable-require-system-font-provider
emmake make -j"$NPROC" install
