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
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Usuario sem privilegios que ja vem na imagem oficial do Node.
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
