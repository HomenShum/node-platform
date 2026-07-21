FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY vendor ./vendor
RUN npm install --omit=dev
COPY . .
ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173
CMD ["node", "apps/web/server.mjs"]
