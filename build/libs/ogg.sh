#!/bin/bash
set -euo pipefail
cd "$THIRD/ogg"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static
emmake make -j"$NPROC" install
