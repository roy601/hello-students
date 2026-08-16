// ============================================================
//  BATCH CLASS ROOM
//
//  Left side  : the live class, in one of three modes
//                 jitsi  video in our page, whole batch
//                 p2p    our own WebRTC, browser to browser
//                 link   the tutor's own Zoom or Meet link
//  Right side : the class chat, live for everyone
//
//  Only people who belong to this batch can open this page.
//  The database checks that too (can_access_batch in
//  schema.sql), so editing this file does not let anyone in.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { renderTopbar, getMyProfile } from './session.js';
import { toast, showLoading } from './ui.js';
import { safe, initials, timeAgo, formatTime } from './format.js';
import { startJitsi, stopJitsi } from './jitsi.js';
import { createCall } from './webrtc.js';
import { attachWatermark, makeLabel } from './watermark.js';

const room = document.getElementById('room');
const batchId = Number(new URLSearchParams(window.location.search).get('id'));

let me = null;
let batch = null;
let isTutor = false;
let chatChannel = null;
let call = null;           // the WebRTC call, when that mode is on
let removeWatermark = null;   // takes the name off the video again

start();

async function start() {
  renderTopbar();
  showLoading(room, 2);

  me = await getMyProfile();
  if (!me) {
    window.location.href = 'login.html';
    return;
  }
  if (!batchId) {
    room.innerHTML = '<div class="alert alert-danger">No batch was chosen.</div>';
    return;
  }

  await loadBatch();
}

async function loadBatch() {
  const { data, error } = await supabase
    .from('batches')
    .select(`
      id, title, days, start_time, end_time, tutor_id,
      live_link, is_live, live_mode, room_code,
      subjects ( name_en, grade_level ),
      tutor_profiles ( profiles ( full_name ) )
    `)
    .eq('id', batchId)
    .maybeSingle();

  if (error || !data) {
    room.innerHTML = '<div class="alert alert-danger">Batch not found.</div>';
    return;
  }

  batch = data;
  isTutor = batch.tutor_id === me.id;

  // Are you allowed in this room?
  if (!isTutor && me.role !== 'admin') {
    const { data: joined } = await supabase
      .from('enrolments')
      .select('id')
      .eq('batch_id', batchId)
      .eq('student_id', me.id)
      .maybeSingle();

    if (!joined) {
      room.innerHTML = `
        <div class="empty">
          <div class="empty-ico">${icon('lock', 'ico-lg')}</div>
          <h3>This room is for students of this batch</h3>
          <p class="muted">Join the batch first, then you can come in.</p>
          <a class="btn mt" href="batch.html?id=${batchId}">See this batch</a>
        </div>`;
      return;
    }
  }

  drawPage();
  await loadMessages();
  listenForNewMessages();
}


// ============================================================
//  THE PAGE
// ============================================================
function drawPage() {
  const tutorName = batch.tutor_profiles?.profiles?.full_name || 'Tutor';

  room.innerHTML = `
    <p class="mb"><a href="batch.html?id=${batchId}">&#8592; Back to batch details</a></p>

    <div class="page-head reveal">
      <div>
        <h1>${safe(batch.title)}</h1>
        <p class="lead">
          ${safe(batch.subjects.name_en)} · ${safe(batch.days)} ·
          ${formatTime(batch.start_time)}–${formatTime(batch.end_time)} · with ${safe(tutorName)}
        </p>
      </div>
      <div id="live-badge"></div>
    </div>

    <div class="room-grid">
      <section class="card" id="class-card"></section>

      <section class="card chat-card">
        <div class="card-head">
          <h2>Class chat</h2>
          <span class="badge badge-brand" id="chat-status">Connecting...</span>
        </div>
        <div class="chat-list" id="chat-list"></div>
        <form class="chat-form" id="chat-form">
          <input id="chat-input" type="text" maxlength="1000" autocomplete="off"
                 placeholder="Write a message..." />
          <button class="btn" type="submit">Send</button>
        </form>
      </section>
    </div>`;

  drawClassCard();
  document.getElementById('chat-form').addEventListener('submit', sendMessage);
}


