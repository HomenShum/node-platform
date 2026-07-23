FROM node:22-bookworm

ARG CODEX_VERSION=0.142.5
ARG CLAUDE_CODE_VERSION=2.1.185

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && codex --version \
    && claude --version

WORKDIR /workspace
