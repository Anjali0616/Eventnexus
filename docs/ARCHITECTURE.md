# EventNexus — System & AWS Architecture

> **Updated:** 2026-09-09 · **Repo:** `Anjali0616/Eventnexus` · **Live:** <https://eventnexus.tech> · **AWS account:** `919744496312` · **Region:** `ap-southeast-2` (Sydney)
>
> This is the architecture narrative + the concrete AWS implementation. For the exhaustive file-by-file reference see [`SYSTEM_OVERVIEW.md`](../SYSTEM_OVERVIEW.md); for runbooks see [`DEPLOYMENT.md`](DEPLOYMENT.md), [`CICD.md`](CICD.md), [`EC2_SETUP.md`](EC2_SETUP.md), [`HTTPS_DOMAIN_SETUP.md`](HTTPS_DOMAIN_SETUP.md), [`REPO_SETTINGS.md`](REPO_SETTINGS.md).

---

## 1. What EventNexus is

A **multi-tenant, AI-enabled event management platform**. It joins organizers, organizations and attendees around one flow — create & promote an event, take registrations and payments, issue QR tickets, check in at the door, and read live analytics.

| Role | Can do |
|------|--------|
| **Attendee** | Browse & search events, get AI recommendations, register (free) or pay (card / eSewa), receive a QR ticket, check in |
| **Organizer** | Create/edit events (with AI drafts), sessions, speakers; track registrations & revenue; scan tickets; co-host with other orgs |
| **Org admin** (`org_admin`) | Manage their organization — members, profile, its events |
| **Platform admin** (`admin`) | Approve/suspend organizations, edit the IAM permission matrix, retrain AI models, view system health & audit logs |

---

