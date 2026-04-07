from django.urls import path
from . import views

urlpatterns = [
    path("queue", views.AdminComplianceQueueView.as_view()),
    path("document-list", views.AdminDocumentListView.as_view()),
    path("document-list/<uuid:document_id>", views.AdminDocumentDetailView.as_view()),
    path("<uuid:seller_id>/documents/presign-upload", views.AdminPresignUploadView.as_view()),
    path("<uuid:seller_id>/documents/<uuid:document_id>", views.AdminReviewDocumentView.as_view()),
    path("<uuid:seller_id>", views.AdminSellerComplianceView.as_view()),
]
