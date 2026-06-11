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
