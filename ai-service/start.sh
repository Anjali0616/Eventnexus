#!/usr/bin/env bash
# Start the EventNexus AI service (FastAPI + scikit-learn models).
#
# First run:   ./start.sh            (creates .venv, installs deps, trains)
# Later runs:  ./start.sh            (serves existing models, /train to retrain)
#
# Env: MONGODB_URI and AI_PORT can be set in ai-service/.env (see .env.example).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[ai] creating virtualenv..."
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi

if [ -f .env ]; then set -a; . ./.env; set +a; fi
PORT="${AI_PORT:-8000}"
# Use --reload only outside production
if [ "${NODE_ENV:-}" = "production" ] || [ "${ENV:-}" = "production" ]; then
  exec .venv/bin/uvicorn app:app --host 0.0.0.0 --port "$PORT" --workers 1
else
  exec .venv/bin/uvicorn app:app --host 0.0.0.0 --port "$PORT" --reload
fi
