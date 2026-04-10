import logging

from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is not None:
        error_code = type(exc).__name__.upper()
        message = str(exc)

        # Flatten DRF validation errors to a single message
        if hasattr(exc, "detail"):
            detail = exc.detail
            if isinstance(detail, dict):
                first_key = next(iter(detail))
                first_val = detail[first_key]
                message = f"{first_key}: {first_val[0] if isinstance(first_val, list) else first_val}"
            elif isinstance(detail, list):
                message = str(detail[0])
            else:
                message = str(detail)

        response.data = {
            "error": {
                "code": error_code,
                "message": message,
            }
        }
        return response

    # Unhandled exceptions (e.g. database errors) — log and return JSON 500
    view = context.get("view")
    logger.exception(
        "Unhandled exception in view %s",
        type(view).__name__ if view else "unknown",
        exc_info=exc,
    )
    return Response(
        {"error": {"code": "SERVER_ERROR", "message": "Sunucuda bir hata oluştu. Lütfen tekrar dene."}},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
