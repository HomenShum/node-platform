FROM node:22.22-alpine

WORKDIR /runtime
RUN npm init -y \
    && npm install --save-exact --omit=dev --no-audit --no-fund @earendil-works/pi-ai@__PI_PACKAGE__

WORKDIR /app
COPY package.json ./
COPY .nodeagent ./.nodeagent
COPY apps ./apps
COPY backend ./backend
COPY integrations ./integrations
COPY fixtures ./fixtures
COPY agent ./agent
COPY packs ./packs
COPY nodeagent.yaml nodekit.yaml hackathon.yaml ./

RUN ln -s /runtime/node_modules /app/node_modules \
    && mkdir -p /app/.data \
    && chown -R node:node /app

ENV NODE_ENV=production
ENV HOST=127.0.0.1
ENV PORT=10000
EXPOSE 10000
USER node

CMD ["node", "apps/web/server.mjs"]
