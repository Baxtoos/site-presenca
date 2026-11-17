# syntax=docker/dockerfile:1.7
# Build:  docker build -f infra/docker/worker.Dockerfile -t presenca-worker .

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.12.1
WORKDIR /repo

FROM base AS builder
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@presenca/worker..."
RUN pnpm --filter "@presenca/worker..." run build
RUN pnpm --filter @presenca/worker deploy --prod --legacy /out

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /out ./
USER app
CMD ["node", "dist/main.js"]
