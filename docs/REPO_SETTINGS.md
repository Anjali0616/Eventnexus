# EventNexus — GitHub repo settings for a green deploy

Everything you must set under **GitHub → your repo → Settings** for
`.github/workflows/deploy.yml` (push to `main` → build images → SSH to EC2 →
`docker compose up`) to succeed and serve `https://eventnexus.tech`.

Companion docs: `docs/HTTPS_DOMAIN_SETUP.md` (how TLS works),
`docs/CICD.md` (pipeline internals), `docs/EC2_SETUP.md` (host provisioning).

---

## 0. One-time, in order

1. **Settings → Actions → General → Workflow permissions** → *Read and write
   permissions* (lets the build push to GHCR).
2. Set the **Secrets** in §1 and **Variables** in §2.
3. Open **TCP 80 + 443** on the EC2 security group — §4.
4. Confirm DNS — §5 (already done).
5. Push to `main` (or **Actions → Build & Deploy to EC2 → Run workflow**).
6. Update **Stripe / Google** callback URLs — §6.

---

## 1. Secrets  ·  Settings → Secrets and variables → Actions → **Secrets**

| Name | Required | What to put in it |
|---|---|---|
| `EC2_HOST` | **yes** | `3.106.232.125` |
| `EC2_USER` | **yes** | `ec2-user` |
| `EC2_SSH_KEY` | **yes** | The **entire** PEM private key for the instance — the file `infra/provision-ec2.sh` created as `infra/eventnexus-key-2026.pem` (it is git-ignored, so it lives only on the machine that ran provisioning). Include the `-----BEGIN … KEY-----` / `-----END … KEY-----` lines and a trailing newline. |
| `EC2_SSH_PORT` | no | Only if SSH is not on `22`. |
| `BACKEND_ENV` | **yes** | The full contents of your local `backend/.env` (all of `MONGODB_URI`, `JWT_SECRET`, `QR_TOKEN_SECRET`, `GOOGLE_CLIENT_ID`, `SMTP_*`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `STRIPE_*`, `ESEWA_*`, …). Paste it verbatim — **`FRONTEND_URL` and `NODE_ENV` are overridden to production values by `docker-compose.prod.yml`**, so a leftover `http://localhost:3000` in there does no harm. Written to `~/eventnexus/backend.env` on the host. |
| `AI_ENV` | **yes** | The full contents of your local `ai-service/.env` (`MONGODB_URI`, `GROQ_API_KEY`, `GROQ_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`). Written to `~/eventnexus/ai.env`. |
| `ACME_EMAIL` | recommended | A real inbox for Let's Encrypt expiry notices. If unset, deploy uses `admin@eventnexus.tech` (still works). |
| `FRONTEND_ENV` | no | Leave unset — the frontend has no runtime env (all `NEXT_PUBLIC_*` are baked at build). |
| `GHCR_PAT` | only if GHCR packages are **private** | Classic PAT with `read:packages`. If the EC2 `docker pull` returns `401`, either set this or make the three `ghcr.io/<owner>/event-*` packages public. |

CLI equivalent (run from the repo root, with your real `.env` files present):

```bash
gh secret set EC2_HOST    --body "3.106.232.125"
gh secret set EC2_USER    --body "ec2-user"
gh secret set EC2_SSH_KEY < infra/eventnexus-key-2026.pem
gh secret set BACKEND_ENV < backend/.env
gh secret set AI_ENV      < ai-service/.env
gh secret set ACME_EMAIL  --body "you@your-real-inbox.com"
```

> If you no longer have `infra/eventnexus-key-2026.pem`, you cannot SSH with
> it again — create a new key pair, add its public key to
> `~/.ssh/authorized_keys` on the instance (via EC2 Instance Connect or the
> serial console), and put the new private key in `EC2_SSH_KEY`.

---

## 2. Variables  ·  Settings → Secrets and variables → Actions → **Variables**

| Name | Required | Value | Consumed by |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **yes** | `https://eventnexus.tech/api` | Baked into the frontend image at build (`deploy.yml` → `frontend/Dockerfile` ARG). Drives `frontend/lib/api/client.ts` and the socket base in `frontend/lib/socket.ts`. **Must be the public HTTPS origin** — a redeploy without a rebuild will not change it. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | yes if Google login is on | Your OAuth **Web client ID** (same value as `GOOGLE_CLIENT_ID` in `BACKEND_ENV`). | Frontend build arg. |
| `DOMAIN` | recommended | `eventnexus.tech` | Passed to the EC2 deploy step → `docker-compose.prod.yml` → `infra/Caddyfile`. Also used to derive the backend's `FRONTEND_URL`. Falls back to the literal `eventnexus.tech` if unset. |
| `FRONTEND_URL` | no | Only if you need origins **beyond** `https://eventnexus.tech` + `https://www.eventnexus.tech` (e.g. a staging host). Comma-separated. Overrides the value the workflow derives from `DOMAIN`. | Exported into the backend container by the deploy step. |

```bash
gh variable set NEXT_PUBLIC_API_URL           --body "https://eventnexus.tech/api"
gh variable set NEXT_PUBLIC_GOOGLE_CLIENT_ID   --body "<your-web-client-id>"
gh variable set DOMAIN                         --body "eventnexus.tech"
```

---

## 3. What the pipeline forces to production values (you don't set these)

`docker-compose.prod.yml` sets these on the `backend` container, and compose
`environment:` beats anything in `BACKEND_ENV`:

