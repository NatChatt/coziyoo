from django.urls import path
from apps.authentication import views

urlpatterns = [
    path("register", views.RegisterView.as_view(), name="auth-register"),
    path("login", views.LoginView.as_view(), name="auth-login"),
    path("refresh", views.RefreshView.as_view(), name="auth-refresh"),
    path("logout", views.LogoutView.as_view(), name="auth-logout"),
    path("me", views.MeView.as_view(), name="auth-me"),
    path("username/check", views.UsernameCheckView.as_view(), name="auth-username-check"),
    path("display-name/check", views.DisplayNameCheckView.as_view(), name="auth-displayname-check"),
    path("forgot-password/request", views.ForgotPasswordRequestView.as_view(), name="auth-forgot-password-request"),
    path("forgot-password/confirm", views.ForgotPasswordConfirmView.as_view(), name="auth-forgot-password-confirm"),
    path("me/enable-seller", views.EnableSellerView.as_view(), name="auth-enable-seller"),
    path("me/profile-image/upload", views.ProfileImageUploadView.as_view(), name="auth-profile-image-upload"),
    path("me/home-card-image/upload", views.HomeCardImageUploadView.as_view(), name="auth-home-card-image-upload"),
    path("me/addresses", views.UserAddressListView.as_view(), name="auth-addresses"),
    path("me/addresses/<uuid:address_id>", views.UserAddressDetailView.as_view(), name="auth-address-detail"),
]
