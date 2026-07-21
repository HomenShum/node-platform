FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run compile
ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173
CMD ["npm", "run", "dev"]
