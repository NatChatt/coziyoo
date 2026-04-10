from django.urls import path

from apps.authentication import admin_api_views


urlpatterns = [
    path("dashboard/overview", admin_api_views.AdminDashboardOverviewView.as_view(), name="admin-dashboard-overview"),
    path("dashboard/review-queue", admin_api_views.AdminDashboardReviewQueueView.as_view(), name="admin-dashboard-review-queue"),
    path("users", admin_api_views.AdminUsersListView.as_view(), name="admin-users-list"),
    path("users/<uuid:user_id>", admin_api_views.AdminUserDetailView.as_view(), name="admin-user-detail"),
    path("investigations/complaints", admin_api_views.AdminComplaintsListView.as_view(), name="admin-complaints-list"),
    path("investigations/complaints/<uuid:complaint_id>", admin_api_views.AdminComplaintDetailView.as_view(), name="admin-complaint-detail"),
    path("investigations/complaint-categories", admin_api_views.AdminComplaintCategoriesView.as_view(), name="admin-complaint-categories"),
    path("audit/events", admin_api_views.AdminAuditEventsView.as_view(), name="admin-audit-events"),
    path("security/login-events", admin_api_views.AdminSecurityLoginEventsView.as_view(), name="admin-security-login-events"),
    path("search/global", admin_api_views.AdminSearchGlobalView.as_view(), name="admin-search-global"),
    path("sales-commission-settings/latest", admin_api_views.AdminSalesCommissionLatestView.as_view(), name="admin-sales-commission-latest"),
    path("notifications/test", admin_api_views.AdminNotificationsTestView.as_view(), name="admin-notifications-test"),
    path("compliance/queue", admin_api_views.AdminComplianceQueueView.as_view(), name="admin-compliance-queue"),
    path("compliance/document-list", admin_api_views.AdminComplianceDocumentListView.as_view(), name="admin-compliance-document-list"),
]
