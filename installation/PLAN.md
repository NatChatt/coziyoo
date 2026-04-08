# Coziyoo Deployment Architecture

## Overview

Production deployment uses:
- **Nginx Proxy Manager** (Docker) for external ingress (TLS, routing)
- **Gunicorn + systemd** for Django application
- **Supabase** (external) for PostgreSQL + Realtime

## Service Architecture

```
Internet
    ↓
Nginx Proxy Manager (Docker: 80/443)
    ├──→ api.coziyoo.com  → Django/Gunicorn (systemd: 127.0.0.1:9000)
    └──→ admin.coziyoo.com → Django/Gunicorn (systemd: 127.0.0.1:9000)
```

## Services

### 1. Django (`coziyoo-django`)
- **Type:** Systemd service
- **Runtime:** Python/Gunicorn
- **Port:** 127.0.0.1:9000
- **Working Dir:** `/opt/coziyoo/apps/django`

### 2. Nginx Proxy Manager
- **Type:** Docker container
- **Ports:** 80, 443 (public), 81 (admin UI)
- **Config:** `/opt/nginx-proxy-manager/docker-compose.yml`

## Install Flow

1. **install.sh** - Install prereqs, set up systemd service, start Django
2. **update.sh** - Pull latest code, restart service

## Configuration Files

### `apps/django/.env` (Application config)
```
DATABASE_URL=postgresql://...
APP_JWT_SECRET=...
ADMIN_JWT_SECRET=...
DJANGO_SECRET_KEY=...
```

### `installation/config.env` (Install config)
```
REPO_ROOT=/opt/coziyoo
DEPLOY_BRANCH=main
ADMIN_DOMAIN=admin.coziyoo.com
API_DOMAIN=api.coziyoo.com
```

## Security

- All services bind to localhost (127.0.0.1) except NPM
- NPM handles SSL termination

## Default Credentials

- Admin user: `admin@coziyoo.com` / `Admin12345`
