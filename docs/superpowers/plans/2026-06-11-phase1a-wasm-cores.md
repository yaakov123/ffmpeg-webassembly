# Phase 1A: WASM Cores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproducible Docker builds of two multithreaded FFmpeg 8.1.1 wasm cores (LGPL + GPL) with SIMD, exposing `exec()`/`ffprobe()`, verified by Node smoke tests.

**Architecture:** All external codec libraries are cross-compiled with Emscripten into a shared static prefix; FFmpeg is configured twice (lgpl/gpl) with `--arch=wasm32 -O3 -msimd128 -pthread`; fftools objects are reused from FFmpeg's own make, with `ffmpeg.c`/`ffprobe.c` recompiled under `-Dmain=<name>_main` so both CLIs live in one wasm module. A `--pre-js` bind layer marshals argv and catches `ExitStatus` so `exit()` never kills the runtime.

**Tech Stack:** Docker (`emscripten/emsdk:4.0.10`), bash build scripts, GNU Make, FFmpeg n8.1.1, node:test for smoke tests (Node 22 on host).

**Key context for the executor (from the approved spec — read `docs/superpowers/specs/2026-06-11-ffmpeg-wasm-port-design.md` first):**
- `-msimd128` MUST be in CFLAGS for FFmpeg's configure, or wasm SIMD is *silently* disabled (`HAVE_SIMD128=0`).
- `-pthread` MUST be in both cflags and ldflags or FFmpeg silently builds threadless.
- Emscripten's default 64KB stack overflows FFmpeg → `-sSTACK_SIZE=5MB`.
- FFmpeg 8's fftools `main()` returns after `ffmpeg_cleanup()` (the 6.x refactor), so re-entrancy is expected to mostly work; the smoke test verifies it, and Task 8 has a fallback if it doesn't.
- Everything runs inside Docker via `make`; the host needs only Docker + Node 22.

---

### Task 1: Repo scaffolding

**Files:**
- Create: `package.json`, `.gitignore`, `packages/core/package.json`, `packages/core-gpl/package.json`, `README.md`

- [ ] **Step 1: Write root files**

`package.json`:
```json
{
  "name": "ffweb-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "engines": { "node": ">=18" },
  "scripts": {
    "test:smoke": "node --test tests/smoke/"
  }
}
```

`.gitignore`:
```
node_modules/
third_party/
build/out/
packages/*/dist/
*.log
```

`packages/core/package.json`:
```json
{
  "name": "@ffweb/core",
  "version": "0.1.0",
  "description": "FFmpeg 8.1 WebAssembly core (LGPL build, multithreaded, SIMD)",
  "type": "module",
  "license": "LGPL-2.1-or-later",
  "exports": { ".": "./dist/ffmpeg-core.js" },
  "files": ["dist", "sources.json"]
}
```

`packages/core-gpl/package.json`: same but `"name": "@ffweb/core-gpl"`, `"description": "FFmpeg 8.1 WebAssembly core (GPL build: + x264, x265)"`, `"license": "GPL-2.0-or-later"`.

`README.md`:
```markdown
# ffweb (working name)

A fast, modern WebAssembly port of FFmpeg 8.x. See
`docs/superpowers/specs/2026-06-11-ffmpeg-wasm-port-design.md` for the design.

## Building the cores

Requires Docker and Node >= 18.

    make image   # build the toolchain image (once)
    make fetch   # download pinned source tarballs into third_party/
    make libs    # build all codec libraries
    make cores   # build LGPL + GPL FFmpeg cores into packages/*/dist
    npm run test:smoke
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "chore: scaffold monorepo workspaces and core packages"
```

---

### Task 2: Build environment (Docker image, Makefile, versions, env, fetch)

**Files:**
- Create: `build/Dockerfile`, `Makefile`, `build/versions.sh`, `build/env.sh`, `build/fetch.sh`

- [ ] **Step 1: Write `build/Dockerfile`**

```dockerfile
FROM emscripten/emsdk:4.0.10
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config autoconf automake libtool ninja-build python3-pip \
    git ca-certificates curl xz-utils bzip2 \
    && pip3 install --no-cache-dir meson==1.4.* \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
```

If the `4.0.10` tag does not exist (`docker pull` fails), use the newest `emscripten/emsdk:4.x` tag available and record the change in the commit message.

- [ ] **Step 2: Write `Makefile`**

```makefile
IMAGE := ffweb-builder
DOCKER_RUN := docker run --rm -v $(CURDIR):/src -w /src $(IMAGE)

.PHONY: image fetch libs cores core-lgpl core-gpl clean

image:
	docker build -t $(IMAGE) build/

fetch:
	$(DOCKER_RUN) bash build/fetch.sh

libs:
	$(DOCKER_RUN) bash build/build-libs.sh

cores: core-lgpl core-gpl

core-lgpl:
	$(DOCKER_RUN) bash build/build-ffmpeg.sh lgpl
	$(DOCKER_RUN) bash build/link.sh lgpl

core-gpl:
	$(DOCKER_RUN) bash build/build-ffmpeg.sh gpl
	$(DOCKER_RUN) bash build/link.sh gpl

clean:
	rm -rf build/out packages/core/dist packages/core-gpl/dist
```

