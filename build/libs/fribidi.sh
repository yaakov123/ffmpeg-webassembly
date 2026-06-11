#!/bin/bash
set -euo pipefail
cd "$THIRD/fribidi"
# Release tarball ships pre-generated tables (no ragel needed).
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static --disable-debug
emmake make -j"$NPROC" install
