import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Login from './components/Login';
import Signup from './components/Signup';
import UserList from './components/UserList';
import Chat from './components/Chat';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/users" element={<UserList />} />
        <Route path="/chat/:userId" element={<Chat />} />
        <Route path="/" element={<Login />} />
      </Routes>
    </Router>
  );
}

export default App;