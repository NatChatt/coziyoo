import hashlib
import hmac
import logging
import subprocess
import threading

from django.http import JsonResponse
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from decouple import config

logger = logging.getLogger(__name__)

WEBHOOK_SECRET = config("DEPLOY_WEBHOOK_SECRET", default="")
DEPLOY_SCRIPT = "/opt/coziyoo/scripts/deploy/update.sh"


def verify_signature(payload_body, signature):
    if not WEBHOOK_SECRET:
        return False
    expected = hmac.new(
        WEBHOOK_SECRET.encode(), payload_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


def run_deploy():
    try:
        # Use sudo + setsid to run the deploy in a new session, detached from
        # Gunicorn's process group. This prevents systemctl restart (inside
        # update.sh) from killing the deploy process via the service cgroup.
        result = subprocess.run(
            ["sudo", "setsid", "bash", DEPLOY_SCRIPT],
            cwd="/opt/coziyoo",
            env={
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "HOME": "/root",
                "GIT_UPDATE": "true",
                "DEPLOY_BRANCH": "main",
            },
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            logger.error("Deploy failed: %s", result.stderr)
        else:
            logger.info("Deploy completed successfully")
    except Exception:
        logger.exception("Deploy script error")


@csrf_exempt
@require_POST
def deploy_webhook(request):
    signature = request.headers.get("X-Webhook-Signature", "")
    if not verify_signature(request.body, signature):
        return JsonResponse({"error": "invalid signature"}, status=403)

    thread = threading.Thread(target=run_deploy, daemon=True)
    thread.start()

    return JsonResponse({"status": "deploy started"})


urlpatterns = [
    path("deploy/", deploy_webhook, name="deploy_webhook"),
]