// ============================================================
//  THE LIVE CLASS SIDE
// ============================================================
function drawClassCard() {
  const card = document.getElementById('class-card');
  const badge = document.getElementById('live-badge');

  badge.innerHTML = batch.is_live
    ? '<span class="badge badge-danger">&#9679; LIVE NOW</span>'
    : '<span class="badge">Not started</span>';

  card.innerHTML = isTutor ? tutorViewHtml() : studentViewHtml();

  if (isTutor) {
    card.querySelectorAll('[data-mode]').forEach((button) =>
      button.addEventListener('click', () => setMode(button.dataset.mode))
    );
    const linkBtn = document.getElementById('save-link');
    if (linkBtn) linkBtn.addEventListener('click', saveLink);
    document.getElementById('go-live').addEventListener('click', toggleLive);
    loadViewLog();
  }

  // If the class is running, open whichever mode it uses.
  if (batch.is_live) openClass();
}

// ---- What the tutor sees -----------------------------------
function tutorViewHtml() {
  const modes = [
    ['jitsi', 'Group class', 'Video in this page. Works for the whole batch.'],
    ['p2p', 'Peer to peer', 'Our own video code. Best for 2 to 4 people.'],
    ['link', 'My own link', 'Zoom, Google Meet or Teams.'],
  ];

  const modeButtons = modes
    .map(
      ([value, title, note]) => `
      <button type="button" class="mode-opt ${batch.live_mode === value ? 'on' : ''}"
              data-mode="${value}" ${batch.is_live ? 'disabled' : ''}>
        <span class="mode-title">${title}</span>
        <span class="mode-note">${note}</span>
      </button>`
    )
    .join('');

  const linkField =
    batch.live_mode === 'link'
      ? `<div class="field mb">
           <label for="live-link">Your class link</label>
           <input id="live-link" type="url" placeholder="https://zoom.us/j/..."
                  value="${safe(batch.live_link || '')}" />
           <button class="btn btn-outline btn-sm mt-sm" type="button" id="save-link">
             Save link
           </button>
         </div>`
      : '';

  return `
    <h2 class="mb">Live class</h2>

    <p class="muted mb-sm">How do you want to run this class?</p>
    <div class="mode-picker mb">${modeButtons}</div>
    ${batch.is_live ? '<p class="hint mb">End the class to change the mode.</p>' : ''}
    ${linkField}

    <div id="class-stage"></div>

    <button class="btn btn-block ${batch.is_live ? 'btn-danger' : ''}" type="button" id="go-live">
      ${batch.is_live ? 'End the class' : 'Start the class'}
    </button>
    <p class="hint center mt-sm">Starting sends every student a notification.</p>

    <details class="watch-log mt">
      <summary>Who watched this class</summary>
      <p class="hint">
        Every viewer also has their own name printed over the video, so a
        leaked recording can be traced back to one person.
      </p>
      <div id="view-log" class="mt-sm"></div>
    </details>`;
}

// ---- What a student sees -----------------------------------
function studentViewHtml() {
  if (!batch.is_live) {
    return `
      <h2 class="mb">Live class</h2>
      <div class="video-holder">
        <div class="center">
          <div class="icon-lg">${icon('video','ico-lg')}</div>
          <h3 class="mt-sm">The class has not started</h3>
          <p class="muted">You can still use the chat while you wait.</p>
        </div>
      </div>`;
  }

  return `
    <h2 class="mb">Live class</h2>
    <div id="class-stage"></div>`;
}