## 2. Component overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Browser                                                                   │
│    Next.js 16 (React 19) SPA — App Router, standalone build                │
│    axios → REST,  socket.io-client → realtime,  Google Identity → OAuth    │
└───────────────┬───────────────────────────────────────────────────────────┘
                │ HTTPS  (single origin: https://eventnexus.tech)
┌───────────────▼───────────────────────────────────────────────────────────┐
│  Caddy  (reverse proxy, in a container on EC2)                             │
│    • terminates TLS — Let's Encrypt, auto-issue + auto-renew               │
│    • /api/*        → backend:5000   (REST + WebSocket upgrade)             │
│    • everything    → frontend:3000  (Next.js standalone server)           │
│    • www.<domain>  → 301 → apex                                            │
└──────┬──────────────────────┬──────────────────────┬─────────────────────┘
       │                      │                      │  (Docker bridge net, EC2-internal)
┌──────▼──────┐        ┌──────▼───────┐       ┌──────▼──────────┐
│  frontend   │        │   backend    │       │   ai-service    │
│  Next.js    │        │  Express 4   │◀─────▶│  FastAPI        │
│  :3000      │        │  + Socket.IO │  8-10s │  scikit-learn   │
│ (127.0.0.1) │        │  :5000       │ timeout│  :8000 (127.*)  │
└─────────────┘        └──────┬───────┘  race  └──────┬──────────┘
                              │                        │
                   ┌──────────▼────────────────────────▼──────────┐
                   │  MongoDB Atlas  (cluster "eventnexus")        │
                   │  one connection string, shared by Node + Py   │
                   └──────────────────────────────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │  Groq / Gemini LLM   │  (optional — chatbot & insight text)
                   └─────────────────────┘
```

- **Frontend** — Next.js 16 App Router, `output: "standalone"`. All `NEXT_PUBLIC_*` (including `NEXT_PUBLIC_API_URL = https://eventnexus.tech/api`) are **baked at build time**. Talks only to `/api` on its own origin.
- **Backend** — Express 4, **TypeScript** (compiled with `tsc`, run as `node dist/server.js`). Owns auth (JWT + refresh rotation), events/tickets/payments, RBAC, Socket.IO, email, and is the *only* client of the AI service.
- **AI service** — FastAPI + scikit-learn. Attendance forecasting, collaborative-filtering recommendations, intent classification, LLM chat understanding, collaboration matching. **Best-effort**: the backend races it with an 8–10 s timeout and falls back to deterministic heuristics.
- **Database** — a single MongoDB Atlas cluster. The Python service reads the same collections directly for training data.
- **Realtime** — Socket.IO on the backend at path `/api/socket.io`, so Caddy's `/api/*` rule proxies the WebSocket upgrade with no extra config. Client base URL is derived by stripping `/api` from `NEXT_PUBLIC_API_URL` → `wss://eventnexus.tech`.
- **Payments** — Stripe Checkout (card, USD; NPR prices auto-converted at checkout) and eSewa v2 (Nepal, native NPR). Webhooks/callbacks are signature-verified.
- **Email** — nodemailer over Gmail SMTP; every send is logged to a `Mail` collection. HTML templates live in `backend/src/templates/emails/` and are shipped into the Docker image.

---

## 3. Request lifecycles

**Page load** — Browser → `https://eventnexus.tech/` → Caddy → `frontend:3000` (Next.js standalone) → HTML/JS. The SPA then calls `https://eventnexus.tech/api/...` → Caddy `/api/*` → `backend:5000`.

**Realtime** — `wss://eventnexus.tech/api/socket.io` → Caddy `/api/*` (Upgrade passed through) → `backend:5000`; handshake carries the access JWT; the socket joins room `user:<id>`; the server pushes `notification:created`, `event:created`, `unread:count`, etc.

**AI call** — Browser → backend `/api/events/:id/ai-insight` → backend `POST http://ai-service:8000/understand` (Docker DNS) with an 8 s timeout → if slow/down, backend returns a heuristic result instead.

**Payment (Stripe)** — Browser → `POST /api/payments/checkout/:id` → backend creates a Checkout Session (NPR→USD, SHA-256 idempotency) → browser redirects to Stripe → Stripe → `POST /api/payments/webhook` (raw body, signature-verified) → backend issues the ticket + emails the QR. `/checkout/success` also polls `checkout/status` and self-heals if the webhook is late.

**Deploy** — `git push origin main` → GitHub Actions builds 3 images → pushes to GHCR → SSH to EC2 → `bash infra/deploy-remote.sh` → `docker compose pull && up -d` → health-wait + smoke tests.

---

## 4. AWS implementation

Everything below is provisioned by the idempotent scripts in `infra/` (`provision-alb-vpc.sh` → `provision-ec2.sh` → `provision-alb.sh`) and recorded in `infra/aws-ids.env`, `infra/ec2-info.env`, `infra/alb-info.env`.

### 4.1 Services used

| AWS service | Resource | Purpose in EventNexus |
|-------------|----------|------------------------|
| **EC2** | `i-04ca32808d1316bc8` (`t3.micro`, AL2023) | The single host. Runs all 4 containers (`caddy`, `frontend`, `backend`, `ai-service`) via Docker Compose. |
| **VPC** | `vpc-01aac9aac4b81d187` (`10.0.0.0/16`) | Network isolation for the instance. |
| **Subnets** | `subnet-05ce4a654a7fc97e0` (`10.0.1.0/24`, `ap-southeast-2a`), `subnet-0e0a96167cd8cb75e` (`10.0.2.0/24`, `ap-southeast-2b`) | Two public subnets across two AZs (created for ALB redundancy). The EC2 instance lives in subnet A. `MapPublicIpOnLaunch = true`. |
| **Internet Gateway** | `igw-00580bea854f8ef32` | Public internet in/out for the VPC. |
| **Route Table** | `rtb-02d2a137743540d52` | `0.0.0.0/0 → igw-…`; associated with both public subnets. |
| **Security Groups** | `sg-069e3ba7854302690` (EC2), `sg-08d7282ce6bb65999` (ALB) | Stateful firewall — see §4.4. |
| **EC2 Key Pair** | `eventnexus-key-2026` (`.pem`, git-ignored) | SSH access; the private key is stored in the GitHub `EC2_SSH_KEY` secret for CI/CD. |
| **EBS** | 30 GB `gp3`, `DeleteOnTermination` | Root volume — OS, Docker images/layers, container volumes (Caddy certs, AI models). |
| **Elastic Load Balancing (ALB)** | `eventnexus-alb` + `eventnexus-frontend-tg` + `eventnexus-backend-tg` | **Provisioned but currently bypassed** — see §4.5. |
| **AMI** | `ami-0d30e783ca50bc3e0` (Amazon Linux 2023) | Base image for the instance. |
| **IAM** | User with `ec2:*` scoped permissions (used to run the provisioning scripts and CI security-group edits) | No instance profile / role is attached — the app does not call AWS APIs. |
| **GitHub Container Registry** *(not AWS)* | `ghcr.io/anjali0616/event-*` | Image storage. ECR is **not** used. |
| **MongoDB Atlas** *(not AWS-managed, but AWS-hosted)* | cluster `eventnexus` | The database. Atlas runs on AWS but is operated by MongoDB, connected over the public internet with SRV + TLS. |

> **Not used:** ECR, ECS/EKS/Fargate, RDS/DocumentDB, S3, CloudFront, Route 53 (DNS is at the domain registrar), ACM (Caddy issues certs itself), Secrets Manager / SSM Parameter Store (secrets are GitHub Actions secrets → files on the host), CloudWatch alarms, WAF, NAT Gateway (public subnets only).

### 4.2 The EC2 host

- **Instance:** `t3.micro` (2 vCPU burst, 1 GiB RAM) in `ap-southeast-2a`, private `10.0.1.142`, public `3.106.232.125`, public DNS `ec2-3-106-232-125.ap-southeast-2.compute.amazonaws.com`.
- **Bootstrap (user-data, `provision-ec2.sh`):** `dnf update`; install `docker git htop`; `systemctl enable --now docker`; add `ec2-user` to the `docker` group; install the Docker Compose v2 plugin (`v2.29.7`) into `/usr/local/lib/docker/cli-plugins` and `/usr/libexec/docker/cli-plugins`. Result: Docker `25.0.14` + Compose `2.29.7`.
- **Memory pressure:** `t3.micro` has only 1 GiB. A 2 GB swap file is added manually so `next build` (run on the runner, not here) and the AI service's first-run model training don't OOM. Runtime memory is capped per container in `docker-compose.prod.yml` (backend 768 M, frontend 512 M, ai 1 G).
- **On-host layout:**
  - `~/eventnexus/` — the git checkout (`git reset --hard origin/main` each deploy) + `docker-compose.prod.yml` + the `backend.env` / `ai.env` / `frontend.env` files.
  - `~/eventnexus-env/` — where CI `scp`s the env files *before* they're installed into `~/eventnexus/` (kept separate so a first-deploy `rm -rf ~/eventnexus` can't wipe them).
- **Containers:**

  | Container | Image | Host binding | Notes |
  |-----------|-------|--------------|-------|
  | `eventnexus-caddy` | `caddy:2-alpine` | `0.0.0.0:80`, `0.0.0.0:443`, `0.0.0.0:443/udp` | **only** public container |
  | `eventnexus-frontend` | `ghcr.io/anjali0616/event-frontend:latest` | `127.0.0.1:3000` | reached as `frontend:3000` on the Docker net |
  | `eventnexus-backend` | `ghcr.io/anjali0616/event-backend:latest` | `127.0.0.1:5000` | reached as `backend:5000` |
  | `eventnexus-ai` | `ghcr.io/anjali0616/event-ai-service:latest` | `127.0.0.1:8000` | reached as `ai-service:8000` |

- **Docker volumes:** `eventnexus-caddy-data` (**Let's Encrypt account key + issued certs — never delete**), `eventnexus-caddy-config`, `eventnexus-ai-models` (trained `.joblib` models, so a redeploy doesn't retrain from scratch). Network `eventnexus-prod`.

### 4.3 Networking & TLS (current design)

DNS (at the domain registrar, **not** Route 53):

```
eventnexus.tech.       A   3.106.232.125
www.eventnexus.tech.   A   3.106.232.125
```

So traffic goes **straight to the EC2 instance's public IP** — no ALB in the path. `eventnexus-caddy` is the single ingress:

- Listens on host `:80` and `:443` (+ `:443/udp` for HTTP/3).
- **Automatic HTTPS** — Caddy provisions a Let's Encrypt certificate for `eventnexus.tech` + `www.eventnexus.tech` on first start (ACME over `:80`/`:443`), and renews it ~30 days before expiry with zero downtime. Certs persist in the `eventnexus-caddy-data` volume.
- **Routing** (`infra/Caddyfile`): `www.<domain>` → 301 → apex (scheme preserved); `/api/*` → `reverse_proxy backend:5000`; everything else → `reverse_proxy frontend:3000`. Adds `Strict-Transport-Security`, strips `Server`.
- `auto_https disable_redirects` is currently set (leftover from when only `:80` was reachable) — `http://` is served rather than force-redirected. Removing it forces HTTPS.

### 4.4 Security Groups

**EC2 SG — `sg-069e3ba7854302690`**

| Direction | Port | Source/Dest | Why |
|-----------|------|-------------|-----|
| Inbound | TCP 22 | `0.0.0.0/0` *(should be tightened to the operator IP)* | SSH for CI/CD deploy + admin |
| Inbound | TCP 80 | `0.0.0.0/0` | Caddy — HTTP + ACME HTTP-01 challenge |
| Inbound | TCP 443 | `0.0.0.0/0` | Caddy — HTTPS |
| Inbound | UDP 443 | `0.0.0.0/0` *(optional)* | Caddy — HTTP/3 (QUIC) |
| Outbound | all | `0.0.0.0/0` | Atlas, GHCR, Let's Encrypt, LLM APIs, `dnf` |

Ports `3000` / `5000` / `8000` are **not** in the SG — the app containers bind to `127.0.0.1` only, so they are unreachable from outside the instance regardless.

**ALB SG — `sg-08d7282ce6bb65999`** — was `80`/`443` from `0.0.0.0/0`; unused now (ALB bypassed).

### 4.5 The ALB (provisioned, bypassed)

`provision-alb.sh` created an internet-facing Application Load Balancer across the two AZs:

- **ALB:** `eventnexus-alb` — DNS `eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com`, hosted zone `Z1GM3OXH4ZPM65`.
- **Listener:** HTTP `:80` — default action → `eventnexus-frontend-tg`; rule priority 1, path `/api/*` → `eventnexus-backend-tg`.
- **Target groups:** `eventnexus-frontend-tg` (HTTP `:80`, health `GET /`, matcher `200-399`), `eventnexus-backend-tg` (HTTP `:5000`, health `GET /api/health`). Target: `i-04ca32808d1316bc8`.

**Why it's bypassed:** the original design was `Internet :80 → ALB → EC2`. Adding HTTPS with an ALB would mean AWS Certificate Manager + a `:443` listener + (ideally) Route 53. Instead the project moved TLS into a **Caddy container on the instance** (self-issued Let's Encrypt certs, no ACM, no Route 53, no extra AWS cost), and repointed DNS `A` records straight at the EC2 IP. The ALB and its target groups still exist and now read *unhealthy* (nothing listens on the instance's `:80`/`:5000` publicly). They can be deleted to stop the ~\$16/month charge, or kept for a future multi-instance / ACM setup.

### 4.6 Cost profile (approx, on-demand `ap-southeast-2`)

| Item | ~Monthly |
|------|----------|
| EC2 `t3.micro` | ~\$10 (or \$0 under the 12-month free tier) |
| EBS 30 GB `gp3` | ~\$2.70 |
| Data transfer out | low (single small app) |
| **ALB (if not deleted)** | **~\$16 + LCU** — the biggest line item, and currently unused |
| MongoDB Atlas | free tier (M0) or ~\$9 (M2) — billed by MongoDB |
| Route 53 | \$0 (not used) |
| ACM | \$0 (not used — Caddy) |

Deleting the ALB roughly halves the AWS bill.

### 4.7 Re-provisioning from scratch

```bash
cd infra
export AWS_PROFILE=…            # IAM user with ec2:* + elasticloadbalancing:*
./provision-alb-vpc.sh         # VPC, IGW, 2 subnets, route table, 2 security groups  → aws-ids.env
./provision-ec2.sh             # key pair, t3.micro + user-data (Docker), 30GB gp3     → ec2-info.env
./provision-alb.sh             # ALB, 2 target groups, listener + /api/* rule          → alb-info.env  (optional now)
# then: set GitHub secrets/variables (docs/REPO_SETTINGS.md), open SG 80/443,
#       point DNS A @ + www at the new public IP, push to main.
```

The scripts are idempotent — they reuse a resource if a matching tag already exists.

---

## 5. CI/CD pipeline (GitHub Actions → GHCR → EC2)

**Repo:** `Anjali0616/Eventnexus` (public). **Registry:** `ghcr.io/anjali0616/event-{backend,frontend,ai-service}` (public → anonymous pull).

### `ci.yml` — every PR / non-`main` push
Matrix `[backend, frontend, ai-service]` → `docker build` with `push: false` and GitHub Actions layer cache. Validation only.

### `deploy.yml` — push to `main` (or manual dispatch)

```
┌─ build-backend ─┐
├─ build-frontend ┤  (parallel)  each: buildx → GHCR login → metadata (:latest :<sha> :<branch>)
└─ build-ai ──────┘             → docker/build-push-action  (registry :buildcache)
        │
        ▼
     deploy  (needs all 3 = success|skipped)
      1. Check required secrets        EC2_HOST / EC2_USER / EC2_SSH_KEY
      2. Materialise env files         secrets.BACKEND_ENV / AI_ENV / FRONTEND_ENV → deploy-env/*.env (strip CRLF, drop empty)
      3. Upload env files              appleboy/scp-action → ~/eventnexus-env/ on EC2
      4. Deploy via SSH                appleboy/ssh-action runs a TINY payload:
                                         derive HOME → git reset --hard origin/main into ~/eventnexus
                                         → export DOMAIN/ACME_EMAIL/FRONTEND_URL/IMAGE_PREFIX/… 
                                         → bash infra/deploy-remote.sh
      5. Notify on failure
```

**`infra/deploy-remote.sh`** (runs as a normal script on the host, so its output & exit code are real — `drone-ssh` swallows stderr from inline multi-line scripts):

1. Lower-case `IMAGE_PREFIX`.
2. `install -m 600` the uploaded `~/eventnexus-env/*.env` into `~/eventnexus/` (empty file ⇒ keep the existing host copy).
3. Optional `docker login ghcr.io` — **non-fatal** (images are public).
4. `docker compose -f docker-compose.prod.yml pull`.
5. `docker compose … up -d --remove-orphans`.
6. Wait for `ai-service / backend / frontend / caddy` health (≤ 120 s each).
7. Smoke tests — internal `127.0.0.1:{5000/api/health, 8000/health, 3000/}` and "caddy running" (**fatal**); `https://$DOMAIN/api/health` + `/` retried ×12 (**non-fatal** — ACME can lag on a first deploy).
8. `docker image prune` → `== Deploy complete ==`.

**Repo settings required** (full list in [`REPO_SETTINGS.md`](REPO_SETTINGS.md)):

- **Secrets:** `EC2_HOST` `3.106.232.125`, `EC2_USER` `ec2-user`, `EC2_SSH_KEY` (the `.pem`), `BACKEND_ENV` (full `backend/.env`), `AI_ENV` (full `ai-service/.env`), `GOOGLE_CLIENT_ID`, optional `ACME_EMAIL`.
- **Variables:** `NEXT_PUBLIC_API_URL = https://eventnexus.tech/api`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `DOMAIN = eventnexus.tech`.
- **Actions → Workflow permissions:** *Read and write* (so the build can push to GHCR).

---

## 6. Configuration & secrets flow

```
GitHub repo secrets/variables
   ├── build args  ─▶  frontend image  (NEXT_PUBLIC_API_URL baked in)
   ├── BACKEND_ENV ─▶  CI writes file ─▶ scp ─▶ ~/eventnexus-env/backend.env ─▶ install ─▶ ~/eventnexus/backend.env ─▶ compose env_file
   ├── AI_ENV      ─▶  … same … ─▶ ~/eventnexus/ai.env
   └── EC2_SSH_KEY ─▶  scp-action / ssh-action auth
docker-compose.prod.yml `environment:` (wins over env_file)
   └── forces NODE_ENV=production, AI_SERVICE_URL=http://ai-service:8000,
       FRONTEND_URL=https://eventnexus.tech,https://www.eventnexus.tech
deploy workflow `export`
   └── DOMAIN, ACME_EMAIL, FRONTEND_URL  ─▶  compose  ─▶  caddy env  ─▶  infra/Caddyfile ({$DOMAIN}, {$ACME_EMAIL})
```

`FRONTEND_URL` is the important one — a single comma-list that drives CORS, Socket.IO allowed origins, and (via `.split(",")[0]`) the base URL in Stripe/eSewa redirect URLs and every email link (verify-email, password-reset, ticket QR). Compose forces it to the production domain regardless of what the pasted `BACKEND_ENV` contains.

---

## 7. Security posture

- **TLS everywhere** — Caddy + Let's Encrypt, auto-renew, HSTS. App containers are `127.0.0.1`-only; Caddy is the sole ingress.
- **AuthN** — bcrypt-12 passwords; short-lived access JWT + rotating refresh tokens with **theft detection** (reused refresh → revoke all sessions + bump `tokenVersion`); email/password accounts must verify their address before the app is usable; Google accounts are pre-verified.
- **AuthZ** — static `ROLE_PERMISSIONS` + a dynamic `Role`/`Permission` matrix, enforced **server-side on every route**; `route-access.ts` mirrors it on the client so no forbidden page is ever rendered.
- **Multi-tenancy** — `scopeToOrg` injects the caller's org; ticket verification cross-checks the scanning org against the event's org **and** its co-hosts.
- **Input** — global NoSQL sanitizer (`$` / `.` / `__proto__`, depth-limited); per-route validation; per-endpoint rate limits; open-redirect guard on post-auth `redirect`; eSewa signature `timingSafeEqual`; Stripe webhook raw-body signature check.
- **Secrets** — GitHub Actions secrets → `chmod 600` files on the host outside the deploy dir; `.env` excluded from images and git; SSH key git-ignored. No secrets in the Docker images.
- **AWS** — no instance role (app makes no AWS calls); app ports not exposed at the SG level.

**Open items:** restrict SG `:22` to the operator IP; rotate `JWT_SECRET` / `QR_TOKEN_SECRET`; drop `auto_https disable_redirects`; delete the unused ALB; move base64 cover images to object storage; point the Stripe webhook + Google OAuth origins at `https://eventnexus.tech`.

---

## 8. At a glance

| | |
|---|---|
| **Live URL** | https://eventnexus.tech (Caddy → Let's Encrypt) |
| **Frontend** | Next.js 16, React 19, Tailwind v4, TanStack Query, standalone build |
| **Backend** | Express 4 + TypeScript, Mongoose, Socket.IO, JWT + refresh rotation |
| **AI** | FastAPI + scikit-learn (HGB / SVD+NN / LinearSVC / RandomForest) + Gemini/Groq |
| **DB** | MongoDB Atlas — one cluster, shared by Node + Python |
| **Payments** | Stripe (card/USD) + eSewa v2 (NPR) |
| **Hosting** | 1× AWS EC2 `t3.micro`, `ap-southeast-2a`, all 4 containers via Docker Compose |
| **AWS used** | EC2, VPC, subnets ×2, IGW, route table, 2 security groups, key pair, EBS gp3, (ALB provisioned but bypassed) |
| **AWS *not* used** | ECR, ECS/EKS, RDS, S3, CloudFront, Route 53, ACM, Secrets Manager, CloudWatch alarms, WAF |
| **Registry** | GHCR — `ghcr.io/anjali0616/event-*` (public) |
| **CI/CD** | GitHub Actions → 3 parallel image builds → SSH → `infra/deploy-remote.sh` |
| **Region / account** | `ap-southeast-2` / `919744496312` |

---

*See [`SYSTEM_OVERVIEW.md`](../SYSTEM_OVERVIEW.md) for the full file-level reference and [`docs/`](.) for per-topic runbooks.*
