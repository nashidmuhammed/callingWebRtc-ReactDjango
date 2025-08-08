from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth.models import User
from .models import Message
from .serializers import UserSerializer, MessageSerializer
from django.db import models
from rest_framework_simplejwt.views import TokenObtainPairView

class UserListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        users = User.objects.exclude(id=request.user.id)
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)

class MessageListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, receiver_id):
        messages = Message.objects.filter(
            models.Q(sender=request.user, receiver_id=receiver_id) |
            models.Q(sender_id=receiver_id, receiver=request.user)
        )
        serializer = MessageSerializer(messages, many=True)
        return Response(serializer.data)

    def post(self, request, receiver_id):
        data = request.data.copy()
        data['sender_id'] = request.user.id
        data['receiver_id'] = receiver_id

        print("receiver_id===>",receiver_id)
        serializer = MessageSerializer(data=data)
        if serializer.is_valid():
            print("Valid")
            serializer.save()
            print("validi save")
            return Response(serializer.data, status=201)
        else:
            print("serializer.errors===>",serializer.errors)
        return Response(serializer.errors, status=400)
    

class CustomLoginView(APIView):
    def post(self, request):
        try:
            response = TokenObtainPairView.as_view()(request._request)
            if response.status_code == 200:
                data = response.data
                user = User.objects.get(username=request.data['username'])
                data['user_id'] = user.id
                return Response(data)
            return response
        except User.DoesNotExist:
            return Response({"error": "Invalid credentials"}, status=400)