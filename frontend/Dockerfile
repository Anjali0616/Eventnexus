# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────
# EventNexus Frontend — Optimized multi-stage Dockerfile
# Node 22 Alpine • pnpm • Next.js 16 standalone • non-root
# ──────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── deps: install dependencies (cached) ─────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* package-lock.json* pnpm-workspace.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# ── builder: build Next.js standalone output ────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public env: bake NEXT_PUBLIC_* into the bundle.
# At runtime on EC2 these are set via compose env; for GH Actions
# we pass dummy defaults so build succeeds — runtime overrides win via
# Next.js standalone server.js reading env at start.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NODE_OPTIONS=--max-old-space-size=1024
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:5000/api}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-}

RUN if [ -f pnpm-lock.yaml ]; then pnpm run build; else npm run build; fi

# ── runner: minimal production image ────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache dumb-init curl \
  && addgroup -S nextjs -g 1001 && adduser -S nextjs -u 1001
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Leverage Next.js standalone output (requires output:"standalone" in next.config.mjs)
# standalone folder is self-contained with pruned node_modules
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
