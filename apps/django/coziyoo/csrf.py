from django.middleware.csrf import CsrfViewMiddleware


class CoziyooCsrfViewMiddleware(CsrfViewMiddleware):
    trusted_origins = {
        "https://admin.coziyoo.com",
        "https://api.coziyoo.com",
    }

    def _origin_verified(self, request):
        origin = request.META.get("HTTP_ORIGIN", "")
        if origin in self.trusted_origins:
            return True
        return super()._origin_verified(request)
