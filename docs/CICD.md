# EventNexus — CI/CD & Repo Settings (GitHub → GHCR → EC2)

> **Status:** Implemented and live in `ap-southeast-2` (VPC `vpc-01aac9aac4b81d187`, ALB `eventnexus-alb`, EC2 `i-04ca32808d1316bc8` `3.106.232.125`).  
> Workflows: `.github/workflows/deploy.yml` (push `main` → build + deploy) + `.github/workflows/ci.yml` (PR/`dev` → build-only).  
> This doc lists **every repo setting that must be set** for a green run.

## 1) What runs when

| Workflow | File | Trigger | What it does |
|----------|------|---------|--------------|
| **Build & Deploy to EC2** | `.github/workflows/deploy.yml:12` | `push` to `main` (ignores `**.md`, `docs/**`, `IR-*.pdf`), `workflow_dispatch` (`skip_build` flag) | 3 parallel builds (`build-backend`, `build-frontend`, `build-ai`) — BuildKit+GHCR cache → push `ghcr.io/<owner>/event-{backend,frontend,ai-service}:latest` + `:sha` + `:branch` → `deploy` job SSHs to EC2 (`~/eventnexus`), writes env files, `docker login ghcr.io`, `compose pull && up -d`, 90s health wait, smoke `curl` |
| **CI** | `.github/workflows/ci.yml:5` | `push` `branches-ignore: [main]`, `pull_request` to `main,dev` | Matrix build `backend/frontend/ai-service` with `push:false` and `cache type=gha` — validation only |

`deploy` depends on all 3 builds (`needs: [build-backend, build-frontend, build-ai]`) and tolerates `skipped` when `skip_build=true` (`deploy.yml:176`).

## 2) Required repo settings — checklist

### 2.1 Actions permissions

`Settings → Actions → General`

- [ ] **Actions permissions:** Allow all actions and reusable workflows
- [ ] **Workflow permissions:** `Read and write permissions` + check `Allow GitHub Actions to create and approve pull requests` (needed for `packages: write` at `deploy.yml:26`)
- [ ] **Fork PR workflows:** not required (private repo)

Without `packages: write`, `docker/login-action` with `secrets.GITHUB_TOKEN` fails to push to GHCR (`403`).

### 2.2 Packages (GHCR)

`Settings → Packages` or each package page `ghcr.io/<owner>/event-*`

- [ ] GHCR images are `ghcr.io/${{ env.IMAGE_PREFIX }}-{backend,frontend,ai-service}` where `IMAGE_PREFIX=${{ github.repository_owner }}/event` (`deploy.yml:34`, lowercased)
- [ ] **Private repo:** EC2 `docker login ghcr.io` uses `GITHUB_TOKEN` or `GHCR_PAT`. If `401` on EC2 `pull`, either set `GHCR_PAT` (see 2.3) or set each package **Visibility → Public** (Package → Settings → Change visibility)
- [ ] No extra `GITHUB_TOKEN` expiry needed — Actions generates one per run

Cache refs: `*:buildcache` (`type=registry,ref=...:buildcache,mode=max`) — auto-created on first push.

### 2.3 Secrets (`Settings → Secrets and variables → Actions → Secrets`)

> `deploy.yml:185` fails fast if any of the first 3 is empty.

| Secret | Required | Value (current prod) | How to set |
|--------|----------|----------------------|------------|
| `EC2_HOST` | **yes** | `3.106.232.125` (direct IP; ALB DNS also works for SSH only if you give it the EC2 IP — use `3.106.232.125`) | `gh secret set EC2_HOST --body "3.106.232.125"` |
| `EC2_USER` | **yes** | `ec2-user` (AL2023) | `gh secret set EC2_USER --body "ec2-user"` |
| `EC2_SSH_KEY` | **yes** | **Full PEM** of `infra/eventnexus-key-2026.pem` (incl. `-----BEGIN RSA PRIVATE KEY-----` header + newline). `deploy.yml:201` feeds to `appleboy/ssh-action` `key`. | `gh secret set EC2_SSH_KEY < infra/eventnexus-key-2026.pem` (not `--body` truncation) |
| `EC2_SSH_PORT` | no | `22` (default `deploy.yml:202`) | `gh secret set EC2_SSH_PORT --body "22"` if non-standard |
| `BACKEND_ENV` | **yes** (or pre-create on host) | **Full file contents** of `backend/.env` → written to `~/eventnexus/backend.env` on EC2 (`deploy.yml:260`). Current prod has `PORT=5000`, `MONGODB_URI=mongodb+srv://...@eventnexus.ue1fwo6.mongodb.net/eventnexus`, `JWT_SECRET`, `FRONTEND_URL=http://3.106.232.125,http://3.106.232.125:3000,http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com,http://localhost:3000` (multi-origin CORS, `backend/src/server.js:54`), `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `SMTP_*`, `STRIPE_SECRET_KEY` | `gh secret set BACKEND_ENV < backend/.env` — or paste via UI (multiline) |
| `AI_ENV` | **yes** (or pre-create) | Full `ai-service/.env` → `~/eventnexus/ai.env` (`MONGODB_URI`, `GROQ_API_KEY`, `GEMINI_API_KEY`, etc.) | `gh secret set AI_ENV < ai-service/.env` |
| `FRONTEND_ENV` | no | Reserved for runtime frontend env (not needed — `NEXT_PUBLIC_*` are baked at build, `deploy.yml:262`) | `gh secret set FRONTEND_ENV --body ""` or omit |
| `GHCR_PAT` | no (required for **private** GHCR pull from EC2 if `GITHUB_TOKEN` insufficient) | Classic PAT `read:packages` (and `repo` if private) — `deploy.yml:270` uses `${{ secrets.GHCR_PAT || secrets.GITHUB_TOKEN }}` for `docker login ghcr.io` on EC2. If `pull` gets `401 Unauthorized`, create PAT and set it. | `gh secret set GHCR_PAT --body "ghp_..."` |
| `GOOGLE_CLIENT_ID` | no (alternative to var) | Fallback for frontend build arg `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (`deploy.yml:125`) if `vars` not set | `gh secret set GOOGLE_CLIENT_ID --body "1092789532631-..."` |

