# EventNexus — Complete System Overview

> **Generated:** 2026-09-08 | **Repo:** Event | **Commit:** main@261fd43 | **Stack:** Next.js 16 + Express 4 + FastAPI + MongoDB | **Knowledge Graph:** 3802 nodes, 8727 edges

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Monorepo Layout](#2-monorepo-layout)
3. [Tech Stack Matrix](#3-tech-stack-matrix)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Frontend — Next.js 16 (React 19)](#5-frontend)
6. [Backend — Express + Mongoose](#6-backend)
7. [AI Service — FastAPI + Scikit-learn](#7-ai-service)
8. [Data Model & ER](#8-data-model)
9. [API Endpoint Catalogue](#9-api-catalogue)
10. [Auth, RBAC & Multi-Tenancy](#10-auth-rbac)
11. [Payments — Stripe + eSewa](#11-payments)
12. [Realtime & Notifications](#12-realtime)
13. [Email System](#13-email)
14. [AI Capabilities](#14-ai-capabilities)
15. [Deployment — Docker & AWS](#15-deployment)
16. [CI/CD — GitHub Actions + GHCR](#16-cicd)
17. [Environment Variables](#17-env)
18. [Security Hardening](#18-security)
19. [Local Development](#19-local-dev)
20. [Project Structure Tree](#20-project-tree)
21. [Appendix — File References](#21-appendix)

---

## 1. Executive Summary

**EventNexus** is a **multi-tenant, AI-enabled secure event management platform** for Nepal. Attendees discover, register, pay and check-in via QR; organizers create/manage events with AI drafts, insights, sessions, speakers, attendee rosters and QR verification; tenant admins (`org_admin`) manage their organization; platform admins (`admin`) handle approvals, system health, IAM matrix and AI training.

- **Monorepo:** `frontend/` (Next.js), `backend/` (Express), `ai-service/` (FastAPI/Python), `infra/` (AWS provisioning), `docs/`, `docker-compose*.yml` `README.md:1`
- **DB:** Single MongoDB Atlas `eventnexus` shared by Node and Python `backend/src/config/db.js:5` `ai-service/db.py:21`
- **AI:** Optional best-effort — backend falls back to deterministic heuristics if AI down `backend/src/utils/aiClient.js:10` `ai-service/app.py:60`
- **Realtime:** Socket.IO rides same origin/port as REST `backend/src/server.js:144` `frontend/lib/socket.ts:27`
- **Payments:** Stripe (global, USD) + eSewa v2 (Nepal NPR) `backend/src/utils/esewa.js:9` `backend/src/controllers/paymentController.js:15`
- **Deployment:** 3 Docker images (GHCR) on single EC2 `t3.micro` behind ALB `ap-southeast-2` via GitHub Actions `docker-compose.prod.yml:15` `.github/workflows/deploy.yml:1`

Demo credentials after `pnpm seed`: `admin@eventnexus.dev` / `organizer@eventnexus.dev` / `attendee@eventnexus.dev` / `password123` `README.md:70`

---

## 2. Monorepo Layout

```
Event/  (project root)  `read:1`
├── frontend/           Next.js 16 standalone :3000 `frontend/Dockerfile:7`
├── backend/            Express 4 :5000 `backend/src/server.js:140`
├── ai-service/         FastAPI :8000 `ai-service/app.py:49`
├── infra/              AWS VPC/ALB/EC2 scripts `infraaws-helpers.sh:1`
├── docs/               CICD.md, DEPLOYMENT.md, EC2_SETUP.md, FEATURE_CHECKLIST.md, USER_TESTING.md
├── .github/workflows/  ci.yml + deploy.yml
├── docker-compose.yml      Local dev (3 services, healthchecks chain) `docker-compose.yml:21`
├── docker-compose.prod.yml Prod GHCR images, 80:3000, 127.0.0.1:8000 `docker-compose.prod.yml:86`
└── README.md
```

Languages detected: TypeScript 223 files, JavaScript 87, YAML 7, HTML 7, Python 6 `get_architecture:languages`

---

## 3. Tech Stack Matrix

### 3.1 Frontend — `frontend/package.json:1`

| Layer | Library | Version | Purpose | File |
|-------|---------|---------|---------|------|
| Framework | `next` | 16.2.6 | App Router, standalone output | `next.config.mjs:5` `package.json:54` |
| UI | `react`/`react-dom` | 19 | Server components | `package.json:57` |
| Language | `typescript` | 5.7.3 | strict | `tsconfig.json:13` `package.json:80` |
| Styling | `tailwindcss` | 4.2.0 CSS-first | `@import 'tailwindcss'` no tailwind.config | `app/globals.css:1` `postcss.config.mjs:1` `components.json:7` |
| Anim utils | `tw-animate-css` | 1.3.3 | | `app/globals.css:2` |
| State server | `@tanstack/react-query` | 5.101.2 | staleTime 60s retry1 | `components/providers/query-provider.tsx:11` |
| State client | `zustand` | 5.0.15 | chatbot per-user persist | `lib/stores/chatbot-store.ts:131` |
| HTTP | `axios` | 1.18.1 | interceptors, single-flight refresh | `lib/api/client.ts:3` |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` | 7.54.1 / 3.24.1 | | `package.json:60` |
| UI primitives | 20× `@radix-ui/*` | 1.1.x-2.2.x | shadcn new-york neutral | `components.json:3` `package.json:13` |
| Charts | `recharts` | 2.15.0 | | `package.json:63` |
| Auth | `@react-oauth/google` | 0.13.5 | | `package.json:40` |
| Realtime | `socket.io-client` | 4.8.3 | lazy import | `lib/socket.ts:22` `package.json:65` |
| Animation | `framer-motion` 12.40.0 + `gsap` 3.15.0 | lazy ScrollTrigger | `lib/gsap.ts:12` |
| QR | `qrcode.react` 4.2.0 + `html5-qrcode` 2.3.8 | render & scan | `package.json:51` |
| Markdown | `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 | bot bubbles | `components/chatbot/event-bot.tsx:9` |
| Icons | `lucide-react` 0.564.0 | | `package.json:53` |
| Themes | `next-themes` 0.4.6 | | `app/layout.tsx:5` |
| Toast | `sonner` 1.7.1 | | `package.json:66` |
| Other | `date-fns` 4.1.0, `cmdk` 1.1.1, `embla-carousel-react` 8.6.0, `vaul` 1.1.2, `input-otp` 1.4.2 | | |

Build: `output:"standalone"` `next.config.mjs:5`, `NODE_OPTIONS=--max-old-space-size=1024` `frontend/Dockerfile:36`, Healthcheck `curl http://127.0.0.1:3000/` `Dockerfile:62`, Non-root `nextjs:1001` `Dockerfile:45`.

### 3.2 Backend — `backend/package.json:12`

| Package | Version | Purpose | File |
|---------|---------|---------|------|
| `express` | 4.22.2 (spec 4.21.0) | REST | `src/server.js:30` `package.json:16` |
| `mongoose` | 8.24.1 (spec 8.5.0) | ODM, 2dsphere, TTL indexes | `src/config/db.js:5` `package.json:21` |
| `jsonwebtoken` | 9.0.3 | access+QR JWT | `src/utils/generateToken.js:10` `src/utils/qrToken.js:15` |
| `bcryptjs` | 2.4.3 | hash cost 12 pre-save | `src/models/User.js:141` `package.json:13` |
| `cors` | 2.8.6 | allowlist split | `src/server.js:55` |
| `helmet` | 8.3.0 | CSP false for data-URL | `src/server.js:47` |
| `express-validator` | 7.3.2 | validation chains | `src/routes/auth.js:36` |
| `google-auth-library` | 10.9.1 | ID token verify | `src/controllers/authController.js:23` |
| `nodemailer` | 9.0.5 | SMTP + Mail log | `src/utils/email.js:16` |
| `qrcode` | 1.5.4 | data-URI PNG | `src/utils/qrCode.js:1` |
| `socket.io` | 4.8.3 | path `/api/socket.io` | `src/utils/socket.js:17` |
| `stripe` | 22.5.0 | checkout + webhook | `src/controllers/paymentController.js:15` |
| `dotenv` | 16.6.1 | | `src/server.js:1` |
| `nodemon` | 3.1.14 dev | | `package.json:28` |

Node 22-alpine multi-stage `backend/Dockerfile:7` `PNPM_HOME=/pnpm` `corepack enable` `dumb-init` non-root `appuser` port 5000 `HEALTHCHECK /api/health` `Dockerfile:57`.

### 3.3 AI Service — `ai-service/requirements.txt:1`

| Package | Version | Role | File |
|---------|---------|------|------|
| `fastapi` | 0.141.1 | HTTP | `app.py:49` |
| `uvicorn[standard]` | 0.52.3 | ASGI | `Dockerfile:60` |
| `scikit-learn` | 1.9.0 | HGB,SVD,SVC,RF | `train.py:189` |
| `pandas` | 3.0.5 | data | `requirements.txt:4` |
| `numpy` | 2.5.2 | | `features.py:1` |
| `scipy` | 1.18.0 | csr_matrix | `train.py:199` |
| `joblib` | 1.5.3 | persist | `train.py:153` |
| `pymongo` | 4.17.0 | Mongo thread-safe | `db.py:23` |
| `python-dotenv` | 1.2.2 | env | `llm.py:24` |

No openai/httpx — stdlib `urllib` for Gemini/Groq `llm.py:44`. Python 3.12-slim venv `/opt/venv` `Dockerfile:8` image ~534MB.

### 3.4 Shared Infra
- **DB:** MongoDB Atlas `mongodb+srv://home1051ab_db_user@eventnexus.ue1fwo6.mongodb.net` `backend/.env.example:2` `ai-service/db.py:21`
- **Cache:** GHCR registry buildcache + gha `ci.yml:31` `deploy.yml:82`
- **Network:** Docker `eventnexus` (dev) / `eventnexus-prod` (prod) `docker-compose.yml:70`

---

## 4. High-Level Architecture

```
Internet :80 ──▶ ALB eventnexus-alb (internet-facing, 2 AZs)
                Listener 80: default → Frontend TG :80
                         rule pri 1 path /api/* → Backend TG :5000
                            │
               EC2 i-04ca32808d1316bc8 (10.0.1.142 / 3.106.232.125, ap-southeast-2a)
               ┌─────────────┼──────────────────┬─────────────────┐
               │             │                  │                 │
         frontend:80/3000 backend:5000   ai-service:8000 (127.0.0.1 only)
         Next.js standalone  Express+Socket.IO FastAPI uvicorn
               │             │                  │
               └─────────────┼──────────────────┘
                             ▼
               MongoDB Atlas (eventnexus) + Groq/Gemini LLM (optional)
```

*No Nginx — ALB chosen for AZ redundancy, health checks, path routing `docs/DEPLOYMENT.md:63`.*

**Knowledge Graph:** `3802 nodes` (1470 Functions, 1007 Variables, 358 Files) `get_architecture:node_labels`, `8727 edges` (3173 DEFINES, 1959 CALLS) `get_architecture:edge_types`, Hotspot `cn` fan-in 224 `frontend/lib/utils.ts:4`, `useCurrentUser` 54 `lib/queries/auth.ts`.

---

## 5. Frontend Deep Dive — `frontend/app`

### 5.1 Config & Boot
- `app/layout.tsx:1` Fonts `Inter` + `JetBrains_Mono` `next/font/google:10`, Providers `GoogleProvider → QueryProvider → ThemeProvider → RealtimeNotifications → Toaster` `layout.tsx:37`, `suppressHydrationWarning` `layout.tsx:43`, `metadata.title EventNexus — AI-Enabled Secure Event Management` `layout.tsx:23`, `globals.css:1` `@import 'tailwindcss'` + `@theme inline` tokens `--primary #5b4cf5` `globals.css:13`, `@custom-variant dark` `globals.css:4`, GSAP guard `html.gsap-ready [data-reveal]{opacity:0}` `globals.css:164`
- `components.json:3` style new-york rsc tsx aliases `@/components` `@/lib/utils`
- `tsconfig.json:9` target ES6 strict paths `@/*→./*`
- `next.config.mjs:12` 9 permanent redirects legacy `/attendee/*→flat`

### 5.2 App Router — 30+ Routes

| Group | Route | File `frontend/app` | Auth | Purpose |
|-------|-------|----------------------|------|---------|
| Public | `/` | `page.tsx:1` | public | Navbar→Hero→TrustBar→ProblemStrip→Solution→Features→HowItWorks→SurveyStats→Footer |
| Public | `/login` | `login/page.tsx:1` | guest | email/pass + GoogleLogin `sanitizeEventRedirect` `login/page.tsx:38` `JoiningEventBanner` |
| Public | `/register` | `register/page.tsx:1` | guest | dual attendee/org tabs `?type=organization&redirect=/event/<id>` lock QR to attendee `register/page.tsx:91` |
| Public | `/forgot-password` | `forgot-password/page.tsx:1` | public | `useForgotPassword` |
| Public | `/reset-password` | `reset-password/page.tsx:1` | public `?token=` | 6-char + match check `reset-password/page.tsx:23` |
| Public | `/verify-email` | `verify-email/page.tsx:1` | public `?token=` else awaiting | auto-mutate once `verify-email/page.tsx:74` redirect `roleRoutes` |
| Public | `/events` | `events/page.tsx:1` | AppShell attendee | browse search/category/type/status/sort debounce 400ms `events/page.tsx:48` socket `event:created` invalidate `events/page.tsx:69` |
| Public | `/events/[id]` | `events/[id]/page.tsx:1` | public no shell | Poster-QR landing share+ICS+map+sticky price+ eSewa/Stripe `events/[id]/page.tsx:161` |
| Gated | `/event/[id]` | `event/[id]/page.tsx:1` | QR router `useHasTokenWithChecked` | unauth → `PublicEventLanding` else `RoleEventDetail` `event/[id]/page.tsx:39` |
| Gated | `/* 404` | `not-found.tsx:1` | public | `NotFoundScreen` |
| Attendee | `/dashboard` | `dashboard/page.tsx:1` | attendee | `router.replace("/events")` legacy `dashboard/page.tsx:13` |
| Attendee | `/my-tickets` | `my-tickets/page.tsx:1` | attendee | Upcoming/Past `timeBucket` QR/Cancel `my-tickets/page.tsx:47` |
| Attendee | `/saved-events` | `saved-events/page.tsx:1` | attendee | guest localStorage vs authed `useSavedEvents` `saved-events/page.tsx:13` |
| Attendee | `/check-in` | `check-in/page.tsx:1` | attendee | Wallet embla carousel countdown 30s `check-in/page.tsx:327` QR 172px PNG+share+ICS |
| Attendee | `/recommendations` | `recommendations/page.tsx:1` | attendee | ScoreRing SVG `page.tsx:35` AI picks location prompt |
| Attendee | `/checkout/success` | `checkout/success/page.tsx:1` | attendee | eSewa 14 error map `page.tsx:124` Stripe `useCheckoutStatus` poll `page.tsx:161` |
| Attendee | `/analytics` | `analytics/page.tsx:1` | attendee | fillRate/conversion `analytics/page.tsx:25` FunnelTrend etc |
| Attendee | `/settings` | `settings/page.tsx:1` | attendee | location auto-detect `settings/page.tsx:82` interests/notif/profile/pass/sessions/GDPR |
| Organizer | `/organizer` | `organizer/page.tsx:1` | organizer+admin | `useMyEvents` + `useOrganizerAnalytics` insights `page.tsx:41` |
| Organizer | `/organizer/events` | `organizer/events/page.tsx:1` | org | portfolio paginated 9 |
| Organizer | `/organizer/events/create` | `organizer/events/create/page.tsx:1` | org | `EventWizard mode="create"` → `useCreateEvent` |
| Organizer | `/organizer/events/[id]` | `organizer/events/[id]/page.tsx:1` | org `useRequireRole` | `RoleEventDetail` |
| Organizer | `/organizer/events/[id]/edit` | `organizer/events/[id]/edit/page.tsx:1` | org | `useEvent` + `EventWizard mode="edit"` |
| Organizer | `/organizer/analytics` | `organizer/analytics/page.tsx:1` | org | PredictedAttendanceChart+Segments |
| Organizer | `/organizer/insights` | `organizer/insights/page.tsx:1` | org | heuristic capacity alerts |
| Organizer | `/organizer/tickets` | `organizer/tickets/page.tsx:1` | org | VerifyTicketPanel `QrScanner` + AttendeeRoster |
| Organizer | `/organizer/collaboration` | `organizer/collaboration/page.tsx:1` | org | `CollaborationWorkspace` |
| Admin | `/admin` | `admin/page.tsx:1` | admin+org_admin | `useOrgStats` + `useAdminAnalytics` 4 cards |
| Admin | `/admin/events` | `admin/events/page.tsx:1` | admin | co-hosted detect `org._id !== user.org` `admin/events/page.tsx:140` |
| Admin | `/admin/users` | `admin/users/page.tsx:1` | admin 980L | directory paginated role change RowActions UserDetailDialog |
| Admin | `/admin/organizations` | `admin/organizations/page.tsx:1` | dual | system→OrgDirectory rename suspend, tenant→OrgProfile `useMyOrganization` |
| Admin | `/admin/approvals` | `admin/approvals/page.tsx:1` | admin only `page.tsx:45` | pending/active/rejected approve/reject reason |
| Admin | `/admin/ai` | `admin/ai/page.tsx:1` | admin only 405L | ModelCard×3 `aiApi.status()+chatlog` `page.tsx:116` playground + curation |
| Admin | `/admin/security` | `admin/security/page.tsx:1` | both edit only system | permission matrix `useRoles` `page.tsx:37` |
| Admin | `/admin/collaboration` | `admin/collaboration/page.tsx:1` | both | same workspace |
| Admin | `/admin/settings` | `admin/settings/page.tsx:1` | admin only | static 5 cards |

### 5.3 Components

**`components/app/*` 30 files:** `app-shell.tsx:466` central shell role `ROLE_FOR_USER` never URL `app-shell.tsx:72` nav `isOrgScopedAdmin?orgAdminNav:roleNavMap` `app-shell.tsx:202` active longest-prefix `app-shell.tsx:205` `EVENT_DETAIL_PATTERN` `/^\/(?:event|organizer\/events|admin\/events)\/([0-9a-f]{24})$/i:142` guards `needsVerification→/verify-email` `app-shell.tsx:165` `pathAllowed→NotFoundScreen` `app-shell.tsx:285`; `nav-configs.ts:83` 4 navs admin 11 orgAdmin 9 organizer 8 attendee 7; `event-card.tsx`, `role-event-detail.tsx`, `public-event-landing.tsx`, `event-wizard.tsx` AI draft+geocode `lib/geocode.ts` + `MAX_FUTURE_EVENT_YEARS=2` `lib/event-date.ts:5`, `event-qr-poster.tsx` `lib/qr.ts:108`, `qr-code.tsx` canvas export, `qr-scanner.tsx` html5-qrcode, `attendee-roster.tsx`, `collaboration-workspace.tsx` `lib/api/collaboration.ts:57`, `notification-*`, `search-input.tsx`, `pagination.tsx`, `stat-card.tsx`, Charts `admin-charts.tsx` `organizer-charts.tsx` `analytics-charts.tsx` `segments-chart.tsx`, `venue-map.tsx` OSM, `help-dialog.tsx`, `location-prompt.tsx`, `event-bot.tsx:660` floating resizable `min 280×300` `event-bot.tsx:485` auto-scroll 120px `event-bot.tsx:339` markdown `ReactMarkdown+remarkGfm`, `auth-shell.tsx`, `first-login-interests-dialog.tsx`.

**`components/ui/*` 60+** shadcn new-york `components.json:3`.

**`components/landing/*` 10:** hero GSAP, navbar, features BounceCard, solution, etc.

**Providers:** `google-provider.tsx:18` `query-provider.tsx:22` staleTime 60s retry1 `providers/query-provider.tsx:11` `realtime-notifications.tsx:11`.

### 5.4 Lib Layer

- `lib/api/client.ts:180` Axios base `NEXT_PUBLIC_API_URL` `client.ts:4` TOKEN_KEY/REFRESH_KEY/USER_KEY `client.ts:10` single-flight `refreshPromise` `client.ts:14` `refreshAccessToken POST /auth/refresh` `client.ts:23` request attach Bearer `client.ts:75` response 401 retry `client.ts:122` silent 403 allowlist `client.ts:135` `AUTH_ENDPOINTS` hard-nav guard `client.ts:103` multi-tab `storage` reload `client.ts:68`.
- 22 API files: `auth.ts:144` User+SessionInfo+storeSession, `events.ts:164` EventData ai-insight/aiDraft, `tickets.ts:105`, `notifications.ts:66`, `payments.ts:41`, `ai.ts:84`, `chatbot.ts`, `list.ts:377` `toQueryString` drops all, `analytics.ts`, `audit.ts`, `collaboration.ts:79`, etc.
- Helpers: `price.ts:27` Rs. manual, `qr.ts:467` `buildPublicUrl` `qr=1&utm_source=qr`+ICS RFC5545 fold 75 `qr.ts:324`, `event-date.ts:31` maxFuture 2y, `event-redirect.ts:32` `EVENT_PATH_RE /\/event\/[0-9a-f]{24}/` sanitize, `esewa.ts:36` allowlist regex, `geocode.ts:53` Nominatim, `gsap.ts:49` lazy, `route-access.ts:38` RULES most-specific first, `saved-events.ts:29` localStorage, `socket.ts:104` `socketUrl` strip /api `socket.ts:27` `loadIo` lazy, `utils.ts:6` `cn=twMerge(clsx)`.
- Queries: 17 files `lib/queries/*` `eventKeys` `authKeys.me` invalidate on mutations `queries/events.ts:118`.
- Store: `lib/stores/chatbot-store.ts:332` Zustand persist `userScopedStorage` `eventnexus-chatbot:<userId>` `chatbot-store.ts:91` `MAX_CONTEXT 20` `chatbot-store.ts:60` `send(eventId)` history 8 `chatbot-store.ts:209`.

### 5.5 Auth & RBAC Frontend
- `useHasToken` start false hydration-safe `lib/hooks/use-has-token.ts:21` listeners storage|focus|poll 2s `hooks/use-has-token.ts:26`
- `useRequireRole` loading|allowed|denied `lib/hooks/use-require-role.ts:9` push `roleRoutes` `lib/queries/auth.ts:21` admin→/admin else /dashboard
- `route-access.ts:17` `/admin/approvals→admin` `/admin→admin,org_admin` `/organizer→admin,org_admin,organizer`
- `AppShell` verify gate `!googleAccount && !emailVerified→/verify-email` `app-shell.tsx:165` role never URL `app-shell.tsx:62`

---

## 6. Backend Deep Dive — `backend/src`

### 6.1 Bootstrap `src/server.js:149`
`dotenv` `server.js:1` `connectDB` `utils/roleIntegrity.checkRoleIntegrity` `server.js:40` `helmet CSP false` `server.js:47` `FRONTEND_URL` split + extraOrigins `server.js:55` `cors credentials` `server.js:69` `POST /api/payments/webhook express.raw` BEFORE json `server.js:83` `json limit 8mb` base64 covers `server.js:92` `sanitizeRequest` global `server.js:100` mounts `/api/auth|events|organizations|tickets|users|events/:id/sessions|speakers|notifications|recommendations|analytics|chatbot|payments|ai/health|ai|audit|iam|collaboration|system` `server.js:102` `GET /api/health` `server.js:131` 404+errorHandler last `server.js:137` `http.createServer+initSocket` `server.js:144` port 5000 `server.js:140`.

### 6.2 Middleware Chain
1 helmet `server.js:47`, 2 cors `server.js:69`, 3 webhook raw `server.js:83`, 4 json 8mb `server.js:92`, 5 sanitizeRequest NoSQL strip $/. `__proto__` depth6 `src/middleware/sanitize.js:29`, 6 rateLimit in-memory Map `${ip}:${baseUrl}${path}` 60s max20 evict5000 `middleware/rateLimit.js:5`, 7 protect/optionalAuth `middleware/auth.js:7`, 8 validate `middleware/validate.js:8`, 9 tenant `middleware/tenant.js:3`, 10 notFound+errorHandler `middleware/errors.js:6` maps ValidationError 400 11000 409 CastError 400.

### 6.3 Models — 17 Mongoose Schemas

| Model `src/models` | Key Fields | Indexes | Notes |
|--------------------|------------|---------|-------|
| `User.js:149` | name,email unique lower, password select:false bcrypt12 `User.js:141`, googleId sparse unique, role enum admin/org_admin/organizer/attendee, tokenVersion 0, active, emailVerifiedAt/token, organization ref, interests enum10, savedEvents, location{lat,lng,city,geo Point 2dsphere} `User.js:30` | geo 2dsphere `User.js:134` | pre-save hash+geo |
| `Event.js:181` | title, date, venue, coordinates 2dsphere `Event.js:25`, type/category, capacity min1, price{amount,currency NPR} `Event.js:55`, status Upcoming/Live/Past/Draft, imageUrl data-URL 6M, tags/highlights/agenda/speakers, reminderSettings{enabled offsets[1440,60] feedback24} `Event.js:130`, coHostOrganizations `Event.js:140`, organizer/org required, registered | status+date, price, text title, org+coHost `Event.js:162` | pre-save geo |
| `Organization.js:58` | name, slug unique lower, owner ref, status pending/active/rejected/suspended, approvedBy/at, rejectionReason | slug unique | |
| `Ticket.js:101` | event/attendee/org required, qrToken unique `Ticket.js:49`, active mirror `status!==cancelled`, status valid/checked-in/cancelled, payment{status provider amount currency stripeSessionId esewaUuid} `Ticket.js:49`, checkedInAt/By | event+attendee unique partial active `Ticket.js:81` | pre-save active |
| `Notification.js:67` | recipient/org required, type enum 9 registration/reminder/new-event/nearby etc `Notification.js:14`, title/message, event, link, data Mixed, read false | recipient+createdAt `Notification.js:62` unique new-event `Notification.js:66` |
| `Feedback.js:49` | event/attendee/org, rating 1-5, comment 1000, sentiment positive/neutral/negative `Feedback.js:12`, sentimentScore -1..1 | event+attendee unique `Feedback.js:47` |
| `EventSession.js:100` | event/org, title, track, startTime/endTime, speakers [Speaker], capacity 0 unlimited, isPublic true | event+startTime `EventSession.js:80` | pre-save track overlap guard `EventSession.js:80` |
| `Session.js:56` auth | user, refreshTokenHash unique select:false `Session.js:15`, previousTokenHash, deviceFingerprint ip userAgent, expiresAt TTL `expireAfterSeconds:0` `Session.js:54` | deviceFingerprint | single per device |
| `OrganizationMember.js:50` | org/user, roleInOrg owner/admin/manager/member, status active/pending/removed | org+user unique partial !removed `Member.js:43` |
| `Role.js:34` | name unique lower, scope system/organization, permissions [String] | |
| `Permission.js:34` | code unique lower e.g. event:manage | |
| `AuditLog.js:62` | user/org, action index `AuditLog.js:18`, resourceType/Id, result success/failure/denied, metadata, ip/userAgent, createdAt only `AuditLog.js:55` | org+createdAt |
| `CoHostInvitation.js:72` | event, fromOrg/toOrg, invitedBy, message 1000, status pending/accepted/declined/cancelled, respondedBy | event+toOrg unique pending `CoHost:63` |
| `CollaborationSuggestion.js:84` | eventA/B+orgA/B denormalized, score 0-100, scoreSource ml/heuristic, matchedFactors, rationaleSource ai/heuristic, statusA/B suggested/accepted/declined, resolvedOutcome co-hosted/rejected | eventA+eventB unique `Collab:73` |
| `Speaker.js:55` | org required, name, email sparse, title/company/bio/photoUrl, socialLinks | org+name |
| `Mail.js:20` | to, subject, template, text/html, metadata | dev log |
| `ReminderJob.js:57` | event/recipient/org, kind before_event/feedback, scheduledAt, sentAt, offsetMinutes | event+recipient+kind+offset unique `Reminder:49` |

### 6.4 Controllers & Routes — 19 controllers ~12k lines

Full table (selected):

**Auth** `routes/auth.js:148` `controllers/authController.js:1112`
| Method | Path | Middleware | Handler | Notes |
|--------|------|-----------|---------|-------|
| POST | `/api/auth/org-register` | orgRegisterLimiter 5/m validate orgName/admin* | `orgRegister:359` | pending org_admin no token |
| POST | `/api/auth/register` | registerLimiter 10 validate role attendee/org | `register:182` | organizer requires isAdminEmail else 403 |
| POST | `/api/auth/login` | loginLimiter 10 | `login:495` | asserts active+orgApproved audit |
| POST | `/api/auth/google` | googleLimiter 10 | `googleLogin:539` | verifyIdToken links googleId attendee only |
| POST | `/api/auth/refresh` | refreshLimiter 60 | `refresh:655` | rotation reuse detection |
| POST | `/api/auth/logout` | validate refreshToken | `logout:744` | revoke |
| DELETE| `/api/auth/me` | protect | `deleteMyAccount:1034` | GDPR anonymize |

**Events** `routes/events.js:221` `controllers/eventController.js:749` — `GET /api/events` public Draft hidden `getAllEvents:452`, `GET /my` owner `getMyEvents:217`, `GET /org` tenant+coHost `getOrgEvents:499`, `POST /` createEventLimiter 5 validate capacity1-1e6 imageUrl6M `createEvent:62` broadcasts+notifyNearby+emit `event:created`+scanSuggestions, `PUT /:id` canManageEvent `updateEvent:302`, `DELETE /:id` isOwningOrgManager `deleteEvent:418` cascade, `GET /:id/ai-insight` `getEventAiInsight:632` LLM 8s else heuristic+predictAttendance, `POST /ai-draft` `generateEventDraft:698`.

**Tickets** `routes/tickets.js:22` `ticketController.js:484` — `GET /my` `getMyTickets:107`, `POST /:id/cancel` `cancelTicket:204`, `POST /verify` `verifyTicket:260` org/coHost check, `GET /:id/attendees` `getEventAttendees` revenue by currency.

**Payments** `routes/payments.js:45` `paymentController.js:634` — webhook raw mounted `server.js:83` `GET /config` `getPaymentConfig:25`, `POST /checkout/:id` `createCheckoutSession:34` NPR→USD `nprToUsd` idempotency SHA256 `success_url` metadata, `GET /checkout/status/:sessionId` `getCheckoutStatus:127` self-heal `issueTicketOnce`, `POST /esewa/initiate/:id` `initiateEsewaPayment:374` signed `total_amount,transaction_uuid,product_code`, `GET /esewa/success|failure/:eventId?` `handleEsewaSuccess:572` `confirmEsewaPayment` verify+checkStatus+amount cross-check.

**Users** `routes/users.js:211` `userController.js:834` — `PATCH /me/location|profile|interests|reminders|password`, saved-events, `GET /` listOrgUsers `userController.js:66` tenant-scoped, `PATCH /:id/status` revoke, `DELETE /:id` guards self/owner/lastAdmin.

**Orgs** `routes/organizations.js:71` `organizationController.js:309` — `GET /` public active, `GET/PUT /me` tenant, members `POST/PATCH/DELETE /members/:userId` `requireOrgAdmin`.

**System** `routes/system.js:44` `systemAdminController.js:219` all `requireSystemAdmin` — `GET /orgs` pending, `POST /orgs/:id/approve|reject` mail, `PATCH /:id` suspend.

**Sessions** `routes/sessions.js:54` mount `/api/events/:eventId/sessions` `sessionController.js:225` — CRUD overlap guard track.

**Speakers** `routes/speakers.js:46` `speakerController.js:158` tenant-scoped.

**Notifications** `routes/notifications.js:19` `notificationController.js:265` — unread-count, paginated, mark read emits.

**Recommendations** `routes/recommendations.js:9` `recommendationController.js:70` `recommendationEngine.scoreEvents` limit12.

**Analytics** `routes/analytics.js:17` `analyticsController.js:221` organizer/admin segments/marketing-insight via aiProvider.

**Chatbot** `routes/chatbot.js:29` Cache-Control no-store `chatbot.js:14` `chatbotController.js:969` `POST /query` rate 20 validate ≤2000 `query:1` regex→aiClient.parse/understand→grounded handlers→LLM fallback `no-store` `GET /suggestions` 30.

**Collaboration** `routes/collaboration.js:47` `collaborationController.js:333` `coHostInvitationController.js:343` — `GET /invitations` `POST /invitations/:id/:action` accept/decline, `GET /` suggestions, `POST /generate` scanForSuggestions, `POST /:id/accept|decline`.

**AI** `routes/ai.js:80` all `protect+requireSystemAdmin` `GET /status` `ai.health()+stats`, `POST /train` 120s, `GET/PATCH/DELETE /chatlog`.

**Audit** `routes/audit.js:10` `auditController.js:45` `GET /` paginated org-scoped.

**IAM** `routes/iam.js:28` `iamController.js:81` all admin `GET /roles|permissions` `PUT /roles/:id/permissions` invalidate cache.

### 6.5 Utils `src/utils/*` 23 files
`aiClient.js:240` proxy best-effort timeout fallback, `aiProvider.js:165` Gemini primary Groq fallback, `audit.js:41` fire-forget, `collaborationEngine.js:440` 7 dims score 60 heuristic + ML blend 55/45, `currency.js:21` NPR_USD 133 `nprToUsd max0.5`, `email.js:157` nodemailer + Mail log never throws, `esewa.js:143` HMAC base64 verify `timingSafeEqual`, `eventPublishNotify.js:91` broadcast batch 500 dedup, `geo.js:33` haversine 6371, `predictAttendance.js:45` heuristic `registered+velocity*capped`, `proximityNotify.js:172` RADIUS 25km MAX_NOTIFIED 300 `$near`, `qrCode.js:253` width64-2048 ECC margin `buildPublicEventUrl` tracking, `qrToken.js:115` 30d grace 300s, `query.js:389` parsePagination max100 buildSearch escaped regex etc, `recommendationEngine.js:318` tier1 CF over-fetch×2 explicit boost28 tier2 deterministic 8+4+6+3+5+7+20+5+28, `reminderScheduler.js:213` TICK 60s LOOKAHEAD 4320 FEEDBACK 7d `ensureJobsForEvent` dispatch `sentAt:null`, `sentiment.js:51` lexicon 31/31, `socket.js:109` path `/api/socket.io` handshake JWT+active+ver+org join `user:<id>` `emitToUser`, `ticketing.js:98` atomic `$expr registered<capacity $inc:1` `issueTicketOnce` 11000.

---

## 7. AI Service Deep Dive — `ai-service/`

### 7.1 Runtime `app.py:629` `train.py:419`
FastAPI 1.0.0 `app.py:49` globals `_attendance/_cf/_intent/_match` `app.py:51` locks `_train_lock _model_lock` `app.py:55` `KNOWN_INTENTS 17` `app.py:60` recommend/near_me/my_tickets/pricing/organizer/upcoming_events/venue/schedule/registration_status/popular_events/capacity/cancellation/greeting/categories/event_count/create_event/join_event/fallback `models/meta.json:1-24` startup auto-train missing `app.py:134` `_load_models` joblib `app.py:109`.

### 7.2 Endpoints — 14 Routes `app.py:160`

| # | Method | Path | Handler `app.py` | Purpose |
|---|--------|------|------------------|---------|
|1|GET|/health|`health:160`|status ok/degraded + models bool Docker HEALTHCHECK `Dockerfile:57`|
|2|POST|/train|`retrain:175`|429 if locked `train_all()` hot-reload|
|3|GET|/stats|`stats:198`|meta + counts past/upcoming/tickets/chatlog/collabPairs intentDistribution|
|4|GET|/chatlog|`list_chatlog:224`|limit 1-200 offset regex search sort -1|
|5|PATCH|/chatlog/{id}|`patch_chatlog:265`|validate in KNOWN_INTENTS 400|
|6|DELETE|/chatlog/{id}|`delete_chatlog:280`|404|
|7|POST|/predict-attendance|`predict_attendance:293`|HGB clip capacity `{"predictions":[{"event_id",predicted}]}`|
|8|POST|/collaboration-match|`collaboration_match:333`|RF proba score 0.4 round; empty if model missing|
|9|POST|/recommendations|`recommendations:380`|CF has_cf+≤30 scored 1-dist|
|10|POST|/classify-intent|`classify_intent:421`|LinearSVC decision_function argmax|
|11|POST|/parse|`parse:448`|intent+slots fast non-LLM|
|12|POST|/understand|`understand:515`|LLM-first system_prompt 530 + slots normalize history inherit `understand:569` fallback rules|
|13|POST|/generate|`generate:600`|generic LLM entry Node builds prompt `aiProvider` fallback|
|14|POST|/log-intent|`log_intent:618`|insert_chat_log|

Helpers `_extract_json` fences `app.py:464`, `_normalize_slots` clamp `app.py:481`, `_sanitize_history` last10 2000 `app.py:498`, `_read_meta` `app.py:190`.

### 7.3 DB `db.py:201`
`get_db()` singleton double-lock `MongoClient serverSelection3s maxPool20` `db.py:23` `load_past_events` status Past `db.py:38` `load_upcoming_events` Upcoming/Live date>=now `db.py:49` `load_tickets` status!=cancelled `db.py:75` `load_chat_log` `db.py:85` `load_orgs` `db.py:90` `load_collab_pairs` positives co-hosted/rejected + mutual coHostOrganizations cap5000 `db.py:95` `insert_chat_log` `db.py:178` `_oid` `db.py:192`.

### 7.4 Features `features.py:262`
Attendance 7 dims `FEATURE_NAMES` `features.py:103`: days_since_created `features.py:42` max1, days_until_event `features.py:49`, capacity `features.py:65`, registered `features.py:66`, fill_rate `features.py:73`, category code `features.py:81` 13 values `Technology…Art` `features.py:14`, type code In-person/Hybrid/Virtual `features.py:18`. `build_rows` drops cap≤0 `features.py:56` `PAIR_FEATURE_NAMES` `features.py:113`: same_category `212`, same_type `213`, days_apart log1p `188`, same_city/country `207`, geo haversine `134` -1 if invalid, capacity_ratio_log `180`, content_cosine placeholder `219` + `cosine_texts` TFIDF `246`, tag_jaccard `168`, fill_delta `197`. `event_text` title+desc+highlights+agenda+speakers+tags lower `features.py:155`.

### 7.5 Training `train.py:419`
`MODELS_DIR` `train.py:36` 4 joblibs + meta.json atomic `train.py:153`. Thresholds `MIN_ATTENDANCE 5` `MIN_CF_USERS 2` `MIN_INTENT_PER_CLASS 1` `MIN_MATCH_POS 8` `train.py:45`. `SEED_CORPUS` ~70 samples 15/17 intents `train.py:55`. `train_attendance` HGB `max_iter300 lr0.08 depth4` `train.py:189` 70 samples, `train_cf` TruncatedSVD `n_components min20 U-1 E-1` normalize + NearestNeighbors cosine brute `train.py:225` 270 samples, `train_intent` Pipeline FeatureUnion word 1-2 char_wb 3-6 sublinear 1.0/0.6 → LinearSVC balanced max_iter5000 `train.py:276` 128 samples, `train_match` TFIDF word1-2 + RandomForest 300 depth6 balanced `train.py:374` MISSING 0 positives. `train_all` sequential catch `train.py:400`.

### 7.6 NLU `nlu.py:138`
`extract_quantity` `nlu.py:43` SINGLE_QUANTIFIER `\b(one|1|single|only one|…needest)` `nlu.py:23` + SINGULAR `nlu.py:24` + PLURAL `nlu.py:25`; `extract_time_scope` PAST `\b(past|done|finished…)` `nlu.py:27` wins vs UPCOMING `nlu.py:59`; `extract_price_preference` FREE `\bfree|no cost` `nlu.py:32` PAID `\bpaid|pay|costs?` `nlu.py:33` negation `not free` `nlu.py:69` ambiguous `free or paid`→None; `extract_count` `\b(\d{1,2})\s+events?\b` `nlu.py:106` cap1-50; `extract_slots` aggregator `nlu.py:132`.

### 7.7 LLM `llm.py:150`
`TIMEOUT 10 MAX_RETRIES 2` `llm.py:38` `_post_json` urllib `llm.py:44` `_call_groq` `api.groq.com/openai/v1/chat/completions` temp0.2 max700 `llm.py:56` `_call_gemini` `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key` system→user merge `llm.py:94` temp0.2 topP0.9 `llm.py:79` `_PROVIDERS [gemini,groq]` `llm.py:128` `generate_reply` loops retry sleep0.5 `llm.py:140` returns str/None. Prompts `understand` system `app.py:530` typo tolerant JSON only `intent quantity time_scope price_pref count`.

### 7.8 Models Snapshot `models/meta.json:1`
attendance true 70 2026-08-20, cf true 270, intent true 128, collaboration false 0.

---

## 8. Data Model & Entity-Relationship

```
User (attendee/organizer/org_admin/admin) 1─∞ OrganizationMember ∞─1 Organization
User.organization (nullable admin) ──▶ Organization
Event ──▶ Organization + User(organizer) + [Organization coHost] + [Speaker]
Event 1─∞ Ticket ∞─1 User(attendee)  Ticket ──▶ Organization
Event 1─∞ EventSession + Speaker
User 1─∞ Session (refresh)  User 1─∞ Notification  User 1─∞ ReminderJob
Feedback (event+attendee unique)   AuditLog immutable   Mail dev log
CoHostInvitation + CollaborationSuggestion (eventA/B orgA/B)
```

Critical constraints: Ticket partial unique event+attendee active `Ticket.js:81`, Feedback unique `Feedback.js:47`, 2dsphere `User.location.geo` `User.js:134` + `Event.coordinates.geo` `Event.js:162`, TTL Session `Session.js:54`.

---

## 9. API Endpoint Catalogue — `/api` `backend/src/routes/*`

(Condensed; full 100+ routes)

- **Auth** `routes/auth.js` `authController.js`: org-register, register, login, google, me, refresh, logout, sessions, verify-email, forgot/reset, export, delete.
- **Events** `routes/events.js` `eventController.js`: GET /, /my, /org, /:id, /:id/attendees, /:id/ai-insight, POST /ai-draft, POST /, PUT/:id, DELETE/:id, co-hosts/invitations.
- **Tickets** `routes/tickets.js` `ticketController.js`: GET /my, POST /:id/cancel, POST /verify, GET /events/:id/attendees.
- **Payments** `routes/payments.js` `paymentController.js`: GET /config, POST /checkout/:id, GET /status/:sessionId, POST /esewa/initiate/:id, GET /esewa/success|failure, POST /webhook raw.
- **Users** `routes/users.js` `userController.js`: PATCH /me/*, GET / + stats + :id, PATCH :id/status, POST revoke/reset, DELETE, POST /, PUT :id/role.
- **Organizations** `routes/organizations.js` `organizationController.js`: GET /, GET/PUT /me, GET/POST /members, PATCH/DELETE /members/:userId.
- **System** `routes/system.js` `systemAdminController.js`: GET /orgs, POST approve/reject, PATCH :id.
- **Speakers/Sessions/Notifications/Recommendations/Analytics/Chatbot/Collaboration/AI/Audit/IAM** as per §6.4.

---

## 10. Auth, RBAC & Multi-Tenancy

### JWT `utils/generateToken.js:6` `utils/tokens.js:5`
Access `jwt.sign({id,ver:tokenVersion}, JWT_SECRET, {expiresIn: JWT_EXPIRES_IN||"1h"})` `generateToken.js:10`, Refresh `randomBytes48 base64url` `tokens.js:5` hash SHA256 `tokens.js:9`, Email `randomBytes32 hex` 24h, QR `jwt.sign({ticketId,eventId,attendeeId}, QR_SECRET||JWT_SECRET, {expiresIn:"30d"})` `qrToken.js:15` short 10m grace 300s `qrToken.js:32`.

### Refresh Rotation `authController.js:116` `authController.js:650`
`deviceFingerprint ip::UA200` `authController.js:116` one per device `updateMany revokedAt` before create `authController.js:132`. Refresh finds hash → if previousHash → theft revoke all + tokenVersion++ audit `authController.js:655` → else rotate previous=hash newHash + lastUsedAt.

### Middleware `middleware/auth.js:85`
`protect:7` bearer verify active 403 ver mismatch 401, `optionalAuth:50` public draft gate, `authorize(...roles):71`, `requireSystemAdmin:170` `role===admin && !organization`, `requirePermission:177` roleCache `loadRoleCache:138`, `requireOrgAdmin:194` Member active+owner.

Static `ROLE_PERMISSIONS:85`: admin 12 perms includes org:approve ai:manage, org_admin 10 no approve/no ai, organizer 5, attendee 3. Dynamic Role docs `Role.js` cached `invalidateRoleCache:157`.

### Org Workflow `authController.js:354`
`orgRegister:354` slug check create org pending + org_admin pending owner Member + verification mail no token. `assertOrgApproved:463` pending/rejected/suspended 403 checked login/google/refresh. `systemAdminController.js:62` approve active+Member+mail, `reject:111` reason mail, `updateOrganization:162` suspend revokes sessions tokenVersion++.

Frontend: `lib/api/client.ts:23` single-flight `isAuthEndpoint` `client.ts:103` no refresh on login fail, silent 403 `client.ts:135`, `storeSession` `lib/api/auth.ts:56` `useCurrentUser` enabled hasToken `queries/auth.ts:28`, `useAuthSuccess` roleRoutes `queries/auth.ts:21` admin→/admin etc, `useHasToken` hydration false `hooks/use-has-token.ts:21`, `useRequireRole` `hooks/use-require-role.ts:9`, `route-access.ts:17` longest prefix `canAccessPath`, `AppShell` verify→/verify-email `app-shell.tsx:165`.

Multi-tenancy: `tenant.js:3` `scopeToOrg` injects organization attendee bypass else 403, `canManageEvent:24` owner/systemAdmin/orgAdmin/coHostAdmin, `findUserInScope:66`, `verifyTicket org check coHost` `ticketController.js:276`.

---

## 11. Payments — Stripe + eSewa

**Stripe** `paymentController.js:15` `currency.js:8` `esewa.js:9`
- Config `getPaymentConfig:25` enabled publishable nprUsdRate `currency.js:8` `NPR_USD 133` `nprToUsd max0.5 round`
- `createCheckoutSession:34` guards Draft/past/paid/capacity/duplicate converts USD idempotency SHA256(event:user:amount) `stripe.checkout.sessions.create` metadata eventId/attendeeId
- `getCheckoutStatus:127` retrieve authorize metadata.attendeeId self-heal `issueTicketOnce` email QR
- Webhook `handleWebhook:211` raw verify signature only `checkout.session.completed` paid + `charge.refunded` full→cancel→decrement

**eSewa v2** `utils/esewa.js:9` UAT `EPAYTEST 8gBm/:&EnhH.1/q rc-epay` `esewa.js:9` SIGNED `total_amount,transaction_uuid,product_code` HMAC SHA256 base64 `esewa.js:16`, `toAmountNumber` comma-strip `esewa.js:35`, `buildTransactionUuid` `${eventId}-${attendeeId}-${now}-${rand}` TTL24h `esewa.js:45`, `buildPaymentForm` `esewa.js:69`, `verifyResponse` pinned product_code timingSafeEqual `esewa.js:96`, `checkStatus` GET 5s `esewa.js:120`, Controllers `initiateEsewaPayment:374` NPR only `confirmEsewaPayment:447` decode base64 verify+parse+status COMPLETE + amount paisa mismatch→reason `handleEsewaSuccess:572` redirects `FRONTEND_URL/checkout/success?provider=esewa&ticketId` or `?error&eventId`.

Frontend `lib/esewa.ts:6` `ESEWA_ALLOWED_ACTIONS` whitelist `lib/esewa.ts:6` `submitEsewaForm` hidden POST `lib/esewa.ts:13` `payments.ts:37` `initiateEsewa`.

---

## 12. Realtime & Notifications

Backend `utils/socket.js:17` `Server path /api/socket.io` `socket.js:17` CORS split `socket.js:12` handshake auth token `jwt.verify` active + ver + org status `socket.js:32` join `user:<id>` `emitToUser/emitToUsers` `socket.js:66`. Server `server.js:144`.

Origins `notificationController.js:124` `createNotification` sanitizeEvent/Link `notificationController.js:13` + emitUnread + `notification:created` `notificationController.js:112` + `notification:read` `read-all` `unread:count`. Triggers: `ticketing.js:49` registration two notifs, `cancelTicket:239`, `verifyTicket:319` checked-in, `paymentController refund` `proximityNotify.js:110` nearby `$near 25km MAX_NOTIFIED300` `eventPublishNotify.js:13` broadcast 500 dedup+`event:created` `eventController.js:187`, collaboration `collaborationController.js:112`.

Frontend `lib/socket.ts:27` strip /api `socketPath` `lib/socket.ts:32` `getSocket` lazy `socket.io-client` `lib/socket.ts:22` `auth:{token}` reconnection10 `lib/socket.ts:37` `socket:ready` `getSocketAsync:76`. Provider `realtime-notifications.tsx:5` `queries/notifications.ts:106` `useRealtimeNotifications` onCreated setQueryData+invalidate+toast View `${section}/${id}` `notificationsSectionForRole` `onRead/onReadAll`.

Model `Notification.js:4` indexes recipient+createdAt `Notification.js:62` unique new-event `Notification.js:66`.

---

## 13. Email System

`utils/email.js:16` singleton transporter `nodemailer` `host port secure465 auth tls` `email.js:69` `sendMail` template+Mail.create dev console prod `messageId` never throws. `utils/emailTemplates.js:1` cache `src/templates/emails/${name}.html` `renderTemplate` `{{#if}}` `{{var}}` `renderEmail` appends frontendUrl. `models/Mail.js` log.

Templates: `verify-email.html` `password-reset.html` `ticket-confirmation.html` qrCodeUrl `cohost-invitation.html` `org-approved.html` `org-rejected.html` `nearby-event.html` reminder inline `reminderScheduler.js:150`.

Call sites: `authController verify/forgot` `paymentController QR` `proximityNotify MAX_EMAILED100` `reminderScheduler` `coHostInvitation` `systemAdminController`.

---

## 14. AI Capabilities — `ai-service/*`

Models §7: Attendance HGB 70 `train.py:189`, CF SVD+NN 270 `train.py:225`, Intent TFIDF char+word SVC 128 `train.py:276`, Match RF MISSING `train.py:374`.

Intents 17 `app.py:60`, slots quantity/time_scope/price_pref/count `nlu.py:132`, LLM Gemini→Groq `llm.py:128` `generate_reply` retry `llm.py:140`, `_understand` prompt `app.py:530`, `predictAttendance` heuristic `predictAttendance.js:45`, `recommendationEngine` two-tier tier1 CF×2+boost28 tier2 deterministic `recommendationEngine.js:318`, `collaborationEngine` 7 dims threshold60 blend55 `collaborationEngine.js:440`, sentiment lexicon `sentiment.js:51`.

Best-effort: Node `aiClient.js` race 8-10s fallback heuristic.

---

## 15. Deployment — Docker & AWS

### Docker Multi-stage
| Service | Base | Stages | Port | Healthcheck | Size |
|---------|------|--------|------|-------------|------|
| Backend | node:22-alpine | base→deps→prod-deps→runner appuser 5000 dumb-init | 5000 | curl /api/health 30s start20 | ~221MB `DEPLOYMENT.md:157` |
| Frontend| node:22-alpine | base→deps→builder standalone→runner nextjs 1001 HOST 0.0.0.0 | 3000→80 prod `docker-compose.prod.yml:55` | curl / 30s | ~220MB |
| AI      | python:3.12-slim | base→builder venv→runner appuser MODELS_DIR /app/models | 8000 127.0.0.1 | python urllib /health 30s start40 | ~534MB |

`.dockerignore` excludes node_modules/.env `backend/.dockerignore:1` `ai-service/.dockerignore:1`.

### Compose
Dev `docker-compose.yml:72` 3 services `ai → backend → frontend` health depends `docker-compose.yml:18` AI `python urllib` `AI_SERVICE_URL http://ai-service:8000` `docker-compose.yml:16` volumes models bind mount `docker-compose.yml:60`.

Prod `docker-compose.prod.yml:118` GHCR `ghcr.io/${IMAGE_PREFIX}-*:latest` `docker-compose.prod.yml:17` env_file `required:false` `docker-compose.prod.yml:22` ports 5000:5000 80:3000 `docker-compose.prod.yml:55` 127.0.0.1:8000:8000 `docker-compose.prod.yml:86` resources limits 768M/512M/1G `docker-compose.prod.yml:32` logging 10m×3 `docker-compose.prod.yml:45` volume ai-models named `docker-compose.prod.yml:112` network eventnexus-prod `docker-compose.prod.yml:116`.

### AWS `ap-southeast-2` `infra/aws-helpers.sh:2`
`REGION ap-southeast-2` VPC `10.0.0.0/16` `aws-helpers.sh:3` SUBNET_A `10.0.1.0/24` `10` SUBNET_B `10.0.2.0/24` AZ a/b `aws-helpers.sh:6` TAG eventnexus `aws-helpers.sh:8` AMI `ami-0d30e783ca50bc3e0 AL2023` `aws-helpers.sh:9` t3.micro `aws-helpers.sh:10` KEY eventnexus-key-2026 `aws-helpers.sh:11`.

Persisted `infra/aws-ids.env` `vpc-01aac9aac4b81d187` `igw-00580bea854f8ef32` `subnet-05ce4a654a7fc97e0` `subnet-0e0a96167cd8cb75e` `rtb-02d2a137743540d52` `sg-08d7282ce6bb65999 ALB` 80/443 `provision-alb-vpc.sh:109` `sg-069e3ba7854302690 EC2` 22 world 80/3000/5000 from ALB only `provision-alb-vpc.sh:121` revoke world `provision-alb-vpc.sh:131`.

EC2 `i-04ca32808d1316bc8` `ec2-info.env:1` private 10.0.1.142 public 3.106.232.125 DNS `ec2-3-106-232-125.ap-southeast-2.compute.amazonaws.com` `ec2-info.env:2` volume 30GB gp3 `provision-ec2.sh:79` swap 2GB `DEPLOYMENT.md:121` Docker 25.0.14 compose 2.29.7 `provision-ec2.sh:42`.

ALB `eventnexus-alb` `arn 6bde2b8c0d8f589e` DNS `eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com Z1GM3OXH4ZPM65` `alb-info.env:2` Listener HTTP:80 default→frontend TG `provision-alb.sh:74` Rule pri1 `/api/*`→backend `provision-alb.sh:86` TG frontend HTTP:80 health / matcher200-399 `provision-alb.sh:38` TG backend HTTP:5000 health /api/health `provision-alb.sh:52` targets i-04ca32808d1316bc8:80/:5000 `provision-alb.sh:69`.

Scripts: `provision-alb-vpc.sh:161` idempotent, `provision-ec2.sh:137` userdata docker+compose, `provision-alb.sh:140` ALB+rules.

Live endpoints `docs/DEPLOYMENT.md:11`: Frontend ALB `http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com/` → TG Frontend →80, Backend ALB `http://.../api/health` →5000, Direct `http://3.106.232.125/` →3000 and `:5000/api/health`, AI `http://127.0.0.1:8000/health`.

---

## 16. CI/CD — GitHub Actions + GHCR

**CI** `.github/workflows/ci.yml:35` name CI trigger pull_request main/dev + push !main paths-ignore md/docs `ci.yml:5` job build matrix backend/frontend/ai-service `ci.yml:19` setup-buildx `ci.yml:23` build-push `ci.yml:25` push false load false cache gha mode max `ci.yml:31` platforms linux/amd64 build-args NEXT_PUBLIC_API_URL localhost `ci.yml:34`.

**Deploy** `.github/workflows/deploy.yml:334` name Build & Deploy to EC2 trigger push main paths-ignore `deploy.yml:12` workflow_dispatch skip_build `deploy.yml:19` permissions contents read packages write `deploy.yml:26` env REGISTRY ghcr.io IMAGE_PREFIX owner/event lowercased `deploy.yml:30` concurrency deploy-ec2-cancel false `deploy.yml:36` jobs:

1 `build-backend:44` checkout+buildx+login GHCR `deploy.yml:54` metadata `ghcr.io/${IMAGE_PREFIX}-backend` tags latest+sha+ref `deploy.yml:61` build-push cache registry buildcache `deploy.yml:82` provenance false `deploy.yml:85`
2 `build-frontend:87` same + build-args `NEXT_PUBLIC_API_URL vars||localhost` `GOOGLE_CLIENT_ID` `deploy.yml:122` cache frontend:buildcache
3 `build-ai:131` same cache ai-service:buildcache
4 `deploy:174` needs all success|skipped `deploy.yml:176` check secrets EC2_HOST/USER/SSH_KEY `deploy.yml:185` appleboy/ssh-action `deploy.yml:197` script: clone `DEPLOY_DIR $HOME/eventnexus` `deploy.yml:214` shallow else fetch reset `deploy.yml:218` write_env helper 600 `deploy.yml:237` BACKEND_ENV→backend.env AI_ENV→ai.env `deploy.yml:260` GHCR login EC2 `deploy.yml:269` export IMAGE_PREFIX/TAG latest pull `docker compose pull` `deploy.yml:285` `up -d --remove-orphans` `deploy.yml:288` health wait 90s loop inspect Health.Status `deploy.yml:290` ps logs `deploy.yml:310` smoke curl localhost:5000 /8000 /3000 fail `deploy.yml:317` prune `deploy.yml:325` notify failure `deploy.yml:331`.

GHCR `ghcr.io/ashokabbhattaraii/event-*:latest|sha|branch` private fallback PAT `CICD.md:33`.

---

## 17. Environment Variables

### Backend `backend/.env.example:113` live `backend/.env:46`

| Var | Required | Default/Live | Purpose |
|-----|----------|--------------|---------|
| PORT | no | 5000 | |
| MONGODB_URI | yes | mongodb://localhost:27017/eventnexus → Atlas srv | `backend/.env:2` |
| JWT_SECRET | yes | replace → eventnexus_jwt_secret_change_in_production | `backend/.env:3` |
| JWT_EXPIRES_IN | no | 7d | |
| JWT_REFRESH_EXPIRES_IN | no | 30d | |
| QR_TOKEN_SECRET | no | →JWT_SECRET → eventnexus_qr | |
| FRONTEND_URL | no | http://localhost:3000 → comma allowlist + extraOrigins ALB/EC2 `server.js:55` | CORS |
| GOOGLE_CLIENT_ID | no | →1092789532631-22lvnc | verify |
| ADMIN_EMAILS | no | anjaliimiishra321@gmail.com | auto-admin |
| SMTP_* EMAIL_FROM | no | smtp.gmail.com 587 home1051ab@gmail.com | nodemailer |
| AI_SERVICE_URL | no | http://localhost:8000 → prod http://ai-service:8000 `docker-compose.prod.yml:26` | |
| GROQ_API_KEY/MODEL | no | gsk_9GXU llama-3.1-8b-instant | |
| GEMINI_API_KEY/MODEL | no | AQ.Ab8RN6 gemini-flash-latest | |
| STRIPE_* | no | sk_test_51U43 pk_test whsec_52403 | |
| NPR_USD_RATE | no | 133 → live 153 | |
| ESEWA_* | no | EPAYTEST 8gBm rc-epay | `esewa.js:9` |

### Frontend `frontend/.env.example:9` `frontend/.env.local:4`
| Var | Required | Value |
|-----|----------|-------|
| NEXT_PUBLIC_API_URL | no | http://localhost:5000/api → prod var http://eventnexus-alb.../api `deploy.yml:124` BAKED |
| NEXT_PUBLIC_GOOGLE_CLIENT_ID | no | →1092789532631 needs rebuild |

### AI `ai-service/.env.example:25` `ai-service/.env:13`
| Var | Default | Purpose |
|-----|---------|---------|
| AI_PORT | 8000 | |
| MONGODB_URI | mongodb://localhost:27017/eventnexus → same Atlas | |
| MODELS_DIR | ./models → /app/models | |
| GROQ_API_KEY/MODEL | llama-3.1-8b-instant | llm.py fallback |
| GEMINI_API_KEY/MODEL | gemini-flash-latest | gemini primary `llm.py:128` |

GitHub Secrets `CICD.md:38` EC2_HOST 3.106.232.125 EC2_USER ec2-user EC2_SSH_KEY PEM BACKEND_ENV AI_ENV FRONTEND_ENV GHCR_PAT GOOGLE_CLIENT_ID Vars NEXT_PUBLIC_API_URL + GOOGLE `deploy.yml:124`.

---

## 18. Security Hardening

- Helmet HSTS frame CSP false for data-URL `server.js:47` x-powered-by disable `server.js:53`
- CORS allowlist `server.js:71` !origin allow
- Stripe webhook raw verify `server.js:83` `paymentController.js:211`
- json 8mb cover images `server.js:92`
- Sanitize NoSQL `$/. __proto__` depth6 global `sanitizeRequest.js:29` `server.js:100`
- RateLimit 20/m Map evict5000 429 `rateLimit.js:5` per-endpoint budgets register10 login10 google10 forgot5 refresh60 orgRegister5 event5 esewa20 chatbot20 `auth.js:36` etc
- protect active 403 ver 401 `auth.js:7` optionalAuth `auth.js:50` authorize `auth.js:71` requireSystemAdmin `auth.js:170` requirePermission `auth.js:177` requireOrgAdmin `auth.js:194` canManageEvent `eventController.js:24` isOwningOrgManager `eventController.js:406`
- bcrypt 12 `User.js:141` tokenVersion bump `authController.js:936` active flag
- QR secret fallback warning `qrToken.js:3` grace 300s `qrToken.js:43`
- scopeToOrg `tenant.js:3` tenant isolation + coHost check `ticketController.js:276`
- validate `validate.js:8` 400 errors[0].msg
- errorHandler ValidationError 400 11000 409 CastError 400 `errors.js:16` no leak
- Open-redirect `sanitizeEventRedirect` EVENT_PATH_RE only `/event/[0-9a-f]{24}` allowed qr/utm `event-redirect.ts:10`
- eSewa allowlist `ESEWA_ALLOWED_ACTIONS` `esewa.ts:6` timingSafeEqual `esewa.js:96`
- JWT ver+tokenVersion theft detection `authController.js:655`
- ALB SG 80/443 world `aws-ids.env:6` EC2 SG 22 world 80/3000/5000 from ALB only `aws-ids.env:7`
- Secrets 600 `deploy.yml:244` .dockerignore excludes .env
- Pending: rotate JWT/QR `DEPLOYMENT.md:313`, restrict SG 22, TLS ACM 443 `DEPLOYMENT.md:309`, Route53 Elastic IP CloudWatch WAF `DEPLOYMENT.md:312`

---

## 19. Local Development

```bash
# prerequisites Node22 pnpm8 Mongo local or Atlas `README.md:12`

# backend
cd backend
pnpm i                 # `package.json:28`
cp .env.example .env   # edit MONGODB_URI JWT_SECRET `README.md:32`
pnpm seed              # wipes 12 colls, sync indexes, 27 users, 109 events, 392 tickets `src/seed.js:125`
pnpm dev               # nodemon src/server.js `README.md:39` -> http://localhost:5000 `/api/health` `server.js:131`

# frontend
cd frontend
pnpm i
cp .env.example .env.local   # `README.md:56` defaults http://localhost:5000/api
pnpm run dev           # `package.json:6` -> http://localhost:3000 `app/layout.tsx:37`

# ai-service
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt  # `requirements.txt:1` needs python3.12 `Dockerfile:8`
cp .env.example .env   # MONGODB_URI same Atlas + GEMINI/GROQ `README.md:3` `ai-service/README.md:52`
./start.sh             # or `uvicorn app:app --reload` `start.sh:18` -> http://localhost:8000 /health `app.py:160`
# first startup auto-trains missing models `app.py:134`

# docker
docker compose up --build          # `docker-compose.yml:2` ai→backend→frontend healthy
docker compose -f docker-compose.prod.yml pull && up -d   # prod `docker-compose.prod.yml:9` smoke curl `docker-compose.prod.yml:13`

# accounts after seed `README.md:70`
admin@eventnexus.dev / password123 -> /admin
organizer@eventnexus.dev / password123 -> /organizer
orgadmin@eventnexus.dev / password123 -> /admin (tenant)
attendee@eventnexus.dev / password123 -> /events
```

Scripts: backend `dev|start|seed|migrate:org-admin|backfill:event-geo` `package.json:5`, frontend `dev|build|start|lint` `package.json:5`.

---

## 20. Project Structure Tree

```
backend/src/
├── server.js:149                  Entry + cors+helmet+webhook+json+sanitize+mounts+socket
├── config/db.js:13                mongoose.connect `MONGODB_URI` exit1
├── controllers/ 19 ~12k
│   ├── authController.js:1112     orgRegister/login/google/refresh/verify/reset/export/delete
│   ├── eventController.js:749     canManageEvent create/update/delete/getAiInsight/aiDraft
│   ├── ticketController.js:484    register/cancel/verify/attendees
│   ├── paymentController.js:634   Stripe checkout+webhook+esewa init/confirm
│   ├── userController.js:834      scope profile/saved/location/sessions/role
│   ├── organizationController.js:309 slugify members
│   ├── systemAdminController.js:219 pending approve/reject
│   └── chatbotController.js:969  multi-intent grounded
├── middleware/ 6
│   ├── auth.js:242                protect/optionalAuth/authorize/requirePermission/requireOrgAdmin
│   ├── sanitize.js:36             global NoSQL
│   ├── rateLimit.js:32            fixed-window
│   ├── errors.js:68               notFound+errorHandler
│   └── tenant.js:24 + validate.js:21
├── models/ 17
│   ├── User.js:149 + Event.js:181 + Ticket.js:101 + Notification.js:67 + etc.
│   └── AuditLog.js:62 immutable
├── routes/ 17  ai(80) analytics(17) audit(10) auth(148) chatbot(29) collaboration(47) events(221) iam(28) notifications(19) organizations(71) payments(45) recommendations(9) sessions(54) speakers(46) system(44) tickets(22) users(211)
├── utils/ 23  aiClient aiProvider audit collaborationEngine currency email esewa eventPublishNotify geo predictAttendance proximityNotify qrCode qrToken query recommendationEngine reminderScheduler sentiment socket ticketing tokens
├── seed.js:907                    deterministic PRNG c0ffee 9+100 events seedRand
└── scripts/backfill-event-geo.js:80 + migrate-org-admin-role.js:90

frontend/
├── app/  layout.tsx:59 globals.css:177 page.tsx:27  admin/* analytics check-in checkout/event/events/forgot/login/my-tickets/notifications/org-register/organizer/recommendations/register/reset/saved/settings/verify-email
│   └── not-found.tsx:8
├── components/
│   ├── app/ 30  app-shell 466 nav-configs 83 event-card role-event-detail public-event-landing event-wizard attendee-roster collaboration-workspace notification-bell event-qr-poster qr-* charts venue-map help-dialog etc
│   ├── ui/ 60+ shadcn new-york
│   ├── landing/ 10 hero navbar features how-it-works
│   ├── chatbot/event-bot 660
│   ├── auth/auth-shell + interests + anim/reveal count-up + providers 3
├── lib/
│   ├── api/22 client 180 auth 144 events 164 tickets 105 notifications 66 payments 41 ai 84 list 377 etc
│   ├── queries/17 analytics auth 194 collaboration events 229 etc
│   ├── hooks use-debounce 21 use-has-token 76 use-require-role 57
│   ├── stores/chatbot-store 332 persist per-user
│   ├── adapters/event 60 + constants/event-options 34 + errors 29 + esewa 36 + event-date 31 + event-redirect 32 + geocode 53 + gsap 49 + price 27 + qr 467 + route-access 38 + saved-events 29 + socket 104 + utils 6
├── hooks/use-mobile + use-toast
├── next.config.mjs:27 standalone+redirects
├── components.json:21  tailwind v4
├── Dockerfile:66  node22 multi-stage
└── styles/globals.css

ai-service/
├── app.py:629  14 routes KNOWN_INTENTS 17
├── db.py:201  Mongo + collab pairs
├── features.py:262  build_rows 7 + pair 10 + TFIDF
├── llm.py:150  gemini/groq urllib
├── nlu.py:138  slots
├── train.py:419 4 models HGB SVD SVC RF meta.json
├── requirements.txt:9  Dockerfile:60  start.sh:24  models/*.joblib meta.json

infra/
├── aws-helpers.sh:16  REGION VPC subnets AMI
├── provision-alb-vpc.sh:161  VPC IGW RT SG
├── provision-ec2.sh:137  t3.micro userdata
├── provision-alb.sh:140  ALB TG Listener rule
├── aws-ids.env + alb-info.env + ec2-info.env

.github/workflows/
├── ci.yml:35  build matrix no push
└── deploy.yml:334  3 builds parallel GHCR + SSH deploy

docker-compose.yml:72  dev
docker-compose.prod.yml:118  prod GHCR
docs/ CICD 156 DEPLOYMENT 317 EC2_SETUP 231 FEATURE_CHECKLIST 128 USER_TESTING 337
```

---

## 21. Appendix — Key File References & Metrics

- **Codebase Graph:** Users-ashokbhattarai-Desktop-Perosnal-Event 3802 nodes 8727 edges size 12MB `list_projects:3802`
- **Entry points:** AdminAiPage `frontend/app/admin/ai/page.tsx`, OrgApprovalsPage `frontend/app/admin/approvals/page.tsx`, AdminCollaboration `collaboration/page.tsx` etc 20 listed `get_architecture:entry_points`
- **Routes:** GET /health, POST /train, GET /stats, GET/ PATCH/DELETE /chatlog, POST /predict-attendance, /collaboration-match, /recommendations, /classify-intent, /parse, /understand, /generate, /log-intent, GET /analytics/* `get_architecture:routes`
- **Hotspots:** cn 224, useCurrentUser 54, useHasToken 36 `get_architecture:hotspots`
- **Boundaries:** components→lib 349 calls `get_architecture:boundaries`
- **Clusters:** frontend 251 cohesion0.98 cn/Root `get_architecture:clusters:6`
- **Total backend src:** controllers 12193 lines + seed 907 `backend analysis`
- **Frontend routes:** 40+ pages AppShell guarded `route-access.ts:17`
- **AI models:** attendance HGB 136KB cf 23KB intent 221KB match MISSING `DEPLOYMENT.md:157`
- **Images:** backend 221MB frontend 220MB ai 534MB `DEPLOYMENT.md:157`
- **Infra IDs:** VPC vpc-01aac9aac4b81d187 ALB eventnexus-alb-1182569403 `aws-ids.env:1` `alb-info.env:2` EC2 3.106.232.125 `ec2-info.env:2`
- **Env templates:** backend 113 frontend 9 ai 25 `infra audit`
- **Seed:** 9 hand +100 generated events `seed.js:584`, 27 users `seed.js:151`, 392 tickets `seed.js:663`, sentiment `seed.js:792`
- **Docs:** CICD 156 DEPLOYMENT 317 EC2_SETUP 231 USER_TESTING 337 FEATURE_CHECKLIST 128

---

## 22. Quick Reference — Ports & URLs

| Service | Local | Prod (ALB / EC2) | Health |
|---------|-------|------------------|--------|
| Frontend | http://localhost:3000 | http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com/ (80) + http://3.106.232.125/ | GET / |
| Backend | http://localhost:5000/api | http://eventnexus-alb.../api/health (via ALB /api/* →:5000) + http://3.106.232.125:5000/api/health | GET /api/health `server.js:131` |
| AI | http://localhost:8000 | http://127.0.0.1:8000 (EC2 localhost) / http://ai-service:8000 (internal DNS) | GET /health `app.py:160` |
| Mongo | mongodb://localhost:27017/eventnexus | mongodb+srv://eventnexus.ue1fwo6.mongodb.net | |

---

## 23. Future / Tech Debt Noted in Code

- JWT_SECRET / QR_TOKEN_SECRET placeholder live rotate `DEPLOYMENT.md:313` `qrToken.js:3`
- SG 22 0.0.0.0/0 restrict to operator `DEPLOYMENT.md:306`
- TLS ACM 443 + Route53 Alias + Elastic IP `DEPLOYMENT.md:309`
- Object storage for cover images base64 8mb limit `server.js:92`
- Swap 2GB manually on t3.micro for Next build `DEPLOYMENT.md:121`
- AI collaboration_match needs 8 positives `train.py:334` currently 0
- Helmet CSP disabled `server.js:49` tighten via CDN `server.js:44`
- GHCR private → PAT or public `CICD.md:33`

---

*End of SYSTEM_OVERVIEW.md — for detailed runbooks see `docs/DEPLOYMENT.md:1` `docs/CICD.md:1` `docs/EC2_SETUP.md:1` `ai-service/README.md:1` `README.md:1`.*
