FROM emscripten/emsdk:4.0.10
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config autoconf automake libtool ninja-build python3-pip \
    git ca-certificates curl xz-utils bzip2 \
    && pip3 install --no-cache-dir meson==1.4.* \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