> **Do NOT store `infra/eventnexus-key-2026.pem` in git** (`.gitignore`). Only in `EC2_SSH_KEY` secret.
> Secrets are written via `write_env()` helper (`deploy.yml:237`) — empty secret = keep existing file on host.

Quick set (run from repo root, `gh auth login` first):

```bash
gh secret set EC2_HOST --body "3.106.232.125"
gh secret set EC2_USER --body "ec2-user"
gh secret set EC2_SSH_KEY < infra/eventnexus-key-2026.pem
gh secret set BACKEND_ENV < backend/.env
gh secret set AI_ENV < ai-service/.env
# optional PAT for private GHCR pull:
# gh secret set GHCR_PAT --body "ghp_xxxxxxxxxxxxxxxxxxxx"
```

### 2.4 Variables (`Settings → Secrets and variables → Actions → Variables`)

Used as **build args** (baked into Next.js standalone image, not runtime). Change requires rebuild.

| Variable | Required | Current prod | Used at |
|----------|----------|--------------|---------|
| `NEXT_PUBLIC_API_URL` | **yes** | `http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com/api` (ALB). For pure direct-IP deploy use `http://3.106.232.125:5000/api` — note `docker-compose.prod.yml:17` does **not** proxy `/api` via `:80`, so direct IP must use `:5000`. Current prod keeps ALB URL; CORS (`server.js:54`) allows both origins. | `deploy.yml:124` → `frontend/Dockerfile` `ARG NEXT_PUBLIC_API_URL` → `frontend/next.config.mjs` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | yes if Google login enabled | `1092789532631-22lvnc3fiv195d4dgg1nor6icb1a85aj.apps.googleusercontent.com` | `deploy.yml:125`, must match `backend.env` `GOOGLE_CLIENT_ID` |

```bash
gh variable set NEXT_PUBLIC_API_URL --body "http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com/api"
gh variable set NEXT_PUBLIC_GOOGLE_CLIENT_ID --body "1092789532631-22lvnc3fiv195d4dgg1nor6icb1a85aj.apps.googleusercontent.com"
```

### 2.5 Branch / environment protection (recommended)

`Settings → Branches → Add rule → main`

- [ ] Require status checks before merging → select `build (backend)`, `build (frontend)`, `build (ai-service)` (from `ci.yml`) and `deploy` if you want main to be green before merge
- [ ] Require conversation resolution, dismiss stale approvals
- [ ] Do not allow bypass (admins included)
- [ ] `Settings → Environments → New environment: production` → Required reviewers (optional), Deployment branches: `main`

`Settings → Secrets and variables → Actions → Secrets` scope: `production` if you use environments (then add `environment: production` to `deploy` job).

### 2.6 Runner & concurrency

- Runs on `ubuntu-latest` (`deploy.yml:46`), timeout `20m` build / `15m` deploy, `concurrency: deploy-ec2-${{ github.ref }}` `cancel-in-progress:false` — safe for sequential prod deploys.

## 3) How a successful run looks

1. Push to `main` (or `Run workflow → skip_build=false`)
2. `Actions → Build & Deploy to EC2` shows 4 jobs: `build-backend | build-frontend | build-ai` (parallel, green), then `deploy` (green)
3. Logs: `Pulling images → Starting services → Waiting for healthchecks (max 90s) → ps -a shows 3 Up (healthy) → Smoke curl http://127.0.0.1:5000/api/health 200, http://127.0.0.1:8000/health 200, http://127.0.0.1:3000/ 200`
4. Post-deploy verify from your machine:

