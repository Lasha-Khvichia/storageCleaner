# syntax=docker/dockerfile:1.7
#
# storageCleaner development & CI image.
#
#   dev  – Rust + Node + Tauri Linux deps: tests, lint, Linux app builds
#   cli  – tiny runtime image containing only the `storagecleaner` CLI
#
# The Windows desktop app is built natively on Windows (see README):
# a GUI can't run inside a Linux container, and it must see your real disks.

ARG RUST_VERSION=1
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS node

# ── dev ──────────────────────────────────────────────────────────────────
FROM rust:${RUST_VERSION}-bookworm AS dev
RUN apt-get update && apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev \
        libxdo-dev libssl-dev build-essential file ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && rustup component add rustfmt clippy
ENV CARGO_TARGET_DIR=/cargo-target \
    STORAGE_CLEANER_DATA_DIR=/data/storageCleaner
WORKDIR /workspace

# ── cli build ────────────────────────────────────────────────────────────
FROM rust:${RUST_VERSION}-bookworm AS cli-build
WORKDIR /src
COPY . .
# Build only the core + CLI (the app crate needs a frontend build).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release -p storage-cleaner-cli \
 && cp target/release/storagecleaner /usr/local/bin/storagecleaner

# ── cli runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS cli
RUN useradd --create-home --uid 1000 cleaner
COPY --from=cli-build /usr/local/bin/storagecleaner /usr/local/bin/storagecleaner
USER cleaner
ENV STORAGE_CLEANER_DATA_DIR=/home/cleaner/.local/share/storageCleaner
ENTRYPOINT ["storagecleaner"]
CMD ["--help"]
