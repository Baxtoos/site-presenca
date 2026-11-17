# syntax=docker/dockerfile:1.7
# Build:  docker build -f infra/docker/api.Dockerfile -t presenca-api .

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.12.1
WORKDIR /repo

FROM base AS builder
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@presenca/api..."
RUN pnpm --filter "@presenca/api..." run build
# Copia só o app e suas dependências de produção (pacotes internos já compilados).
RUN pnpm --filter @presenca/api deploy --prod --legacy /out

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist/main.js"]
