from django.urls import path
from . import seller_views

urlpatterns = [
    path("profile", seller_views.SellerProfileView.as_view()),
    path("foods", seller_views.SellerFoodListView.as_view()),
    path("foods/<uuid:food_id>", seller_views.SellerFoodDetailView.as_view()),
    path("foods/<uuid:food_id>/status", seller_views.SellerFoodStatusView.as_view()),
    path("orders", seller_views.SellerOrdersView.as_view()),
    path("reviews", seller_views.SellerReviewsView.as_view()),
    path("categories", seller_views.SellerCategoriesView.as_view()),
    path("lots", seller_views.SellerLotListView.as_view()),
    path("lots/<uuid:lot_id>/adjust", seller_views.SellerLotAdjustView.as_view()),
    path("lots/<uuid:lot_id>/recall", seller_views.SellerLotRecallView.as_view()),
    path("addon-templates", seller_views.SellerAddonTemplatesView.as_view()),
]
