#!/usr/bin/env bash
# EventNexus — remote half of the deploy, executed ON the EC2 host.
#
# Lives in the repo so that .github/workflows/deploy.yml only has to ship a
# handful of trivial single-line commands over SSH: drone-ssh mangles anything
# more involved and swallows stderr, which makes failures show up as a bare
# "exit 1" with no diagnostic. Everything non-trivial belongs here, where it
# runs as an ordinary bash script with normal output.
#
# Expected in the environment (exported by the workflow's SSH step):
#   IMAGE_PREFIX   e.g. anjali0616/event      (lowercase; GHCR requires it)
#   IMAGE_TAG      e.g. latest
#   DOMAIN         e.g. eventnexus.tech
#   ACME_EMAIL     Let's Encrypt contact
#   FRONTEND_URL   comma-separated origins forced into the backend container
#   GHCR_USER      GHCR login user      (optional)
#   GHCR_TOKEN     GHCR login token     (optional; public packages need none)
#
# Run from the deploy directory (the repo checkout on the host).

set -eo pipefail

IMAGE_PREFIX="$(printf '%s' "${IMAGE_PREFIX:-anjali0616/event}" | tr '[:upper:]' '[:lower:]')"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DOMAIN="${DOMAIN:-eventnexus.tech}"
ACME_EMAIL="${ACME_EMAIL:-admin@${DOMAIN}}"
FRONTEND_URL="${FRONTEND_URL:-https://${DOMAIN},https://www.${DOMAIN}}"
export IMAGE_PREFIX IMAGE_TAG DOMAIN ACME_EMAIL FRONTEND_URL

DEPLOY_DIR="$(pwd)"
ENV_DIR="${ENV_DIR:-$(dirname "$DEPLOY_DIR")/eventnexus-env}"
COMPOSE="docker compose -f docker-compose.prod.yml"

echo ">> dir=$DEPLOY_DIR  image=$IMAGE_PREFIX-*:$IMAGE_TAG"
echo ">> DOMAIN=$DOMAIN  ACME_EMAIL=$ACME_EMAIL"
echo ">> backend FRONTEND_URL=$FRONTEND_URL"

# ---------------------------------------------------------------------------
# 1) Move in the env files uploaded by the workflow's scp step. Absent means
#    the secret was empty, so keep whatever is already on the host.
# ---------------------------------------------------------------------------
for f in backend ai frontend; do
  src="$ENV_DIR/$f.env"
  dest="$DEPLOY_DIR/$f.env"
  if [ -s "$src" ]; then
    install -m 600 "$src" "$dest"
    echo ">> wrote $dest ($(wc -l < "$dest") lines)"
  elif [ -f "$dest" ]; then
    echo ">> kept existing $dest (secret not set)"
  else
    echo "::warning:: $dest missing and secret not set — service may fail to start"
  fi
done

# ---------------------------------------------------------------------------
# 2) GHCR login — optional. The repo is public so the images pull anonymously;
#    GITHUB_TOKEN is scoped to the Actions run and GHCR often rejects it from
#    here ("denied: denied"). Never fatal.
# ---------------------------------------------------------------------------
if [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-x}" --password-stdin \
    || echo ">> GHCR login failed — continuing with anonymous pull (packages are public)"
fi

# ---------------------------------------------------------------------------
# 3) Pull & roll
# ---------------------------------------------------------------------------
echo ">> pulling images"
$COMPOSE pull

echo ">> starting services"
$COMPOSE up -d --remove-orphans

echo ">> waiting for health (max 120s each)"
for svc in ai-service backend frontend caddy; do
  printf '   - %s ' "$svc"
  for i in $(seq 1 40); do
    status="$(docker inspect --format='{{.State.Health.Status}}' "eventnexus-$svc" 2>/dev/null || echo nohealth)"
    if [ "$status" = "healthy" ]; then echo "healthy"; break; fi
    if [ "$status" = "nohealth" ] && docker ps --filter "name=eventnexus-$svc" --filter status=running -q | grep -q .; then
      echo "running (no healthcheck)"; break
    fi
    if [ "$i" -eq 40 ]; then echo "NOT healthy after 120s (continuing)"; fi
    sleep 3
  done
done

echo ">> status"
$COMPOSE ps -a

# ---------------------------------------------------------------------------
# 4) Smoke tests
# ---------------------------------------------------------------------------
echo ">> smoke: internal ports"
curl -fsS --max-time 10 http://127.0.0.1:5000/api/health >/dev/null && echo "   backend ok"
curl -fsS --max-time 10 http://127.0.0.1:8000/health     >/dev/null && echo "   ai ok"
curl -fsS --max-time 10 http://127.0.0.1:3000/           >/dev/null && echo "   frontend ok"

docker ps --filter name=eventnexus-caddy --filter status=running -q | grep -q . || {
  echo "caddy is not running"; $COMPOSE logs --tail 50 caddy; exit 1;
}
echo "   caddy running"

# Non-fatal: on a first deploy the certificate can take ~60s, and the check
# depends on public DNS + the security group allowing 443.
echo ">> smoke: public HTTPS"
https_ok=0
for i in $(seq 1 12); do
  if curl -fsS --max-time 10 "https://$DOMAIN/api/health" >/dev/null 2>&1 \
     && curl -fsS --max-time 10 "https://$DOMAIN/" >/dev/null 2>&1; then
    echo "   https://$DOMAIN (frontend + /api) ok"; https_ok=1; break
  fi
  sleep 10
done
if [ "$https_ok" != "1" ]; then
  echo "::warning::HTTPS not verified. Check 'docker logs eventnexus-caddy'. Usual causes: DNS for $DOMAIN not on this host, or the security group is missing inbound 80/443."
  docker logs --tail 30 eventnexus-caddy 2>&1 || true
fi

# ---------------------------------------------------------------------------
# 5) Tidy up
# ---------------------------------------------------------------------------
docker image prune -f --filter "until=24h" >/dev/null 2>&1 || true

echo "== Deploy complete =="
