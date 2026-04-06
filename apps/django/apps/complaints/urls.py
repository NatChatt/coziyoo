from django.urls import path
from . import views

urlpatterns = [
    path("", views.ComplaintListCreateView.as_view()),
    path("<uuid:complaint_id>", views.ComplaintDetailView.as_view()),
    path("<uuid:complaint_id>/messages", views.ComplaintMessagesView.as_view()),
]
