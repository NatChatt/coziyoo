from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status


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