- [ ] **Step 3: Write `build/versions.sh`**

```bash
#!/bin/bash
# Pinned upstream versions. Known-good combinations from ffmpeg.wasm /
# libav.js research (see spec §4.3).
FFMPEG_VERSION=n8.1.1
FFMPEG_URL="https://github.com/FFmpeg/FFmpeg/archive/refs/tags/${FFMPEG_VERSION}.tar.gz"

X264_URL="https://code.videolan.org/videolan/x264/-/archive/stable/x264-stable.tar.bz2"
X265_VERSION=3.4
X265_URL="https://bitbucket.org/multicoreware/x265_git/downloads/x265_${X265_VERSION}.tar.gz"
LIBVPX_VERSION=1.15.2
LIBVPX_URL="https://github.com/webmproject/libvpx/archive/refs/tags/v${LIBVPX_VERSION}.tar.gz"
DAV1D_VERSION=1.5.3
DAV1D_URL="https://code.videolan.org/videolan/dav1d/-/archive/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.gz"
SVTAV1_VERSION=3.1.2
SVTAV1_URL="https://gitlab.com/AOMediaCodec/SVT-AV1/-/archive/v${SVTAV1_VERSION}/SVT-AV1-v${SVTAV1_VERSION}.tar.gz"
LAME_VERSION=3.100
LAME_URL="https://downloads.sourceforge.net/project/lame/lame/${LAME_VERSION}/lame-${LAME_VERSION}.tar.gz"
OPUS_VERSION=1.5.2
OPUS_URL="https://downloads.xiph.org/releases/opus/opus-${OPUS_VERSION}.tar.gz"
OGG_VERSION=1.3.6
OGG_URL="https://downloads.xiph.org/releases/ogg/libogg-${OGG_VERSION}.tar.gz"
VORBIS_VERSION=1.3.7
VORBIS_URL="https://downloads.xiph.org/releases/vorbis/libvorbis-${VORBIS_VERSION}.tar.gz"
ZLIB_VERSION=1.3.1
ZLIB_URL="https://zlib.net/zlib-${ZLIB_VERSION}.tar.gz"
LIBWEBP_VERSION=1.3.2
LIBWEBP_URL="https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-${LIBWEBP_VERSION}.tar.gz"
FREETYPE_VERSION=2.13.3
FREETYPE_URL="https://download.savannah.gnu.org/releases/freetype/freetype-${FREETYPE_VERSION}.tar.xz"
FRIBIDI_VERSION=1.0.16
FRIBIDI_URL="https://github.com/fribidi/fribidi/releases/download/v${FRIBIDI_VERSION}/fribidi-${FRIBIDI_VERSION}.tar.xz"
HARFBUZZ_VERSION=5.2.0
HARFBUZZ_URL="https://github.com/harfbuzz/harfbuzz/releases/download/${HARFBUZZ_VERSION}/harfbuzz-${HARFBUZZ_VERSION}.tar.xz"
LIBASS_VERSION=0.15.0
LIBASS_URL="https://github.com/libass/libass/releases/download/${LIBASS_VERSION}/libass-${LIBASS_VERSION}.tar.xz"
ZIMG_BRANCH=release-3.0.5   # cloned with submodules (graphengine)
ZIMG_GIT="https://github.com/sekrit-twc/zimg.git"
```

- [ ] **Step 4: Write `build/env.sh`**

```bash
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
```

- [ ] **Step 5: Write `build/fetch.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source build/versions.sh
mkdir -p third_party && cd third_party

get() { # get <dirname> <url>
  local dir=$1 url=$2
  [ -d "$dir" ] && { echo "have $dir"; return; }
  echo "fetching $dir"
  local tmp=$dir.dl
  curl -fL --retry 3 -o "$tmp" "$url"
  mkdir "$dir"
  case "$url" in
    *.tar.gz|*.tgz) tar xzf "$tmp" -C "$dir" --strip-components=1 ;;
    *.tar.xz)       tar xJf "$tmp" -C "$dir" --strip-components=1 ;;
    *.tar.bz2)      tar xjf "$tmp" -C "$dir" --strip-components=1 ;;
  esac
  rm "$tmp"
}

get ffmpeg   "$FFMPEG_URL"
get x264     "$X264_URL"
get x265     "$X265_URL"
get libvpx   "$LIBVPX_URL"
get dav1d    "$DAV1D_URL"
get svtav1   "$SVTAV1_URL"
get lame     "$LAME_URL"
get opus     "$OPUS_URL"
get ogg      "$OGG_URL"
get vorbis   "$VORBIS_URL"
get zlib     "$ZLIB_URL"
get libwebp  "$LIBWEBP_URL"
get freetype "$FREETYPE_URL"
get fribidi  "$FRIBIDI_URL"
get harfbuzz "$HARFBUZZ_URL"
get libass   "$LIBASS_URL"
[ -d zimg ] || git clone --recursive --depth 1 --branch "$ZIMG_BRANCH" "$ZIMG_GIT" zimg
echo "fetch complete"
```

