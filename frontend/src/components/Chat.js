import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getMessages, sendMessage } from '../api';
import Call from './Call';

const Chat = () => {
  const { userId } = useParams(); // this is the "other" user's id (remote)
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [showCall, setShowCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(false);
  const [callerInfo, setCallerInfo] = useState(null); // { sender_id }
  const [isInitiator, setIsInitiator] = useState(false);
  const [callType, setCallType] = useState(null); // 'audio' or 'video'
  const [showCallInfo, setShowCallInfo] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [ringtoneUrl, setRingtoneUrl] = useState('https://soundbible.com/grab.php?id=535&type=mp3');

  const messagesEndRef = useRef(null);
  const ws = useRef(null);
  const handleWebRTCSignalRef = useRef(null);
  const signalQueueRef = useRef([]);
  const ringtoneRef = useRef(null);
  const ringtoneInputRef = useRef(null);

  // helper to get my id
  const myId = (() => {
    const v = localStorage.getItem('user_id');
    return v ? parseInt(v, 10) : null;
  })();

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const response = await getMessages(userId);
        setMessages(response.data);
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      }
    };

    const attemptWebSocketConnection = () => {
      const token = localStorage.getItem('access_token');
      // adjust ws URL if needed (wss in prod)
      ws.current = new WebSocket(`ws://localhost:8000/ws/chat/${userId}/?token=${encodeURIComponent(token)}`);

      ws.current.onopen = () => {
        console.log('✅ WebSocket connected');
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📩 WS Received:', data);

          if (data.type === 'chat') {
            setMessages((prev) => [...prev, data.message]);
          }

          if (data.type === 'webrtc') {
            const sender = data.sender_id;
            const signal = data.signal || {};

            if (signal.type === 'offer' && sender !== myId) {
              // Check if already in a call
              if (showCall) {
                // Send busy signal
                if (ws.current?.readyState === WebSocket.OPEN) {
                  ws.current.send(JSON.stringify({
                    type: 'webrtc',
                    sender_id: myId,
                    receiver_id: sender,
                    signal: { type: 'call-busy' }
                  }));
                }
                return;
              }

              // show incoming popup and store who is calling
              setIncomingCall(true);
              setCallerInfo({ sender_id: sender });
              setIsInitiator(false); // Receiver role
              setCallType(signal.callType || 'video'); // default to video if not specified
            }

            // queue or forward to Call component
            if (handleWebRTCSignalRef.current) {
              handleWebRTCSignalRef.current(data);
            } else {
              signalQueueRef.current.push(data);
            }
          }
        } catch (err) {
          console.error('Failed parse WS message', err);
        }
      };

      ws.current.onerror = (err) => {
        console.error('WebSocket error', err);
      };

      ws.current.onclose = (ev) => {
        console.log('❌ WebSocket disconnected', ev.code, ev.reason);
      };
    };

    fetchMessages();
    attemptWebSocketConnection();

    return () => {
      try {
        ws.current?.close();
      } catch (e) {}
      handleWebRTCSignalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]); // re-open ws when chatting with another user

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Ringtone for incoming call
  useEffect(() => {
    if (incomingCall) {
      // play ringtone
      ringtoneRef.current = new Audio(ringtoneUrl);
      ringtoneRef.current.loop = true;
      ringtoneRef.current.play().catch(e => console.error('Ringtone play error:', e));

      // Auto-timeout for incoming call
      const timeoutId = setTimeout(() => {
        rejectCall();
        alert('Call timed out');
      }, 30000);

      return () => {
        clearTimeout(timeoutId);
        if (ringtoneRef.current) {
          ringtoneRef.current.pause();
          ringtoneRef.current = null;
        }
      };
    }
  }, [incomingCall, ringtoneUrl]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      const response = await sendMessage(userId, message); // send via REST to persist
      const saved = response.data;

      // send through WS so other client receives instantly (also include metadata)
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'chat',
          sender_id: myId,
          receiver_id: parseInt(userId, 10),
          message: saved
        }));
      }
      // optimistically render
      setMessages((prev) => [...prev, saved]);
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  // Start call as caller
  const startCallAsCaller = (type) => {
    setCallType(type);
    setIsInitiator(true);
    setShowCall(true);
  };

  // Callee accepts incoming call
  const acceptCall = () => {
    setIncomingCall(false);
    // Send call-accepted signal before opening Call
    if (ws.current?.readyState === WebSocket.OPEN && callerInfo?.sender_id) {
      ws.current.send(JSON.stringify({
        type: 'webrtc',
        sender_id: myId,
        receiver_id: parseInt(callerInfo.sender_id, 10),
        signal: { type: 'call-accepted' }
      }));
    }
    setIsInitiator(false);
    setShowCall(true);
  };

  const rejectCall = () => {
    setIncomingCall(false);
    // notify caller
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'webrtc',
        sender_id: myId,
        receiver_id: callerInfo?.sender_id ? parseInt(callerInfo.sender_id, 10) : parseInt(userId, 10),
        signal: { type: 'call-rejected' }
      }));
    }
    setCallerInfo(null);
    setCallType(null);
  };

  // When closing Call component, cleanup state and unregister handler
  const closeCall = (duration = 0) => {
    console.log("Close CALL======>");
    
    setShowCall(false);
    setIsInitiator(false);
    setCallerInfo(null);
    setCallType(null);
    handleWebRTCSignalRef.current = null;
    signalQueueRef.current = []; // Clear signal queue
    if (duration > 0) {
      console.log('Setting call duration and showing call info:', duration);
      setCallDuration(duration);
      setShowCallInfo(true);
    }
  };

  // compute correct receiverId prop to pass to Call:
  // - if initiator (caller) -> remote is `userId` from URL
  // - if callee (accepted incoming) -> remote is the caller's id saved in callerInfo
  const callReceiverId = isInitiator ? userId : (callerInfo?.sender_id?.toString() ?? userId);

  // Format duration as mm:ss
  const formatDuration = (secs) => {
    const mins = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const selectRingtone = () => {
    ringtoneInputRef.current.click();
  };

  const handleRingtoneChange = (e) => {
    if (e.target.files[0]) {
      const fileUrl = URL.createObjectURL(e.target.files[0]);
      setRingtoneUrl(fileUrl);
    }
  };

  return (
    <div className="container mx-auto p-4 h-screen flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Chat</h2>
        <div className="flex gap-2">
          <button onClick={() => startCallAsCaller('audio')} className="bg-blue-500 text-white p-2 rounded">Audio Call</button>
          <button onClick={() => startCallAsCaller('video')} className="bg-green-500 text-white p-2 rounded">Video Call</button>
          <button onClick={selectRingtone} className="bg-purple-500 text-white p-2 rounded">Select Ringtone</button>
          <input
            type="file"
            accept="audio/*"
            ref={ringtoneInputRef}
            onChange={handleRingtoneChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mb-4 p-4 bg-gray-100 rounded">
        {messages.map((msg) => {
          const fromMe = msg?.sender?.id === myId;
          return (
            <div key={msg.id} className={`mb-2 ${fromMe ? 'text-right' : 'text-left'}`}>
              <span className="font-bold">{msg.sender.username}: </span>
              <span>{msg.content}</span>
            </div>
          );
        })}
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
        <button type="submit" className="bg-blue-500 text-white p-2 rounded-r">Send</button>
      </form>

      {/* Incoming call overlay */}
      {incomingCall && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg text-center">
            <h3 className="text-lg font-semibold">Incoming {callType.charAt(0).toUpperCase() + callType.slice(1)} Call</h3>
            <p className="my-2">User {callerInfo?.sender_id ?? 'Unknown'} is calling...</p>
            <div className="flex gap-4 justify-center mt-4">
              <button onClick={acceptCall} className="bg-green-500 text-white px-4 py-2 rounded">Accept</button>
              <button onClick={rejectCall} className="bg-red-500 text-white px-4 py-2 rounded">Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* Call modal */}
      {showCall && (
        <Call
          receiverId={callReceiverId}
          closeCall={closeCall}
          ws={ws.current}
          setSignalHandler={(fn) => {
            // register handler (Call will call setSignalHandler(handler) on mount)
            handleWebRTCSignalRef.current = fn;
            // flush any queued signals
            while (signalQueueRef.current.length > 0) {
              const queuedData = signalQueueRef.current.shift();
              fn(queuedData);
            }
          }}
          isInitiator={isInitiator}
          myId={myId}
          callType={callType}
        />
      )}

      {/* Call info modal */}
      {showCallInfo && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg text-center">
            <h3 className="text-lg font-semibold">Call Ended</h3>
            <p className="my-2">Duration: {formatDuration(callDuration)}</p>
            <button onClick={() => setShowCallInfo(false)} className="bg-blue-500 text-white px-4 py-2 rounded">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;