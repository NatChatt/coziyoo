# Project Analysis (Updated: 2026-03-02)

This document summarizes the current project state and defines working boundaries for future tasks.

## 1) Monorepo State
- Structure: npm workspaces (`apps/*`, `packages/*`).
- Main active apps: `apps/django` (backend + admin), `apps/mobile`.
- Shared packages: `packages/shared-types`, `packages/shared-utils`.
- Deployment/operations center: `installation/scripts/*`.
- CI/CD workflow: `.github/workflows/deploy-on-push.yml`.

## 2) Deploy and Operations Flow (Current)
- `deploy-on-push.yml` runs on `main` push and connects to target servers via SSH, then runs `installation/scripts/update_all.sh`.
- `update_all.sh` flow:
  - stop app services
  - optional demo DB rebuild decision (flag + schema-change check)
  - update API/Admin
  - optional reseed + admin sync
  - idempotent post-deploy DB patch checks via `apply_post_deploy_db_updates.sh`
  - health checks and validation
- This chain is treated as the currently stable deploy contract.

## 3) Codebase and Documentation Notes
- Root `README.md` still references `dev:web`/`build:web`, while root `package.json` scripts are `mobile`-oriented (`dev:mobile`, `build:mobile`). This is a documentation drift risk.
- `apps/web` appears to contain mostly `node_modules` content, not an active app source tree. Cleanup may be needed if it is deprecated.
- API includes hardening around login content-type compatibility, health checks, and deploy verification.
- Recent commits are focused on deploy/migration/admin-sync reliability.

## 4) Persistent Working Constraint
Unless explicitly requested by the user, do not modify:
- GitHub Actions: `.github/workflows/*`
- Deployment DB update method:
  - `installation/scripts/update_all.sh`
  - `installation/scripts/apply_post_deploy_db_updates.sh`
  - `installation/scripts/db-migrate.sh`
  - demo DB rebuild/reseed decision logic and related env/flag behavior

## 5) Working Mode for Next Tasks
- Default focus: app features, bug fixes, tests, and product improvements.
- Preserve CI/CD and DB update pipeline unless user gives explicit approval.
- If a requested feature cannot be done without touching protected areas, first provide an impact analysis and ask for approval.

## 6) Delivery Preference
- Avoid over-engineering. Prefer direct, minimal, maintainable implementations unless deeper architecture is explicitly requested.

## 7) Git Workflow Preference (User)
- Unless the user explicitly says otherwise, after completing requested code changes always run:
  - `git pull --rebase --autostash`
  - commit with a clear message
  - `git push`
- Apply this by default without asking the user to repeat it in each task.

## 8) Brand Voice Lock (User Rule - Persistent)
- Coziyoo metin dili sabittir and must not drift unless user explicitly requests a change:
  - Tam Turkce
  - Samimi "sen" dili
  - Kisa, net, guven veren ton
  - Kurumsal/robotik dil yok
- Ana slogan sabittir: `Komşunun mutfağından, kapına.`
- Slogan Home ekraninda arama cubugunun altindaki hero kartta kalir.
- Mobil metinlerde tek kaynak: `apps/mobile/src/copy/brandCopy.ts`
- Detayli kilit dokumani: `BRAND_VOICE_LOCK.md`

## 9) API Response Contract (User Rule - Persistent)
- HTML response kullanmiyoruz.
- Tum API endpointleri `application/json` donmeli.
- Hata durumlarinda da JSON donmeli (`{ error: { code, message } }`).
- Mobile/Admin istemcileri JSON disi response'u hata kabul eder ve fallback mesaj gosterir.