- [ ] **Step 6: Build the image and fetch sources**

Run: `make image && make fetch`
Expected: image builds; `third_party/` contains 17 source directories. If any URL 404s, find the corrected URL for the *same pinned version* and update `versions.sh`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(build): docker toolchain, pinned versions, fetch script"
```

---

### Task 3: Audio + support library build scripts

**Files:**
- Create: `build/libs/zlib.sh`, `build/libs/lame.sh`, `build/libs/ogg.sh`, `build/libs/vorbis.sh`, `build/libs/opus.sh`, `build/libs/libwebp.sh`

Each script is invoked by the Task 5 orchestrator with `env.sh` already sourced and `$THIRD`, `$PREFIX`, `$NPROC` set.

- [ ] **Step 1: Write `build/libs/zlib.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/zlib"
emconfigure ./configure --prefix="$PREFIX" --static
emmake make -j"$NPROC" install
```

- [ ] **Step 2: Write `build/libs/lame.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/lame"
# lame 3.100 ships a stale symbol list that breaks modern toolchains.
sed -i '/lame_init_old/d' include/libmp3lame.sym
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --disable-frontend --disable-analyzer-hooks --disable-gtktest
emmake make -j"$NPROC" install
```

- [ ] **Step 3: Write `build/libs/ogg.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/ogg"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static
emmake make -j"$NPROC" install
```

- [ ] **Step 4: Write `build/libs/vorbis.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/vorbis"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static --disable-oggtest \
  --with-ogg="$PREFIX"
emmake make -j"$NPROC" install
```

- [ ] **Step 5: Write `build/libs/opus.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/opus"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --disable-asm --disable-rtcd --disable-intrinsics \
  --disable-doc --disable-extra-programs --disable-stack-protector
emmake make -j"$NPROC" install
```

- [ ] **Step 6: Write `build/libs/libwebp.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/libwebp"
emcmake cmake -B build-wasm -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF -DWEBP_ENABLE_SIMD=OFF \
  -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF \
  -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
  -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF \
  -DWEBP_BUILD_LIBWEBPMUX=ON
cmake --build build-wasm -j"$NPROC" --target install
```

- [ ] **Step 7: Commit**

```bash
git add build/libs && git commit -m "feat(build): audio and support library scripts"
```

(These scripts are exercised in Task 5; no standalone run here.)

---

### Task 4: Video library build scripts

**Files:**
- Create: `build/libs/x264.sh`, `build/libs/x265.sh`, `build/libs/libvpx.sh`, `build/libs/dav1d.sh`, `build/libs/svtav1.sh`

- [ ] **Step 1: Write `build/libs/x264.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/x264"
emconfigure ./configure --prefix="$PREFIX" --host=i686-gnu \
  --enable-static --disable-cli --disable-asm \
  --extra-cflags="$CFLAGS"
emmake make -j"$NPROC" install
```

- [ ] **Step 2: Write `build/libs/x265.sh`**

x265 needs the 8/10/12-bit triple build merged into one archive (the approach proven by ffmpeg.wasm):

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/x265"
COMMON=(-DCMAKE_BUILD_TYPE=Release -DENABLE_SHARED=OFF -DENABLE_CLI=OFF
        -DENABLE_ASSEMBLY=OFF -DENABLE_LIBNUMA=OFF)

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
cmake --build build-8 -j"$NPROC"

# Merge the three static libs into one libx265.a
cd build-8
mv libx265.a libx265_main.a
emar -M <<'EOF'
CREATE libx265.a
ADDLIB libx265_main.a
ADDLIB ../build-10/libx265.a
ADDLIB ../build-12/libx265.a
SAVE
END
EOF
cmake --build . --target install -j"$NPROC"
cp libx265.a "$PREFIX/lib/libx265.a"
```

- [ ] **Step 3: Write `build/libs/libvpx.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/libvpx"
emconfigure ./configure --prefix="$PREFIX" --target=generic-gnu \
  --enable-static --disable-shared \
  --enable-vp8 --enable-vp9 \
  --disable-examples --disable-tools --disable-docs --disable-unit-tests \
  --disable-runtime-cpu-detect --disable-install-bins \
  --extra-cflags="$CFLAGS"
emmake make -j"$NPROC" install
# make install runs the host ranlib; redo with emranlib so the archive index
# is valid for wasm objects ("libvpx enabled but no supported decoders" fix).
emranlib "$PREFIX/lib/libvpx.a"
```

