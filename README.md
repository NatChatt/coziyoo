# Coziyoo

Coziyoo v2 platform monorepo.

## Project Structure

```
coziyoo/
├── apps/
│   ├── django/            # Backend API + Admin panel (Django + DRF)
│   └── mobile/            # Mobile app (Expo, standalone npm project)
└── installation/          # Deployment scripts
```

## Quick Start (Local Development)

### Django (Backend + Admin)

```bash
cd apps/django
pip install -r requirements.txt
# apps/django/.env required (DATABASE_URL, APP_JWT_SECRET, ADMIN_JWT_SECRET, DJANGO_SECRET_KEY)
DJANGO_SETTINGS_MODULE=coziyoo.settings.development python manage.py runserver 9000
```

### Mobile

```bash
cd apps/mobile
npm install
npm run ios      # or npm run android
```

## Production Deployment

See [installation/README.md](installation/README.md) for VPS deployment instructions.

```bash
# On VPS - First time setup
bash installation/scripts/install_all.sh

# On VPS - Updates
bash installation/scripts/update_all.sh
```

Auto-deploy on push is available via GitHub Actions (`.github/workflows/deploy-django.yml`).
See `installation/README.md` for required secrets (`DEPLOY_SSH_KEY`, `DEPLOY_TARGETS`).

## Default Credentials

After installation, the admin panel is available at your configured domain with:
- **Email:** `admin@coziyoo.com`
- **Password:** `Admin12345`

## Architecture

### Services (Production)

| Service | Type | Port | Description |
|---------|------|------|-------------|
| `coziyoo-django` | systemd/gunicorn | 9000 | Django API + Admin |
| `nginx-proxy-manager` | Docker | 80/443/81 | Nginx Proxy Manager (ingress) |

### External Access

Nginx Proxy Manager routes external traffic:
- `api.coziyoo.com` → `http://127.0.0.1:9000`
- `admin.coziyoo.com` → `http://127.0.0.1:9000`

## Environment Configuration

- `.env.example`: sample template
- `apps/django/.env`: runtime config (DATABASE_URL, JWT secrets, S3, etc.)

Installation-specific settings are in `installation/config.env`.
