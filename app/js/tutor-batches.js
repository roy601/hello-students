// ============================================================
//  TUTOR — MY BATCHES
//
//  Open a batch, publish it, or delete it.
//  Only an approved tutor can create a batch: the database
//  rule checks the tutor's status, so the browser cannot
//  get around it.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { toast, busy, confirmBox, showEmpty, renderPageHero, setupReveal } from './ui.js';
import { formatTime, taka, safe } from './format.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const statusArea = document.getElementById('status-area');
const batchList = document.getElementById('batch-list');
const form = document.getElementById('batch-form');
const submitBtn = document.getElementById('batch-btn');
const subjectSelect = document.getElementById('b-subject');
const areaSelect = document.getElementById('b-area');
const dayPicker = document.getElementById('day-picker');

let me = null;
let isApproved = false;

start();

async function start() {
  renderTopbar('tutor-batches.html');
  renderPageHero({
    eyebrow: 'Tutor',
    title: 'My batches',
    subtitle: 'Each batch has its own days, seats and monthly fee.',
  });
  setupReveal();

  me = await requireRole('tutor');
  if (!me) return;

  buildDayPicker();
  await loadLists();
  await checkApproval();
  await loadMyBatches();
}

// ---- Seven day buttons -------------------------------------
function buildDayPicker() {
  dayPicker.innerHTML = DAYS.map(
    (day) => `
      <label class="day-chip">
        <input type="checkbox" value="${day}" />
        <span>${day}</span>
      </label>`
  ).join('');
}

async function loadLists() {
  const { data: subjects } = await supabase
    .from('subjects')
    .select('*')
    .order('grade_level')
    .order('name_en');

  subjectSelect.innerHTML = '<option value="">Choose a subject</option>';
  (subjects || []).forEach((s) => {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = s.name_en + ' · ' + s.grade_level;
    subjectSelect.appendChild(option);
  });

  const { data: areas } = await supabase
    .from('areas')
    .select('*')
    .order('city')
    .order('name_en');

  areaSelect.innerHTML = '<option value="">Choose an area</option>';
  (areas || []).forEach((a) => {
    const option = document.createElement('option');
    option.value = a.id;
    option.textContent = a.name_en + ' (' + a.city + ')';
    areaSelect.appendChild(option);
  });
}

// ---- Can this tutor open batches yet? ----------------------
async function checkApproval() {
  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('status')
    .eq('id', me.id)
    .maybeSingle();

  isApproved = tutor?.status === 'approved';

  if (!isApproved) {
    statusArea.innerHTML = `
      <div class="alert alert-warning">
        <strong>Waiting for approval.</strong>
        You can open batches once our team approves your account.
        <a href="tutor-profile.html">Complete your profile</a> to speed this up.
      </div>`;
    submitBtn.disabled = true;
  }
}

// ---- The tutor's own batches -------------------------------
async function loadMyBatches() {
  const { data: batches, error } = await supabase
    .from('batches')
    .select(`
      *,
      subjects ( name_en, grade_level ),
      areas ( name_en )
    `)
    .eq('tutor_id', me.id)
    .order('id', { ascending: false });

  if (error) {
    batchList.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  if (!batches || batches.length === 0) {
    showEmpty(
      batchList,
      'calendar',
      'No batches yet',
      'Use the form below to open your first batch.'
    );
    return;
  }

  batchList.innerHTML = batches.map(batchHtml).join('');

  batchList.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => togglePublish(b.dataset.toggle, b.dataset.now === '1'))
  );
  batchList.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', () => removeBatch(b.dataset.delete, Number(b.dataset.taken)))
  );
}

function batchHtml(batch) {
  const place = batch.is_online
    ? 'Online'
    : batch.areas
      ? batch.areas.name_en
      : 'Area not set';

  const statusBadge = batch.is_published
    ? '<span class="badge badge-success">Published</span>'
    : '<span class="badge">Draft</span>';

  const liveBadge = batch.is_live
    ? '<span class="badge badge-danger">&#9679; LIVE</span>'
    : '';

  return `
    <div class="list-row">
      <div class="body">
        <h3>${safe(batch.title)} ${statusBadge} ${liveBadge}</h3>
        <p class="muted">${safe(batch.subjects.name_en)} · ${safe(batch.subjects.grade_level)}</p>
        <p class="muted">
          ${safe(batch.days)} · ${formatTime(batch.start_time)}–${formatTime(batch.end_time)}
        </p>
        <p class="muted">
          ${safe(place)} · ${batch.seats_taken} of ${batch.seat_limit} seats filled
        </p>
      </div>
      <div class="side stack-sm">
        <div class="price">${taka(batch.monthly_fee)}<small>per month</small></div>
        <div class="row-end">
          <a class="btn btn-sm" href="batch-room.html?id=${batch.id}">
            Class room
          </a>
          <button class="btn btn-outline btn-sm" type="button"
                  data-toggle="${batch.id}" data-now="${batch.is_published ? 1 : 0}">
            ${batch.is_published ? 'Unpublish' : 'Publish'}
          </button>
          <button class="btn btn-outline btn-sm" type="button"
                  data-delete="${batch.id}" data-taken="${batch.seats_taken}">
            Delete
          </button>
        </div>
      </div>
    </div>`;
}

async function togglePublish(id, isNowPublished) {
  const { error } = await supabase
    .from('batches')
    .update({ is_published: !isNowPublished })
    .eq('id', id);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast(isNowPublished ? 'Batch hidden from students.' : 'Batch is now live.', 'success');
  await loadMyBatches();
}

async function removeBatch(id, seatsTaken) {
  if (seatsTaken > 0) {
    toast('Students have already joined, so this batch cannot be deleted.', 'error');
    return;
  }

  const yes = await confirmBox('Delete this batch?', 'This cannot be undone.', 'Delete');
  if (!yes) return;

  const { error } = await supabase.from('batches').delete().eq('id', id);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Batch deleted.', 'success');
  await loadMyBatches();
}

// ---- Open a new batch --------------------------------------
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const chosenDays = [...dayPicker.querySelectorAll('input:checked')]
    .map((box) => box.value)
    .join(', ');

  if (chosenDays === '') {
    toast('Please choose at least one class day.', 'error');
    return;
  }

  const isOnline = document.getElementById('b-online').checked;
  const areaId = areaSelect.value ? Number(areaSelect.value) : null;

  if (!isOnline && areaId === null) {
    toast('Choose an area, or tick "online batch".', 'error');
    return;
  }

  busy(submitBtn, true, 'Opening batch...');

  const { error } = await supabase.from('batches').insert({
    tutor_id: me.id,
    subject_id: Number(subjectSelect.value),
    area_id: isOnline ? null : areaId,
    title: document.getElementById('b-title').value.trim(),
    description: document.getElementById('b-desc').value.trim() || null,
    days: chosenDays,
    start_time: document.getElementById('b-start').value,
    end_time: document.getElementById('b-end').value,
    monthly_fee: Number(document.getElementById('b-fee').value),
    seat_limit: Number(document.getElementById('b-seats').value),
    is_online: isOnline,
    is_published: document.getElementById('b-publish').checked,
  });

  busy(submitBtn, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Batch opened.', 'success');
  form.reset();
  buildDayPicker();
  await loadMyBatches();
});
