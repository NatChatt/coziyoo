# Coziyoo Django — container image for Coolify deployment.
# DB stays on Supabase; this image only runs the API + admin (gunicorn + whitenoise).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Container-friendly gunicorn defaults (overridable via Coolify env)
    GUNICORN_BIND=0.0.0.0:9000 \
    GUNICORN_ACCESS_LOG=- \
    GUNICORN_ERROR_LOG=- \
    DJANGO_SETTINGS_MODULE=coziyoo.settings.production

WORKDIR /app

# curl is only needed for the container healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Collect static at build time. Production settings require these at import, but
# none of them touch the database — they are throwaway build-only values.
RUN DJANGO_SECRET_KEY=build-time-only-not-used-at-runtime-0000000000 \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    APP_JWT_SECRET=build-time-only \
    python manage.py collectstatic --noinput

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:9000/v1/health/ || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["gunicorn", "--config", "gunicorn.conf.py", "coziyoo.wsgi:application"]
