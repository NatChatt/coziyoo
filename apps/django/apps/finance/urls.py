from django.urls import path
from . import views

urlpatterns = [
    path("sellers/<uuid:seller_id>/summary", views.SellerFinanceSummaryView.as_view()),
]
