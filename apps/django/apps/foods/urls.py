from django.urls import path
from . import views

urlpatterns = [
    path("", views.FoodListView.as_view()),
    path("home-hero-image", views.mobile_home_hero_image_view, name="foods-home-hero-image"),
    path("recommendations", views.FoodRecommendationsView.as_view()),
    path("top-sold", views.TopSoldFoodsView.as_view()),
    path("sellers", views.SellerListView.as_view()),
    path("sellers/<uuid:seller_id>/address", views.SellerAddressView.as_view()),
    path("sellers/<uuid:seller_id>/foods", views.SellerFoodsView.as_view()),
    path("sellers/<uuid:seller_id>/reviews", views.SellerReviewsView.as_view()),
    path("categories", views.CategoryListView.as_view()),
]
