# syntax=docker/dockerfile:1.6
# ---- bridge-rs: nicotine-shim + soulseek-rs daemon (pin 20bd676) ----
FROM rust:1.91-bookworm AS builder
WORKDIR /build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates pkg-config \
    && rm -rf /var/lib/apt/lists/*
# Local submodule copy keeps the build hermetic; it equals pin 20bd676
# (see `git submodule status third_party/soulseek-rs`).
COPY third_party/soulseek-rs /build/soulseek-rs
COPY apps/bridge-rs /build/shim
RUN cd /build/soulseek-rs && cargo build --release --locked -p soulseek-rs \
    && cd /build/shim && cargo build --release --locked

# ---- runtime ----
FROM debian:13-slim AS runner
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/mlnl221/nicotineHub"
LABEL org.opencontainers.image.description="Nicotine Hub — Rust bridge (nicotine-shim + soulseek-rs daemon)"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/soulseek-rs/target/release/soulseek-rs /usr/local/bin/soulseek-rs
COPY --from=builder /build/shim/target/release/nicotine-shim /usr/local/bin/nicotine-shim
ENV CONFIG_DIR=/config \
    DATA_DIR=/data \
    SOULSEEK_CONFIG_DIR=/config/slsk-rs \
    SOULSEEK_STATE_DIR=/config/slsk-rs/state \
    SOULSEEK_DOWNLOAD_DIR=/data/downloads \
    SOULSEEK_LISTENER_PORT=2234 \
    DAEMON_BIND=127.0.0.1:5030 \
    PORT=8787 \
    LISTEN_PORT=2234
RUN mkdir -p $CONFIG_DIR $DATA_DIR $DATA_DIR/downloads $DATA_DIR/incomplete $DATA_DIR/uploads
EXPOSE 8787 2234
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD ["nicotine-shim", "healthcheck"]
ENTRYPOINT ["nicotine-shim"]
