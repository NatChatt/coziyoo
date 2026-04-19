from django.conf import settings
from django.urls import path
from . import views

urlpatterns = [
    path("", views.PaymentInitView.as_view()),
    path("start", views.PaymentInitView.as_view()),
    path("<uuid:order_id>/status", views.PaymentStatusView.as_view()),
]

if settings.DEBUG:
    urlpatterns += [
        path("mock-process", views.MockProcessView.as_view()),
    ]
