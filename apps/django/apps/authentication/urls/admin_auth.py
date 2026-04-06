from django.urls import path
from apps.authentication import views

urlpatterns = [
    path("login", views.AdminLoginView.as_view(), name="admin-auth-login"),
    path("refresh", views.AdminRefreshView.as_view(), name="admin-auth-refresh"),
    path("logout", views.AdminLogoutView.as_view(), name="admin-auth-logout"),
    path("me", views.AdminMeView.as_view(), name="admin-auth-me"),
]
