from ipaddress import ip_address, ip_network

from django.conf import settings
from django.http import HttpResponseForbidden


class MetricsAccessMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.allowed_networks = [
            ip_network(value.strip(), strict=False)
            for value in getattr(settings, "METRICS_ALLOWED_IPS", [])
            if value.strip()
        ]

    def __call__(self, request):
        if request.path.startswith("/metrics/") and not self._is_allowed(request):
            return HttpResponseForbidden("Forbidden")
        return self.get_response(request)

    def _is_allowed(self, request):
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        client_ip = forwarded_for.split(",", 1)[0].strip() or request.META.get("REMOTE_ADDR", "")
        try:
            parsed_ip = ip_address(client_ip)
        except ValueError:
            return False
        return any(parsed_ip in network for network in self.allowed_networks)