```bash
curl -fsS http://3.106.232.125/ | head -c 200
curl -fsS http://3.106.232.125:5000/api/health   # backend direct
curl -fsS http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com/api/health  # via ALB
```

EC2 path: `ssh -i infra/eventnexus-key-2026.pem ec2-user@3.106.232.125 "cd ~/eventnexus && docker compose -f docker-compose.prod.yml ps -a && docker compose -f docker-compose.prod.yml logs --tail 30"`

## 4) Common failures & fixes

| Failure | Cause | Fix |
|---------|-------|-----|
| `::error::Missing secret EC2_HOST/EC2_USER/EC2_SSH_KEY` at `deploy: Check required secrets` | Secrets not set | Set 2.3 table |
| `docker/login-action 401` or `build-push-action 403` | `packages: write` not granted or token wrong | Enable `Settings → Actions → General → Workflow permissions: Read and write` + ensure `permissions: packages: write` (`deploy.yml:28`) |
| `pull 401 Unauthorized` on EC2 | Private GHCR + bad `GITHUB_TOKEN` | Set `GHCR_PAT` (`read:packages`) or make images Public |
| `ERR_CONNECTION_TIMED_OUT` at `http://3.106.232.125` | SG blocks direct IP (pre-2026-09-03) | `infra/provision-alb-vpc.sh:122` now opens `80/3000/5000/443` `0.0.0.0/0` on `sg-069e3ba7854302690`; or `aws ec2 authorize-security-group-ingress --group-id sg-069e3ba7854302690 --port 80 --cidr 0.0.0.0/0 --region ap-southeast-2` |
| `CORS error` from frontend (browser console) | `FRONTEND_URL` single origin | `backend/src/server.js:54` now allows comma-separated `FRONTEND_URL` + `3.106.232.125` + ALB DNS; update `backend.env` `FRONTEND_URL=http://3.106.232.125,http://3.106.232.125:3000,http://eventnexus-alb-...,http://localhost:3000` |
| Frontend calls `localhost:5000` in prod | `NEXT_PUBLIC_API_URL` var missing | Set variable (2.4) and rebuild (push to `main`) |
| `ai-service` 500 / `numpy==2.5.2` build fail | Python 3.11 image | Fixed `ai-service/Dockerfile:1` → `python:3.12-slim` (commit `56b4317`) |
| `t3.micro` OOM during `next build` | 1GB RAM | Userdata swap 2GB (`infra/ec2-info.env:1`); no action needed |

## 5) Local verification before push

```bash
# ci-like checks:
docker compose -f docker-compose.prod.yml config  # validate prod compose resolves
# optional full builds (needs Buildx):
docker buildx build -f backend/Dockerfile --platform linux/amd64 backend --load
docker buildx build -f frontend/Dockerfile --platform linux/amd64 frontend --load --build-arg NEXT_PUBLIC_API_URL=http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com/api --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=...
docker buildx build -f ai-service/Dockerfile --platform linux/amd64 ai-service --load
```

## 6) Infra reference (already provisioned)

- **Region:** `ap-southeast-2`, **VPC:** `vpc-01aac9aac4b81d187` (`10.0.0.0/16`), **Subnets:** `subnet-05ce4a654a7fc97e0` (`10.0.1.0/24` a), `subnet-0e0a96167cd8cb75e` (`10.0.2.0/24` b)
- **ALB:** `eventnexus-alb` → `eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com` (listener `80` default→`eventnexus-frontend-tg:80`, rule `/api/*`→`eventnexus-backend-tg:5000`)
- **EC2:** `i-04ca32808d1316bc8` `3.106.232.125` (`10.0.1.142`, `t3.micro`, AL2023, 30GB gp3, Docker 25 + compose v2, 2GB swap), SG `sg-069e3ba7854302690`, key `infra/eventnexus-key-2026.pem`
- **On-host:** `~/eventnexus` (`eventnexus-prod` network, volumes `eventnexus-ai-models`), `backend.env`/`ai.env` from secrets, `docker-compose.prod.yml` mounts `80:3000, 3000:3000, 5000:5000, 127.0.0.1:8000:8000`

See `docs/DEPLOYMENT.md:1` (live endpoints + architecture) and `docs/EC2_SETUP.md:1` (manual steps).

## 7) Minimal `gh` setup for a fresh fork

```bash
gh auth login
gh repo clone ashokabbhattaraii/Event && cd Event
# secrets + variables as in 2.3/2.4, then:
git checkout -b ci-test && echo "# test" >> README.md && git commit -am "ci test" && git push -u origin ci-test
# open PR → ci.yml should go green before merge
gh pr create --fill
# merge to main → deploy.yml builds & deploys to EC2
```
