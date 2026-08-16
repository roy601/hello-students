// ============================================================
//  OUR OWN VIDEO CALL  (WebRTC, peer to peer)
//
//  No video company is used here. The two browsers send video
//  straight to each other. There is no media server at all.
//
//  But two browsers cannot find each other on their own, so
//  they need a place to swap a few small text messages first.
//  That is called SIGNALLING, and we use Supabase Realtime
//  for it. Nothing else is needed.
//
//  The three messages that get swapped:
//    1. OFFER   "here is the video I can send, can you match?"
//    2. ANSWER  "yes, and here is mine"
//    3. ICE     "here are the network addresses to try"
//
//  After that the video flows directly between the browsers.
//
//  LIMIT: every person sends their video to every other
//  person, so this works well for 2 to 4 people. For a whole
//  batch use the Jitsi mode instead, which has a real media
//  server behind it.
// ============================================================

import { supabase } from './supabase.js';

// A STUN server just tells a browser its own public address.
// It never sees or carries any video. Google's is free.
const ICE_SERVERS = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302',
                        'stun:stun1.l.google.com:19302'] }],
};

export function createCall({ batchId, myId, myName, grid, onStatus, onCount }) {
  let channel = null;
  let localStream = null;
  const peers = new Map();      // other person's id -> { pc, name }

  // ---- Start: turn the camera on and say hello -------------
  async function start() {
    onStatus('Asking for camera...');

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      });
    } catch (err) {
      onStatus('Camera or microphone blocked');
      throw new Error(
        'Please allow the camera and microphone, then press Join again.'
      );
    }

    addTile('me', myName + ' (you)', localStream, true);
    onStatus('Connecting...');

    // Everyone in this batch joins the same signalling channel.
    channel = supabase.channel('call-' + batchId, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'signal' }, ({ payload }) =>
      handleMessage(payload)
    );

    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        onStatus('Waiting for others');
        // Tell everyone already in the room that I am here.
        send({ kind: 'hello', from: myId, name: myName });
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        onStatus('Connection problem');
      }
    });
  }

  // ---- Stop: hang up and clean everything up ---------------
  function stop() {
    if (channel) {
      send({ kind: 'bye', from: myId });
      supabase.removeChannel(channel);
      channel = null;
    }
    peers.forEach((peer) => peer.pc.close());
    peers.clear();

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    grid.innerHTML = '';
    onCount(0);
  }

  // ---- Send one small text message to everyone -------------
  function send(message) {
    if (channel) {
      channel.send({ type: 'broadcast', event: 'signal', payload: message });
    }
  }

  // ---- A message arrived from someone else -----------------
  async function handleMessage(msg) {
    // Some messages are addressed to one person only.
    if (msg.to && msg.to !== myId) return;
    if (msg.from === myId) return;

    if (msg.kind === 'hello') {
      if (peers.has(msg.from)) return;      // already know them

      // Tell them I am here too, so they know about me.
      send({ kind: 'hello', from: myId, name: myName, to: msg.from });

      // Both of us must not call at the same time, so we agree
      // a simple rule: whoever has the smaller id makes the call.
      if (myId < msg.from) {
        await makeOffer(msg.from, msg.name);
      } else {
        getPeer(msg.from, msg.name);        // just get ready
      }
      return;
    }

    if (msg.kind === 'offer') {
      const peer = getPeer(msg.from, msg.name);
      await peer.pc.setRemoteDescription(msg.sdp);

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);

      send({
        kind: 'answer',
        from: myId,
        to: msg.from,
        name: myName,
        sdp: { type: answer.type, sdp: answer.sdp },
      });
      return;
    }

    if (msg.kind === 'answer') {
      const peer = peers.get(msg.from);
      if (peer) await peer.pc.setRemoteDescription(msg.sdp);
      return;
    }

    if (msg.kind === 'ice') {
      const peer = peers.get(msg.from);
      if (peer && msg.candidate) {
        // A late or repeated address is normal, so ignore errors.
        await peer.pc.addIceCandidate(msg.candidate).catch(() => {});
      }
      return;
    }

    if (msg.kind === 'bye') {
      removePeer(msg.from);
    }
  }

  // ---- One connection to one other person ------------------
  function getPeer(otherId, otherName) {
    if (peers.has(otherId)) return peers.get(otherId);

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Put my camera and microphone into the connection.
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    // Every network address my browser finds gets sent across.
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        send({
          kind: 'ice',
          from: myId,
          to: otherId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Their video arrived. Show it.
    pc.ontrack = (event) => {
      addTile(otherId, otherName || 'Student', event.streams[0], false);
      onStatus('Connected');
      onCount(peers.size);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        removePeer(otherId);
      }
    };

    const peer = { pc, name: otherName };
    peers.set(otherId, peer);
    onCount(peers.size);
    return peer;
  }

  // ---- Start a call to one person --------------------------
  async function makeOffer(otherId, otherName) {
    const peer = getPeer(otherId, otherName);

    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);

    send({
      kind: 'offer',
      from: myId,
      to: otherId,
      name: myName,
      sdp: { type: offer.type, sdp: offer.sdp },
    });
  }

  function removePeer(otherId) {
    const peer = peers.get(otherId);
    if (!peer) return;

    peer.pc.close();
    peers.delete(otherId);

    const tile = document.getElementById('tile-' + otherId);
    if (tile) tile.remove();

    onCount(peers.size);
    if (peers.size === 0) onStatus('Waiting for others');
  }

  // ---- One video box on the screen -------------------------
  function addTile(id, label, stream, isMe) {
    let tile = document.getElementById('tile-' + id);

    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = 'tile-' + id;
      tile.innerHTML = `
        <video autoplay playsinline ${isMe ? 'muted' : ''}></video>
        <span class="tile-name"></span>`;
      grid.appendChild(tile);
    }

    tile.querySelector('.tile-name').textContent = label;

    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
  }

  // ---- Buttons ---------------------------------------------
  function toggleMic() {
    if (!localStream) return false;
    const track = localStream.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return track.enabled;
  }

  function toggleCamera() {
    if (!localStream) return false;
    const track = localStream.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return track.enabled;
  }

  return { start, stop, toggleMic, toggleCamera };
}
