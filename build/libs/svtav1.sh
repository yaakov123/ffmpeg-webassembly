#!/bin/bash
set -euo pipefail
cd "$THIRD/svtav1"
rm -rf build-wasm
emcmake cmake -B build-wasm -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_SYSTEM_PROCESSOR=generic \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_APPS=OFF -DBUILD_TESTING=OFF \
  -DENABLE_NASM=OFF
cmake --build build-wasm -j"$NPROC" --target install
