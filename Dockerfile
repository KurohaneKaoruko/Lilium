# ===== Lilium Web 服务端部署镜像 =====
# 构建:  docker build -t lilium .
# 运行:  docker run -d -p 7333:7333 -v lilium-data:/data lilium
# 访问:  http://localhost:7333/

# ---------- 前端构建 ----------
FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ---------- Rust 构建 ----------
FROM rust:1.85-slim AS build
WORKDIR /src
RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates
COPY src-tauri ./src-tauri
# 服务端镜像不需要 Tauri 本体，屏蔽该成员以减少编译
RUN sed -i 's|"crates/lilium-core", "crates/lilium-server", "src-tauri"|"crates/lilium-core", "crates/lilium-server"|' Cargo.toml || true
RUN cargo build --release -p lilium-server

# ---------- 运行镜像 ----------
FROM debian:stable-slim
RUN apt-get update && apt-get install -y ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/* \
    && useradd -m lilium
WORKDIR /app
COPY --from=build /src/target/release/lilium-server /app/lilium-server
COPY --from=web /src/dist /app/web/dist
ENV LILIUM_LIBRARY=/data \
    LILIUM_PORT=7333
VOLUME /data
USER lilium
EXPOSE 7333
CMD ["/app/lilium-server", "--dist", "/app/web/dist"]
