# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────
# EventNexus Backend — Optimized multi-stage Dockerfile
# Node 22 Alpine • pnpm • production-only runtime • non-root
# ──────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ── deps: install all deps (cached layer) ───────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* package-lock.json* ./
# Prefer pnpm if lock exists, fallback to npm ci
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# ── builder: compile TypeScript to dist ─────────────────────
FROM base AS builder
COPY package.json pnpm-lock.yaml* package-lock.json* tsconfig.json ./
COPY src ./src
COPY --from=deps /app/node_modules ./node_modules
RUN npm run build

# ── production deps: pruned runtime deps only ───────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --prod; \
    elif [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

# ── runner: minimal production image ────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache dumb-init curl \
  && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Copy production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json

# Copy compiled dist (no src, no dev files, no .env — injected at runtime)
COPY --from=builder /app/dist ./dist

# Security: non-root, read-only friendly
USER appuser
EXPOSE 5000

# Healthcheck: backend exposes GET /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:5000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
