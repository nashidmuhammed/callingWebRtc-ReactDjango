from django.urls import path
from . import views

urlpatterns = [
    path('users/', views.UserListView.as_view(), name='user-list'),
    path('messages/<int:receiver_id>/', views.MessageListView.as_view(), name='message-list'),
]