from django.http import JsonResponse
from django.urls import path
from django.db import connection
from django.core.cache import cache


def health_check(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    try:
        cache_key = "health:cache"
        cache.set(cache_key, "ok", timeout=10)
        cache_status = "ok" if cache.get(cache_key) == "ok" else "error: cache read mismatch"
    except Exception as e:
        cache_status = f"error: {e}"

    return JsonResponse({"status": "ok", "db": db_status, "cache": cache_status})


urlpatterns = [
    path("", health_check, name="health"),
]
