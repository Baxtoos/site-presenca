# syntax=docker/dockerfile:1.7
# Build:  docker build -f infra/docker/web.Dockerfile --build-arg API_INTERNAL_URL=http://api:4000 -t presenca-web .
# API_INTERNAL_URL entra no build porque o proxy /api do Next é definido na compilação.

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.12.1
WORKDIR /repo

FROM base AS builder
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@presenca/web..."
RUN pnpm --filter "@presenca/web..." run build

FROM node:22-alpine AS runner
ARG API_INTERNAL_URL=http://api:4000
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    API_INTERNAL_URL=${API_INTERNAL_URL}
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
