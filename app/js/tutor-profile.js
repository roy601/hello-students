// ============================================================
//  FEATURE 1 — TUTOR PROFILE AND BATCHES
//
//  A logged-in tutor can:
//    - write a headline and bio
//    - open a BATCH: subject, days, time, monthly fee, seats
//    - publish a batch so students can find it
//    - delete a batch
//
//  The price lives on the BATCH, not on the tutor, because a
//  tutor can run several batches at different monthly fees.
// ============================================================

import { supabase } from './supabase.js';
import { requireLogin, renderNav, getMyProfile } from './session.js';
import { formatTime, formatTaka } from './format.js';

const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const aboutForm = document.getElementById('about-form');
const aboutMessage = document.getElementById('about-message');

const batchForm = document.getElementById('batch-form');
const batchMessage = document.getElementById('batch-message');
const subjectSelect = document.getElementById('batch-subject');
const areaSelect = document.getElementById('batch-area');
const dayList = document.getElementById('day-list');
const batchList = document.getElementById('batch-list');

let currentUser = null;

start();

async function start() {
  renderNav();

  currentUser = await requireLogin();
  if (!currentUser) return;

  const profile = await getMyProfile();
  if (!profile || profile.role !== 'tutor') {
    document.getElementById('page').innerHTML =
      '<p class="message error">This page is only for tutors.</p>';
    return;
  }

  document.getElementById('greeting').textContent = 'Hello, ' + profile.full_name;

  buildDayCheckboxes();
  await loadSubjects();
  await loadAreas();
  await loadAbout();
  await loadMyBatches();
}

// ============================================================
//  PART A — about you
// ============================================================

async function loadAbout() {
  // maybeSingle = it is fine if the tutor has not saved anything yet
  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (!tutor) return;

  document.getElementById('headline').value = tutor.headline || '';
  document.getElementById('bio').value = tutor.bio || '';
}

aboutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  aboutMessage.textContent = 'Saving...';
  aboutMessage.className = 'message';

  // upsert = insert if this is the first save, update if not
  const { error } = await supabase.from('tutor_profiles').upsert({
    id: currentUser.id,
    headline: document.getElementById('headline').value.trim(),
    bio: document.getElementById('bio').value.trim(),
  });

  if (error) {
    showMessage(aboutMessage, error.message, 'error');
    return;
  }

  showMessage(aboutMessage, 'Saved.', 'success');
});

// ============================================================
//  PART B — batches
// ============================================================

function buildDayCheckboxes() {
  dayList.innerHTML = '';

  ALL_DAYS.forEach((day) => {
    const label = document.createElement('label');
    label.className = 'checkbox';
    label.innerHTML = `
      <input type="checkbox" value="${day}" />
      <span>${day}</span>
    `;
    dayList.appendChild(label);
  });
}

async function loadSubjects() {
  const { data: subjects } = await supabase
    .from('subjects')
    .select('*')
    .order('id');

  subjectSelect.innerHTML = '<option value="">Choose a subject</option>';

  subjects.forEach((subject) => {
    const option = document.createElement('option');
    option.value = subject.id;
    option.textContent = subject.name_en + ' · ' + subject.grade_level;
    subjectSelect.appendChild(option);
  });
}

async function loadAreas() {
  const { data: areas } = await supabase.from('areas').select('*').order('city');

  areaSelect.innerHTML = '<option value="">Choose an area</option>';

  areas.forEach((area) => {
    const option = document.createElement('option');
    option.value = area.id;
    option.textContent = area.name_en + ' (' + area.city + ')';
    areaSelect.appendChild(option);
  });
}

// ---- Show the tutor's own batches ---------------------------
async function loadMyBatches() {
  const { data: batches, error } = await supabase
    .from('batches')
    .select(`
      id, title, days, start_time, end_time,
      monthly_fee, seat_limit, is_online, is_published,
      subjects ( name_en, grade_level ),
      areas ( name_en )
    `)
    .eq('tutor_id', currentUser.id)
    .order('id', { ascending: false });

  if (error) {
    batchList.innerHTML = '<p class="message error">' + error.message + '</p>';
    return;
  }

  if (batches.length === 0) {
    batchList.innerHTML =
      '<p class="muted">You have not opened any batch yet.</p>';
    return;
  }

  batchList.innerHTML = '';

  batches.forEach((batch) => {
    const place = batch.is_online
      ? 'Online'
      : batch.areas
        ? batch.areas.name_en
        : 'Area not set';

    const status = batch.is_published
      ? '<span class="tag tag-live">Published</span>'
      : '<span class="tag">Draft</span>';

    const row = document.createElement('div');
    row.className = 'batch-row';
    row.innerHTML = `
      <div>
        <h4>${batch.title} ${status}</h4>
        <p class="muted">
          ${batch.subjects.name_en} · ${batch.subjects.grade_level}
        </p>
        <p class="muted">
          ${batch.days} · ${formatTime(batch.start_time)}–${formatTime(batch.end_time)}
          · ${place} · ${batch.seat_limit} seats
        </p>
      </div>
      <div class="batch-row-side">
        <p class="price">${formatTaka(batch.monthly_fee)}</p>
        <p class="muted">per month</p>
        <button type="button" class="btn-small btn-outline"
                data-delete="${batch.id}">Delete</button>
      </div>
    `;
    batchList.appendChild(row);
  });

  // Wire up every Delete button.
  batchList.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteBatch(button.dataset.delete));
  });
}

async function deleteBatch(batchId) {
  if (!confirm('Delete this batch?')) return;

  const { error } = await supabase.from('batches').delete().eq('id', batchId);

  if (error) {
    showMessage(batchMessage, error.message, 'error');
    return;
  }

  await loadMyBatches();
}

// ---- Create a new batch -------------------------------------
batchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  batchMessage.textContent = 'Opening batch...';
  batchMessage.className = 'message';

  const chosenDays = [...dayList.querySelectorAll('input:checked')]
    .map((box) => box.value)
    .join(', ');

  if (chosenDays === '') {
    showMessage(batchMessage, 'Please choose at least one day.', 'error');
    return;
  }

  const isOnline = document.getElementById('batch-online').checked;
  const areaId = areaSelect.value ? Number(areaSelect.value) : null;

  if (!isOnline && areaId === null) {
    showMessage(batchMessage, 'Choose an area, or tick "Online batch".', 'error');
    return;
  }

  const { error } = await supabase.from('batches').insert({
    tutor_id: currentUser.id,
    subject_id: Number(subjectSelect.value),
    area_id: isOnline ? null : areaId,
    title: document.getElementById('batch-title').value.trim(),
    days: chosenDays,
    start_time: document.getElementById('batch-start').value,
    end_time: document.getElementById('batch-end').value,
    monthly_fee: Number(document.getElementById('batch-fee').value),
    seat_limit: Number(document.getElementById('batch-seats').value),
    is_online: isOnline,
    is_published: document.getElementById('batch-publish').checked,
  });

  if (error) {
    showMessage(batchMessage, error.message, 'error');
    return;
  }

  showMessage(batchMessage, 'Batch opened.', 'success');
  batchForm.reset();
  buildDayCheckboxes();
  await loadMyBatches();
});

function showMessage(element, text, kind) {
  element.textContent = text;
  element.className = 'message ' + (kind || '');
}
