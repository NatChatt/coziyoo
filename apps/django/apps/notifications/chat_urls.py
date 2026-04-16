from django.urls import path

from . import views

urlpatterns = [
    path("", views.ChatListView.as_view()),
    path("bootstrap", views.ChatBootstrapView.as_view()),
    path("<uuid:chat_id>/messages", views.ChatMessagesView.as_view()),
]
