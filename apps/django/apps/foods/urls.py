from django.urls import path
from . import views

urlpatterns = [
    path("", views.FoodListView.as_view()),
    path("top-sold", views.TopSoldFoodsView.as_view()),
    path("sellers", views.SellerListView.as_view()),
    path("sellers/<uuid:seller_id>/address", views.SellerAddressView.as_view()),
    path("sellers/<uuid:seller_id>/foods", views.SellerFoodsView.as_view()),
    path("sellers/<uuid:seller_id>/reviews", views.SellerReviewsView.as_view()),
    path("categories", views.CategoryListView.as_view()),
]
