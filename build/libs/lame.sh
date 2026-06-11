#!/bin/bash
set -euo pipefail
cd "$THIRD/lame"
# lame 3.100 ships a stale symbol list that breaks modern toolchains.
sed -i '/lame_init_old/d' include/libmp3lame.sym
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --disable-frontend --disable-analyzer-hooks --disable-gtktest
emmake make -j"$NPROC" install
