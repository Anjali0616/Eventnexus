# EventNexus — HTTPS + Custom Domain (`eventnexus.tech`)

> **Goal:** serve the whole app over `https://eventnexus.tech` with an
> auto-renewing Let's Encrypt certificate, keep CI/CD green, and route
> `/api/*` (REST + `socket.io`) to the backend and everything else to the
> Next.js frontend.
>
> **How:** a `caddy` reverse-proxy container is now part of
> `docker-compose.prod.yml`. Caddy owns host ports **80 + 443**, obtains and
> renews TLS certs by itself, and proxies to the app containers over the
> Docker network. The frontend/backend/ai containers are no longer published
> to the public internet — only to `127.0.0.1` for local smoke tests.

---

## 0. TL;DR — what you must do

| Where | Action |
|---|---|
| **AWS — Security Group `sg-069e3ba7854302690`** | Add inbound **TCP 80** and **TCP 443** from `0.0.0.0/0` (and `::/0`). Optionally **UDP 443** for HTTP/3. |
| **AWS — DNS (already done ✅)** | `eventnexus.tech` `A @` and `A www` → `3.106.232.125`. Keep as-is. |
| **GitHub → Settings → Secrets and variables → Actions → Variables** | Set `NEXT_PUBLIC_API_URL = https://eventnexus.tech/api` |
| " | Set `DOMAIN = eventnexus.tech` |
| **GitHub → … → Secrets** | Set `ACME_EMAIL = you@real-address.com` (Let's Encrypt expiry notices) |
| **GitHub → … → Secrets → `BACKEND_ENV`** | Ensure it contains `FRONTEND_URL=https://eventnexus.tech,https://www.eventnexus.tech` |
| **Then** | Push to `main` (or run the **Build & Deploy to EC2** workflow manually). First run issues the cert in ~30–60 s. |

Everything below is the detail behind that table.

---

## 1. Repo settings — exact values

### 1.1 Variables (`Settings → Secrets and variables → Actions → Variables`)

| Variable | Required | Value | Why |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **yes** | `https://eventnexus.tech/api` | Baked into the frontend bundle at build time (`frontend/Dockerfile` `ARG`). Drives `frontend/lib/api/client.ts` and the socket base in `frontend/lib/socket.ts` (which strips `/api` → `https://eventnexus.tech`, path `/api/socket.io`). Must be the **public HTTPS** origin, same-origin with the site. |
| `DOMAIN` | recommended | `eventnexus.tech` | Passed to the EC2 deploy step → `docker-compose.prod.yml` → `infra/Caddyfile` (`{$DOMAIN}`). If unset, the workflow falls back to the literal `eventnexus.tech`. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | keep existing | *(unchanged)* | Google login; must still match `GOOGLE_CLIENT_ID` in `BACKEND_ENV`. |

```bash
gh variable set NEXT_PUBLIC_API_URL --body "https://eventnexus.tech/api"
gh variable set DOMAIN              --body "eventnexus.tech"
```

### 1.2 Secrets (`Settings → Secrets and variables → Actions → Secrets`)

| Secret | Required | Value | Why |
|---|---|---|---|
| `ACME_EMAIL` | recommended | a real inbox, e.g. `you@gmail.com` | Registered with Let's Encrypt for cert-expiry / policy email. If unset, the workflow uses `admin@eventnexus.tech` (works, but you get no warnings). |
| `BACKEND_ENV` | **yes** (already set) | full `backend/.env` contents — **update the `FRONTEND_URL` line** to:<br>`FRONTEND_URL=https://eventnexus.tech,https://www.eventnexus.tech` | `backend/src/server.ts` CORS + `backend/src/utils/socket.ts` realtime origins read this (comma-separated). The HTTPS origins are also hard-coded as a fallback in both files, so a stale value degrades gracefully instead of breaking, but set it correctly. |
| `EC2_HOST` / `EC2_USER` / `EC2_SSH_KEY` | **yes** (already set) | `3.106.232.125` / `ec2-user` / full PEM | Unchanged. |
| `GHCR_PAT` | only if GHCR packages are private | classic PAT, `read:packages` | Unchanged — see `docs/CICD.md`. |

```bash
# after editing the FRONTEND_URL line in backend/.env locally:
gh secret set BACKEND_ENV  < backend/.env
gh secret set ACME_EMAIL   --body "you@gmail.com"
```

> `FRONTEND_ENV` is still optional / unused — `NEXT_PUBLIC_*` are build-time only.

---

## 2. AWS — one-time infrastructure

### 2.1 Open 80 + 443 on the EC2 security group

ACME HTTP-01 validation **requires inbound :80 reachable from the internet**;
:443 serves the site.

```bash
aws ec2 authorize-security-group-ingress --region ap-southeast-2 \
  --group-id sg-069e3ba7854302690 \
  --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
    'IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]'
```

If port 80 was previously open for the old direct-to-frontend setup, that rule
is fine to keep — it now reaches Caddy instead. Egress must allow outbound
443 (default "allow all" SGs already do) so Caddy can reach Let's Encrypt.

### 2.2 DNS — already correct

`eventnexus.tech` and `www.eventnexus.tech` both `A` → `3.106.232.125`
(the EC2 public IP). No change. Caddy will get one cert covering both names;
`www` is 301-redirected to the apex so sessions/cookies live on one origin.

> If you ever re-associate an Elastic IP or move instances, update these two
> A records to the new IP, then redeploy.

### 2.3 Third-party callbacks that now need the HTTPS origin

| Service | Update |
|---|---|
| **Stripe** | Dashboard → Developers → Webhooks: point the endpoint at `https://eventnexus.tech/api/payments/webhook`. Copy the new signing secret into `BACKEND_ENV` (`STRIPE_WEBHOOK_SECRET`). Success/cancel URLs are derived from `FRONTEND_URL` — no separate change. |
| **Google OAuth** | Google Cloud Console → Credentials → your OAuth client → **Authorized JavaScript origins**: add `https://eventnexus.tech`. Add `https://eventnexus.tech` to **Authorized redirect URIs** if you use the redirect flow. |
| **eSewa** (if configured) | Update the merchant success/failure URLs to the `https://eventnexus.tech/...` equivalents. |

### 2.4 The ALB is now bypassed

DNS points straight at the EC2 box, so `eventnexus-alb` (see
`infra/alb-info.env`) is **not in the request path** anymore. Its target
groups will show unhealthy because ports 80/5000 are no longer published on
the instance — that is expected and harmless. Options:

- **Leave it** (costs ~\$16/mo) if you plan to move to ALB + ACM + multi-AZ later.
- **Delete it** to stop charges:
  `aws elbv2 delete-load-balancer --load-balancer-arn <ALB_ARN>` then delete
  the two target groups. Keep `sg-08d7282ce6bb65999` only if the ALB stays.

---

## 3. What changed in the codebase

| File | Change |
|---|---|
| `infra/Caddyfile` | **new** — edge config: auto-HTTPS for `{$DOMAIN}` + `www`, `/api/*` → `backend:5000`, rest → `frontend:3000`, HSTS header, `www` → apex redirect. |
| `docker-compose.prod.yml` | **new `caddy` service** (`caddy:2.8-alpine`) on `80/443` with persisted `caddy-data` volume (holds the certs — don't delete it). `backend` now `127.0.0.1:5000:5000`, `frontend` now `127.0.0.1:3000:3000` (was `80:3000`). New named volumes `eventnexus-caddy-data` / `-config`. |
| `.github/workflows/deploy.yml` | Exports `DOMAIN` + `ACME_EMAIL` before `compose up`; **lowercases `IMAGE_PREFIX`** (GHCR rejects uppercase owners — latent bug); waits on `caddy` health; adds edge-routing smoke tests (via `Host:` header on `127.0.0.1`) and a non-fatal public-HTTPS check with retry (first-run cert issuance). |
| `backend/src/server.ts` | `https://eventnexus.tech` + `https://www.eventnexus.tech` added to the CORS allow-list fallback. |
| `backend/src/utils/socket.ts` | Same two origins added to the `socket.io` CORS fallback so realtime survives a missing `FRONTEND_URL`. |

Nothing about the local `docker-compose.yml` dev flow changed.

---

## 4. Deploy & verify

1. Set the variables/secrets in §1 and open the SG ports in §2.1.
2. `git push origin main` (or **Actions → Build & Deploy to EC2 → Run workflow**).
3. Watch the `deploy` job logs. Expected tail:
   ```
   caddy running
   ✓ https://eventnexus.tech (frontend + /api) ok
   == Deploy complete ==
   ```
4. If the HTTPS line shows `::warning::HTTPS not verified yet`, the deploy
   still succeeds. Re-check in a minute:
   ```bash
   curl -I https://eventnexus.tech
   ssh ec2-user@3.106.232.125 'docker logs --tail 50 eventnexus-caddy'
   ```

Manual checks:

```bash
curl -sS https://eventnexus.tech/api/health         # {"status":"ok",...}
curl -sSI https://eventnexus.tech/                   # 200, next.js
curl -sSI https://www.eventnexus.tech/               # 308 → https://eventnexus.tech/
```

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Caddy logs `could not get certificate ... connection refused` / `timeout` | SG missing inbound **:80**, or DNS not on this IP | Apply §2.1; confirm `dig +short eventnexus.tech` = `3.106.232.125` |
| `HTTPS not verified yet` warning persists >5 min | Let's Encrypt rate-limit (5 failed/hour) or wrong DNS | Check `docker logs eventnexus-caddy`; wait out the limit or use the staging CA line in `infra/Caddyfile` temporarily |
| Browser: `CORS` / socket won't connect | `BACKEND_ENV` `FRONTEND_URL` wrong **and** you're on `www` | Use apex `https://eventnexus.tech`; fix `FRONTEND_URL` (§1.2) and redeploy |
| `pull ... denied` on EC2 | Uppercase repo owner previously broke the image ref | Fixed by the `IMAGE_PREFIX` lowercase in `deploy.yml`; just re-run |
| Frontend still calls `localhost:5000` | `NEXT_PUBLIC_API_URL` variable not set before the build | Set it (§1.1), push again — it's **baked at build**, redeploy-only won't fix it |
| `:80` already allocated when Caddy starts | Old `eventnexus-frontend` still bound to 80 | `ssh … 'cd ~/eventnexus && docker compose -f docker-compose.prod.yml up -d --force-recreate'` |

### Rollback

Revert this change set and redeploy — the previous compose publishes the
frontend on `:80` directly again (HTTP only). The `eventnexus-caddy-data`
volume can stay; it's reused on the next HTTPS attempt.

---

## 6. Certificate renewal

Automatic. Caddy renews ~30 days before expiry and reloads itself with zero
downtime. The only operational rule: **do not delete the
`eventnexus-caddy-data` Docker volume** — it stores the ACME account key and
issued certs. `docker compose down` (without `-v`) is safe.
