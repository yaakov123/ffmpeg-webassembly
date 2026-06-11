#!/bin/bash
set -euo pipefail
ROOT=/src
THIRD=$ROOT/third_party
OUT=$ROOT/build/out
PREFIX=$OUT/prefix

# -msimd128 is mandatory: FFmpeg's configure silently disables simd128 without it.
# -pthread must be in CFLAGS *and* LDFLAGS or FFmpeg builds threadless.
export CFLAGS="-O3 -msimd128 -pthread"
export CXXFLAGS="$CFLAGS"
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-pthread -L$PREFIX/lib"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export EM_PKG_CONFIG_PATH="$PKG_CONFIG_PATH"
NPROC=$(nproc)
mkdir -p "$PREFIX" "$OUT"

built() { [ -f "$OUT/.stamp-$1" ]; }
mark()  { touch "$OUT/.stamp-$1"; }
