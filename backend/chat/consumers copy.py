import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import Message
from .serializers import MessageSerializer

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.other_user_id = self.scope['url_route']['kwargs']['user_id']
        print(f"User in scope: {self.scope['user']}")
        if self.scope["user"].is_anonymous:
            print("Unauthorized WebSocket connection")
            await self.close()
            return
        self.room_group_name = f'chat_{min(self.scope["user"].id, int(self.other_user_id))}_{max(self.scope["user"].id, int(self.other_user_id))}'
        print(f"Connecting to group: {self.room_group_name}")
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            print(f"Disconnecting from group: {self.room_group_name}")
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        else:
            print("Disconnecting: No room group defined (likely unauthorized)")

    async def receive(self, text_data):
        data = json.loads(text_data)
        print(f"Received data: {data}")
        message = data['message']
        sender_id = self.scope['user'].id
        receiver_id = int(self.other_user_id)

        # Save message to database
        msg = await self.save_message(sender_id, receiver_id, message)

        # Broadcast to group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': MessageSerializer(msg).data
            }
        )
        print(f"Sent message to group: {self.room_group_name}")

    async def chat_message(self, event):
        print(f"Broadcasting message: {event['message']}")
        await self.send(text_data=json.dumps({
            'message': event['message']
        }))

    @database_sync_to_async
    def save_message(self, sender_id, receiver_id, content):
        sender = User.objects.get(id=sender_id)
        receiver = User.objects.get(id=receiver_id)
        return Message.objects.create(sender=sender, receiver=receiver, content=content)