# EventNexus — Complete System Overview

> **Updated:** 2026-09-09 · **Repo:** `Anjali0616/Eventnexus` · **Branch/Commit:** `main@25a4b12` · **Live:** <https://eventnexus.tech> · **Stack:** Next.js 16 (React 19) + Express 4 (TypeScript) + FastAPI (Python 3.12) + MongoDB Atlas

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Monorepo Layout](#2-monorepo-layout)
3. [Tech Stack Matrix](#3-tech-stack-matrix)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Frontend Deep Dive](#5-frontend-deep-dive--frontendapp)
6. [Backend Deep Dive](#6-backend-deep-dive--backendsrc)
7. [AI Service Deep Dive](#7-ai-service-deep-dive--ai-service)
8. [Data Model & Entity-Relationship](#8-data-model--entity-relationship)
9. [API Endpoint Catalogue](#9-api-endpoint-catalogue--api)
10. [Auth, RBAC & Multi-Tenancy](#10-auth-rbac--multi-tenancy)
11. [Payments — Stripe + eSewa](#11-payments--stripe--esewa)
12. [Realtime & Notifications](#12-realtime--notifications)
13. [Email System](#13-email-system)
14. [AI Capabilities](#14-ai-capabilities--ai-service)
15. [Deployment — Docker, Caddy/HTTPS & AWS](#15-deployment--docker-caddyhttps--aws)
16. [CI/CD — GitHub Actions + GHCR](#16-cicd--github-actions--ghcr)
17. [Environment Variables](#17-environment-variables)
18. [Security Hardening](#18-security-hardening)
19. [Local Development](#19-local-development)
20. [Project Structure Tree](#20-project-structure-tree)
21. [Appendix — Key File References](#21-appendix--key-file-references)
22. [Quick Reference — Ports & URLs](#22-quick-reference--ports--urls)
23. [Notable Changes & Tech Debt](#23-notable-changes--tech-debt)

---

## 1. Executive Summary

**EventNexus** is a **multi-tenant, AI-enabled event management platform** (final-year university project by *Anjali Mishra*). It is deployed live at **`https://eventnexus.tech`** on a single AWS EC2 host behind an in-container Caddy reverse proxy that terminates TLS with auto-renewing Let's Encrypt certificates.

- **Roles:** `attendee` (discover / register / pay / QR check-in), `organizer` (create & manage events, sessions, speakers, rosters, QR verification, AI drafts & insights), `org_admin` (tenant administration), `admin` (platform: org approvals, IAM matrix, AI model training, system health).
- **Monorepo:** `frontend/` (Next.js 16), `backend/` (Express 4, **now 100% TypeScript**), `ai-service/` (FastAPI / scikit-learn), `infra/` (AWS + Caddy + deploy script), `docs/`, `docker-compose*.yml`.
- **DB:** one MongoDB Atlas cluster `eventnexus`, shared by the Node backend (`backend/src/config/db.ts`) and the Python AI service (`ai-service/db.py:21`).
- **AI:** best-effort — the backend races the AI service with an 8–10 s timeout and falls back to deterministic heuristics if it is slow or down (`backend/src/utils/aiClient.ts`).
- **Realtime:** Socket.IO shares the backend origin/port, served at path `/api/socket.io` (`backend/src/utils/socket.ts`), so Caddy's `/api/*` proxy rule covers websockets.
- **Payments:** Stripe (card, USD; NPR auto-converted at checkout) + eSewa v2 (Nepal, native NPR) — `backend/src/utils/esewa.ts`, `backend/src/controllers/paymentController.ts`.
- **Deploy:** 3 app images (`ghcr.io/anjali0616/event-{backend,frontend,ai-service}`) + `caddy:2-alpine`, orchestrated by `docker-compose.prod.yml` on EC2, driven by GitHub Actions → `infra/deploy-remote.sh`.

Demo credentials after `npm run seed` (backend): `admin@eventnexus.dev` / `organizer@eventnexus.dev` / `orgadmin@eventnexus.dev` / `attendee@eventnexus.dev`, password `password123`.

---

## 2. Monorepo Layout

```
Event/  (project root)
├── frontend/            Next.js 16 standalone :3000            frontend/Dockerfile
├── backend/             Express 4 + TypeScript :5000           backend/src/server.ts
├── ai-service/          FastAPI :8000 (127.0.0.1 only in prod) ai-service/app.py
├── infra/
│   ├── Caddyfile             edge reverse proxy + auto-HTTPS
│   ├── deploy-remote.sh      remote half of the deploy, runs ON the EC2 host
│   ├── provision-*.sh        one-time VPC / EC2 / ALB provisioning (ALB now bypassed)
│   ├── aws-ids.env / alb-info.env / ec2-info.env
│   └── eventnexus-key-2026.pem   (git-ignored) SSH key
├── docs/                CICD.md, DEPLOYMENT.md, EC2_SETUP.md, HTTPS_DOMAIN_SETUP.md,
│                        REPO_SETTINGS.md, FEATURE_CHECKLIST.md, USER_TESTING.md
├── .github/workflows/   ci.yml (PR/branch build) + deploy.yml (main → build → deploy)
├── docker-compose.yml        local dev — ai → backend → frontend (health-gated)
├── docker-compose.prod.yml   prod — caddy + 3 GHCR images, app ports on 127.0.0.1
└── README.md
```

Backend source is now **88 `.ts` files, 0 `.js`** (`commit 25777c3 "migrate backend from JavaScript to TypeScript"`). Frontend is TypeScript throughout. AI service is Python.

---

## 3. Tech Stack Matrix

### 3.1 Frontend — `frontend/package.json`

| Layer | Library | Version | Notes |
|-------|---------|---------|-------|
| Framework | `next` | 16.2.6 | App Router, `output: "standalone"` (`next.config.mjs`) |
| UI runtime | `react` / `react-dom` | 19 | server + client components |
| Language | `typescript` | 5.7.3 | strict; path alias `@/* → ./*` |
| Styling | `tailwindcss` | 4.2.0 | CSS-first (`@import "tailwindcss"` in `app/globals.css`), no `tailwind.config` |
| Anim CSS | `tw-animate-css` | 1.3.3 | keyframes incl. `demo-fill` (Watch-Demo progress bar) `app/globals.css` |
| Server state | `@tanstack/react-query` | 5.101.x | `staleTime 60s`, `retry 1` (`components/providers/query-provider.tsx`) |
| Client state | `zustand` | 5.0.x | per-user persisted chatbot store (`lib/stores/chatbot-store.ts`) |
| HTTP | `axios` | 1.18.x | interceptors, single-flight refresh (`lib/api/client.ts`) |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` | 7.x / 3.24.x | |
| UI primitives | `@radix-ui/*` ×20+ | 1.1.x–2.2.x | shadcn "new-york" neutral (`components.json`); **`dropdown-menu`** now used by the navbar |
| Charts | `recharts` | 2.15.0 | organizer / admin / analytics dashboards |
| Google auth | `@react-oauth/google` | 0.13.x | ID-token flow |
| Realtime | `socket.io-client` | 4.8.x | lazy-imported (`lib/socket.ts`) |
| Animation | `framer-motion` 12.40 + `gsap` 3.15 | lazy ScrollTrigger (`lib/gsap.ts`) — HowItWorks pinned-scroll **removed** (`c5b250b`) |
| QR | `qrcode.react` 4.2 + `html5-qrcode` 2.3.8 | render & scan |
| Icons | `lucide-react` 0.564 | |
| Themes | `next-themes` 0.4.6 | |
| Toast | `sonner` 1.7.x | |

Brand: **`components/ui/logo.tsx`** (`<Logo>`) renders the shared `frontend/public/logo.png` wordmark everywhere (navbar, auth shell, app shell, footer with `onDark` white pill, 404, public event landing). Build: `NODE_OPTIONS=--max-old-space-size=1024`, non-root `nextjs:1001`, healthcheck `curl http://127.0.0.1:3000/`.

### 3.2 Backend — `backend/package.json` (TypeScript)

| Package | Spec | Purpose |
|---------|------|---------|
| `express` | ^4.21 | REST (`src/server.ts`) |
| `mongoose` | ^8.5 | ODM; 2dsphere + TTL + partial-unique indexes |
| `jsonwebtoken` | ^9.0 | access JWT (`utils/generateToken.ts`) + QR ticket JWT (`utils/qrToken.ts`) |
| `bcryptjs` | ^2.4 | password hash, cost 12, pre-save (`models/User.ts`) |
| `cors` | ^2.8 | comma-split allowlist + hard-coded `https://eventnexus.tech` / `https://www.eventnexus.tech` fallbacks (`src/server.ts`) |
| `helmet` | ^8.3 | security headers; CSP disabled for base64 data-URL cover images |
| `express-validator` | ^7.1 | per-route validation chains |
| `google-auth-library` | ^10.9 | `verifyIdToken` |
| `nodemailer` | ^9.0 | SMTP + `Mail` audit log; never throws |
| `qrcode` | ^1.5 | data-URI PNG for ticket QR |
| `socket.io` | ^4.8 | path `/api/socket.io` |
| `stripe` | ^22.5 | Checkout Sessions + webhook |
| **dev** | `typescript` ^5.7, `tsx` ^4.19, `nodemon`, `@types/*` | |

**Toolchain:** `npm run dev` = `tsx watch src/server.ts`; `npm run build` = `tsc` → `dist/`; `npm start` = `node dist/server.js`. **Backend now installs with `npm ci` from `backend/package-lock.json`** — `pnpm-lock.yaml` was removed (`d3c963d`) because pnpm 12 hard-fails on `esbuild`'s blocked install script; the Dockerfile's `if [ -f pnpm-lock.yaml ]` branch therefore falls through to `npm ci`. Node 22-alpine multi-stage, `dumb-init`, non-root `appuser`, port 5000, healthcheck `curl /api/health`. **The runner stage also `COPY --from=builder /app/src/templates ./src/templates`** so the HTML email templates ship in the image (`7a51d3f`).

### 3.3 AI Service — `ai-service/requirements.txt`

| Package | Role |
|---------|------|
| `fastapi` + `uvicorn[standard]` | HTTP / ASGI (`app.py`) |
| `scikit-learn` | HistGradientBoosting (attendance), TruncatedSVD + NearestNeighbors (CF), FeatureUnion + LinearSVC (intent), RandomForest (collaboration match) |
| `pandas` / `numpy` / `scipy` | feature matrices, `csr_matrix` |
| `joblib` | model persistence → `MODELS_DIR` |
| `pymongo` | thread-safe Mongo client (`db.py`) |
| `python-dotenv` | env |

No `openai`/`httpx` — LLM calls (Gemini, Groq) use stdlib `urllib` (`llm.py`). Python 3.12-slim venv `/opt/venv`, image ≈ 534 MB.

### 3.4 Shared Infra
- **DB:** MongoDB Atlas `eventnexus` (`mongodb+srv://…@eventnexus.ue1fwo6.mongodb.net`), one URI shared by Node and Python.
- **Build cache:** GHCR registry `:buildcache` (deploy.yml) + `type=gha` (ci.yml).
- **Docker networks:** `eventnexus` (dev) / `eventnexus-prod` (prod).

---

## 4. High-Level Architecture

```
                      DNS: eventnexus.tech  A @  + A www  →  3.106.232.125
                                     │  (Route53 / registrar; ALB is NOT in the path)
                                     ▼
Internet :80 / :443 ─────▶  caddy  (container, host :80 + :443 + :443/udp)
                            │  Let's Encrypt auto-cert (TLS-ALPN / HTTP-01), auto-renew
                            │  www.<domain>  → 301 → apex (scheme preserved)
                            │  /api/*        → reverse_proxy backend:5000   (REST + socket.io)
                            │  everything else → reverse_proxy frontend:3000
                            ▼
        EC2 i-04ca32808d1316bc8  (10.0.1.142 / 3.106.232.125, ap-southeast-2a, t3.micro)
        ┌───────────────────┬───────────────────────┬─────────────────────┐
   frontend  127.0.0.1:3000   backend 127.0.0.1:5000    ai-service 127.0.0.1:8000
   Next.js standalone          Express + Socket.IO       FastAPI / uvicorn
        └───────────────────┴───────────────────────┴─────────────────────┘
                                     ▼
              MongoDB Atlas (eventnexus)  +  Groq / Gemini LLM (optional)
```

**No app container is internet-facing** — `backend`, `frontend`, `ai-service` publish only on `127.0.0.1`. Caddy is the sole entrypoint. The previously-provisioned ALB (`eventnexus-alb`) still exists but is **bypassed** — DNS points straight at the EC2 elastic-less public IP, so its target groups read unhealthy (harmless; can be deleted to save cost).

---

## 5. Frontend Deep Dive — `frontend/app`

### 5.1 Config & Boot
- `app/layout.tsx` — fonts `Inter` + `JetBrains_Mono`; provider tree `GoogleProvider → QueryProvider → ThemeProvider → RealtimeNotifications → Toaster`; `metadata.title = "EventNexus — AI-Enabled Secure Event Management"`.
- `app/globals.css` — `@import "tailwindcss"` + `@theme inline` tokens (`--primary #5b4cf5`), `@custom-variant dark`, GSAP guard `html.gsap-ready [data-reveal]{opacity:0}`, `@keyframes demo-fill` (landing demo dialog).
- `next.config.mjs` — `output: "standalone"`, `images.unoptimized`, ~10 permanent redirects for legacy `/attendee/*` paths.
- `NEXT_PUBLIC_*` are **baked at build time** — `NEXT_PUBLIC_API_URL = https://eventnexus.tech/api` (GitHub repo *variable*), `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

### 5.2 App Router — ~52 routes

**Public marketing / landing** (Navbar + Footer shell, `Reveal` animations):

| Route | File | Notes |
|-------|------|-------|
| `/` | `page.tsx` | Navbar → Hero → TrustBar → ProblemStrip → Solution → Features → HowItWorks → SurveyStats → Footer |
| `/pricing` | `pricing/page.tsx` | 3 tiers (Starter free / Pro / Enterprise) + comparison table + FAQ + CTA |
| `/contact` | `contact/page.tsx` | `ContactForm` (mailto hand-off, no backend) + channel cards |
| `/about` | `about/page.tsx` | About EventNexus + Our Mission (`#mission` anchor) |
| `/faqs` | `faqs/page.tsx` | grouped `<details>` accordion (attendees / organizers / account) |
| `/privacy`, `/terms` | `privacy/page.tsx`, `terms/page.tsx` | shared `LegalDoc` shell |
| `/organizer-guide` | `organizer-guide/page.tsx` | 6-step numbered organizer workflow → `MarketingPage` shell |
| `/create-event` | `create-event/page.tsx` | "what's included" → `MarketingPage` shell |
| `/collaboration` | `collaboration/page.tsx` | multi-org co-hosting explainer → `MarketingPage` shell |

**Auth** (`AuthShell`):

| Route | Notes |
|-------|-------|
| `/login` | email/pass + Google; `sanitizeEventRedirect` for QR deep-links |
| `/register` | attendee / org tabs; **on success routes to `/verify-email`** (not the dashboard) — see §10 |
| `/forgot-password` | `useForgotPassword` |
| `/reset-password` `?token=` | new-password form; `POST /auth/reset-password {token,password}` |
| `/verify-email` `?token=` else *awaiting* | with token → auto `POST /auth/verify-email/:token`; without → "Check your inbox" holding screen (`Resend`, `?redirect=` carried through) |

**App** (`AppShell` — role-aware sidebar, no login *redirect* but blocks by role/verification):

| Group | Route | Notes |
|-------|-------|-------|
| Attendee | `/events` | browse: search / category / type / status / sort (debounced); seeds `?q= ?category= ?status= ?filters=1` from URL; live `event:created` invalidation |
| | `/events/[id]` | public poster/QR landing (no shell) — share, ICS, OSM map, sticky price, eSewa/Stripe |
| | `/event/[id]` | QR router — unauth → `PublicEventLanding`, auth → `RoleEventDetail` |
| | `/dashboard` | thin redirect → `/events` (kept for legacy links / post-auth) |
| | `/my-tickets` | Upcoming / Past buckets, QR, cancel |
| | `/saved-events` | localStorage (guest) vs `useSavedEvents` (authed) |
| | `/check-in` | wallet carousel, 30 s countdown, QR PNG + share + ICS |
| | `/recommendations` | AI picks with `ScoreRing`; per-card `joiningId` spinner (`ffc63d0` — was a shared boolean that spun every card) |
| | `/checkout/success` | eSewa error map + Stripe `getCheckoutStatus` poll |
| | `/analytics` | **charts dashboard, renders from the public `/api/events` feed — no login required**; footer "Dashboard" points here as a live demo |
| | `/settings` | location, interests, notifications, profile, password, sessions, GDPR export/delete |
| | `/notifications`, `/notifications/[id]` | list + detail |
| Organizer | `/organizer` | `useMyEvents` + `useOrganizerAnalytics` + insight cards |
| | `/organizer/events`, `/…/create`, `/…/[id]`, `/…/[id]/edit` | portfolio + `EventWizard` (create/edit, AI draft, geocode) |
| | `/organizer/analytics`, `/organizer/insights` | predicted-attendance chart, capacity alerts |
| | `/organizer/tickets` | `QrScanner` verify panel + `AttendeeRoster` |
| | `/organizer/collaboration` | `CollaborationWorkspace` (invitations + suggestions) |
| | `/organizer/notifications[/id]` | |
| Admin | `/admin` | `useOrgStats` + `useAdminAnalytics` |
| | `/admin/events`, `/admin/users`, `/admin/organizations` | directories; co-host detection; role changes |
| | `/admin/approvals` | *system admin only* — pending / active / rejected orgs |
| | `/admin/ai` | *system admin only* — model cards, retrain, chat-log curation, playground |
| | `/admin/security` | permission matrix (`useRoles`) |
| | `/admin/collaboration`, `/admin/settings`, `/admin/notifications[/id]` | |
| Misc | `/org-register` | org self-registration (pending-tenant flow) |
| | `*` (404) | `not-found.tsx` → `NotFoundScreen` |

### 5.3 Components

**`components/landing/*` (14):** `navbar.tsx` (now **Explore ▾ / Organizations ▾ Radix dropdowns**, flat `Pricing` / `Contact`, right side `Log In` / `Create Account`, plus a **mobile disclosure menu** — the navbar previously had no mobile nav; logged-in users still get `Dashboard` + `Logout`), `footer.tsx` (**5 sections** — Discover / Organizations / Company / Support / Connect — brand + tagline *"Connect. Collaborate. Create."*, "Built by Anjali Mishra" → LinkedIn; no Features / How-It-Works repeats), `demo-flow.tsx` (**Watch Demo dialog** — 7 role-tagged steps Organizer→Attendee→System with an explicit Next/Back stepper, segmented click-to-jump progress bar, autoplay, "Replay walkthrough"), `marketing-page.tsx` / `contact-form.tsx` / `legal-doc.tsx` (shared shells for the new pages), `hero.tsx` (GSAP, uses `WatchDemoButton`), `features.tsx`, `how-it-works.tsx` (plain tabbed panel, no scroll-pin), `solution.tsx`, `problem-strip.tsx`, `survey-stats.tsx`, `trust-bar.tsx`.

**`components/app/*` (~30):** `app-shell.tsx` — central role-aware shell; role from `ROLE_FOR_USER[user.role]`, never the URL; nav from `isOrgScopedAdmin ? orgAdminNav : roleNavMap[role]`; guards `needsVerification → router.replace("/verify-email")` and `currentUser && !pathAllowed → <NotFoundScreen/>` (`canAccessPath` from `lib/route-access.ts`). Also `event-card`, `role-event-detail`, `public-event-landing`, `event-wizard`, `event-qr-poster`, `qr-code` (canvas export), `qr-scanner` (html5-qrcode), `attendee-roster`, `collaboration-workspace`, `notification-*`, `stat-card`, chart sets (`admin-charts` / `organizer-charts` / `analytics-charts` / `segments-chart`), `venue-map` (OSM), `help-dialog`, `location-prompt`, `not-found-screen`.

**`components/ui/*` (~60):** shadcn "new-york" primitives + `logo.tsx`.

**`components/chatbot/event-bot.tsx`:** floating resizable assistant, markdown bubbles (`react-markdown` + `remark-gfm`), auto-scroll, per-user zustand history.

### 5.4 Lib Layer
- `lib/api/client.ts` — axios base `NEXT_PUBLIC_API_URL`; `TOKEN_KEY`/`REFRESH_KEY`/`USER_KEY`; single-flight `refreshPromise` → `POST /auth/refresh`; request attaches `Bearer`; 401 → refresh + retry; silent 403 allowlist; multi-tab `storage` reload; hard-nav guard on auth endpoints.
- `lib/api/*` (~22 files) — `auth.ts` (`storeSession`, `User`, `SessionInfo`), `events.ts`, `tickets.ts`, `notifications.ts`, `payments.ts`, `ai.ts`, `chatbot.ts`, `collaboration.ts`, `analytics.ts`, `audit.ts`, `list.ts` (`toQueryString`).
- `lib/queries/*` (~17) — react-query hooks; `authKeys.me`; invalidation on mutations. **`useRegister`** now stores the session then, for a new unverified local account, `router.replace("/verify-email"…)` instead of the role home.
- Helpers — `price.ts` (Rs.), `qr.ts` (`buildPublicUrl` + ICS RFC-5545), `event-date.ts` (max 2 y future), `event-redirect.ts` (`/event/[0-9a-f]{24}` open-redirect guard), `esewa.ts` (action allowlist), `geocode.ts` (Nominatim), `gsap.ts` (lazy), `route-access.ts` (`RULES`, most-specific-first), `saved-events.ts`, `socket.ts` (strip `/api`, lazy `socket.io-client`), `utils.ts` (`cn = twMerge(clsx)`).
- Store — `lib/stores/chatbot-store.ts` — zustand `persist`, key `eventnexus-chatbot:<userId>`, context cap 20.

### 5.5 Auth & RBAC (frontend)
- `useHasToken` — starts `false` (hydration-safe); re-checks on `storage` / `focus` / 2 s poll.
- `useRequireRole` — loading / allowed / denied → `roleRoutes` (`admin → /admin`, else `/dashboard`).
- `route-access.ts` `RULES` — `/admin/{approvals,ai,settings} → admin`; `/admin/* → admin,org_admin`; `/organizer/* → admin,org_admin,organizer`. Unlisted paths (`/events`, `/analytics`, `/recommendations`, `/dashboard`) are allowed for everyone, including logged-out visitors — hence `/analytics` works as a public demo.
- `AppShell` — verification gate: `!googleAccount && !emailVerified → /verify-email`. Role is derived from the user, never trusted from the URL.

---

## 6. Backend Deep Dive — `backend/src`

### 6.1 Bootstrap `src/server.ts`
`dotenv.config()` → `connectDB()` → `checkRoleIntegrity()` → `helmet({contentSecurityPolicy:false})` → CORS (comma-split `FRONTEND_URL` + `extraOrigins` incl. `https://eventnexus.tech`, `https://www.eventnexus.tech`, the EC2 IP, ALB DNS, localhost) with `credentials:true` → `POST /api/payments/webhook` with `express.raw()` **before** JSON → `express.json({limit:"8mb"})` (base64 cover images) → `sanitizeRequest` (global NoSQL guard) → mounts `/api/{auth,events,organizations,tickets,users,events/:eventId/sessions,speakers,notifications,recommendations,analytics,chatbot,payments,ai,audit,iam,collaboration,system}` → `GET /api/health` → `notFound` + `errorHandler` → `http.createServer` + `initSocket` → listen `PORT || 5000`.

### 6.2 Middleware Chain
helmet → cors → webhook-raw → json 8 MB → `sanitize.ts` (strip `$` / `.` / `__proto__`, depth 6) → `rateLimit.ts` (in-memory `Map`, key `${ip}:${baseUrl}${path}`, 60 s window, per-route budgets) → `auth.ts` (`protect` / `optionalAuth` / `authorize` / `requireSystemAdmin` / `requirePermission` / `requireOrgAdmin`) → `validate.ts` → `tenant.ts` (`scopeToOrg`) → `errors.ts` (`notFound` + `errorHandler`: `ValidationError→400`, dup-key `11000→409`, `CastError→400`).

### 6.3 Models — 17 Mongoose Schemas (`src/models/*.ts`)

`User` (email unique-lower, `password` `select:false` bcrypt-12, `googleId` sparse-unique, `role` enum `admin|org_admin|organizer|attendee`, `tokenVersion`, `active`, `emailVerifiedAt`/`emailVerificationToken`, `emailVerificationExpiresAt`, `passwordResetToken`/`…ExpiresAt`, `organization` ref, `interests` enum×10, `savedEvents`, `location{lat,lng,city,geo Point}` 2dsphere; pre-save hash + geo) ·
`Event` (title/date/venue, `coordinates` 2dsphere, `type`/`category`, `capacity`, `price{amount,currency:"NPR"}`, `status Upcoming|Live|Past|Draft`, `imageUrl` data-URL ≤ 6 MB, tags/highlights/agenda/speakers, `reminderSettings`, `coHostOrganizations`, `organizer`/`organization`; indexes status+date, price, text(title), org+coHost) ·
`Organization` (slug unique-lower, `owner`, `status pending|active|rejected|suspended`, `approvedBy`/`At`, `rejectionReason`) ·
`Ticket` (event/attendee/org, `qrToken` unique, `active` mirror of `status!=="cancelled"`, `status valid|checked-in|cancelled`, `payment{status,provider,amount,currency,stripeSessionId,esewaUuid}`, `checkedInAt`/`By`; partial-unique event+attendee where `active`) ·
`Notification` (recipient/org, `type` enum×9, event/link/data, `read`; recipient+createdAt, partial-unique for `new-event`) ·
`Feedback` (rating 1–5, comment, `sentiment` + `sentimentScore`; event+attendee unique) ·
`EventSession` (track, start/end, speakers, `capacity`; event+startTime; pre-save overlap guard) ·
`Session` (refresh-token store — `refreshTokenHash` unique `select:false`, `previousTokenHash`, `deviceFingerprint`, `expiresAt` TTL `expireAfterSeconds:0`) ·
`OrganizationMember` (`roleInOrg owner|admin|manager|member`, `status`; org+user partial-unique) ·
`Role` (name, `scope system|organization`, `permissions[]`) · `Permission` (`code` unique-lower) ·
`AuditLog` (user/org, `action` indexed, `resourceType`/`Id`, `result success|failure|denied`, ip/UA, createdAt-only) ·
`CoHostInvitation` (event, from/to org, `status pending|accepted|declined|cancelled`) ·
`CollaborationSuggestion` (eventA/B + orgA/B denormalized, `score 0–100`, `scoreSource ml|heuristic`, `statusA/B`, `resolvedOutcome`) ·
`Speaker` (org, name, email sparse, bio/photo/socials) ·
`Mail` (to/subject/template/text/html/metadata — every send is logged) ·
`ReminderJob` (event/recipient/org, `kind before_event|feedback`, `scheduledAt`/`sentAt`, `offsetMinutes`; unique per event+recipient+kind+offset).

### 6.4 Controllers & Routes — 19 controllers (`src/controllers/*.ts`)

`analyticsController` · `auditController` · `authController` · `chatbotController` · `coHostInvitationController` · `collaborationController` · `eventController` · `feedbackController` · `iamController` · `networkingController` · `notificationController` · `organizationController` · `paymentController` · `recommendationController` · `sessionController` · `speakerController` · `systemAdminController` · `ticketController` · `userController`.

17 route files (`src/routes/*.ts`). Highlights:

- **Auth** `routes/auth.ts` — `POST /org-register` (pending `org_admin`, no session), `POST /register` (attendee self-serve; organizer/admin invite-only via `isAdminEmail` → else 403; **issues a session token *and* sends the verification email**, but the frontend routes to `/verify-email`), `POST /login` (asserts `active` + org approved), `POST /google` (`verifyIdToken`, links `googleId`, attendee only), `POST /refresh` (rotation + reuse/theft detection → revoke-all + `tokenVersion++`), `POST /logout`, `GET /me`, sessions list/revoke, **`POST /verify-email/:token`**, **`POST /forgot-password`** (5/min) → **`POST /reset-password`**, `POST /resend-verification` (protected), `GET /export` + `DELETE /me` (GDPR).
- **Events** `routes/events.ts` — `GET /` (public, Draft hidden), `GET /my`, `GET /org` (tenant + coHost), `POST /` (validate, broadcast + `notifyNearby` + emit `event:created` + `scanForSuggestions`), `PUT /:id` (`canManageEvent`), `DELETE /:id` (`isOwningOrgManager`, cascade), `GET /:id/ai-insight` (LLM 8 s → heuristic + `predictAttendance`), `POST /ai-draft`.
- **Tickets** `routes/tickets.ts` — `GET /my`, `POST /:id/cancel`, `POST /verify` (org / coHost check), `GET /:id/attendees` (revenue by currency).
- **Payments** `routes/payments.ts` — `GET /config`, `POST /checkout/:id` (guards + NPR→USD + SHA-256 idempotency), `GET /checkout/status/:sessionId` (self-heal `issueTicketOnce`), `POST /esewa/initiate/:id`, `GET /esewa/success|failure/:eventId?`, `POST /webhook` (raw, signature-verified: `checkout.session.completed` + `charge.refunded`).
- **Users / Organizations / System / Sessions / Speakers / Notifications / Recommendations / Analytics / Chatbot / Collaboration / AI / Audit / IAM / Feedback / Networking** — CRUD + tenant scoping as before; `/api/ai/*` is `protect + requireSystemAdmin` (status, `POST /train`, chat-log curation); `/api/system/*` is `requireSystemAdmin` (org approve/reject/suspend + mail).

### 6.5 Utils `src/utils/*.ts` (22)
`aiClient` (best-effort proxy, timeout → fallback) · `aiProvider` (Gemini primary, Groq fallback) · `audit` (fire-and-forget) · `collaborationEngine` (7-dimension score, threshold 60, ML/heuristic blend) · `currency` (`NPR_USD` rate, `nprToUsd`, min 0.5) · **`email`** (nodemailer singleton + `Mail` log; on template-render failure the text **and** HTML fallback now embed `templateData.link` so a broken template can never send a link-less reset/verify email) · **`emailTemplates`** (resolves the templates dir from several candidate paths — `cwd/src`, `cwd/dist`, `__dirname`-relative — and uses the first that exists; `{{var}}` + `{{#if}}` renderer) · `esewa` (HMAC-SHA256 base64, `timingSafeEqual`, UAT creds) · `eventPublishNotify` (broadcast batch 500, dedup) · `generateToken` · `geo` (haversine) · `predictAttendance` (heuristic) · `proximityNotify` (25 km `$near`, cap 300) · `qrCode` (data-URI, `buildPublicEventUrl`) · `qrToken` (JWT 30 d, 300 s grace) · `query` (pagination ≤ 100, escaped-regex search) · `recommendationEngine` (two-tier: CF over-fetch ×2 + explicit boost, then deterministic scoring) · `reminderScheduler` (60 s tick, 4320 min look-ahead, 7 d feedback) · `roleIntegrity` (startup warn on pre-split admin rows) · `sentiment` (31/31-word lexicon) · `socket` (path `/api/socket.io`, handshake JWT + active + version + org, room `user:<id>`, `emitToUser`) · `ticketing` (atomic `$expr registered<capacity` + `$inc`, `issueTicketOnce`).

---

## 7. AI Service Deep Dive — `ai-service/`

### 7.1 Runtime
FastAPI; module globals `_attendance / _cf / _intent / _match` behind `_train_lock` / `_model_lock`; `KNOWN_INTENTS` (17). On startup it auto-trains any missing model, then `_load_models` from joblib.

### 7.2 Endpoints (14) — `app.py`
`GET /health` (ok/degraded + per-model booleans; Docker healthcheck) · `POST /train` (429 if locked, hot-reload) · `GET /stats` (meta + counts + intent distribution) · `GET /chatlog` · `PATCH /chatlog/{id}` (label must be in `KNOWN_INTENTS`) · `DELETE /chatlog/{id}` · `POST /predict-attendance` (HGB, clip to capacity) · `POST /collaboration-match` (RF proba; empty if model missing) · `POST /recommendations` (CF, needs `has_cf` + ≤ 30 candidates) · `POST /classify-intent` (LinearSVC `decision_function` argmax) · `POST /parse` (fast non-LLM intent + slots) · `POST /understand` (LLM-first with system prompt + slot normalize + history inherit; rule fallback) · `POST /generate` (generic LLM entry; Node builds the prompt) · `POST /log-intent`.

### 7.3 DB `db.py`
`get_db()` singleton (double-checked lock, `MongoClient serverSelection 3s maxPool 20`); loaders for past / upcoming events, tickets, chat log, orgs, and collaboration pairs (co-hosted / rejected + mutual `coHostOrganizations`, cap 5000); `insert_chat_log`.

### 7.4 Features `features.py`
Attendance — 7 dims: `days_since_created`, `days_until_event`, `capacity`, `registered`, `fill_rate`, `category` code (13), `type` code (In-person/Hybrid/Virtual). Pair — 10 dims for collaboration: `same_category`, `same_type`, `days_apart` (log1p), `same_city`/`country`, geo haversine (-1 if invalid), `capacity_ratio_log`, `content_cosine` (TF-IDF), `tag_jaccard`, `fill_delta`. `event_text` = title + desc + highlights + agenda + speakers + tags, lower-cased.

### 7.5 Training `train.py`
4 joblibs + atomic `meta.json`. Min-sample thresholds (`MIN_ATTENDANCE 5`, `MIN_CF_USERS 2`, `MIN_INTENT_PER_CLASS 1`, `MIN_MATCH_POS 8`); `SEED_CORPUS` ≈ 70 samples covering 15/17 intents. `train_attendance` HGB, `train_cf` TruncatedSVD + NearestNeighbors(cosine), `train_intent` FeatureUnion(word 1-2 + char_wb 3-6) → LinearSVC(balanced), `train_match` TF-IDF + RandomForest(300, depth 6) — **still 0 real positives**, so `_match` is absent.

### 7.6 NLU `nlu.py`
Regex slot extractors — `extract_quantity` (SINGLE / SINGULAR / PLURAL), `extract_time_scope` (PAST wins over UPCOMING), `extract_price_preference` (FREE / PAID, negation-aware, ambiguous → None), `extract_count` (`\b(\d{1,2}) events?\b`, cap 1–50), aggregated by `extract_slots`.

### 7.7 LLM `llm.py`
`TIMEOUT 10`, `MAX_RETRIES 2`, `_post_json` via `urllib`. `_call_groq` → `api.groq.com/openai/v1/chat/completions` (temp 0.2). `_call_gemini` → `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (temp 0.2, topP 0.9). Provider order `[gemini, groq]`; `generate_reply` retries with 0.5 s sleep, returns `str | None`.

---

## 8. Data Model & Entity-Relationship

```
User (attendee|organizer|org_admin|admin) 1─∞ OrganizationMember ∞─1 Organization
User.organization (nullable for platform admin) ──▶ Organization
Event ──▶ Organization + User(organizer) + [Organization coHost] + [Speaker]
Event 1─∞ Ticket ∞─1 User(attendee)     Ticket ──▶ Organization
Event 1─∞ EventSession                    Event 1─∞ Feedback (event+attendee unique)
User 1─∞ Session(refresh)  User 1─∞ Notification  User 1─∞ ReminderJob
AuditLog (immutable)   Mail (send log)
CoHostInvitation + CollaborationSuggestion (eventA/B, orgA/B denormalized)
```

Key constraints: partial-unique `Ticket` (event+attendee where `active`), unique `Feedback` (event+attendee), 2dsphere on `User.location.geo` + `Event.coordinates.geo`, TTL on `Session.expiresAt`.

---

## 9. API Endpoint Catalogue — `/api`

Grouped, condensed (100+ routes total):

- **Auth** `routes/auth.ts` — org-register, register, login, google, me, refresh, logout, sessions, **verify-email/:token**, **forgot-password → reset-password**, resend-verification, export, delete.
- **Events** `routes/events.ts` — `GET /` `/my` `/org` `/:id` `/:id/attendees` `/:id/ai-insight`, `POST /ai-draft` `POST /`, `PUT/DELETE /:id`, co-host invitations.
- **Tickets** — `GET /my`, `POST /:id/cancel`, `POST /verify`, `GET /:id/attendees`.
- **Payments** — `GET /config`, `POST /checkout/:id`, `GET /checkout/status/:sessionId`, `POST /esewa/initiate/:id`, `GET /esewa/success|failure`, `POST /webhook` (raw).
- **Users** — `PATCH /me/{location,profile,interests,reminders,password}`, saved-events, `GET /` + `/:id`, `PATCH /:id/status`, `DELETE /:id`, `POST /`, `PUT /:id/role`.
- **Organizations** — `GET /`, `GET/PUT /me`, `GET/POST/PATCH/DELETE /members/:userId`.
- **System** — `GET /orgs`, `POST /orgs/:id/{approve,reject}`, `PATCH /:id`.
- **Speakers / Sessions / Notifications / Recommendations / Analytics / Chatbot / Collaboration / AI / Audit / IAM / Feedback / Networking** — per §6.4.

---

## 10. Auth, RBAC & Multi-Tenancy

### Tokens
- **Access JWT** — `jwt.sign({id, ver: tokenVersion}, JWT_SECRET, {expiresIn: JWT_EXPIRES_IN||"7d"})` (`utils/generateToken.ts`).
- **Refresh** — `randomBytes(48)` base64url, stored as SHA-256 hash in `Session` with `deviceFingerprint` and TTL (`utils/tokens.ts`).
- **Email token** — `randomBytes(32)` hex, hashed, 24 h expiry — used by verify-email **and** password-reset.
- **QR ticket JWT** — `jwt.sign({ticketId,eventId,attendeeId}, QR_TOKEN_SECRET||JWT_SECRET, {expiresIn:"30d"})`; short-lived scan token with 300 s grace (`utils/qrToken.ts`).

### Refresh rotation
`deviceFingerprint = ip + "::" + UA[:200]`; one session per device (`updateMany revokedAt` before create). On refresh: hash found → if it matches `previousTokenHash` → **theft** → revoke all + `tokenVersion++` + audit; else rotate (`previous = current`, new hash, `lastUsedAt`).

### Middleware (`middleware/auth.ts`)
`protect` (bearer → verify → `active` 403 / `ver` mismatch 401), `optionalAuth` (public draft gate), `authorize(...roles)`, `requireSystemAdmin` (`role === "admin" && !organization`), `requirePermission` (role cache, invalidated on IAM change), `requireOrgAdmin` (active `OrganizationMember` with owner/admin).
Static `ROLE_PERMISSIONS`: admin ~12 (incl. `org:approve`, `ai:manage`), org_admin ~10 (no approve/ai), organizer ~5, attendee ~3. Dynamic `Role` docs layer on top (cached).

### Org workflow
`orgRegister` → slug check → create Org `pending` + pending `org_admin` + owner `Member` + verification mail (**no session**). `assertOrgApproved` blocks login/google/refresh for pending/rejected/suspended (403). `systemAdmin` approve → active + Member + mail; reject → reason + mail; suspend → revoke sessions + `tokenVersion++`.

### Registration → verification flow (current)
1. `POST /auth/register` (attendee) → `201 {user, token, refreshToken}` **and** `sendVerificationEmail(user)` fired.
2. Frontend `useRegister.onSuccess` — stores the session (so "Resend" is authenticated), then because `user.emailVerified === false && !user.googleAccount`, does `router.replace("/verify-email"[?redirect=…])`.
3. `/verify-email` (no token) → *AwaitingVerification* holding screen — shows the address, `Resend verification email` button, `Sign out`. Auto-redirects to the role home once `useCurrentUser().emailVerified` flips true.
4. The email (rendered from `src/templates/emails/verify-email.html`) contains a **Verify Email Address** button → `https://eventnexus.tech/verify-email?token=<token>`.
5. `/verify-email?token=` → auto `POST /auth/verify-email/:token` → sets `emailVerifiedAt`, clears token → success card → the still-open holding tab detects verification and continues.
   *(Password reset is the mirror image: `password-reset.html` → "Reset Password" button → `https://eventnexus.tech/reset-password?token=<token>` → `POST /auth/reset-password {token,password}`.)*

### Multi-tenancy
`tenant.ts scopeToOrg` injects `organization` (attendee bypass, else 403). `canManageEvent` = owner / system-admin / org-admin / co-host-admin. `verifyTicket` cross-checks the scanning org against the event's org **and** its `coHostOrganizations`.

---

## 11. Payments — Stripe + eSewa

**Stripe** (`paymentController.ts`, `currency.ts`) — `getPaymentConfig` exposes `enabled` + publishable key + `nprUsdRate`. `createCheckoutSession` guards Draft/past/paid/capacity/duplicate, converts NPR→USD (`nprToUsd`, min $0.50), SHA-256 idempotency key `event:user:amount`, metadata `eventId`/`attendeeId`, `success_url` → `/checkout/success`. `getCheckoutStatus` retrieves the session and self-heals the ticket (`issueTicketOnce`) + emails the QR. Webhook (`express.raw`, signature-verified): `checkout.session.completed` (paid) → issue ticket; `charge.refunded` (full) → cancel ticket + decrement.

**eSewa v2** (`utils/esewa.ts`) — UAT creds `EPAYTEST` / `rc-epay`; SIGNED fields `total_amount,transaction_uuid,product_code` via HMAC-SHA256 → base64; `transaction_uuid = ${eventId}-${attendeeId}-${now}-${rand}` (24 h TTL). `verifyResponse` pins `product_code` + `timingSafeEqual`; `checkStatus` GET (5 s). Controller `confirmEsewaPayment` decodes base64, verifies signature, checks status `COMPLETE`, and cross-checks the amount in paisa; `handleEsewaSuccess` redirects to `${FRONTEND_URL}/checkout/success?provider=esewa&…`.

Frontend `lib/esewa.ts` — `ESEWA_ALLOWED_ACTIONS` whitelist + `submitEsewaForm` (hidden POST form).

---

## 12. Realtime & Notifications

**Backend** — `Server({path: "/api/socket.io"})`, CORS from the comma-split origin list; handshake verifies the access JWT + `active` + `tokenVersion` + org status, joins room `user:<id>`; `emitToUser` / `emitToUsers`.

**Triggers** — registration (2 notifications), cancel, checked-in, refund, nearby event (`$near` 25 km, cap 300), event published (broadcast batch 500, dedup) + `event:created`, collaboration invitation/suggestion. Every notification also emits `notification:created`, `unread:count`, `notification:read` / `read-all`.

**Frontend** — `lib/socket.ts` strips `/api` from `NEXT_PUBLIC_API_URL` for the socket base, lazy-loads `socket.io-client`, `auth:{token}`, reconnection 10. `providers/realtime-notifications.tsx` → `useRealtimeNotifications` → `setQueryData` + invalidate + toast with a "View" deep-link.

Since `NEXT_PUBLIC_API_URL = https://eventnexus.tech/api`, the socket connects to `wss://eventnexus.tech/api/socket.io` — Caddy proxies the `Upgrade` transparently under the `/api/*` rule.

---

## 13. Email System

`utils/email.ts` — nodemailer singleton (`host / port / secure(465) / auth / tls`); `sendMail({to, subject, template, templateData, …})` renders the template, **always** writes a `Mail` document (audit trail), then sends via SMTP (prod) or logs to console (dev, when SMTP creds absent). It **never throws** — callers use `.catch()`.

`utils/emailTemplates.ts` — loads & caches `src/templates/emails/<name>.html`; `renderTemplate` supports `{{var}}`, `{{obj.key}}`, and `{{#if var}}…{{/if}}`. **The templates directory is resolved from a candidate list** (`<cwd>/src/templates/emails`, `<cwd>/dist/templates/emails`, `__dirname`-relative) — a build/layout change can no longer silently disable templated email.

**Fix history (`7a51d3f`):** the backend Docker runner stage previously copied only `dist/`, so the `.html` templates (which `tsc` never emits) were **missing in production** → `renderEmail` threw → `sendMail` fell back to a bare `"EventNexus notification: <subject>"` with **no link** (broke verify-email *and* password-reset). Fixed by (a) `COPY --from=builder /app/src/templates ./src/templates` in the Dockerfile, (b) the multi-candidate resolver above, (c) a fallback in `email.ts` that embeds `templateData.link` in both the text and HTML if the template still fails.

**Templates:** `verify-email.html`, `password-reset.html`, `ticket-confirmation.html` (with QR data-URI), `cohost-invitation.html`, `org-approved.html`, `org-rejected.html`, `nearby-event.html` (+ an inline reminder body in `reminderScheduler.ts`). All use `{{link}}` for the CTA button `href` and the copy-paste line; controllers build `${FRONTEND_URL.split(",")[0]}/…?token=<token>` → `https://eventnexus.tech/…` in prod.

**Call sites:** `authController` (register / resend / forgot), `paymentController` (ticket QR), `proximityNotify` (cap 100 emails), `reminderScheduler`, `coHostInvitationController`, `systemAdminController` (approve / reject).

---

## 14. AI Capabilities — `ai-service/*`

- **Attendance forecast** — HistGradientBoostingRegressor on the 7 event features; result clipped to `[registered, capacity]`.
- **Recommendations** — two-tier: (1) collaborative filtering (TruncatedSVD user/item factors + NearestNeighbors) over-fetched ×2 with an explicit interest boost; (2) deterministic fallback scoring (category match, distance, recency, popularity, price fit, capacity, tags) — always returns something.
- **Intent classification** — FeatureUnion(word 1-2 + char_wb 3-6) TF-IDF → LinearSVC; 17 intents.
- **Chat understanding** — LLM-first (`/understand`) with a typo-tolerant JSON system prompt (`intent`, `quantity`, `time_scope`, `price_pref`, `count`) + slot normalization + short history inheritance; deterministic rule fallback.
- **Collaboration match** — 7-dimension `collaborationEngine` (heuristic threshold 60) blended 55/45 with the RandomForest model *when trained* (currently heuristic-only — 0 real training positives).
- **Sentiment** — 31/31-word lexicon on feedback comments.
- **LLM providers** — Gemini primary → Groq fallback, `urllib` only.

Node side (`utils/aiClient.ts`) races each AI call with an 8–10 s timeout and falls back to `predictAttendance.ts` / `recommendationEngine.ts` / heuristics if the service is slow or down.

---

## 15. Deployment — Docker, Caddy/HTTPS & AWS

### 15.1 Edge / TLS (current)
`infra/Caddyfile` + the `caddy` service in `docker-compose.prod.yml`:
- Image `caddy:2-alpine`, host ports `80:80`, `443:443`, `443:443/udp` (HTTP/3).
- Env `DOMAIN` (default `eventnexus.tech`) + `ACME_EMAIL` (default `admin@eventnexus.tech`) — exported by the deploy workflow / `deploy-remote.sh`.
- Automatic Let's Encrypt certificate for the apex + `www`, **auto-renewing**. Certs & ACME account persist in the named volume **`eventnexus-caddy-data`** — *do not delete it*.
- Routing: `www.<domain>` → 301 → apex (scheme preserved); `/api/*` → `reverse_proxy backend:5000` (covers REST + `socket.io` websockets); everything else → `reverse_proxy frontend:3000`. `Strict-Transport-Security` header added; `Server` header stripped.
- `auto_https disable_redirects` is currently set (a leftover from when only `:80` was open) — `http://` is served rather than force-redirected to `https://`. Drop it once you want forced HTTPS.
- Admin API healthcheck on `127.0.0.1:2019`.

DNS: `eventnexus.tech` `A @` and `A www` → `3.106.232.125` (the EC2 public IP directly — the ALB is **not** in the path).

### 15.2 Docker images

| Service | Base | Stages | Runtime port | Healthcheck |
|---------|------|--------|--------------|-------------|
| backend | `node:22-alpine` | base → deps (`npm ci`) → builder (`tsc`) → prod-deps → runner (`appuser`, `dumb-init`, **+ `src/templates`**) | 5000 (→ `127.0.0.1:5000`) | `curl /api/health` |
| frontend | `node:22-alpine` | base → deps (pnpm) → builder (`next build`, standalone) → runner (`nextjs:1001`) | 3000 (→ `127.0.0.1:3000`) | `curl /` |
| ai-service | `python:3.12-slim` | base → builder (venv) → runner (`appuser`, `MODELS_DIR=/app/models`) | 8000 (→ `127.0.0.1:8000`) | `python urllib /health` |
| caddy | `caddy:2-alpine` | — | 80 / 443 (public) | admin API `:2019` |

### 15.3 `docker-compose.prod.yml`
- Images `ghcr.io/${IMAGE_PREFIX:-anjali0616/event}-{backend,frontend,ai-service}:${IMAGE_TAG:-latest}`.
- `backend.environment` **forces** `NODE_ENV=production`, `AI_SERVICE_URL=http://ai-service:8000`, `FRONTEND_URL=${FRONTEND_URL:-https://eventnexus.tech,https://www.eventnexus.tech}` — these override anything in the pasted `backend.env` secret (compose `environment` > `env_file`, and the app's `dotenv` doesn't override real env vars).
- `env_file` (optional): `~/eventnexus/backend.env`, `~/eventnexus/ai.env`, `~/eventnexus/frontend.env`.
- `depends_on` health chain: `ai-service` (healthy) → `backend` (healthy) → `frontend` (started) → `caddy`.
- Resource limits 768 M / 512 M / 1 G; JSON log rotation 10 m × 3.
- Volumes: `eventnexus-ai-models`, `eventnexus-caddy-data`, `eventnexus-caddy-config`. Network `eventnexus-prod`.

### 15.4 AWS (`ap-southeast-2`, account 919744496312)
VPC `vpc-01aac9aac4b81d187` (`10.0.0.0/16`), subnets `10.0.1.0/24` (a) + `10.0.2.0/24` (b), IGW `igw-00580bea854f8ef32`, RT `rtb-02d2a137743540d52`.
SGs — `sg-069e3ba7854302690` (EC2): needs inbound **TCP 80 + 443** for Caddy/ACME; `sg-08d7282ce6bb65999` (ALB, now unused).
EC2 `i-04ca32808d1316bc8` — `t3.micro`, AL2023, `10.0.1.142` / `3.106.232.125`, 30 GB gp3, Docker 25.0.14 + Compose 2.29.7, deploy dir `~/eventnexus`, env dir `~/eventnexus-env`.
ALB `eventnexus-alb` (`eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com`) — provisioned but **bypassed**; safe to delete.

---

## 16. CI/CD — GitHub Actions + GHCR

**Repo:** `Anjali0616/Eventnexus` (public). **Registry:** `ghcr.io/anjali0616/event-{backend,frontend,ai-service}` (public → anonymous pull, no PAT needed). `IMAGE_PREFIX` is hard-coded `anjali0616/event` in `deploy.yml` (GitHub Actions expressions have no `lower()`, and GHCR rejects the uppercase owner in cache refs).

### `.github/workflows/ci.yml` — PR / non-main push
Matrix `[backend, frontend, ai-service]` → `docker/build-push-action` with `push: false`, `type=gha` cache. Validation only.

### `.github/workflows/deploy.yml` — push to `main` (+ manual `workflow_dispatch skip_build`)
`permissions: packages: write`. Jobs:
1. **build-backend / build-frontend / build-ai** (parallel) — checkout → buildx → GHCR login → `docker/metadata-action` (`:latest` + `:<sha>` + `:<branch>`) → build & push with `type=registry` `:buildcache`. Frontend gets `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` build-args from repo *variables*.
2. **deploy** (needs all builds `success|skipped`):
   - *Check required secrets* — `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`.
   - *Materialise env files* — write `secrets.BACKEND_ENV` / `AI_ENV` / `FRONTEND_ENV` to `deploy-env/*.env`, `tr -d '\r'` (CRLF sources), drop empties.
   - *Upload env files* — `appleboy/scp-action` → `~/eventnexus-env/` on EC2.
   - *Deploy via SSH* — `appleboy/ssh-action` runs a **trivial** payload: derive `HOME`, clone/`git reset --hard origin/main` into `~/eventnexus`, `export` `IMAGE_PREFIX / IMAGE_TAG / DOMAIN / ACME_EMAIL / FRONTEND_URL / GHCR_USER / GHCR_TOKEN`, then `bash infra/deploy-remote.sh`.
   - *Notify on failure*.

**Why this shape:** drone-ssh (behind `appleboy/ssh-action`) mangles multi-line shell and **discards stderr**, so earlier attempts failed as a bare `exit 1`. The real work now lives in a committed script:

### `infra/deploy-remote.sh` (runs on the host)
`set -eo pipefail` → normalize `IMAGE_PREFIX` lower-case → `install -m 600` the uploaded `~/eventnexus-env/*.env` into place (empty = keep existing host copy) → **optional** `docker login ghcr.io` (non-fatal — repo is public) → `docker compose -f docker-compose.prod.yml pull` → `up -d --remove-orphans` → wait for `ai-service / backend / frontend / caddy` health (≤ 120 s each) → smoke tests: internal `127.0.0.1:{5000/api/health, 8000/health, 3000/}` (fatal) + caddy running (fatal) + `https://$DOMAIN/api/health` & `/` retry ×12 (non-fatal, ACME can lag) → `docker image prune` → `== Deploy complete ==`.

### Repo settings (see `docs/REPO_SETTINGS.md`)
- **Secrets:** `EC2_HOST` `3.106.232.125`, `EC2_USER` `ec2-user`, `EC2_SSH_KEY` (PEM), `BACKEND_ENV` (full `backend/.env`), `AI_ENV` (full `ai-service/.env`), `GOOGLE_CLIENT_ID`, `ACME_EMAIL` (optional).
- **Variables:** `NEXT_PUBLIC_API_URL = https://eventnexus.tech/api`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `DOMAIN = eventnexus.tech` (optional `FRONTEND_URL`).
- **Actions → Workflow permissions:** Read *and write*.

---

## 17. Environment Variables

### Backend (`backend/.env.example`, live in the `BACKEND_ENV` secret)
| Var | Req | Prod value / note |
|-----|-----|-------------------|
| `PORT` | no | 5000 |
| `MONGODB_URI` | **yes** | Atlas `mongodb+srv://…@eventnexus.ue1fwo6.mongodb.net/eventnexus` |
| `JWT_SECRET` | **yes** | *(rotate — placeholder-ish)* |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | no | `7d` / `30d` |
| `QR_TOKEN_SECRET` | no | falls back to `JWT_SECRET` |
| `FRONTEND_URL` | no | **overridden by compose** → `https://eventnexus.tech,https://www.eventnexus.tech` (drives CORS, socket origins, Stripe/eSewa redirects, email & QR links via `.split(",")[0]`) |
| `GOOGLE_CLIENT_ID` | no | `1092789532631-22lvnc3fiv195d4dgg1nor6icb1a85aj.apps.googleusercontent.com` |
| `ADMIN_EMAILS` | no | comma list → auto-`admin` on sign-in |
| `SMTP_HOST/PORT/USER/PASS(WORD)` `EMAIL_FROM` | prod | `smtp.gmail.com` `587` `home1051ab@gmail.com` (App Password) — code reads `SMTP_PASS` **or** `SMTP_PASSWORD` |
| `AI_SERVICE_URL` | no | **overridden by compose** → `http://ai-service:8000` |
| `GROQ_API_KEY/MODEL` | no | `llama-3.1-8b-instant` |
| `GEMINI_API_KEY/MODEL` | no | `gemini-flash-latest` |
| `STRIPE_SECRET_KEY / PUBLISHABLE_KEY / WEBHOOK_SECRET` | no | **test** keys (`sk_test_…` / `pk_test_…`) |
| `NPR_USD_RATE` | no | `153` |
| `ESEWA_PRODUCT_CODE / SECRET_KEY / FORM_URL / STATUS_URL` | no | UAT sandbox (`EPAYTEST`, `rc-epay`) |

### Frontend (`frontend/.env.example`; build-time only — baked)
| Var | Prod |
|-----|------|
| `NEXT_PUBLIC_API_URL` | `https://eventnexus.tech/api` (GitHub repo variable) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | same client id as backend |

### AI (`ai-service/.env.example`, live in `AI_ENV` secret)
`AI_PORT=8000` · `MONGODB_URI` (same Atlas) · `MODELS_DIR=./models` (→ `/app/models`) · `GROQ_API_KEY/MODEL` · `GEMINI_API_KEY/MODEL`.

### Deploy-time (workflow → compose → Caddy)
`DOMAIN` · `ACME_EMAIL` · `FRONTEND_URL` (derived from `DOMAIN`) · `IMAGE_PREFIX=anjali0616/event` · `IMAGE_TAG=latest`.

---

## 18. Security Hardening

- **HTTPS** via Caddy + Let's Encrypt (auto-renew), HSTS header, `www` → apex. App containers are **not internet-facing** (127.0.0.1 only); Caddy is the single ingress.
- Helmet security headers; `x-powered-by` disabled; CSP disabled only for base64 data-URL cover images.
- CORS — comma-split `FRONTEND_URL` + hard-coded HTTPS-origin fallbacks; `!origin` allowed (server-to-server).
- Stripe webhook — raw body + signature verification, mounted before `express.json`.
- Global NoSQL sanitizer — strips `$` / `.` / `__proto__`, depth 6.
- Rate limiting — in-memory fixed-window `Map`, per-route budgets (register 10, login 10, google 10, forgot 5, refresh 60, org-register 5, event-create 5, esewa 20, chatbot 20 …).
- `protect` checks `active` (403) + `tokenVersion` (401); refresh-token **theft detection** → revoke-all + `tokenVersion++`.
- bcrypt cost 12; `select:false` password; suspending an org revokes its sessions.
- QR ticket — 300 s scan grace; secret falls back to `JWT_SECRET` with a startup warning.
- Open-redirect guard — post-auth redirect must match `/event/[0-9a-f]{24}` (`event-redirect.ts`); eSewa action allowlist + `timingSafeEqual`.
- Tenant isolation — `scopeToOrg` + co-host cross-checks on ticket verification.
- `errorHandler` maps known errors to 4xx without leaking internals.
- Secrets — env files written `chmod 600` on the host, outside `~/eventnexus` (so a first-deploy `rm -rf` can't wipe them); `.dockerignore` excludes `.env`; SSH key is git-ignored.

**Still open:** rotate `JWT_SECRET` / `QR_TOKEN_SECRET`; restrict SG port 22 from `0.0.0.0/0`; drop `auto_https disable_redirects` to force HTTPS; move cover images to object storage (base64 ≤ 8 MB body limit); delete the unused ALB; wire Stripe/Google callback URLs to the live domain (Stripe webhook → `https://eventnexus.tech/api/payments/webhook`).

---

## 19. Local Development

```bash
# prerequisites: Node 22, MongoDB (local or Atlas), Python 3.12

# backend  (TypeScript, npm)
cd backend
npm ci
cp .env.example .env          # set MONGODB_URI, JWT_SECRET
npm run seed                  # wipes collections, syncs indexes, seeds users/events/tickets/...
npm run dev                   # tsx watch src/server.ts → http://localhost:5000/api/health

# frontend  (pnpm)
cd frontend
pnpm install
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:5000/api
pnpm dev                      # → http://localhost:3000

# ai-service
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # MONGODB_URI (same), GEMINI/GROQ keys optional
./start.sh                    # uvicorn app:app → http://localhost:8000/health
#                               first run auto-trains any missing models

# everything via Docker (dev)
docker compose up --build     # ai → backend → frontend, health-gated

# seeded accounts (password: password123)
admin@eventnexus.dev      → /admin
organizer@eventnexus.dev  → /organizer
orgadmin@eventnexus.dev   → /admin (tenant-scoped)
attendee@eventnexus.dev   → /events
```

Backend scripts: `dev | build | start | seed | migrate:org-admin | backfill:event-geo`. Frontend: `dev | build | start | lint`.

---

## 20. Project Structure Tree

```
backend/src/                         (TypeScript, compiled to dist/ by tsc)
├── server.ts                  entry — helmet → cors → webhook-raw → json → sanitize → mounts → socket
├── config/db.ts               mongoose.connect(MONGODB_URI), exit(1) on failure
├── controllers/  (19)         auth, event, ticket, payment, user, organization, systemAdmin,
│                              chatbot, collaboration, coHostInvitation, notification, analytics,
│                              recommendation, session, speaker, feedback, networking, audit, iam
├── middleware/   (6)          auth, sanitize, rateLimit, errors, tenant, validate
├── models/       (17)         User, Event, Ticket, Notification, Feedback, EventSession, Session,
│                              Organization, OrganizationMember, Role, Permission, AuditLog,
│                              CoHostInvitation, CollaborationSuggestion, Speaker, Mail, ReminderJob
├── routes/       (17)         auth, events, tickets, payments, users, organizations, system,
│                              sessions, speakers, notifications, recommendations, analytics,
│                              chatbot, collaboration, ai, audit, iam
├── utils/        (22)         aiClient, aiProvider, audit, collaborationEngine, currency, email,
│                              emailTemplates, esewa, eventPublishNotify, generateToken, geo,
│                              predictAttendance, proximityNotify, qrCode, qrToken, query,
│                              recommendationEngine, reminderScheduler, roleIntegrity, sentiment,
│                              socket, ticketing, tokens
├── templates/emails/          7 .html templates (shipped into the Docker runner image)
├── seed.ts                    deterministic PRNG seed — ~27 users, ~109 events, feedback, notifs
└── scripts/                   backfill-event-geo.ts, migrate-org-admin-role.ts

frontend/
├── app/                       ~52 routes (see §5.2) — layout.tsx, globals.css, not-found.tsx
├── components/
│   ├── landing/  (14)         navbar (dropdowns + mobile), footer (5 sections), demo-flow,
│   │                          marketing-page, contact-form, legal-doc, hero, features,
│   │                          how-it-works, solution, problem-strip, survey-stats, trust-bar
│   ├── app/      (~30)        app-shell, nav-configs, event-card, role-event-detail,
│   │                          public-event-landing, event-wizard, qr-*, charts, venue-map, ...
│   ├── ui/       (~60)        shadcn "new-york" + logo.tsx
│   ├── chatbot/event-bot.tsx
│   ├── auth/auth-shell.tsx  +  interests/  +  anim/reveal  +  providers/ (3)
├── lib/  api/(~22)  queries/(~17)  hooks/  stores/chatbot-store.ts  + helpers
├── public/logo.png
├── next.config.mjs   components.json   Dockerfile   styles/globals.css

ai-service/
├── app.py        14 routes, KNOWN_INTENTS(17), startup auto-train
├── db.py         Mongo + collaboration pairs
├── features.py   7 event dims + 10 pair dims + TF-IDF
├── llm.py        gemini/groq via urllib
├── nlu.py        regex slot extractors
├── train.py      4 models (HGB, SVD+NN, SVC, RF) + meta.json
└── requirements.txt   Dockerfile   start.sh   models/*.joblib

infra/
├── Caddyfile              edge proxy + auto-HTTPS
├── deploy-remote.sh       remote deploy logic (runs on EC2)
├── provision-*.sh         one-time VPC / EC2 / ALB (ALB bypassed)
└── aws-ids.env  alb-info.env  ec2-info.env  eventnexus-key-2026.pem(git-ignored)

.github/workflows/  ci.yml  (matrix build, no push)  ·  deploy.yml  (build → scp env → ssh → deploy-remote.sh)
docker-compose.yml (dev)   docker-compose.prod.yml (caddy + 3 GHCR images)
docs/  CICD.md  DEPLOYMENT.md  EC2_SETUP.md  HTTPS_DOMAIN_SETUP.md  REPO_SETTINGS.md  FEATURE_CHECKLIST.md  USER_TESTING.md
```

---

## 21. Appendix — Key File References

| Concern | File |
|---------|------|
| Backend entry | `backend/src/server.ts` |
| Auth logic | `backend/src/controllers/authController.ts`, `backend/src/middleware/auth.ts` |
| Registration → verify flow | `frontend/lib/queries/auth.ts` (`useRegister`), `frontend/app/verify-email/page.tsx` |
| Email | `backend/src/utils/email.ts`, `backend/src/utils/emailTemplates.ts`, `backend/src/templates/emails/*` |
| Payments | `backend/src/controllers/paymentController.ts`, `backend/src/utils/esewa.ts`, `backend/src/utils/currency.ts` |
| Realtime | `backend/src/utils/socket.ts`, `frontend/lib/socket.ts` |
| RBAC table | `backend/src/middleware/auth.ts` (`ROLE_PERMISSIONS`), `frontend/lib/route-access.ts` |
| Edge / HTTPS | `infra/Caddyfile`, `docker-compose.prod.yml` (`caddy` service) |
| Deploy | `.github/workflows/deploy.yml`, `infra/deploy-remote.sh` |
| Repo settings | `docs/REPO_SETTINGS.md`, `docs/HTTPS_DOMAIN_SETUP.md` |
| Landing nav/footer | `frontend/components/landing/navbar.tsx`, `frontend/components/landing/footer.tsx` |
| Watch-Demo dialog | `frontend/components/landing/demo-flow.tsx` |
| Brand mark | `frontend/components/ui/logo.tsx`, `frontend/public/logo.png` |

---

## 22. Quick Reference — Ports & URLs

| Service | Local | Production |
|---------|-------|-----------|
| Site (Caddy) | — | **https://eventnexus.tech** (443, HTTP/3); `www` → 301 → apex |
| Frontend | http://localhost:3000 | `frontend:3000` (via Caddy, all non-`/api` paths); host `127.0.0.1:3000` |
| Backend API | http://localhost:5000/api | `https://eventnexus.tech/api/*` → `backend:5000`; host `127.0.0.1:5000`; health `GET /api/health` |
| Socket.IO | ws://localhost:5000/api/socket.io | `wss://eventnexus.tech/api/socket.io` (proxied by the `/api/*` rule) |
| AI service | http://localhost:8000 | internal only — `http://ai-service:8000` (compose DNS) / `127.0.0.1:8000` on the host; `GET /health` |
| Mongo | mongodb://localhost:27017/eventnexus | Atlas `eventnexus.ue1fwo6.mongodb.net` |

---

## 23. Notable Changes & Tech Debt

**Recently landed** (this doc reflects `main@25a4b12`):
- Backend fully migrated JavaScript → TypeScript; builds with `tsc`, runs `dist/`, installs via `npm ci`.
- **HTTPS + custom domain** — Caddy reverse proxy replaces the ALB path; Let's Encrypt auto-cert for `eventnexus.tech` + `www`; app containers bound to `127.0.0.1`.
- **CI/CD rebuilt** — `deploy.yml` → scp env files (`appleboy/scp-action`) + `infra/deploy-remote.sh`; hard-coded lowercase `IMAGE_PREFIX`; GHCR images public; non-fatal GHCR login; robust `HOME` handling.
- **Email fix** — templates now ship in the runner image; resilient template-dir resolver; link-bearing fallback so reset/verify emails always contain the URL.
- **Registration** — now lands on `/verify-email` (holding screen), not the dashboard.
- **Landing/marketing** — new pages `/pricing`, `/contact`, `/about`, `/faqs`, `/privacy`, `/terms`, `/organizer-guide`, `/create-event`, `/collaboration`; redesigned dropdown navbar + mobile menu; 5-section footer with brand tagline; interactive Watch-Demo dialog; shared `<Logo>`; HowItWorks scroll-pin removed.
- Recommendations page — per-card register spinner (was a shared boolean).

**Still open:**
- Rotate `JWT_SECRET` / `QR_TOKEN_SECRET` off placeholder values.
- Restrict SG port 22 to the operator IP.
- Drop `auto_https disable_redirects` in the Caddyfile to force HTTPS.
- Delete the unused ALB + its SG/target groups (cost).
- Point Stripe webhook + Google OAuth authorized origins at `https://eventnexus.tech`.
- Move base64 cover images to object storage (8 MB JSON body limit).
- `collaboration_match` model has 0 real training positives → heuristic-only.
- Helmet CSP disabled — tighten once cover images move to a CDN.

---

*End of SYSTEM_OVERVIEW.md — for runbooks see `docs/DEPLOYMENT.md`, `docs/CICD.md`, `docs/EC2_SETUP.md`, `docs/HTTPS_DOMAIN_SETUP.md`, `docs/REPO_SETTINGS.md`, `README.md`.*
