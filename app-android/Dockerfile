# syntax=docker/dockerfile:1
# Web do FitSocial — export estatico do Expo servido pelo Caddy.
# EXPO_PUBLIC_API_URL e build-time: o Expo inlina o valor no bundle,
# entao precisa chegar como ARG (no Coolify: marcar a env como "Build Variable").

FROM node:20-bookworm-slim AS build
WORKDIR /app
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
# O bundler do Metro e guloso de memoria; teto explicito evita OOM na VPS.
ENV NODE_OPTIONS=--max-old-space-size=2048
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx expo export --platform web --output-dir dist

FROM caddy:2-alpine AS runtime
# curl: o healthcheck do Coolify o executa dentro do container.
RUN apk add --no-cache curl
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 3000
