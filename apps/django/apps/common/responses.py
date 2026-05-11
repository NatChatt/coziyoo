"""Standart hata yanıt formatı.

API sözleşmesi (CLAUDE.md): {"error": {"code": "...", "message": "..."}}
coziyoo/exceptions.py içindeki custom_exception_handler ile aynı şekli üretir.
"""
from rest_framework import status as drf_status
from rest_framework.response import Response


def error_response(code: str, message: str, status: int = drf_status.HTTP_400_BAD_REQUEST) -> Response:
    """Standart hata yanıtı döndürür.

    Örnek:
        return error_response("VALIDATION_ERROR", "email required", 400)
        return error_response("NOT_FOUND", "Sipariş bulunamadı.", status.HTTP_404_NOT_FOUND)
    """
    return Response({"error": {"code": code, "message": message}}, status=status)
