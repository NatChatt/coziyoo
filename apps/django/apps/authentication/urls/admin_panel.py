from django.urls import path
from apps.authentication import admin_views
from apps.authentication import metadata_views
from apps.finance.views import CommissionSettingsLatestView as CommissionLatestView
from apps.finance.views import CommissionSettingsCreateView as CommissionCreateView

urlpatterns = [
    path("system/version", metadata_views.AdminSystemVersionView.as_view()),
    path("metadata/entities", metadata_views.AdminMetadataEntitiesView.as_view()),
    path("metadata/tables/<str:table_key>/fields", metadata_views.AdminMetadataFieldsView.as_view()),
    path("metadata/tables/<str:table_key>/records", metadata_views.AdminMetadataRecordsView.as_view()),
    path("table-preferences/<str:table_key>", metadata_views.AdminTablePreferencesView.as_view()),
    path("dashboard/overview", admin_views.DashboardOverviewView.as_view()),
    path("dashboard/review-queue", admin_views.DashboardReviewQueueView.as_view()),
    path("users", admin_views.AdminUserListView.as_view()),
    path("users/<uuid:user_id>", admin_views.AdminUserDetailView.as_view()),
    path("investigations/complaints", admin_views.InvestigationComplaintListView.as_view()),
    path("investigations/complaints/<uuid:complaint_id>", admin_views.InvestigationComplaintDetailView.as_view()),
    path("investigations/complaint-categories", admin_views.ComplaintCategoryView.as_view()),
    path("audit/events", admin_views.AuditEventsView.as_view()),
    path("security/login-events", admin_views.SecurityLoginEventsView.as_view()),
    path("search/global", admin_views.GlobalSearchView.as_view()),
    path("sales-commission-settings/latest", CommissionLatestView.as_view()),
    path("sales-commission-settings", CommissionCreateView.as_view()),
    path("users/sellers/daily-sales", admin_views.SellersDailySalesView.as_view()),
    path("notifications/test", admin_views.NotificationTestView.as_view()),
]
