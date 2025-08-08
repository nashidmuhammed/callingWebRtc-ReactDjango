import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const login = (credentials) => api.post('/auth/jwt/create/', credentials);
export const signup = (data) => api.post('/auth/users/', data);
export const getUsers = () => api.get('/api/users/');
export const getMessages = (receiverId) => api.get(`/api/messages/${receiverId}/`);
export const sendMessage = (receiverId, content) => api.post(`/api/messages/${receiverId}/`, { content });