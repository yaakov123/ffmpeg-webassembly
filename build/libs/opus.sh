#!/bin/bash
set -euo pipefail
cd "$THIRD/opus"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --disable-asm --disable-rtcd --disable-intrinsics \
  --disable-doc --disable-extra-programs --disable-stack-protector
emmake make -j"$NPROC" install
