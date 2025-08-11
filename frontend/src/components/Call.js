import { useEffect, useRef, useState } from 'react';

/**
 * Props:
 *  - receiverId: id of the remote peer (number or string)
 *  - closeCall: function to close the call UI
 *  - ws: shared WebSocket instance (from Chat)
 *  - setSignalHandler: function to register a callback for incoming webrtc signals
 *  - isInitiator: boolean, whether this side should create an offer
 *  - myId: numeric local user id
 *  - callType: 'audio' or 'video'
 */
const Call = ({ receiverId, closeCall, ws, setSignalHandler, isInitiator, myId, callType }) => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const candidateQueueRef = useRef([]); // buffer ICEs that arrive early
  const timeoutRef = useRef(null);

  const [incomingOffer, setIncomingOffer] = useState(null);
  const [isStarted, setIsStarted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasReceivedAnswer, setHasReceivedAnswer] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const timerRef = useRef(null);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  };

  // auto-answer for callee when offer is received
  useEffect(() => {
    if (incomingOffer && !isInitiator) {
      answerCall();
    }
  }, [incomingOffer]);

  // register a handler so Chat forwards webrtc messages into this component
  useEffect(() => {
    if (!setSignalHandler) {
      console.error('Call requires setSignalHandler prop from Chat');
      return;
    }

    const handler = async (data) => {
      if (!data || data.type !== 'webrtc') return;
      const sender = data.sender_id;
      const signal = data.signal || {};

      // ignore signals not meant for us
      if (data.receiver_id && parseInt(data.receiver_id, 10) !== myId) return;

      // OFFER
      if (signal.type === 'offer') {
        console.log('Call: incoming offer received');
        setIncomingOffer(signal);
        return;
      }

      // ANSWER
      if (signal.type === 'answer') {
        console.log('Call: answer received');
        setHasReceivedAnswer(true);
        try {
          if (pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(signal));
          } else {
            console.warn('Call: pc not ready when answer arrived');
          }
        } catch (err) {
          console.error('Error setting remote description (answer):', err);
        }
        return;
      }

      // ICE Candidate
      if (signal.candidate) {
        const candidate = signal.candidate;
        if (!pcRef.current) {
          candidateQueueRef.current.push(candidate);
          console.log('Queued ICE candidate (pc not ready yet).');
          return;
        }
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(e => console.warn('addIceCandidate failed (ignored):', e));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
        return;
      }

      // call-accepted
      if (signal.type === 'call-accepted') {
        console.log('Call: call-accepted received');
        if (isInitiator && timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            if (!hasReceivedAnswer) {
              alert('Call timed out - no media response');
              cleanupAndClose();
            }
          }, 60000); // longer timeout for media
        }
        return;
      }
      

      // Other control messages
      if (signal.type === 'call-rejected') {
        alert('📵 Call was rejected by remote user.');
        cleanupAndClose();
        return;
      }
      if (signal.type === 'call-ended') {
        alert('Call ended by remote user');
        cleanupAndClose();
        return;
      }
      if (signal.type === 'call-busy') {
        alert('User is busy on another call.');
        cleanupAndClose();
        return;
      }
    };

    setSignalHandler(handler);

    return () => {
      setSignalHandler(() => null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSignalHandler, myId]);

  // create RTCPeerConnection and wire events
  const createPeerAndAttachStream = (localStream) => {
    pcRef.current = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach((t) => pcRef.current.addTrack(t, localStream));

    pcRef.current.ontrack = (evt) => {
      const [remoteStream] = evt.streams;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    };

    pcRef.current.onicecandidate = (event) => {
      if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'webrtc',
          sender_id: myId,
          receiver_id: parseInt(receiverId, 10),
          signal: { candidate: event.candidate }
        }));
      }
    };

    pcRef.current.oniceconnectionstatechange = () => {
      const state = pcRef.current.iceConnectionState;
      console.log('ICE state:', state);
      if (state === 'connected') {
        setIsConnected(true);
        timerRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        cleanupAndClose();
      }
    };

    // flush queued ICE
    if (candidateQueueRef.current.length > 0) {
      candidateQueueRef.current.forEach(async (cand) => {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Failed to add queued ICE:', e);
        }
      });
      candidateQueueRef.current = [];
    }
  };

  const ensureLocalStream = async () => {
    if (isStarted && localStreamRef.current) return localStreamRef.current;
    try {
      setIsConnecting(true);
      const videoOpts = callType === 'video' ? { width: 1280, height: 720 } : false;
      const opts = { video: videoOpts, audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(opts);
      localStreamRef.current = stream;
      if (localVideoRef.current && callType === 'video') localVideoRef.current.srcObject = stream;
      createPeerAndAttachStream(stream);
      setIsStarted(true);
      setIsConnecting(false);
      return stream;
    } catch (err) {
      setIsConnecting(false);
      console.error('Could not get user media:', err);
      throw err;
    }
  };

  // Caller flow
  const startCall = async () => {
    try {
      await ensureLocalStream();
      if (!pcRef.current) throw new Error('Peer connection not created');

      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'webrtc',
          sender_id: myId,
          receiver_id: parseInt(receiverId, 10),
          signal: { ...offer, callType }
        }));
      } else {
        console.warn('WebSocket not open; cannot send offer');
      }

      // Timeout if no answer
      timeoutRef.current = setTimeout(() => {
        if (!hasReceivedAnswer) {
          alert('Call timed out - no answer');
          cleanupAndClose();
        }
      }, 30000);
    } catch (err) {
      console.error('startCall error:', err);
    }
  };

  // Callee: answer
  const answerCall = async () => {
    if (!incomingOffer) {
      console.warn('No incoming offer to answer');
      return;
    }
    try {
      await ensureLocalStream();
      if (!pcRef.current) throw new Error('Peer connection not created after getUserMedia');

      await pcRef.current.setRemoteDescription(new RTCSessionDescription(incomingOffer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'webrtc',
          sender_id: myId,
          receiver_id: parseInt(receiverId, 10),
          signal: answer
        }));
      }
      setIncomingOffer(null);
    } catch (err) {
      console.error('answerCall error:', err);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current && callType === 'video') {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  const endCall = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'webrtc',
        sender_id: myId,
        receiver_id: parseInt(receiverId, 10),
        signal: { type: 'call-ended' }
      }));
    }
    cleanupAndClose();
  };

  const cleanupAndClose = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try { localStreamRef.current?.getTracks()?.forEach((t) => t.stop()); } catch (e) {}
    try { pcRef.current?.close(); } catch (e) {}
    localStreamRef.current = null;
    pcRef.current = null;
    setIsStarted(false);
    setIncomingOffer(null);
    setIsConnected(false);
    closeCall(isConnected ? duration : 0);
  };

  // auto-start if caller
  useEffect(() => {
    if (isInitiator) {
      const t = setTimeout(() => startCall(), 300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitiator]);

  // Format duration
  const formatDuration = (secs) => {
    const mins = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white p-4 rounded shadow-lg w-[700px] max-w-full">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col items-center">
            <h4 className="mb-2">You</h4>
            {callType === 'video' ? (
              <video ref={localVideoRef} autoPlay muted playsInline className="bg-black w-full h-56 object-cover" />
            ) : (
              <div className="bg-black w-full h-56 flex items-center justify-center text-white">Audio Only</div>
            )}
          </div>
          <div className="flex flex-col items-center">
            <h4 className="mb-2">Remote</h4>
            <video ref={remoteVideoRef} autoPlay playsInline className="bg-black w-full h-56 object-cover" />
          </div>
        </div>

        <div className="flex justify-between mt-4">
          <div className="flex gap-2">
            <button onClick={toggleMute} className="bg-gray-500 text-white px-4 py-2 rounded">
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            {callType === 'video' && (
              <button onClick={toggleCamera} className="bg-gray-500 text-white px-4 py-2 rounded">
                {isCameraOn ? 'Camera Off' : 'Camera On'}
              </button>
            )}
            <button onClick={endCall} className="bg-red-600 text-white px-4 py-2 rounded">End</button>
          </div>

          <div className="text-sm text-gray-600 self-center">
            {isStarted ? (isConnected ? `Connected - ${formatDuration(duration)}` : 'Connecting...') : incomingOffer ? 'Incoming call' : isInitiator ? 'Calling...' : 'Idle'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Call;