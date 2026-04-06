# Coziyoo

Monorepo for Coziyoo v2 platform with npm workspaces.

## Project Structure

```
coziyoo/
├── .env                    # Centralized environment configuration
├── package.json            # Root workspace configuration
├── apps/
│   ├── api/               # Backend API (Node.js/Express)
│   ├── admin/             # Admin panel (React + Vite)
│   └── mobile/            # Mobile app (Expo, standalone npm project)
├── packages/
│   ├── shared-types/      # Shared TypeScript types
│   └── shared-utils/      # Shared utility functions
└── installation/          # Deployment scripts
```

## Quick Start (Local Development)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/mobile/.env.example apps/mobile/.env
```

### 3. Run Development

```bash
# API only (http://localhost:3000)
npm run dev:api

# Admin panel only (http://localhost:5173)
npm run dev:admin

# Mobile app (delegates to apps/mobile)
npm run dev:mobile
```

Mobile can also run fully standalone:

```bash
cd apps/mobile
cp .env.example .env
npm install
npm run ios
```

## Docker Dev Stack (No System-Wide Node/Python)

Use this when you want API and Admin to run fully in containers.

```bash
# Start API + Admin
docker compose -f docker-compose.dev.yml up -d

# Follow logs
docker compose -f docker-compose.dev.yml logs -f
```

Stop stack:

```bash
docker compose -f docker-compose.dev.yml down
```

Notes:
- Mobile app can continue running on simulator from host as usual.
- Dev compose reads shared values from root `.env` and app-specific values from each app's `.env`.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build all workspaces |
| `npm run dev:api` | Start API in dev mode |
| `npm run dev:admin` | Start Admin panel in dev mode |
| `npm run dev:mobile` | Start Mobile app in dev mode |
| `npm run build:api` | Build API only |
| `npm run build:admin` | Build Admin only |
| `npm run build:mobile` | Reminder message for standalone mobile workflow |
| `npm run test` | Run tests in all workspaces |
| `npm run test:api` | Run API tests only |

## Production Deployment

See [installation/README.md](installation/README.md) for VPS deployment instructions.
Quick deploy smoke test note: this section was last verified on **March 2, 2026**.
Latest deploy smoke trigger commit timestamp: **2026-03-02 22:13:57 GMT**.

```bash
# On VPS - First time setup
bash installation/scripts/install_all.sh

# On VPS - Updates
bash installation/scripts/update_all.sh
```

Auto-deploy on push is available via GitHub Actions (`.github/workflows/deploy-on-push.yml`).
See `installation/README.md` for required secrets (`DEPLOY_SSH_KEY`, `DEPLOY_TARGETS`).
Post-deploy one-time DB data patch checks are also run during `update_all.sh` (flag-tracked in DB).
Latest lot lifecycle patch key: `lot_lifecycle_v1_20260302` (adds sale window + snapshot fields on `production_lots`).
For demo environments, default workflow behavior is DB reset only on schema changes (`DEPLOY_DEMO_DB_REBUILD_ON_SCHEMA_CHANGE=true`).

## Default Credentials

After installation, the admin panel is available at your configured domain with:
- **Email:** `admin@coziyoo.com`
- **Password:** `Admin12345`

## Architecture

### Services (Production)

| Service | Type | Port | Description |
|---------|------|------|-------------|
| `coziyoo-api` | systemd | 3000 | Node.js/Express API |
| `coziyoo-admin` | systemd | 8000 | Python HTTP server (admin panel) |
| `nginx-proxy-manager` | Docker | 80/443/81 | Nginx Proxy Manager (ingress) |

### External Access

Nginx Proxy Manager routes external traffic:
- `api.coziyoo.com` → `http://127.0.0.1:3000`
- `admin.coziyoo.com` → `http://127.0.0.1:8000`

## Environment Configuration

Environment file policy:

- `.env.example`: sample template
- `.env`: production/runtime file

Application configuration values include:

- **API settings:** `API_PORT`, `*_SECRET` keys
- **Database:** `DATABASE_URL`, `DATABASE_SSL_MODE`
- **External services:** `PAYMENT_WEBHOOK_SECRET`, `N8N_*`, `OLLAMA_*`, etc.

Installation-specific settings are in `installation/config.env`.

Generate a conflict-safe root env from template:

```bash
bash installation/scripts/generate_env.sh
```

Overwrite existing `.env`:

```bash
bash installation/scripts/generate_env.sh --force
```

## Workspace Commands

```bash
# Install package in specific app
npm install some-package --workspace=apps/api

# Run script in specific app
npm run test --workspace=apps/api

# Add shared package as dependency
npm install @coziyoo/shared-types --workspace=apps/api
```

## Adding New Packages

1. Create directory in `packages/my-package/`
2. Add `package.json` with `"name": "@coziyoo/my-package"`
3. Run `npm install` at root
4. Use in apps: `npm install @coziyoo/my-package --workspace=apps/api`
