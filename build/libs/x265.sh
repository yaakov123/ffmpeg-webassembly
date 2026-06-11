#!/bin/bash
set -euo pipefail
cd "$THIRD/x265"
COMMON=(-DCMAKE_BUILD_TYPE=Release -DENABLE_SHARED=OFF -DENABLE_CLI=OFF
        -DENABLE_ASSEMBLY=OFF -DENABLE_LIBNUMA=OFF)

rm -rf build-8 build-10 build-12

emcmake cmake -S source -B build-12 "${COMMON[@]}" \
  -DHIGH_BIT_DEPTH=ON -DMAIN12=ON -DEXPORT_C_API=OFF
cmake --build build-12 -j"$NPROC"

emcmake cmake -S source -B build-10 "${COMMON[@]}" \
  -DHIGH_BIT_DEPTH=ON -DEXPORT_C_API=OFF
cmake --build build-10 -j"$NPROC"

emcmake cmake -S source -B build-8 "${COMMON[@]}" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DEXTRA_LIB="$PWD/build-10/libx265.a;$PWD/build-12/libx265.a" \
  -DLINKED_10BIT=ON -DLINKED_12BIT=ON
cmake --build build-8 -j"$NPROC" --target install

# Replace the installed 8-bit-only archive with the merged 8/10/12-bit one.
cd build-8
emar -M <<'EOF'
CREATE libx265_full.a
ADDLIB libx265.a
ADDLIB ../build-10/libx265.a
ADDLIB ../build-12/libx265.a
SAVE
END
EOF
mv libx265_full.a "$PREFIX/lib/libx265.a"