- [ ] **Step 4: Write `build/libs/dav1d.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/dav1d"
cat > wasm-cross.ini <<EOF
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
meson setup build-wasm --cross-file=wasm-cross.ini --prefix="$PREFIX" \
  --default-library=static -Denable_asm=false \
  -Denable_tools=false -Denable_tests=false -Denable_examples=false \
  -Dbitdepths=8,16
ninja -C build-wasm install
```

- [ ] **Step 5: Write `build/libs/svtav1.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/svtav1"
emcmake cmake -B build-wasm -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_SYSTEM_PROCESSOR=generic \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_APPS=OFF -DBUILD_TESTING=OFF \
  -DENABLE_NASM=OFF
cmake --build build-wasm -j"$NPROC" --target install
```

Known risk: SVT-AV1 is x86-asm-heavy and libav.js carries a small patch for it. If the build fails on CPU detection or intrinsics, the failure modes and fixes are: (a) CMake arch detection → already mitigated by `-DCMAKE_SYSTEM_PROCESSOR=generic`; (b) `cpuinfo`/`rtcd` code paths compiled in → add `-DCOMPILE_C_ONLY=ON` if the option exists in v3.1.2 (`grep -r COMPILE_C_ONLY CMakeLists.txt`), otherwise consult `https://github.com/Yahweasel/libav.js/blob/master/patches/svt-av1.diff` and vendor that patch into `build/patches/svt-av1.diff`, applied in this script with `patch -p1 -N`.

- [ ] **Step 6: Commit**

```bash
git add build/libs build/patches 2>/dev/null; git commit -m "feat(build): video codec library scripts"
```

---

### Task 5: Subtitle/text libraries + orchestrator; build everything

**Files:**
- Create: `build/libs/freetype.sh`, `build/libs/fribidi.sh`, `build/libs/harfbuzz.sh`, `build/libs/libass.sh`, `build/libs/zimg.sh`, `build/build-libs.sh`

- [ ] **Step 1: Write `build/libs/freetype.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/freetype"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --with-zlib=yes --without-png --without-brotli --without-harfbuzz \
  --without-bzip2
emmake make -j"$NPROC" install
```

- [ ] **Step 2: Write `build/libs/fribidi.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/fribidi"
# Release tarball ships pre-generated tables (no ragel needed).
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static --disable-debug
emmake make -j"$NPROC" install
```

- [ ] **Step 3: Write `build/libs/harfbuzz.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/harfbuzz"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static \
  --with-freetype=yes --with-glib=no --with-cairo=no --with-icu=no \
  --with-fontconfig=no
emmake make -j"$NPROC" install
```

- [ ] **Step 4: Write `build/libs/libass.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/libass"
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static --disable-asm \
  --disable-fontconfig --disable-require-system-font-provider
emmake make -j"$NPROC" install
```

- [ ] **Step 5: Write `build/libs/zimg.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$THIRD/zimg"
./autogen.sh
emconfigure ./configure --prefix="$PREFIX" --host=i686-linux-gnu \
  --disable-shared --enable-static
emmake make -j"$NPROC" install
```

- [ ] **Step 6: Write `build/build-libs.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source build/env.sh

# Dependency order: zlib before freetype/libwebp; ogg before vorbis;
# freetype+fribidi+harfbuzz before libass.
LIBS=(zlib lame ogg vorbis opus libwebp
      x264 x265 libvpx dav1d svtav1
      freetype fribidi harfbuzz libass zimg)

for lib in "${LIBS[@]}"; do
  if built "$lib"; then echo "== $lib: cached"; continue; fi
  echo "== building $lib"
  bash "build/libs/$lib.sh"
  mark "$lib"
done
echo "all libraries built into $PREFIX"
ls "$PREFIX/lib"
```

- [ ] **Step 7: Run the full library build**

Run: `make libs` (expect 30–90 minutes on first run; x265 and SVT-AV1 dominate)
Expected final output: `ls $PREFIX/lib` shows `libz.a libmp3lame.a libogg.a libvorbis.a libvorbisenc.a libopus.a libwebp.a libwebpmux.a libsharpyuv.a libx264.a libx265.a libvpx.a libdav1d.a libSvtAv1Enc.a libfreetype.a libfribidi.a libharfbuzz.a libass.a libzimg.a`.

Debug loop: a failing library stops the orchestrator; fix its script, rerun `make libs` (stamps skip completed libs). Library configure quirks are normal — resolve them in the script (not by hand inside the container) so the build stays reproducible.

- [ ] **Step 8: Verify pkg-config sees everything**

Run: `docker run --rm -v $PWD:/src -w /src ffweb-builder bash -c 'source build/env.sh && pkg-config --exists x264 x265 vpx dav1d SvtAv1Enc libass zimg opus vorbis ogg libwebp freetype2 fribidi harfbuzz && echo OK'`
Expected: `OK`

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(build): subtitle/scaling libs and library build orchestrator"
```

---

### Task 6: FFmpeg configure + build (both variants)

**Files:**
- Create: `build/build-ffmpeg.sh`

- [ ] **Step 1: Write `build/build-ffmpeg.sh`**

```bash
#!/bin/bash
# Usage: build-ffmpeg.sh <lgpl|gpl>
set -euo pipefail
VARIANT=${1:?usage: build-ffmpeg.sh <lgpl|gpl>}
cd "$(dirname "$0")/.."
source build/env.sh

