FROM node:22-bookworm

ARG CODEX_VERSION=0.142.5

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && codex --version

WORKDIR /workspace
