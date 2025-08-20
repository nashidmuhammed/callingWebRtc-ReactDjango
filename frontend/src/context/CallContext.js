// src/context/CallContext.js
import { createContext, useContext, useState } from 'react';

const CallContext = createContext();

export const CallProvider = ({ children }) => {
  const [incomingCall, setIncomingCall] = useState(null); // { sender_id, callType, signal }

  const setCallNotification = (sender_id, callType, signal) => {
    setIncomingCall({ sender_id, callType, signal });
  };

  const clearCallNotification = () => {
    setIncomingCall(null);
  };

  return (
    <CallContext.Provider value={{ incomingCall, setCallNotification, clearCallNotification }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCallContext = () => useContext(CallContext);