FFSRC=$THIRD/ffmpeg
FFBUILD=$OUT/ffmpeg-$VARIANT
mkdir -p "$FFBUILD"
cd "$FFBUILD"

VARIANT_FLAGS=()
if [ "$VARIANT" = gpl ]; then
  VARIANT_FLAGS+=(--enable-gpl --enable-libx264 --enable-libx265)
fi

emconfigure "$FFSRC/configure" \
  --target-os=none --arch=wasm32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc \
  --ar=emar --ranlib=emranlib --nm=emnm \
  --disable-stripping --disable-doc --disable-debug \
  --disable-runtime-cpudetect --disable-autodetect --disable-network \
  --enable-ffmpeg --enable-ffprobe --disable-ffplay \
  --enable-zlib --enable-libvpx --enable-libsvtav1 --enable-libdav1d \
  --enable-libmp3lame --enable-libopus --enable-libvorbis \
  --enable-libwebp --enable-libfreetype --enable-libfribidi \
  --enable-libass --enable-libzimg \
  "${VARIANT_FLAGS[@]}" \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="$CFLAGS -I$PREFIX/include" \
  --extra-cxxflags="$CXXFLAGS -I$PREFIX/include" \
  --extra-ldflags="$LDFLAGS"

# simd128 must have been autodetected — hard-fail if not.
grep -q '^#define HAVE_SIMD128 1' config.h \
  || { echo "FATAL: simd128 not enabled (missing -msimd128?)"; exit 1; }
grep -q '^#define HAVE_PTHREADS 1' config.h \
  || { echo "FATAL: pthreads not enabled"; exit 1; }

# Build everything. The final emcc link of the ffmpeg/ffprobe *programs* may
# fail (we link them ourselves in link.sh) — object files are what we need.
emmake make -j"$NPROC" -k || true

# Assert the objects we depend on exist.
test -f fftools/ffmpeg.o && test -f fftools/ffprobe.o \
  && test -f libavcodec/libavcodec.a && test -f libavformat/libavformat.a \
  || { echo "FATAL: expected FFmpeg objects missing"; exit 1; }
echo "ffmpeg $VARIANT build complete"
```

- [ ] **Step 2: Run the LGPL build**

Run: `docker run --rm -v $PWD:/src -w /src ffweb-builder bash build/build-ffmpeg.sh lgpl`
Expected: configure summary lists `Architecture: wasm32`, external libraries include `libvpx libsvtav1 libdav1d ...`; the two `grep` guards pass; build completes (~15–30 min). If configure rejects a `--enable-lib*` flag, check `ffbuild/config.log` — almost always a pkg-config miss from Task 5.

- [ ] **Step 3: Run the GPL build**

Run: `docker run --rm -v $PWD:/src -w /src ffweb-builder bash build/build-ffmpeg.sh gpl`
Expected: same, plus `libx264 libx265` in the enabled list and `License: GPL version 2 or later` in the configure banner.

- [ ] **Step 4: Commit**

```bash
git add build/build-ffmpeg.sh && git commit -m "feat(build): FFmpeg 8.1.1 wasm32 configure+build for lgpl/gpl variants"
```

---

### Task 7: Bind layer + link step → core artifacts

**Files:**
- Create: `src/bind/bind.js`, `build/link.sh`

- [ ] **Step 1: Write `src/bind/bind.js`** (Emscripten `--pre-js`, runs inside the module factory scope)

```js
// Bind layer: exposes exec()/ffprobe() on the module, captures logs, and
// converts exit() into a return code instead of a dead runtime.
Module['ret'] = 0;
Module['logger'] = () => {};
Module['print'] = (message) => Module['logger']({ type: 'stdout', message });
Module['printErr'] = (message) => Module['logger']({ type: 'stderr', message });

function ffweb_run(entryName, progName, args) {
  const entry = Module['_' + entryName];
  const allArgs = [progName, ...args.map(String)];
  const argc = allArgs.length;
  const ptrs = [];
  const argv = Module['_malloc']((argc + 1) * 4);
  allArgs.forEach((arg, i) => {
    const size = Module['lengthBytesUTF8'](arg) + 1;
    const p = Module['_malloc'](size);
    Module['stringToUTF8'](arg, p, size);
    ptrs.push(p);
    Module['setValue'](argv + i * 4, p, 'i32');
  });
  Module['setValue'](argv + argc * 4, 0, 'i32');
  try {
    Module['ret'] = entry(argc, argv);
  } catch (e) {
    if (e && e.name === 'ExitStatus') {
      // exit() was called; with EXIT_RUNTIME=0 the runtime stays alive.
      Module['ret'] = e.status;
    } else if (e && typeof e.message === 'string' && e.message.includes('Aborted')) {
      Module['ret'] = 1;
    } else {
      throw e;
    }
  } finally {
    ptrs.forEach((p) => Module['_free'](p));
    Module['_free'](argv);
  }
  return Module['ret'];
}

