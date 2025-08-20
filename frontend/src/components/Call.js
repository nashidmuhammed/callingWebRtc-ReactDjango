import { useEffect, useRef, useState } from 'react';
import {
  MicrophoneIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneXMarkIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  ArrowsUpDownIcon,
} from '@heroicons/react/24/solid';

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
  const candidateQueueRef = useRef([]);
  const timeoutRef = useRef(null);
  const timerRef = useRef(null);

  const [incomingOffer, setIncomingOffer] = useState(null);
  const [isStarted, setIsStarted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasReceivedAnswer, setHasReceivedAnswer] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isFrontCamera, setIsFrontCamera] = useState(true);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  };

  useEffect(() => {
    if (incomingOffer && !isInitiator) {
      answerCall();
    }
  }, [incomingOffer]);

  useEffect(() => {
    if (!setSignalHandler) {
      console.error('Call requires setSignalHandler prop from Chat');
      return;
    }

    const handler = async (data) => {
      if (!data || data.type !== 'webrtc') return;
      const sender = data.sender_id;
      const signal = data.signal || {};
      console.log('Received signal:', { type: signal.type, sender, receiverId: data.receiver_id, pcState: pcRef.current?.signalingState });

      if (data.receiver_id === undefined) {
        console.warn('Received signal with undefined receiver_id:', signal);
        if (parseInt(sender, 10) !== parseInt(receiverId, 10)) {
          console.warn('Sender ID does not match expected receiverId; discarding signal');
          return;
        }
      } else if (parseInt(data.receiver_id, 10) !== myId) {
        console.log('Signal not intended for this peer; discarding');
        return;
      }

      if (signal.type === 'offer') {
        console.log('Call: incoming offer received');
        setIncomingOffer(signal);
        return;
      }

      if (signal.type === 'answer') {
        console.log('Call: answer received');
        setHasReceivedAnswer(true);
        try {
          if (!pcRef.current) {
            console.warn('Call: pc not ready when answer arrived; creating new connection');
            await ensureLocalStream();
          }
          if (pcRef.current) {
            console.log('Setting remote description for answer');
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(signal));
            console.log('Remote description set successfully');
            await processQueuedCandidates();
          } else {
            console.error('Failed to create peer connection before processing answer');
            alert('Failed to process call answer. Please try again.');
            cleanupAndClose();
          }
        } catch (err) {
          console.error('Error setting remote description (answer):', err);
          alert('Failed to process call answer. Please try again.');
          cleanupAndClose();
        }
        return;
      }

      if (signal.candidate) {
        const candidate = signal.candidate;
        if (!candidate.candidate || !candidate.sdpMid || candidate.sdpMLineIndex == null) {
          console.warn('Invalid ICE candidate received:', candidate);
          return;
        }
        if (!pcRef.current) {
          candidateQueueRef.current.push(candidate);
          console.log('Queued ICE candidate (pc not ready yet).');
          return;
        }
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch((e) =>
            console.warn('addIceCandidate failed (ignored):', e)
          );
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
        return;
      }

      if (signal.type === 'call-accepted') {
        console.log('Call: call-accepted received');
        if (isInitiator) {
          if (!pcRef.current) {
            console.warn('No peer connection; initializing');
            await ensureLocalStream();
          }
          setIsStarted(true);
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
              if (!hasReceivedAnswer && !isConnected) {
                alert('Call timed out - no media response');
                cleanupAndClose();
              }
            }, 60000);
          }
        }
        return;
      }

      if (signal.type === 'call-rejected') {
        alert('📵 Call was rejected by remote user.');
        cleanupAndClose();
        return;
      }
      if (signal.type === 'call-ended') {
        console.log('Ending call with duration:', duration);
        alert('Call ended by remote user');
        cleanupAndClose(signal.duration || 0);
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
      candidateQueueRef.current = [];
    };
  }, [setSignalHandler, myId, receiverId, isInitiator, hasReceivedAnswer, isConnected]);

  const createPeerAndAttachStream = (localStream) => {
    if (pcRef.current) {
      console.warn('Existing peer connection found; closing it before creating new one');
      pcRef.current.close(); // Fixed: Added semicolon
    }
    console.log('Creating new RTCPeerConnection');
    pcRef.current = new RTCPeerConnection(rtcConfig);

    console.log('Attaching local stream tracks');
    localStream.getTracks().forEach((t) => pcRef.current.addTrack(t, localStream));

    pcRef.current.ontrack = (evt) => {
      const [remoteStream] = evt.streams;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    };

    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ candidate: event.candidate });
      }
    };

    pcRef.current.oniceconnectionstatechange = () => {
      const state = pcRef.current.iceConnectionState;
      console.log('ICE state:', state, 'isInitiator:', isInitiator, 'isConnected:', isConnected, 'duration:', duration);
      if (state === 'connected') {
        setIsConnected(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        if (!timerRef.current) {
          console.log('Starting duration timer');
          timerRef.current = setInterval(() => {
            setDuration((prev) => prev + 1);
          }, 1000);
        }
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        console.log('ICE state indicates call end:', state);
        if (isInitiator) {
          endCall();
        } else {
          console.log('Callee waiting for call-ended signal');
        }
      }
    };
  };

  const processQueuedCandidates = async () => {
    if (candidateQueueRef.current.length > 0 && pcRef.current) {
      const validStates = ['stable', 'have-remote-offer', 'have-local-offer'];
      if (!validStates.includes(pcRef.current.signalingState)) {
        console.warn('Cannot process ICE candidates; invalid signaling state:', pcRef.current.signalingState);
        return;
      }
      console.log('Processing queued ICE candidates');
      for (const cand of candidateQueueRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
          console.log('Added queued ICE candidate:', cand);
        } catch (e) {
          console.warn('Failed to add queued ICE candidate:', e);
        }
      }
      candidateQueueRef.current = [];
    }
  };

  const ensureLocalStream = async () => {
    if (localStreamRef.current && isStarted) {
      console.log('Reusing existing local stream');
      return localStreamRef.current;
    }
    try {
      setIsConnecting(true);
      const videoOpts = callType === 'video' ? { width: 1280, height: 720, facingMode: isFrontCamera ? 'user' : 'environment' } : false;
      const opts = { video: videoOpts, audio: true };
      console.log('Requesting media devices with opts:', opts);
      const stream = await navigator.mediaDevices.getUserMedia(opts).catch((err) => {
        throw new Error(`Failed to access media devices: ${err.message}`);
      });
      localStreamRef.current = stream;
      console.log('Local stream acquired:', stream);
      if (localVideoRef.current && callType === 'video') localVideoRef.current.srcObject = stream;

      if (pcRef.current) {
        console.warn('Existing peer connection found; closing it');
        pcRef.current.close();
        pcRef.current = null;
      }
      createPeerAndAttachStream(stream);
      setIsStarted(true);
      setIsConnecting(false);
      console.log('Peer connection created and stream attached');
      return stream;
    } catch (err) {
      setIsConnecting(false);
      console.error('Could not get user media:', err);
      alert(`Media access error: ${err.message}. Please check camera/microphone permissions.`);
      cleanupAndClose();
      throw err;
    }
  };

  const sendSignal = (signal) => {
    if (!receiverId || isNaN(parseInt(receiverId, 10))) {
      console.error('Invalid receiverId:', receiverId);
      alert('Cannot send signal: Invalid receiver ID.');
      cleanupAndClose();
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'webrtc',
        sender_id: parseInt(myId, 10),
        receiver_id: parseInt(receiverId, 10),
        signal,
      };
      console.log('Sending signal:', signal, 'to receiver_id:', receiverId, 'full message:', message);
      ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not open; cannot send signal:', signal);
      alert('Connection error: Unable to send signal. Please try again.');
      cleanupAndClose();
    }
  };

  const startCall = async () => {
    console.log('Starting call with state:', {
      isStarted,
      hasPeerConnection: !!pcRef.current,
      hasLocalStream: !!localStreamRef.current,
      receiverId,
      isInitiator,
    });
    try {
      await ensureLocalStream();
      if (!pcRef.current) {
        console.error('No peer connection after ensureLocalStream');
        alert('Failed to initialize call. Please try again.');
        cleanupAndClose();
        return;
      }
      console.log('Creating offer');
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      console.log('Sending offer signal');
      sendSignal({ ...offer, callType });
      setIsStarted(true);
      timeoutRef.current = setTimeout(() => {
        if (!hasReceivedAnswer) {
          alert('Call timed out - no answer');
          cleanupAndClose();
        }
      }, 30000);
    } catch (err) {
      console.error('startCall error:', err);
      alert('Failed to start call. Please try again.');
      cleanupAndClose();
    }
  };

  const answerCall = async () => {
    if (!incomingOffer) {
      console.warn('No incoming offer to answer');
      return;
    }
    try {
      await ensureLocalStream();
      if (!pcRef.current) {
        console.warn('No peer connection; creating new one');
        await ensureLocalStream();
      }
      console.log('Setting remote description for offer');
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(incomingOffer));
      console.log('Remote description set successfully');
      await processQueuedCandidates();
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      sendSignal(answer);
      setIncomingOffer(null);
    } catch (err) {
      console.error('answerCall error:', err);
      alert('Failed to answer call. Please try again.');
      cleanupAndClose();
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

  const toggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
    // Note: Speaker toggle is not natively supported in WebRTC; this is a placeholder
  };

  const switchCamera = async () => {
    if (localStreamRef.current && callType === 'video') {
      try {
        setIsConnecting(true);
        localStreamRef.current.getVideoTracks().forEach((track) => track.stop());
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: isFrontCamera ? 'environment' : 'user' },
          audio: true,
        });
        localStreamRef.current = newStream;
        if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
        const videoTrack = newStream.getVideoTracks()[0];
        const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
        setIsFrontCamera(!isFrontCamera);
        setIsCameraOn(true);
        setIsConnecting(false);
      } catch (err) {
        console.error('Failed to switch camera:', err);
        alert('Failed to switch camera. Please check permissions.');
        setIsConnecting(false);
      }
    }
  };

  const endCall = () => {
    console.log('Ending call with duration:', duration, 'isConnected:', isConnected);
    sendSignal({ type: 'call-ended', duration: isConnected ? duration : 0 });
    cleanupAndClose();
  };

  const cleanupAndClose = (remoteDuration = 0) => {
    console.log('Cleaning up call resources with local duration:', duration, 'remote duration:', remoteDuration, 'isConnected:', isConnected);
    if (timerRef.current) {
      console.log('Clearing duration timer');
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current) {
      console.log('Clearing timeout');
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    try {
      if (localStreamRef.current) {
        console.log('Stopping local stream tracks');
        localStreamRef.current.getTracks().forEach((t) => {
          t.stop();
          console.log('Stopped track:', t.kind);
        });
      }
    } catch (e) {
      console.warn('Error stopping media tracks:', e);
    }

    try {
      if (pcRef.current) {
        console.log('Closing RTCPeerConnection');
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.close();
      }
    } catch (e) {
      console.warn('Error closing peer connection:', e);
    }

    console.log('Resetting refs and state');
    localStreamRef.current = null;
    pcRef.current = null;
    candidateQueueRef.current = [];
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    const finalDuration = remoteDuration > 0 ? remoteDuration : (isConnected ? duration : 0);
    console.log('Calling closeCall with duration:', finalDuration);

    setIsStarted(false);
    setIsConnected(false);
    setIsConnecting(false);
    setIncomingOffer(null);
    setHasReceivedAnswer(false);
    setIsMuted(false);
    setIsCameraOn(true);
    setIsSpeakerOn(true);
    setIsFrontCamera(true);
    setDuration(0);

    closeCall(finalDuration);
  };

  useEffect(() => {
    if (isInitiator) {
      const t = setTimeout(() => startCall(), 300);
      return () => clearTimeout(t);
    }
  }, [isInitiator]);

  const formatDuration = (secs) => {
    const mins = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center z-50">
      {callType === 'video' ? (
        <>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={`absolute bottom-4 right-4 w-32 h-24 bg-black rounded-lg shadow-lg border-2 border-white ${
              isCameraOn ? '' : 'hidden'
            }`}
          />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full">
          <div className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center text-white text-2xl font-bold">
            {receiverId ? receiverId.charAt(0).toUpperCase() : '?'}
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-white">User {receiverId}</h2>
        </div>
      )}

      <div className="absolute top-4 left-4 text-white text-lg">
        {isConnecting ? (
          'Connecting...'
        ) : isConnected ? (
          <span>Connected - {formatDuration(duration)}</span>
        ) : isStarted ? (
          'Calling...'
        ) : incomingOffer ? (
          'Incoming call'
        ) : (
          'Idle'
        )}
      </div>

      <div className="absolute bottom-8 flex justify-center gap-6">
        <button
          onClick={toggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center ${
            isMuted ? 'bg-red-500' : 'bg-gray-700'
          } text-white shadow-lg hover:bg-gray-600 transition`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicrophoneIcon className="w-6 h-6" /> : <MicrophoneIcon className="w-6 h-6" />}
        </button>
        {callType === 'video' && (
          <>
            <button
              onClick={toggleCamera}
              className={`w-12 h-12 rounded-full flex items-center justify-center ${
                isCameraOn ? 'bg-gray-700' : 'bg-red-500'
              } text-white shadow-lg hover:bg-gray-600 transition`}
              title={isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
            >
              {isCameraOn ? <VideoCameraIcon className="w-6 h-6" /> : <VideoCameraSlashIcon className="w-6 h-6" />}
            </button>
            <button
              onClick={switchCamera}
              className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-white shadow-lg hover:bg-gray-600 transition"
              title="Switch Camera"
            >
              <ArrowsUpDownIcon className="w-6 h-6" />
            </button>
          </>
        )}
        <button
          onClick={toggleSpeaker}
          className={`w-12 h-12 rounded-full flex items-center justify-center ${
            isSpeakerOn ? 'bg-gray-700' : 'bg-red-500'
          } text-white shadow-lg hover:bg-gray-600 transition`}
          title={isSpeakerOn ? 'Turn Speaker Off' : 'Turn Speaker On'}
        >
          {isSpeakerOn ? <SpeakerWaveIcon className="w-6 h-6" /> : <SpeakerXMarkIcon className="w-6 h-6" />}
        </button>
        <button
          onClick={endCall}
          className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center text-white shadow-lg hover:bg-red-700 transition"
          title="End Call"
        >
          <PhoneXMarkIcon className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};

export default Call;