// ============================================================
//  RECORDINGS — watch a class again
//
//  The tutor uploads a video file of a class. Students of that
//  batch can play it back later.
//
//  Two things are worth understanding here.
//
//  1. WHERE THE FILE LIVES
//     Not in the database. Supabase Storage holds the file and
//     the recordings table only remembers the path to it. The
//     bucket is private, so a file cannot be opened by address
//     alone — the browser asks for a signed link that dies
//     after an hour.
//
//  2. WHY THE NAME IS ON THE VIDEO
//     Same reason as the live class: the viewer's own name and
//     phone sit over the picture, and every play is written to
//     class_views. If a recording is ever leaked, it points at
//     one person. See watermark.js.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { toast, showLoading, busy, confirmBox } from './ui.js';
import { safe, timeAgo } from './format.js';
import { attachWatermark, makeLabel } from './watermark.js';

//  Supabase refuses very large uploads, and a two hour video
//  would be a miserable wait on a Bangladeshi connection
//  anyway. Say so before the upload starts, not after.
const MAX_MB = 50;

let ctx = null;
let box = null;
let removeWatermark = null;

export async function mountRecordings(element, context) {
  ctx = context;
  box = element;

  box.innerHTML = `
    <div id="rec-top"></div>
    <div id="rec-player"></div>
    <div id="rec-list"></div>`;

  drawTop();
  await loadList();
}

// ------------------------------------------------------------
//  The tutor gets an upload box. Students get a short line.
// ------------------------------------------------------------
function drawTop() {
  const top = document.getElementById('rec-top');

  if (!ctx.isTutor) {
    top.innerHTML = `
      <p class="lead mb">
        Classes your teacher has uploaded. Your name is shown over
        the video while it plays.
      </p>`;
    return;
  }

  top.innerHTML = `
    <div class="card mb">
      <h2 class="mb-sm">Upload a class</h2>
      <p class="hint mb">
        Record the class with any screen recorder, then put the file
        here. Up to ${MAX_MB} MB, and mp4 or webm plays everywhere.
      </p>

      <form id="rec-form">
        <div class="field">
          <label for="rec-title">What was this class about?</label>
          <input id="rec-title" type="text" maxlength="200" required
                 placeholder="Chapter 4 — Thermodynamics" />
        </div>

        <div class="field">
          <label for="rec-file">Video file</label>
          <input id="rec-file" type="file" accept="video/*" required />
        </div>

        <div id="rec-progress" class="rec-progress" hidden>
          <div class="rec-bar"><i id="rec-bar-fill"></i></div>
          <p class="hint" id="rec-progress-text">Uploading...</p>
        </div>

        <button class="btn" type="submit" id="rec-upload">Upload</button>
      </form>
    </div>`;

  document.getElementById('rec-form').addEventListener('submit', upload);
}

async function upload(event) {
  event.preventDefault();

  const button = document.getElementById('rec-upload');
  const titleBox = document.getElementById('rec-title');
  const fileBox = document.getElementById('rec-file');
  const file = fileBox.files[0];

  if (!file) {
    toast('Choose a video file first.', 'error');
    return;
  }

  const sizeMb = file.size / 1024 / 1024;
  if (sizeMb > MAX_MB) {
    toast(
      'That file is ' + sizeMb.toFixed(0) + ' MB. The limit is ' + MAX_MB + ' MB.',
      'error'
    );
    return;
  }

  //  The path must start with the batch id, because the storage
  //  rules read the batch out of the first folder to decide who
  //  may upload and who may watch.
  const safeName = file.name.replace(/[^\w.-]/g, '_');
  const path = ctx.batchId + '/' + Date.now() + '-' + safeName;

  busy(button, true, 'Uploading...');
  showProgress(true, 'Uploading ' + sizeMb.toFixed(1) + ' MB. Please keep this tab open.');

  const { error: uploadError } = await supabase.storage
    .from('recordings')
    .upload(path, file, { contentType: file.type || 'video/mp4' });

  if (uploadError) {
    busy(button, false);
    showProgress(false);
    toast(uploadError.message, 'error');
    return;
  }

  //  The file is up. Now remember it, so the class can find it.
  const { error: rowError } = await supabase.from('recordings').insert({
    batch_id: ctx.batchId,
    tutor_id: ctx.me.id,
    title: titleBox.value.trim(),
    storage_path: path,
    size_bytes: file.size,
  });

  busy(button, false);
  showProgress(false);

  if (rowError) {
    //  The row failed, so the file would sit there unreachable.
    //  Take it back out rather than leave rubbish behind.
    await supabase.storage.from('recordings').remove([path]);
    toast(rowError.message, 'error');
    return;
  }

  toast('Uploaded. Your students have been told.', 'success');
  document.getElementById('rec-form').reset();
  await loadList();
}

