from django.urls import path
from . import views

urlpatterns = [
    path("profile", views.SellerComplianceProfileView.as_view()),
    path("submit", views.SellerComplianceSubmitView.as_view()),
    path("documents", views.SellerDocumentListView.as_view()),
    path("optional-uploads", views.SellerOptionalUploadsView.as_view()),
]
