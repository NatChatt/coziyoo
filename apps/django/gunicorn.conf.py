"""
Gunicorn configuration for Coziyoo Django.
Used in production via systemd: gunicorn --config gunicorn.conf.py coziyoo.wsgi:application
"""
import multiprocessing
import os

# Bind to localhost; Nginx Proxy Manager forwards api.coziyoo.com and admin.coziyoo.com here.
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:9000")

# 2–4 workers is fine for a single VPS (adjust via GUNICORN_WORKERS env var)
workers = int(os.getenv("GUNICORN_WORKERS", max(2, multiprocessing.cpu_count())))
worker_class = "sync"

# Prevent hung requests from blocking workers
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
graceful_timeout = 30
keepalive = 5

# Recycle workers periodically to avoid memory leaks
max_requests = 1000
max_requests_jitter = 100

# Logging — write to files so journalctl and these files both work
accesslog = os.getenv("GUNICORN_ACCESS_LOG", "/var/log/coziyoo/django-access.log")
errorlog  = os.getenv("GUNICORN_ERROR_LOG",  "/var/log/coziyoo/django-error.log")
loglevel  = os.getenv("GUNICORN_LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'

# Forward X-Forwarded-For from Nginx Proxy Manager
forwarded_allow_ips = "*"
proxy_protocol = False
