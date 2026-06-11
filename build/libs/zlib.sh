#!/bin/bash
set -euo pipefail
cd "$THIRD/zlib"
emconfigure ./configure --prefix="$PREFIX" --static
emmake make -j"$NPROC" install
