# syntax=docker/dockerfile:1
# Painel profissional (coach e nutri) — build estatico do Vite servido pelo Caddy.
# VITE_API_URL e build-time: o Vite inlina o valor no bundle, entao precisa
# chegar como ARG (no Coolify: marcar a env como "Build Variable"). E a mesma
# armadilha do EXPO_PUBLIC_API_URL, documentada em docs/INFRA.md.

FROM node:20-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine AS runtime
# curl: o healthcheck do Coolify o executa dentro do container.
RUN apk add --no-cache curl
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 3000
