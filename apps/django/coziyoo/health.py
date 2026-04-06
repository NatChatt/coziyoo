from django.http import JsonResponse
from django.urls import path
from django.db import connection


def health_check(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    return JsonResponse({"status": "ok", "db": db_status})


urlpatterns = [
    path("", health_check, name="health"),
]
