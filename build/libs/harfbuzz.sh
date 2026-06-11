#!/bin/bash
set -euo pipefail
cd "$THIRD/harfbuzz"
# Build harfbuzz without --with-freetype to avoid hb-ft.cc, which triggers
# -Wcast-function-type-strict errors in clang 21 (emcc).  libass uses
# freetype and harfbuzz independently, so the FreeType integration module
# is not needed for subtitle rendering.
# Clean any prior partial build first.
[ -f Makefile ] && emmake make distclean 2>/dev/null || true
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --with-freetype=no --with-glib=no --with-cairo=no --with-icu=no \
  --with-fontconfig=no
emmake make -j"$NPROC" install
