# syntax=docker/dockerfile:1
# API do FitSocial — build TypeScript e runtime enxuto.
# Debian slim (nao Alpine): o sharp depende de glibc para os binarios prebuilt.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Dependencias de producao isoladas, sem as de desenvolvimento.
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# curl: o healthcheck do Coolify precisa dele dentro do container.
RUN apt-get update  && apt-get install -y --no-install-recommends curl  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# services/storage/disk.ts cria ./uploads ja no import do modulo, mesmo quando
# STORAGE_PROVIDER=s3. Sem este diretorio gravavel, o processo morre no boot.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
# Usuario sem privilegios que ja vem na imagem oficial do Node.
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
