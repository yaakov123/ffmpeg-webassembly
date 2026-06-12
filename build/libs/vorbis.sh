#!/bin/bash
set -euo pipefail
cd "$THIRD/vorbis"
make distclean 2>/dev/null || true
# vorbis configure.ac sets CFLAGS=-O3...-mno-ieee-fp for *86-*-linux* hosts.
# clang/emcc rejects -mno-ieee-fp. Use a non-x86 host triple so configure falls
# through to the generic branch and keeps whatever CFLAGS we export.
emconfigure ./configure --prefix="$PREFIX" --host=mipsel-linux-gnu \
  --disable-shared --enable-static --disable-oggtest \
  --with-ogg="$PREFIX"
emmake make -j"$NPROC" install
