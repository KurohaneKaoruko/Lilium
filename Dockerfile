# ===== Lilium Web 服务端部署镜像 =====
# 构建:  docker build -t lilium .
# 海外构建: docker build --build-arg CN_MIRROR=0 -t lilium .
# 运行:  docker run -d -p 7333:7333 -v lilium-data:/data lilium
# 访问:  http://localhost:7333/

ARG CN_MIRROR=1

# ---------- 前端构建 ----------
FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ---------- Rust 构建 ----------
FROM rust:1.95-slim AS build
ARG CN_MIRROR
WORKDIR /src
# 国内镜像加速（apt + crates.io）
RUN if [ "$CN_MIRROR" = "1" ]; then \
      (sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
        || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list); \
      printf '[source.crates-io]\nreplace-with = "rsproxy"\n\n[source.rsproxy]\nregistry = "sparse+https://rsproxy.cn/index/"\n\n[net]\ngit-fetch-with-cli = true\n' > /usr/local/cargo/config.toml; \
    fi
RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates
COPY src-tauri ./src-tauri
# 服务端镜像不需要 Tauri 本体，屏蔽该成员以减少编译
RUN sed -i 's|"crates/lilium-core", "crates/lilium-server", "src-tauri"|"crates/lilium-core", "crates/lilium-server"|' Cargo.toml \
    && cargo build --release -p lilium-server

# ---------- 运行镜像 ----------
FROM debian:stable-slim
ARG CN_MIRROR
RUN if [ "$CN_MIRROR" = "1" ]; then \
      (sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
        || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list); \
    fi
RUN apt-get update && apt-get install -y ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/* \
    && useradd -m lilium
WORKDIR /app
COPY --from=build /src/target/release/lilium-server /app/lilium-server
COPY --from=web /src/dist /app/web/dist
ENV LILIUM_LIBRARY=/data \
    LILIUM_PORT=7333
# 预建数据目录并赋权（命名卷首次挂载会继承此所有权）
RUN mkdir -p /data && chown -R lilium:lilium /data
VOLUME /data
USER lilium
EXPOSE 7333
CMD ["/app/lilium-server", "--dist", "/app/web/dist"]
