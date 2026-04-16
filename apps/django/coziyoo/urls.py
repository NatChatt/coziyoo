from django.contrib import admin
from django.urls import path, include
from django.views.generic import RedirectView
from django.conf import settings
from django.conf.urls.static import static
from coziyoo.admin_search import admin_global_search
from coziyoo.dashboard_views import dashboard_data

urlpatterns = [
    # Django Admin UI (django-unfold)
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/global-search/", admin_global_search, name="admin_global_search"),
    path("admin/dashboard/data/", admin.site.admin_view(dashboard_data), name="admin_dashboard_data"),
    path("admin/", admin.site.urls),
    path("i18n/", include("django.conf.urls.i18n")),

    # REST API v1
    path("v1/auth/", include("apps.authentication.urls.app")),
    path("v1/admin/auth/", include("apps.authentication.urls.admin_auth")),
    path("v1/admin/", include("apps.authentication.urls.admin_panel")),
    path("v1/orders/", include("apps.orders.urls")),
    path("v1/foods/", include("apps.foods.urls")),
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

    # Deploy webhook
    path("webhook/", include("coziyoo.webhook")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
