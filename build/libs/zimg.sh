#!/bin/bash
set -euo pipefail
cd "$THIRD/zimg"
# Stale objects from a pre-mipsel configure were packaged into libzimg.a with
# ZIMG_X86 dispatch callers; clean the tree so autogen/configure start fresh.
git clean -fdx . && git checkout -- .
./autogen.sh
# --host=i686-linux-gnu causes configure to enable x86 SIMD paths which use
# constants (ZIMG_CPU_X86_SSE2 etc.) not defined when targeting wasm32.
# Use --disable-simd to skip all SIMD dispatch code; also switch host to
# mipsel-linux-gnu (a non-x86/non-arm WASM-friendly trick) to avoid any
# residual x86 code paths in configure.
emconfigure ./configure --prefix="$PREFIX" --host=mipsel-linux-gnu \
  --disable-shared --enable-static \
  --disable-simd
emmake make -j"$NPROC" install