Module['exec'] = (...args) => ffweb_run('ffmpeg_main', 'ffmpeg', ['-nostdin', '-y', ...args]);
Module['ffprobe'] = (...args) => ffweb_run('ffprobe_main', 'ffprobe', args);
```

- [ ] **Step 2: Write `build/link.sh`**

```bash
#!/bin/bash
# Usage: link.sh <lgpl|gpl>
set -euo pipefail
VARIANT=${1:?usage: link.sh <lgpl|gpl>}
cd "$(dirname "$0")/.."
source build/env.sh

FFSRC=$THIRD/ffmpeg
FFBUILD=$OUT/ffmpeg-$VARIANT
PKG=packages/core; [ "$VARIANT" = gpl ] && PKG=packages/core-gpl
DIST=$ROOT/$PKG/dist
mkdir -p "$DIST"

INCLUDES=(-I"$FFBUILD" -I"$FFSRC" -I"$FFSRC/fftools")

# Recompile only the two main()-bearing TUs under unique names so both CLIs
# coexist in one module. All other fftools objects come from FFmpeg's make.
emcc -c "$FFSRC/fftools/ffmpeg.c"  -Dmain=ffmpeg_main  "${INCLUDES[@]}" $CFLAGS \
  -o "$FFBUILD/fftools/ffmpeg_main.o"
emcc -c "$FFSRC/fftools/ffprobe.c" -Dmain=ffprobe_main "${INCLUDES[@]}" $CFLAGS \
  -o "$FFBUILD/fftools/ffprobe_main.o"

mapfile -t FFTOOL_OBJS < <(find "$FFBUILD/fftools" -name '*.o' \
  ! -name 'ffmpeg.o' ! -name 'ffprobe.o' ! -name 'ffplay*')

EXTRA_LIBS=(-lvpx -lSvtAv1Enc -ldav1d -lmp3lame -lopus -lvorbis -lvorbisenc
            -logg -lwebpmux -lwebp -lsharpyuv -lass -lharfbuzz -lfribidi
            -lfreetype -lzimg -lz)
[ "$VARIANT" = gpl ] && EXTRA_LIBS+=(-lx264 -lx265)

emcc "${FFTOOL_OBJS[@]}" \
  -L"$FFBUILD/libavdevice" -L"$FFBUILD/libavfilter" -L"$FFBUILD/libavformat" \
  -L"$FFBUILD/libavcodec" -L"$FFBUILD/libswresample" -L"$FFBUILD/libswscale" \
  -L"$FFBUILD/libavutil" -L"$PREFIX/lib" \
  -lavdevice -lavfilter -lavformat -lavcodec -lswresample -lswscale -lavutil \
  "${EXTRA_LIBS[@]}" \
  -O3 -msimd128 -pthread \
  -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createFFmpegCore \
  -sENVIRONMENT=web,worker,node \
  -sWASM_BIGINT -sSTACK_SIZE=5MB \
  -sINITIAL_MEMORY=256MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB \
  -sPTHREAD_POOL_SIZE=32 \
  -sEXPORTED_FUNCTIONS=_ffmpeg_main,_ffprobe_main,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=FS,setValue,getValue,UTF8ToString,stringToUTF8,lengthBytesUTF8 \
  -sFORCE_FILESYSTEM -lworkerfs.js \
  --pre-js "$ROOT/src/bind/bind.js" \
  -o "$DIST/ffmpeg-core.js"

ls -lh "$DIST"
```

Note: `FFTOOL_OBJS` deliberately includes everything under `fftools/` that FFmpeg's make produced (including `textformat/` and `resources/` subdirectories on 8.x, which ffprobe needs).

- [ ] **Step 3: Link both cores**

Run: `make core-lgpl && make core-gpl` (the ffmpeg build step is stamped/cheap on rerun; link takes ~1–3 min each)
Expected: `packages/core/dist/` and `packages/core-gpl/dist/` each contain `ffmpeg-core.js` and `ffmpeg-core.wasm` (the wasm in the 25–40MB range). Likely first-run issues and their fixes belong in `link.sh`: missing symbol from a fftools object → check the `find` exclusions; duplicate symbol `main` → the recompile step didn't exclude the originals.

- [ ] **Step 4: Commit**

```bash
git add src/bind build/link.sh Makefile && git commit -m "feat(build): bind layer and emcc link producing core artifacts"
```

---

### Task 8: Node smoke tests

**Files:**
- Create: `tests/smoke/lgpl.test.mjs`, `tests/smoke/gpl.test.mjs`, `tests/smoke/helpers.mjs`

- [ ] **Step 1: Write `tests/smoke/helpers.mjs`**

```js
import { fileURLToPath } from 'node:url';

