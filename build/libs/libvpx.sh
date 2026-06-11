#!/bin/bash
set -euo pipefail
cd "$THIRD/libvpx"
emconfigure ./configure --prefix="$PREFIX" --target=generic-gnu \
  --enable-static --disable-shared \
  --enable-vp8 --enable-vp9 \
  --disable-examples --disable-tools --disable-docs --disable-unit-tests \
  --disable-runtime-cpu-detect --disable-install-bins \
  --extra-cflags="$CFLAGS"
emmake make -j"$NPROC" install
# make install runs the host ranlib; redo with emranlib so the archive index
# is valid for wasm objects ("libvpx enabled but no supported decoders" fix).
emranlib "$PREFIX/lib/libvpx.a"