function showProgress(on, text) {
  const holder = document.getElementById('rec-progress');
  if (!holder) return;

  holder.hidden = !on;
  if (text) document.getElementById('rec-progress-text').textContent = text;

  //  The browser upload API here does not report progress, so
  //  the bar shows movement rather than a percentage. Better an
  //  honest "still going" than a fake number.
  document.getElementById('rec-bar-fill').classList.toggle('working', on);
}


// ============================================================
//  THE LIST
// ============================================================
async function loadList() {
  const list = document.getElementById('rec-list');
  showLoading(list, 2);

  const { data, error } = await supabase
    .from('recordings')
    .select('id, title, storage_path, size_bytes, created_at')
    .eq('batch_id', ctx.batchId)
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${icon('video', 'ico-lg')}</div>
        <h3>No recordings yet</h3>
        <p class="muted">
          ${ctx.isTutor
            ? 'Upload a class above and your students can watch it again.'
            : 'When your teacher uploads a class, it will appear here.'}
        </p>
      </div>`;
    return;
  }

  list.innerHTML = data.map(rowHtml).join('');

  list.querySelectorAll('[data-play]').forEach((button) =>
    button.addEventListener('click', () =>
      play(button.dataset.play, button.dataset.title)
    )
  );

  list.querySelectorAll('[data-del-rec]').forEach((button) =>
    button.addEventListener('click', () =>
      remove(button.dataset.delRec, button.dataset.path)
    )
  );
}

function rowHtml(rec) {
  const mb = rec.size_bytes ? (rec.size_bytes / 1024 / 1024).toFixed(1) + ' MB' : '';

  return `
    <article class="card rec-item">
      <button type="button" class="rec-row"
              data-play="${safe(rec.storage_path)}" data-title="${safe(rec.title)}">
        <span class="rec-thumb">${icon('video', 'ico-sm')}</span>
        <span class="rec-main">
          <span class="rec-title">${safe(rec.title)}</span>
          <span class="rec-meta">${timeAgo(rec.created_at)}${mb ? ' · ' + mb : ''}</span>
        </span>
        <span class="badge badge-brand">Watch</span>
      </button>

      ${ctx.isTutor
        ? `<button type="button" class="post-x rec-x"
                   data-del-rec="${rec.id}" data-path="${safe(rec.storage_path)}"
                   aria-label="Delete this recording">${icon('cross', 'ico-sm')}</button>`
        : ''}
    </article>`;
}


// ============================================================
//  PLAYING ONE BACK
// ============================================================
async function play(path, title) {
  const holder = document.getElementById('rec-player');

  holder.innerHTML = `
    <div class="card mb">
      <h2 class="mb-sm">${safe(title)}</h2>
      <div class="video-holder" id="rec-stage">
        <p class="muted center">Getting the video ready...</p>
      </div>
      <p class="hint mt-sm">
        Your name and number are shown over this video. Please do not
        share it — a leaked copy can be traced back.
      </p>
    </div>`;

  holder.scrollIntoView({ behavior: 'smooth', block: 'start' });

  //  A private bucket needs a signed link. It lasts an hour,
  //  which is long enough to watch and short enough that a
  //  copied address is useless tomorrow.
  const { data, error } = await supabase.storage
    .from('recordings')
    .createSignedUrl(path, 3600);

  const stage = document.getElementById('rec-stage');

  if (error || !data?.signedUrl) {
    stage.innerHTML =
      '<p class="muted center">' + safe(error?.message || 'Could not open this video.') + '</p>';
    return;
  }

  stage.innerHTML = `
    <video id="rec-video" controls controlslist="nodownload" playsinline
           src="${safe(data.signedUrl)}"></video>`;

  //  put the viewer's name over the picture
  if (removeWatermark) removeWatermark();
  removeWatermark = attachWatermark(stage, makeLabel(ctx.me));

  logThisView();
}

//  Every play is written down, so the tutor can see who opened
//  a class. Failing here must never stop the video, so there
//  is no error shown.
async function logThisView() {
  await supabase.from('class_views').insert({
    batch_id: ctx.batchId,
    user_id: ctx.me.id,
    mode: 'recording',
    user_agent: navigator.userAgent.slice(0, 300),
  });
}


// ============================================================
//  DELETING
// ============================================================
async function remove(id, path) {
  const yes = await confirmBox(
    'Delete this recording?',
    'Your students will not be able to watch it again.',
    'Delete'
  );
  if (!yes) return;

  //  the row first, then the file. If the file fails the row is
  //  already gone, which is the safer way round: a missing file
  //  with no row is invisible, a row with no file is an error
  //  every student would hit.
  const { error } = await supabase.from('recordings').delete().eq('id', id);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  await supabase.storage.from('recordings').remove([path]);

  document.getElementById('rec-player').innerHTML = '';
  toast('Recording deleted.', 'success');
  await loadList();
}

//  Called by the room when the page is left.
export function stopRecordings() {
  if (removeWatermark) removeWatermark();
  removeWatermark = null;
}
