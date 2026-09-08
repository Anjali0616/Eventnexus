# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────
# EventNexus AI Service — Optimized multi-stage Dockerfile
# Python 3.12 slim • FastAPI + scikit-learn • non-root • cached layers
# Requires Python 3.12 for numpy==2.5.2 / pandas 3.0.5
# ──────────────────────────────────────────────────────────────

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# ── builder: create isolated venv with compiled deps ────────
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Create venv at /opt/venv (copied to runner, no re-install)
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
# Leverage BuildKit cache for pip downloads
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip wheel \
 && pip install -r requirements.txt

# ── runner: minimal runtime ─────────────────────────────────
FROM python:3.12-slim AS runner
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    MODELS_DIR=/app/models \
    AI_PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r appgroup && useradd -r -g appgroup -m appuser \
    && mkdir -p /app/models && chown -R appuser:appgroup /app

WORKDIR /app

# Copy venv from builder
COPY --from=builder /opt/venv /opt/venv

# Copy app source (models dir is a volume, not baked)
COPY --chown=appuser:appgroup app.py db.py features.py llm.py nlu.py train.py ./
# Ensure models dir exists and is writable
RUN mkdir -p /app/models && chown -R appuser:appgroup /app

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request,sys; port=os.getenv('AI_PORT','8000'); sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=4).status==200 else 1)" || exit 1

CMD ["sh","-c","uvicorn app:app --host 0.0.0.0 --port ${AI_PORT:-8000} --workers 1"]
