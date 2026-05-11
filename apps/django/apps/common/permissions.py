from rest_framework.permissions import IsAuthenticated


class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


class IsAdminRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "admin"
