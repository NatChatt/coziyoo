from django.contrib import admin
from django.urls import path, include
from django.views.generic import RedirectView
from django.conf import settings
from django.conf.urls.static import static
from django.views.decorators.csrf import csrf_exempt
from apps.foods.views import FoodImageView, FavoriteListView, FavoriteToggleView
from apps.authentication.admin_home_hero import home_hero_view, hero_image_proxy_view
from coziyoo.admin_search import admin_global_search
from coziyoo.dashboard_views import dashboard_data

urlpatterns = [
    # Django Admin UI (django-unfold)
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/home-hero/", admin.site.admin_view(home_hero_view), name="admin_home_hero"),
    path("admin/home-hero/image/", admin.site.admin_view(hero_image_proxy_view), name="admin_home_hero_image"),
    path("admin/global-search/", admin_global_search, name="admin_global_search"),
    path("admin/dashboard/data/", admin.site.admin_view(dashboard_data), name="admin_dashboard_data"),
    path("admin/login/", csrf_exempt(admin.site.login), name="admin_login"),
    path("admin/", admin.site.urls),
    path("food-images/<uuid:food_id>", FoodImageView.as_view(), name="food-public-image"),
    path("i18n/", include("django.conf.urls.i18n")),

    # REST API v1
    path("v1/auth/", include("apps.authentication.urls.app")),
    path("v1/admin/auth/", include("apps.authentication.urls.admin_auth")),
    path("v1/admin/", include("apps.authentication.urls.admin_panel")),
    path("v1/orders/", include("apps.orders.urls")),
    path("v1/foods/", include("apps.foods.urls")),
    path("v1/favorites", FavoriteListView.as_view()),
    path("v1/favorites/<uuid:food_id>", FavoriteToggleView.as_view()),
    path("v1/seller/", include("apps.foods.urls_seller")),
    path("v1/payments/", include("apps.payments.urls")),
    path("v1/notifications/", include("apps.notifications.urls")),
    path("v1/chats/", include("apps.notifications.chat_urls")),
    path("v1/complaints/", include("apps.complaints.urls")),
    path("v1/tickets/", include("apps.complaints.urls_tickets")),
    path("v1/finance/", include("apps.finance.urls")),
    path("v1/seller/compliance/", include("apps.compliance.urls_seller")),

    # Health check
    path("v1/health/", include("coziyoo.health")),
    path("metrics/", include("django_prometheus.urls")),

    # Deploy webhook
    path("webhook/", include("coziyoo.webhook")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