| Var | Production value | Why it matters |
|---|---|---|
| `NODE_ENV` | `production` | — |
| `AI_SERVICE_URL` | `http://ai-service:8000` | internal Docker DNS, not localhost |
| `FRONTEND_URL` | `https://eventnexus.tech,https://www.eventnexus.tech` (from `DOMAIN`) | CORS + `socket.io` origins, and the base for Stripe/eSewa redirect URLs, transactional-email links, and QR deep links |

The `caddy` service gets `DOMAIN` and `ACME_EMAIL` the same way and obtains /
renews the TLS certificate on its own.

---

## 4. EC2 security group — open the web ports

ACME HTTP-01 validation needs inbound **:80** reachable from the internet;
**:443** serves the site. SG id is `sg-069e3ba7854302690` (see
`infra/aws-ids.env`).

```bash
aws ec2 authorize-security-group-ingress --region ap-southeast-2 \
  --group-id sg-069e3ba7854302690 \
  --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
    'IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]'
```

(A pre-existing :80 rule from the old setup is fine to keep — it now reaches
Caddy.) Egress must allow outbound 443 so Caddy can talk to Let's Encrypt;
default "allow all" egress already does.

---

## 5. DNS — already correct, no change

`eventnexus.tech` and `www.eventnexus.tech` → `A` → `3.106.232.125`.
Caddy issues one certificate covering both and 308-redirects `www` → apex.
If the instance IP ever changes, update both A records and redeploy.

---

## 6. Third-party callbacks to update after first successful HTTPS deploy

| Service | Change |
|---|---|
| **Stripe** | Dashboard → Developers → Webhooks → set the endpoint to `https://eventnexus.tech/api/payments/webhook`; copy the new signing secret into `BACKEND_ENV` as `STRIPE_WEBHOOK_SECRET` and re-set the secret. Keys are currently `sk_test_…` / `pk_test_…` — swap to live keys when you go live. |
| **Google OAuth** | Cloud Console → Credentials → your Web client → **Authorized JavaScript origins**: add `https://eventnexus.tech`. Add the same to redirect URIs if you use the redirect flow. |
| **eSewa** | Currently on `EPAYTEST` / `rc-epay` sandbox. For live payments set real `ESEWA_PRODUCT_CODE` / `ESEWA_SECRET_KEY` and the production `ESEWA_FORM_URL` / `ESEWA_STATUS_URL` in `BACKEND_ENV`. |

---

## 7. Verify

Watch the `deploy` job. Success tail:

```
>> Backend FRONTEND_URL=https://eventnexus.tech,https://www.eventnexus.tech
caddy running
✓ https://eventnexus.tech (frontend + /api) ok
== Deploy complete ==
```

Then:

```bash
curl -sS  https://eventnexus.tech/api/health     # {"status":"ok",...}
curl -sSI https://eventnexus.tech/                # 200
curl -sSI https://www.eventnexus.tech/            # 308 → https://eventnexus.tech/
```

If the log shows `::warning::HTTPS not verified yet`, the deploy still
passed — the cert just hadn't issued. Fix DNS/SG if needed and **re-run the
workflow** (no rebuild required); check `ssh … 'docker logs --tail 50
eventnexus-caddy'`.

---

## 8. Common failures

| Log line | Cause | Fix |
|---|---|---|
| `::error::Missing secret EC2_HOST/EC2_USER/EC2_SSH_KEY` | Secrets unset | §1 |
| `ssh: handshake failed` / `permission denied (publickey)` | `EC2_SSH_KEY` truncated or wrong key | Re-set from the real `.pem`, full file, trailing newline |
| `denied` / `manifest unknown` on `docker compose pull` | GHCR packages private, or uppercase owner | Set `GHCR_PAT`, or make packages public. Uppercase owner is already handled (`deploy.yml` lowercases the image prefix). |
| Frontend calls `localhost:5000` in prod | `NEXT_PUBLIC_API_URL` variable missing at **build** time | Set the variable (§2), push again — it is baked, redeploy-only won't fix it |
| `could not get certificate … timeout` in `eventnexus-caddy` logs | SG missing inbound :80, or DNS not on this IP | §4, then re-run |
| CORS / socket errors in the browser on `www.` | You're on `www` and it didn't redirect | Use the apex `https://eventnexus.tech`; check Caddy is running |

---

## 9. Manual deploy from your machine (bypass GitHub Actions)

Use this only for a one-off — the normal path is a push to `main`. Requires
the private key locally and the images already on GHCR (public, or run
`docker login ghcr.io` on the host first).

```bash
KEY=infra/eventnexus-key-2026.pem            # your private key
HOST=ec2-user@3.106.232.125

ssh -i "$KEY" "$HOST" bash -s <<'EOF'
set -euo pipefail
cd ~/eventnexus
git fetch origin main --depth 1 && git reset --hard origin/main
# env files: only overwrite if you have fresh contents; otherwise keep host copies
#   nano backend.env ; nano ai.env
export IMAGE_PREFIX="$(echo "<owner>/event" | tr '[:upper:]' '[:lower:]')"
export IMAGE_TAG=latest
export DOMAIN=eventnexus.tech
export ACME_EMAIL=you@your-real-inbox.com
export FRONTEND_URL="https://eventnexus.tech,https://www.eventnexus.tech"
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker compose -f docker-compose.prod.yml ps
EOF

curl -sSI https://eventnexus.tech/
```

Replace `<owner>` with the lowercase GitHub owner of the `event-*` packages.

