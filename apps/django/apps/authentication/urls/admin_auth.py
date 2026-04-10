from django.urls import path

from apps.authentication import admin_api_views


urlpatterns = [
    path("login", admin_api_views.AdminLoginView.as_view(), name="admin-auth-login"),
    path("refresh", admin_api_views.AdminRefreshView.as_view(), name="admin-auth-refresh"),
    path("me", admin_api_views.AdminMeView.as_view(), name="admin-auth-me"),
]
