import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { getUsers } from '../api';
import { useCallContext } from '../context/CallContext';

const UserList = () => {
  const [users, setUsers] = useState([]);
  const [websockets, setWebsockets] = useState({});
  const navigate = useNavigate();
  const { setCallNotification } = useCallContext();
  const token = localStorage.getItem('access_token');

  useEffect(() => {
    // Fetch users
    const fetchUsers = async () => {
      try {
        const response = await getUsers();
        setUsers(response.data);
      } catch (error) {
        console.error('Failed to fetch users:', error);
      }
    };
    fetchUsers();

    // Get authenticated user ID
    const currentUserId = parseInt(localStorage.getItem('userId')); // Replace with your auth logic

    // Set up WebSocket connections for each user’s chat room
    const sockets = {};
    const setupWebSockets = async () => {
      try {
        const response = await getUsers();
        const users = response.data;
        users.forEach(user => {
          if (user.id !== currentUserId) {
            const roomName = `chat_${Math.min(currentUserId, user.id)}_${Math.max(currentUserId, user.id)}`;
            const socket = new WebSocket(
              `ws://localhost:8000/ws/chat/${user.id}/?token=${encodeURIComponent(token)}`
            );

            socket.onopen = () => {
              console.log(`WebSocket connected for room ${roomName}`);
            };

            socket.onmessage = (event) => {
              const data = JSON.parse(event.data);
              if (data.type === 'chat') {
                toast.info(`New message from ${user.username}: ${data.message}`, {
                  onClick: () => navigate(`/chat/${user.id}`),
                });
                if (Notification.permission === 'granted') {
                  new Notification(`New Message from ${user.username}`, {
                    body: data.message,
                    icon: '/path/to/icon.png',
                  });
                }
              } else if (data.type === 'webrtc' && data.sender_id !== currentUserId) {
                if (data.signal.type === 'offer') {
                  // Store incoming call details in context
                  setCallNotification(data.sender_id, data.signal.callType || 'video', data.signal);
                  toast.warn(`Incoming ${data.signal.callType || 'video'} call from ${user.username}`, {
                    onClick: () => navigate(`/chat/${data.sender_id}`),
                  });
                  if (Notification.permission === 'granted') {
                    new Notification(`Incoming Call from ${user.username}`, {
                      body: 'Click to join the call',
                      icon: '/path/to/icon.png',
                    });
                  }
                }
              }
            };

            socket.onclose = () => {
              console.log(`WebSocket closed for room ${roomName}`);
            };

            socket.onerror = (error) => {
              console.error(`WebSocket error for room ${roomName}:`, error);
              toast.error('WebSocket connection failed');
            };

            sockets[user.id] = socket;
          }
        });
        setWebsockets(sockets);
      } catch (error) {
        console.error('Failed to set up WebSockets:', error);
      }
    };

    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    setupWebSockets();

    return () => {
      Object.values(sockets).forEach(socket => {
        socket.close();
      });
    };
  }, [navigate, setCallNotification]);

  return (
    <div className="container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Users</h2>
      <ul className="space-y-2">
        {users.map(user => (
          <li
            key={user.id}
            className="p-4 bg-gray-100 rounded cursor-pointer hover:bg-gray-200"
            onClick={() => navigate(`/chat/${user.id}`)}
          >
            {user.username}
          </li>
        ))}
      </ul>
      <ToastContainer position="top-right" autoClose={5000} />
    </div>
  );
};

export default UserList;