export async function loadCore(variant) {
  const pkg = variant === 'gpl' ? 'core-gpl' : 'core';
  const url = new URL(`../../packages/${pkg}/dist/ffmpeg-core.js`, import.meta.url);
  const createFFmpegCore = (await import(fileURLToPath(url))).default;
  const core = await createFFmpegCore();
  const logs = [];
  core.logger = (l) => logs.push(l.message);
  return { core, logs };
}
```

- [ ] **Step 2: Write `tests/smoke/lgpl.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

test('reports FFmpeg 8.1 version', async () => {
  const { core, logs } = await loadCore('lgpl');
  const ret = core.exec('-version');
  assert.equal(ret, 0);
  assert.match(logs.join('\n'), /ffmpeg version n?8\.1/);
});

test('transcodes lavfi test source to VP9/webm', async () => {
  const { core } = await loadCore('lgpl');
  const ret = core.exec(
    '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libvpx-vp9', '-f', 'webm', '/out.webm',
  );
  assert.equal(ret, 0);
  const out = core.FS.readFile('/out.webm');
  assert.ok(out.length > 1000, `output too small: ${out.length}`);
});

test('is re-entrant: two execs on one instance', async () => {
  const { core } = await loadCore('lgpl');
  assert.equal(core.exec('-f', 'lavfi', '-i', 'sine=duration=1',
    '-c:a', 'libmp3lame', '-f', 'mp3', '/a.mp3'), 0);
  assert.equal(core.exec('-f', 'lavfi', '-i', 'sine=duration=1',
    '-c:a', 'libopus', '-f', 'ogg', '/b.ogg'), 0);
  assert.ok(core.FS.readFile('/a.mp3').length > 500);
  assert.ok(core.FS.readFile('/b.ogg').length > 500);
});

test('ffprobe reads back generated file', async () => {
  const { core, logs } = await loadCore('lgpl');
  assert.equal(core.exec('-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libvpx', '-f', 'webm', '/p.webm'), 0);
  const ret = core.ffprobe('-v', 'error', '-show_streams', '-of', 'json', '/p.webm');
  assert.equal(ret, 0);
  assert.match(logs.join('\n'), /"codec_name"\s*:\s*"vp8"/);
});
```

- [ ] **Step 3: Write `tests/smoke/gpl.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

test('encodes H.264 with x264 and HEVC with x265', async () => {
  const { core, logs } = await loadCore('gpl');
  assert.equal(core.exec('-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libx264', '-f', 'mp4', '/h264.mp4'), 0);
  assert.equal(core.exec('-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libx265', '-f', 'mp4', '/hevc.mp4'), 0);
  assert.ok(core.FS.readFile('/h264.mp4').length > 1000);
  assert.ok(core.FS.readFile('/hevc.mp4').length > 1000);
  const ret = core.ffprobe('-v', 'error', '-show_streams', '-of', 'json', '/h264.mp4');
  assert.equal(ret, 0);
  assert.match(logs.join('\n'), /"codec_name"\s*:\s*"h264"/);
});
```

- [ ] **Step 4: Run the smoke tests**

Run: `npm run test:smoke`
Expected: all tests PASS on Node 22.

**If the re-entrancy test fails** (second `exec` errors or hangs): FFmpeg 8's fftools is expected to clean up after itself, but if state leaks, the fix is a small C patch — create `build/patches/fftools-reentrancy.patch` against `fftools/ffmpeg.c` that re-zeroes whichever globals the failure implicates (inspect with the error message; the usual suspects are the option-parsing state in `ffmpeg_opt.c` and `nb_input_files`/`input_files`/`output_files`/`filtergraphs`). Apply it in `build/build-ffmpeg.sh` right after `source build/env.sh` with `patch -d "$FFSRC" -p1 -N < build/patches/fftools-reentrancy.patch || true`, rebuild, rerun. Do not move on with a single-shot core.

**If `ExitStatus` never reaches the catch** (process dies on `-version`): the link is missing `-sEXIT_RUNTIME=0` semantics; add `-sEXIT_RUNTIME=0` explicitly to `link.sh` and relink.

- [ ] **Step 5: Commit**

```bash
git add tests && git commit -m "test: node smoke tests for lgpl/gpl cores (version, transcode, re-entrancy, ffprobe)"
```

---

### Task 9: License compliance artifacts

**Files:**
- Create: `build/gen-sources-json.sh`, `packages/core/README.md`, `packages/core-gpl/README.md`

- [ ] **Step 1: Write `build/gen-sources-json.sh`**

LGPL compliance requires telling users where to get the exact sources. Generate a manifest from `versions.sh`:

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source build/versions.sh
for pkg in packages/core packages/core-gpl; do
  cat > "$pkg/sources.json" <<EOF
{
  "note": "Exact upstream sources for all compiled components, per LGPL/GPL source-offer requirements.",
  "ffmpeg": "$FFMPEG_URL",
  "x264": "$X264_URL",
  "x265": "$X265_URL",
  "libvpx": "$LIBVPX_URL",
  "dav1d": "$DAV1D_URL",
  "svt-av1": "$SVTAV1_URL",
  "lame": "$LAME_URL",
  "opus": "$OPUS_URL",
  "ogg": "$OGG_URL",
  "vorbis": "$VORBIS_URL",
  "zlib": "$ZLIB_URL",
  "libwebp": "$LIBWEBP_URL",
  "freetype": "$FREETYPE_URL",
  "fribidi": "$FRIBIDI_URL",
  "harfbuzz": "$HARFBUZZ_URL",
  "libass": "$LIBASS_URL",
  "zimg": "$ZIMG_GIT#$ZIMG_BRANCH"
}
EOF
done
echo wrote sources.json
```

