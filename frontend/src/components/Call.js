import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:8001');

const Call = ({ receiverId, closeCall }) => {
  const [peerConnection, setPeerConnection] = useState(null);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    setPeerConnection(pc);

    // Get local audio stream
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        localAudioRef.current.srcObject = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      })
      .catch((err) => console.error('Error accessing media devices:', err));

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, to: receiverId });
      }
    };

    // Handle remote stream
    pc.ontrack = (event) => {
      remoteAudioRef.current.srcObject = event.streams[0];
    };

    // WebSocket events
    socket.on('offer', async (data) => {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { answer, to: data.from });
    });

    socket.on('answer', async (data) => {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    });

    socket.on('ice-candidate', async (data) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    socket.on('call-ended', () => {
      closeCall();
    });

    // Initiate call
    const makeCall = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { offer, to: receiverId });
    };
    makeCall();

    return () => {
      pc.close();
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('call-ended');
    };
  }, [receiverId, closeCall]);

  const handleHangup = () => {
    socket.emit('call-ended', { to: receiverId });
    closeCall();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded shadow-md">
        <h2 className="text-2xl font-bold mb-4">Voice Call</h2>
        <audio ref={localAudioRef} autoPlay muted />
        <audio ref={remoteAudioRef} autoPlay />
        <button
          onClick={handleHangup}
          className="bg-red-500 text-white p-2 rounded mt-4"
        >
          Hang Up
        </button>
      </div>
    </div>
  );
};

export default Call;