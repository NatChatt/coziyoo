from django.urls import path
from . import views

urlpatterns = [
    path("", views.PaymentInitView.as_view()),
    path("start", views.PaymentInitView.as_view()),
    path("mock-process", views.MockProcessView.as_view()),
    path("<uuid:order_id>/status", views.PaymentStatusView.as_view()),
]
