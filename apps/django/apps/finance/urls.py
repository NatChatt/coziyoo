from django.urls import path
from . import views

urlpatterns = [
    path("sellers/<uuid:seller_id>/summary", views.SellerFinanceSummaryView.as_view()),
    path("sellers/<uuid:seller_id>/balance", views.SellerFinanceBalanceView.as_view()),
    path("sellers/<uuid:seller_id>/payouts", views.SellerFinancePayoutsView.as_view()),
]
