import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
// import io from 'socket.io-client';
import { getMessages, sendMessage } from '../api';
import Call from './Call';

// const socket = io('http://localhost:8000'); // For WebRTC signaling

const Chat = () => {
  const { userId } = useParams();
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [showCall, setShowCall] = useState(false);
  const messagesEndRef = useRef(null);
  const ws = useRef(null);

  const attemptWebSocketConnection = async () => {
    let token = localStorage.getItem('access_token');
    if (!token) {
      console.error('JWT token not found in localStorage');
      return;
    }
    console.log('Using token for WebSocket:', token); // Debug
    ws.current = new WebSocket(`ws://localhost:8000/ws/chat/${userId}/?token=${encodeURIComponent(token)}`);

    ws.current.onopen = () => {
      // console.log('WebSocket connected:', roomName);
      console.log('WebSocket connected:');
    };

    // ws.current.onmessage = (event) => {
    //   const data = JSON.parse(event.data);
    //   console.log('Received WebSocket message:', data);
    //   setMessages((prev) => [...prev, data.message]);
    // };
    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.message) {
          setMessages((prev) => [...prev, data.message]);
        } else {
          console.warn("Unknown WebSocket payload:", data);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", event.data);
      }
    };

    ws.current.onerror = async (error) => {
      console.error('WebSocket error:', error);
      // try {
      //   const response = await refreshToken();
      //   localStorage.setItem('access_token', response.data.access);
      //   console.log('Token refreshed');
      //   ws.current.close();
      //   attemptWebSocketConnection();
      // } catch (err) {
      //   console.error('Failed to refresh token:', err);
      // }
    };

    ws.current.onclose = (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
    };
  };

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const response = await getMessages(userId);
        setMessages(response.data);
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      }
    };
    fetchMessages();

    // const userIdNum = parseInt(userId);
    const currentUserId = parseInt(localStorage.getItem('user_id')) || 0;
    if (!currentUserId) {
      console.error('User ID not found in localStorage');
      return;
    }
    // const roomName = `chat_${Math.min(currentUserId, userIdNum)}_${Math.max(currentUserId, userIdNum)}`;
    attemptWebSocketConnection();

    return () => {
      ws.current.close();
    };
  }, [userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // const handleSendMessage = async (e) => {
  //   e.preventDefault();
  //   if (message.trim()) {
  //     try {
  //       const response = await sendMessage(userId, message);
  //       // ws.current.send(JSON.stringify({ message: response.data }));
  //       ws.current.send(JSON.stringify({
  //           message: message,  // the string user typed
  //         }));
  //       console.log('Success to send message:');
  //       setMessage('');
  //     } catch (error) {
  //       console.error('Failed to send message:', error);
  //     }
  //   }
  // };
  const handleSendMessage = async (e) => {
  e.preventDefault();
  if (message.trim()) {
    try {
      const response = await sendMessage(userId, message);
      const savedMessage = response.data; // assuming backend returns saved message
      // setMessages((prev) => [...prev, savedMessage]); // show instantly
      // optionally still send over WS if your backend handles it
      // ws.current.send(JSON.stringify({ message: savedMessage.content }));
      ws.current.send(JSON.stringify({
        type: 'chat',
        message: {
          id: response.data.id,
          content: response.data.content,
          sender: response.data.sender
        }
      }));
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }
};

  return (
    <div className="container mx-auto p-4 h-screen flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Chat</h2>
        <button
          onClick={() => setShowCall(true)}
          className="bg-green-500 text-white p-2 rounded"
        >
          Call
        </button>
      </div>
      <div className="flex-1 overflow-y-auto mb-4 p-4 bg-gray-100 rounded">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mb-2 ${msg.sender.id === parseInt(userId) ? 'text-left' : 'text-right'}`}
          >
            <span className="font-bold">{msg.sender.username}: </span>
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSendMessage} className="flex">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1 p-2 border rounded-l"
          placeholder="Type a message..."
        />
        <button type="submit" className="bg-blue-500 text-white p-2 rounded-r">
          Send
        </button>
      </form>
      {showCall && <Call receiverId={userId} closeCall={() => setShowCall(false)} />}
    </div>
  );
};

export default Chat;