// ---- Open whichever mode the tutor chose -------------------
async function openClass() {
  const stage = document.getElementById('class-stage');
  if (!stage) return;

  logThisView();

  if (batch.live_mode === 'jitsi') {
    stage.innerHTML = '<div class="video-holder" id="jitsi-holder"></div>';
    try {
      await startJitsi({
        holder: document.getElementById('jitsi-holder'),
        roomName: batch.room_code || 'hellostudents-batch-' + batchId,
        displayName: me.full_name,
        isTutor: isTutor,
      });
      // Put the viewer's name over the video, so a screen
      // recording of this class carries their details.
      protect(document.getElementById('jitsi-holder'));
    } catch (err) {
      stage.innerHTML = '<div class="alert alert-danger">' + safe(err.message) + '</div>';
    }
    return;
  }

  if (batch.live_mode === 'p2p') {
    stage.innerHTML = `
      <div class="alert alert-info mb">
        This mode sends video straight between browsers, with no video company
        in the middle. It works best with a few people at a time.
      </div>
      <div class="video-grid" id="video-grid"></div>
      <div class="row mt">
        <span class="badge" id="call-status">Not joined</span>
        <span class="badge" id="call-count">0 others</span>
        <div class="spacer"></div>
        <button class="btn btn-outline btn-sm" type="button" id="mic-btn" hidden>Mute</button>
        <button class="btn btn-outline btn-sm" type="button" id="cam-btn" hidden>Camera off</button>
        <button class="btn btn-sm" type="button" id="call-btn">Join with camera</button>
      </div>`;

    protect(document.getElementById('video-grid'));
    document.getElementById('call-btn').addEventListener('click', toggleCall);
    document.getElementById('mic-btn').addEventListener('click', () => {
      const on = call.toggleMic();
      document.getElementById('mic-btn').textContent = on ? 'Mute' : 'Unmute';
    });
    document.getElementById('cam-btn').addEventListener('click', () => {
      const on = call.toggleCamera();
      document.getElementById('cam-btn').textContent = on ? 'Camera off' : 'Camera on';
    });
    return;
  }

  // mode === 'link'
  if (!batch.live_link) {
    stage.innerHTML =
      '<div class="alert alert-warning">The tutor has not added a link yet.</div>';
    return;
  }

  stage.innerHTML = `
    <div class="video-holder">
      <div class="center">
        <div class="icon-lg">${icon('video','ico-lg')}</div>
        <h3 class="mt-sm">Class link ready</h3>
        <p class="muted">Zoom and Meet cannot open inside a page, so this
           opens in a new tab.</p>
      </div>
    </div>
    <a class="btn btn-lg btn-block mt" href="${safe(batch.live_link)}"
       target="_blank" rel="noopener">Open the live class</a>`;
}

// ---- Peer to peer: join or leave ---------------------------
async function toggleCall() {
  const button = document.getElementById('call-btn');

  if (call) {
    call.stop();
    call = null;
    button.textContent = 'Join with camera';
    button.className = 'btn btn-sm';
    document.getElementById('mic-btn').hidden = true;
    document.getElementById('cam-btn').hidden = true;
    return;
  }

  call = createCall({
    batchId: batchId,
    myId: me.id,
    myName: me.full_name,
    grid: document.getElementById('video-grid'),
    onStatus: (text) => (document.getElementById('call-status').textContent = text),
    onCount: (n) =>
      (document.getElementById('call-count').textContent =
        n + (n === 1 ? ' other' : ' others')),
  });

  try {
    await call.start();
  } catch (err) {
    toast(err.message, 'error');
    call = null;
    return;
  }

  button.textContent = 'Leave call';
  button.className = 'btn btn-danger btn-sm';
  document.getElementById('mic-btn').hidden = false;
  document.getElementById('cam-btn').hidden = false;
}

// ---- Tutor actions -----------------------------------------
async function setMode(mode) {
  const { error } = await supabase
    .from('batches')
    .update({ live_mode: mode })
    .eq('id', batchId);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  batch.live_mode = mode;
  drawClassCard();
}

async function saveLink() {
  const link = document.getElementById('live-link').value.trim();

  if (link && !link.startsWith('https://')) {
    toast('The link must start with https://', 'error');
    return;
  }

  const { error } = await supabase
    .from('batches')
    .update({ live_link: link || null })
    .eq('id', batchId);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  batch.live_link = link;
  toast('Class link saved.', 'success');
}

async function toggleLive() {
  const goingLive = !batch.is_live;

  if (goingLive && batch.live_mode === 'link' && !batch.live_link) {
    toast('Add your class link first, or pick another mode.', 'error');
    return;
  }

  const { error } = await supabase
    .from('batches')
    .update({
      is_live: goingLive,
      live_started_at: goingLive ? new Date().toISOString() : null,
    })
    .eq('id', batchId);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  if (!goingLive) closeClass();

  batch.is_live = goingLive;
  toast(goingLive ? 'Class started. Students have been told.' : 'Class ended.', 'success');
  drawClassCard();
}

