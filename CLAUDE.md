# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Coziyoo v2 is a food-ordering marketplace platform. It is an npm workspaces monorepo containing a Node.js/Express API, React admin panel, and Expo mobile app.

## Common Commands

### Local Development

```bash
# First-time env setup (copy all four files)
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/mobile/.env.example apps/mobile/.env

npm install                  # Install API + Admin + packages workspaces

npm run dev:api              # API on http://localhost:3000
npm run dev:admin            # Admin panel on http://localhost:5174
npm run dev:mobile           # Mobile via Expo (delegates to apps/mobile)
```

`apps/mobile` is **not** in the npm workspaces array. Run it standalone:

```bash
cd apps/mobile && npm install && npm run ios   # or npm run android
```

### Docker Dev Stack

```bash
docker compose -f docker-compose.dev.yml up -d   # Start API + Admin in containers
docker compose -f docker-compose.dev.yml down
```

### Building

```bash
npm run build                # Build all workspaces
npm run build:api            # API only (tsc)
npm run build:admin          # Admin only (Vite)
```

### Testing

```bash
npm run test                 # All workspaces
npm run test:api             # API unit tests (Vitest)
npm run test --workspace=apps/api -- --run src/path/to/file.test.ts  # Single test file
```

### Database

```bash
bash installation/scripts/db-migrate.sh   # Run pending SQL migrations
bash installation/scripts/seed-data.sh    # Seed sample data
npm run seed:admin --workspace=apps/api   # Seed admin user only
```

### Workspace-scoped package management

```bash
npm install some-package --workspace=apps/api
npm run test --workspace=apps/api
```

### VPS Deployment

```bash
bash installation/scripts/install_all.sh  # First-time VPS setup
bash installation/scripts/update_all.sh   # Deploy updates & restart services
bash installation/scripts/generate_env.sh # Generate root .env from template
```

## Architecture

### Services

| Service | Stack | Port | Description |
|---------|-------|------|-------------|
| `apps/api` | Node.js/Express/TypeScript | 3000 | REST API |
| `apps/admin` | React/Vite/TypeScript | 5174 (dev) / 8000 (prod) | Admin panel |
| `apps/mobile` | Expo/React Native | Expo | Buyer/seller mobile app |

Production ingress via Nginx Proxy Manager (Docker):
- `api.coziyoo.com` → `127.0.0.1:3000`
- `admin.coziyoo.com` → `127.0.0.1:8000`

### API Structure (`apps/api/src/`)

- `app.ts` — Express setup, middleware registration, route mounting
- `routes/` — Route files grouped by domain (`auth`, `orders`, `payments`, `admin/*`)
- `config/env.ts` — Zod-validated env schema; loads root `.env` then `apps/api/.env`
- `db/client.ts` — PostgreSQL pool (pg) using root `.env` vars
- `db/migrations/` — Sequential SQL migrations (currently up to `0028`)
- `services/` — Business logic layer (order state machine, payouts, outbox, Ollama, N8N, TTS, etc.)
- `middleware/` — Auth, CORS, content-type normalization, rate limiting, idempotency, RBAC

### Request Middleware Chain

Requests flow through: CORS → content-type normalization → request context (UUID) → auth → abuse protection → idempotency → route handler.

Content-type normalization strips malformed charset values before Express body parsing to prevent 415 errors from mobile clients.

### Authentication

- Two JWT realms: `app` (buyer/seller) and `admin` (admin panel)
- Separate secrets: `APP_JWT_SECRET` and `ADMIN_JWT_SECRET`
- Access + refresh token pairs; Bearer token in `Authorization` header
- Passwords hashed with Argon2

### Admin Panel (`apps/admin/src/`)

- `AppShell.tsx` — main layout with nav, global search, dark mode, language toggle
- `lib/api.ts` — `request()` wrapper: auto-refreshes JWT on 401, reads base URL from `VITE_API_BASE_URL`
- `lib/auth.ts` — token storage helpers
- `lib/i18n.ts` + `i18n/en.json` / `i18n/tr.json` — English and Turkish UI strings
- `pages/` — one file per admin page (Dashboard, Users, ReviewQueue, Compliance, Security, etc.)
- `components/ui.tsx` — shared UI primitives; `NotesPanel.tsx` — reusable notes sidebar

### Mobile Copy System

All mobile UI text lives in a single source file: `apps/mobile/src/copy/brandCopy.ts`. Never write user-facing strings directly into screen files — add them to `brandCopy.ts` first.

Brand voice rules (immutable unless owner requests change):
- Full Turkish, informal "sen" tone, short and direct sentences
- No corporate/robotic phrasing, no mixed Turkish/English UI text
- Fixed slogan: `Komşunun mutfağından, kapına.` (appears on Home hero card, below search bar)

### Shared Packages

- `packages/shared-types` — TypeScript types shared across API, admin, mobile (`@coziyoo/shared-types`)
- `packages/shared-utils` — Utility functions (`@coziyoo/shared-utils`)

### Database Migrations

Migrations live in `apps/api/src/db/migrations/` as numbered SQL files. The `db-migrate.sh` script runs all pending migrations before service start in production. When adding a migration, use the next sequential number (currently up to `0028`).

### CI/CD

GitHub Actions (`.github/workflows/deploy-on-push.yml`) SSH-deploys to one or more VPS targets on push. Requires `DEPLOY_SSH_KEY` and `DEPLOY_TARGETS` secrets. Each target runs `update_all.sh` which pulls code, runs migrations, rebuilds, and restarts systemd services.

## Environment Configuration

Environment is split by app. Root `.env` holds shared/ops values; each app has its own `.env`. Key groups:

- **API:** `PORT`, `APP_JWT_SECRET`, `ADMIN_JWT_SECRET`
- **Database:** `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `DATABASE_URL`
- **Admin:** `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Mobile:** `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- **S3:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_SELLER_DOCS`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- **External:** `OLLAMA_BASE_URL`, `N8N_HOST`, `TTS_API_KEY`, `SPEECH_TO_TEXT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`
- **CORS:** `CORS_ALLOWED_ORIGINS` (comma-separated, supports `*` and `://*.domain` wildcards)

Installation-specific VPS settings (domains, OS passwords) go in `installation/config.env`.

## API Response Contract

All endpoints return `application/json` — including errors. No HTML responses. Error shape:

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

HTTP 401 = unauthenticated, 403 = forbidden, 415 = unsupported content-type.

## Git Workflow

After completing requested code changes, always:

```bash
git pull --rebase --autostash
# commit with a clear message
git push
```

Apply this by default without waiting to be asked.

## Protected Files (Do Not Modify Without Explicit Approval)

- `.github/workflows/*` — GitHub Actions pipelines
- `installation/scripts/update_all.sh`
- `installation/scripts/apply_post_deploy_db_updates.sh`
- `installation/scripts/db-migrate.sh`
- Demo DB rebuild/reseed decision logic and related env/flag behavior

If a requested change cannot be done without touching these files, provide an impact analysis and ask for approval first.

## Default Admin Credentials

After seeding: `admin@coziyoo.com` / `Admin12345`