(x264/x265 are listed in both manifests for simplicity; only the GPL core links them — the README clarifies.)

- [ ] **Step 2: Write `packages/core/README.md`**

```markdown
# @ffweb/core

FFmpeg 8.1 compiled to WebAssembly (multithreaded + SIMD). **LGPL-2.1 build** —
contains no GPL components (no x264/x265).

Includes: all native FFmpeg codecs/muxers/demuxers/filters, libvpx (VP8/VP9
encode), SVT-AV1 (AV1 encode), dav1d (AV1 decode), LAME (MP3 encode), Opus,
Vorbis, libwebp, libass subtitle rendering, zimg scaling.

H.264/HEVC *encoding* is not in this build: use the browser's hardware encoder
via the `@ffweb/ffmpeg` pipeline API, or `@ffweb/core-gpl`.

`sources.json` lists the exact upstream sources for every compiled component.
Patent note: H.264/HEVC/AAC are patent-encumbered technologies; shipping and
using codecs may require licenses in some jurisdictions. The pipeline API's
WebCodecs path uses the browser/OS codecs, which carry their own licensing.
```

- [ ] **Step 3: Write `packages/core-gpl/README.md`**

```markdown
# @ffweb/core-gpl

FFmpeg 8.1 compiled to WebAssembly (multithreaded + SIMD). **GPL-2.0 build** —
everything in `@ffweb/core` plus x264 (H.264 encode) and x265 (HEVC encode,
8/10/12-bit).

Distributing an application that includes this binary subjects that
distribution to the GPL. If that's a problem, use `@ffweb/core` (LGPL).
`sources.json` lists the exact upstream sources for every compiled component.
```

- [ ] **Step 4: Run generator, verify, commit**

Run: `bash build/gen-sources-json.sh && cat packages/core/sources.json | node -e 'JSON.parse(require("fs").readFileSync(0)); console.log("valid")'`
Expected: `valid`

```bash
git add -A && git commit -m "docs: license/source compliance manifests and core package READMEs"
```

---

### Task 10: CI workflow

**Files:**
- Create: `.github/workflows/build.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: build-cores
on:
  push: { branches: [main] }
  pull_request:
jobs:
  cores:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Cache third_party sources
        uses: actions/cache@v4
        with:
          path: third_party
          key: third-party-${{ hashFiles('build/versions.sh') }}
      - name: Cache build output
        uses: actions/cache@v4
        with:
          path: build/out
          key: build-out-${{ hashFiles('build/**/*.sh', 'build/Dockerfile') }}
      - run: make image
      - run: make fetch
      - run: make libs
      - run: make cores
      - run: npm run test:smoke
      - uses: actions/upload-artifact@v4
        with:
          name: cores
          path: packages/*/dist/
```

- [ ] **Step 2: Validate YAML locally**

Run: `node -e 'console.log("ok")' && npx --yes yaml-lint .github/workflows/build.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build.yml')); print('ok')"`
Expected: `ok` (CI itself is exercised on the first push to a remote; that's outside this plan's scope).

- [ ] **Step 3: Commit**

```bash
git add .github && git commit -m "ci: build cores and run smoke tests"
```

---

## Self-review notes

- **Spec coverage (Phase 1, core half):** Docker infra (T2), LGPL+GPL mt cores with FFmpeg 8.1.1 + SIMD + full codec sets (T3–T7), fftools port without invasive patches + documented fallback patch path (T7–T8), license compliance (T9), CI (T10). The JS library, Vitest/Playwright harness, and FS/worker API are Plan 1B (planned after these artifacts exist). ST cores, streaming I/O, WebCodecs are Phases 2–3 per spec.
- **Known-risk steps are labeled with their failure modes and concrete fixes** (SVT-AV1 patch, re-entrancy patch, ExitStatus handling) rather than left to discovery.
- **Type/name consistency:** core module exposes `exec`, `ffprobe`, `logger`, `ret`, `FS` — the names Plan 1B will build the worker RPC against.