function closeClass() {
  stopJitsi();
  if (call) {
    call.stop();
    call = null;
  }
  if (removeWatermark) {
    removeWatermark();
    removeWatermark = null;
  }
}


// ============================================================
//  ANTI-LEAK
//  1. the viewer's name is printed over the video
//  2. every viewing is written to class_views
//  Together they mean a leaked recording points at a person.
// ============================================================
function protect(holder) {
  if (removeWatermark) removeWatermark();
  removeWatermark = attachWatermark(holder, makeLabel(me));
}

// The tutor can see everyone who opened this class.
async function loadViewLog() {
  const box = document.getElementById('view-log');
  if (!box) return;

  const { data: rows } = await supabase
    .from('class_views')
    .select('opened_at, mode, profiles ( full_name, phone )')
    .eq('batch_id', batchId)
    .order('opened_at', { ascending: false })
    .limit(50);

  if (!rows || rows.length === 0) {
    box.innerHTML = '<p class="muted">Nobody has opened this class yet.</p>';
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Who</th><th>Phone</th><th>Mode</th><th>When</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td class="strong">${safe(r.profiles?.full_name || 'Unknown')}</td>
              <td class="muted">${safe(r.profiles?.phone || '—')}</td>
              <td class="muted">${safe(r.mode || '')}</td>
              <td class="muted nowrap">${timeAgo(r.opened_at)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

async function logThisView() {
  // If this fails it must not stop the class, so no error shown.
  await supabase.from('class_views').insert({
    batch_id: batchId,
    user_id: me.id,
    mode: batch.live_mode,
    user_agent: navigator.userAgent.slice(0, 300),
  });
}


// ============================================================
//  THE CHAT SIDE
// ============================================================
async function loadMessages() {
  const list = document.getElementById('chat-list');

  const { data: rows, error } = await supabase
    .from('messages')
    .select('id, body, created_at, sender_id, profiles ( full_name )')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    list.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  if (!rows || rows.length === 0) {
    list.innerHTML =
      '<p class="muted center mt">No messages yet. Say hello to your class.</p>';
    return;
  }

  list.innerHTML = rows.map(bubbleHtml).join('');
  scrollToBottom();
}

function bubbleHtml(row) {
  const mine = row.sender_id === me.id;
  const name = row.profiles?.full_name || 'Someone';

  return `
    <div class="bubble-row ${mine ? 'mine' : ''}">
      ${mine ? '' : `<div class="avatar">${initials(name)}</div>`}
      <div class="bubble">
        ${mine ? '' : `<div class="bubble-name">${safe(name)}</div>`}
        <div>${safe(row.body)}</div>
        <div class="bubble-time">${timeAgo(row.created_at)}</div>
      </div>
    </div>`;
}

async function sendMessage(event) {
  event.preventDefault();

  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (text === '') return;

  input.value = '';

  const { error } = await supabase.from('messages').insert({
    batch_id: batchId,
    sender_id: me.id,
    body: text,
  });

  if (error) {
    toast(error.message, 'error');
    input.value = text;         // give the text back so it is not lost
  }
}

// Supabase tells the browser as soon as a new row is added to
// the messages table for this batch. That is the live part.
function listenForNewMessages() {
  const status = document.getElementById('chat-status');

  chatChannel = supabase
    .channel('chat-' + batchId)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: 'batch_id=eq.' + batchId,
      },
      async (payload) => {
        const { data: sender } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', payload.new.sender_id)
          .maybeSingle();

        addBubble({ ...payload.new, profiles: sender });
      }
    )
    .subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        status.textContent = 'Live';
        status.className = 'badge badge-success';
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        status.textContent = 'Offline';
        status.className = 'badge badge-danger';
      }
    });
}

function addBubble(row) {
  const list = document.getElementById('chat-list');
  if (list.querySelector('p')) list.innerHTML = '';   // clear "no messages yet"
  list.insertAdjacentHTML('beforeend', bubbleHtml(row));
  scrollToBottom();
}

function scrollToBottom() {
  const list = document.getElementById('chat-list');
  list.scrollTop = list.scrollHeight;
}

// Hang up and close the channels when the page is left.
window.addEventListener('beforeunload', () => {
  closeClass();
  if (chatChannel) supabase.removeChannel(chatChannel);
});
