from django.urls import path
from . import views

urlpatterns = [
    path("", views.OrderListCreateView.as_view()),
    path("<uuid:order_id>", views.OrderDetailView.as_view()),
    path("<uuid:order_id>/buyer-delivery-request", views.BuyerDeliveryRequestView.as_view()),
    path("<uuid:order_id>/seller-delivery-request-response", views.SellerDeliveryRequestResolveView.as_view()),
    path("<uuid:order_id>/status", views.OrderStatusView.as_view()),
    path("<uuid:order_id>/cancel", views.OrderCancelView.as_view()),
    path("<uuid:order_id>/review", views.OrderReviewView.as_view()),
    path("<uuid:order_id>/seller-decision", views.SellerDecisionView.as_view()),
    path("<uuid:order_id>/buyer-confirm-terms", views.BuyerConfirmTermsView.as_view()),
    path("<uuid:order_id>/notes", views.OrderNotesView.as_view()),
    path("<uuid:order_id>/delivery-proof", views.DeliveryProofView.as_view()),
    path("<uuid:order_id>/verify-delivery-pin", views.VerifyDeliveryPinView.as_view()),
]
