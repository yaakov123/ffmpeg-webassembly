#!/bin/bash
set -euo pipefail
cd "$THIRD/freetype"
# emconfigure sets CC=emcc which causes freetype to compile the host-side
# `apinames` tool with emcc → produces a .wasm file that cannot be executed
# natively.  Clean any prior partial build first to avoid stale artifacts.
[ -f Makefile ] && emmake make distclean 2>/dev/null || true
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --with-zlib=yes --without-png --without-brotli --without-harfbuzz \
  --without-bzip2
# Fix: configure bakes emcc as CCraw_build (the host-native tool compiler).
# Override it to the real native gcc so apinames is compiled as a native binary.
sed -i 's|^CCraw_build\s*:=.*|CCraw_build  := gcc|' builds/unix/unix-cc.mk
emmake make -j"$NPROC" install
