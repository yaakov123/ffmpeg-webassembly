#!/bin/bash
set -euo pipefail
cd "$THIRD/dav1d"
CROSS_FILE=$(mktemp /tmp/dav1d-cross-XXXX.ini)
cat > "$CROSS_FILE" <<EOF
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
ranlib = 'emranlib'
strip = 'emstrip'
pkg-config = 'pkg-config'

[built-in options]
c_args = ['-O3', '-msimd128', '-pthread']
c_link_args = ['-pthread']

[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
EOF
rm -rf build-wasm
meson setup build-wasm --cross-file="$CROSS_FILE" --prefix="$PREFIX" \
  --default-library=static -Denable_asm=false \
  -Denable_tools=false -Denable_tests=false -Denable_examples=false \
  -Dbitdepths=8,16
ninja -C build-wasm install
