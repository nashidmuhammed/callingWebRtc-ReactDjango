import socketio
import eventlet

sio = socketio.Server(cors_allowed_origins=['http://localhost:3000'])
app = socketio.WSGIApp(sio)

@sio.event
def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
def join(sid, data):
    sio.enter_room(sid, f"user_{data['user_id']}")

@sio.event
def chat_message(sid, data):
    sio.emit('message', data, room=f"user_{data['user_id']}")

@sio.event
def offer(sid, data):
    sio.emit('offer', {'offer': data['offer'], 'from': sid}, room=f"user_{data['to']}")

@sio.event
def answer(sid, data):
    sio.emit('answer', {'answer': data['answer'], 'from': sid}, room=f"user_{data['to']}")

@sio.event
def ice_candidate(sid, data):
    sio.emit('ice-candidate', {'candidate': data['candidate'], 'from': sid}, room=f"user_{data['to']}")

@sio.event
def call_ended(sid, data):
    sio.emit('call-ended', room=f"user_{data['to']}")

@sio.event
def disconnect(sid):
    print(f"Client disconnected: {sid}")

if __name__ == '__main__':
    eventlet.wsgi.server(eventlet.listen(('', 8001)), app)