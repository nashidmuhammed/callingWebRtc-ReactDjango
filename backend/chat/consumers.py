import json
from channels.generic.websocket import AsyncWebsocketConsumer

class ChatConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.user_id = self.scope['url_route']['kwargs']['user_id']
        self.current_user = self.scope['user'].id if self.scope['user'].is_authenticated else None
        self.room_group_name = None

        if self.current_user is None:
            print("❌ WebSocket auth failed — closing connection")
            await self.close()
            return

        self.room_group_name = f"chat_{min(int(self.user_id), self.current_user)}_{max(int(self.user_id), self.current_user)}"
        print(f"✅ WebSocket connected: user {self.current_user} to room {self.room_group_name}")

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if self.room_group_name:
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        data = json.loads(text_data)
        print(f"📩 Received from frontend: {data}")
        # await self.send(text_data="👋 Pong from server")
        print(f"data.get('type')===>",data.get('type'))
        
        # Distinguish message or WebRTC signal
        if data.get('type') == 'chat':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message': data['message']
                }
            )
        elif data.get('type') == 'webrtc':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'webrtc_signal',
                    'signal': data['signal'],
                    'sender_id': self.current_user
                }
            )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat',
            'message': event['message']
        }))

    async def webrtc_signal(self, event):
        await self.send(text_data=json.dumps({
            'type': 'webrtc',
            'signal': event['signal'],
            'sender_id': event['sender_id']
        }))