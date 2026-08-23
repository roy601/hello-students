// ============================================================
//  MY WEEK
//
//  The one thing the app could never show: your classes laid
//  out as a week. Enrolling already refuses a batch that
//  clashes with one you are in, but nobody could actually SEE
//  their week — which is the first thing a student or a tutor
//  wants before joining anything else.
//
//  Works for both sides from the same page:
//    a student sees the batches they joined
//    a tutor sees the batches they teach
//
//  The week starts on Sunday, because that is the school week
//  in Bangladesh.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { renderTopbar, getMyProfile } from './session.js';
import { showLoading, renderPageHero, setupReveal } from './ui.js';
import { safe, formatTime, taka } from './format.js';

const box = document.getElementById('schedule');

//  Sunday first. The short names here must match what is stored
//  in batches.days, which tutor-batches.js writes as
//  'Sun, Tue, Thu'.
const DAYS = [
  ['Sun', 'Sunday'],
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
];

let me = null;

start();

async function start() {
  renderTopbar('schedule.html');
  showLoading(box, 2);

  me = await getMyProfile();
  if (!me) {
    window.location.href = 'login.html';
    return;
  }

  const isTutor = me.role === 'tutor';

  renderPageHero({
    eyebrow: isTutor ? 'Tutor' : 'Student',
    title: 'My week',
    subtitle: isTutor
      ? 'Every batch you teach, laid out across the week.'
      : 'Every class you have joined, laid out across the week.',
    actions: isTutor
      ? '<a class="btn btn-outline" href="tutor-batches.html">My batches</a>'
      : '<a class="btn btn-outline" href="browse.html">Find another batch</a>',
  });
  setupReveal();

  await load(isTutor);
}

async function load(isTutor) {
  const batches = isTutor ? await tutorBatches() : await studentBatches();

  if (batches === null) return;             // the query already reported

  if (batches.length === 0) {
    box.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${icon('calendar', 'ico-lg')}</div>
        <h3>Nothing in your week yet</h3>
        <p class="muted">
          ${isTutor
            ? 'Open a batch and it will appear here.'
            : 'Join a batch and it will appear here.'}
        </p>
        <a class="btn mt" href="${isTutor ? 'tutor-batches.html' : 'browse.html'}">
          ${isTutor ? 'Open a batch' : 'Find a batch'}
        </a>
      </div>`;
    return;
  }

  draw(batches, isTutor);
}

// ---- where the batches come from ---------------------------
async function studentBatches() {
  const { data, error } = await supabase
    .from('enrolments')
    .select(`
      id,
      batches (
        id, title, days, start_time, end_time, monthly_fee, is_online, is_live,
        subjects ( name_en, grade_level ),
        areas ( name_en ),
        tutor_profiles ( profiles ( full_name ) )
      )
    `)
    .eq('student_id', me.id)
    //  a refunded enrolment is set to 'left', and a class you
    //  are no longer in has no business in your week
    .eq('status', 'active');

  if (error) {
    box.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return null;
  }

  return (data || []).map((row) => row.batches).filter(Boolean);
}

async function tutorBatches() {
  const { data, error } = await supabase
    .from('batches')
    .select(`
      id, title, days, start_time, end_time, monthly_fee, is_online, is_live,
      seats_taken, seat_limit,
      subjects ( name_en, grade_level ),
      areas ( name_en )
    `)
    .eq('tutor_id', me.id);

  if (error) {
    box.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return null;
  }

  return data || [];
}


// ============================================================
//  DRAWING THE WEEK
// ============================================================
function draw(batches, isTutor) {
  //  days is stored as text like 'Sun, Tue, Thu', so every
  //  batch is dropped into each day it names.
  const byDay = new Map(DAYS.map(([short]) => [short, []]));

  batches.forEach((b) => {
    String(b.days || '')
      .split(',')
      .map((d) => d.trim())
      .filter((d) => byDay.has(d))
      .forEach((d) => byDay.get(d).push(b));
  });

  //  earliest class first within each day
  byDay.forEach((list) => list.sort((a, b) => a.start_time.localeCompare(b.start_time)));

  const todayShort = DAYS[new Date().getDay()][0];

  const columns = DAYS.map(([short, full]) => {
    const list = byDay.get(short);
    const isToday = short === todayShort;

    return `
      <div class="wk-day ${isToday ? 'today' : ''}">
        <div class="wk-head">
          <span class="wk-name">${full}</span>
          ${isToday ? '<span class="badge badge-brand">Today</span>' : ''}
        </div>
        <div class="wk-list">
          ${list.length === 0
            ? '<p class="wk-free">Free</p>'
            : list.map((b) => cardHtml(b, isTutor)).join('')}
        </div>
      </div>`;
  }).join('');

  const hours = countHours(batches);

  box.innerHTML = `
    <section class="grid-4 mb-md stagger">
      <div class="stat">
        <div class="label">${isTutor ? 'Batches you teach' : 'Classes joined'}</div>
        <div class="value brand">${batches.length}</div>
      </div>
      <div class="stat">
        <div class="label">Sittings a week</div>
        <div class="value">${countSittings(batches)}</div>
      </div>
      <div class="stat">
        <div class="label">Hours a week</div>
        <div class="value">${hours}</div>
      </div>
      <div class="stat">
        <div class="label">${isTutor ? 'Monthly income' : 'Monthly cost'}</div>
        <div class="value">${taka(batches.reduce((s, b) => s + (b.monthly_fee || 0), 0))}</div>
        ${isTutor ? '<div class="sub">before the 15% site fee</div>' : ''}
      </div>
    </section>

    <div class="week">${columns}</div>`;
}

function cardHtml(b, isTutor) {
  const place = b.is_online ? 'Online' : (b.areas?.name_en || 'In person');
  const who = isTutor
    ? b.seats_taken + ' of ' + b.seat_limit + ' seats'
    : (b.tutor_profiles?.profiles?.full_name || 'Tutor');

  return `
    <a class="wk-item ${b.is_live ? 'live' : ''}" href="batch-room.html?id=${b.id}">
      <span class="wk-time">${formatTime(b.start_time)}–${formatTime(b.end_time)}</span>
      <span class="wk-title">${safe(b.title)}</span>
      <span class="wk-meta">${safe(place)} · ${safe(who)}</span>
      ${b.is_live ? '<span class="wk-live">&#9679; LIVE</span>' : ''}
    </a>`;
}

// ---- how much of the week does this actually take? ---------
//  One "sitting" is one batch on one day. A batch running three
//  days a week is three sittings, which is the number that
//  tells you how busy you are.
function countSittings(batches) {
  return batches.reduce((total, b) => {
    const days = String(b.days || '').split(',').filter((d) => d.trim() !== '');
    return total + days.length;
  }, 0);
}

function countHours(batches) {
  const minutes = batches.reduce((total, b) => {
    const days = String(b.days || '').split(',').filter((d) => d.trim() !== '').length;
    return total + days * minutesBetween(b.start_time, b.end_time);
  }, 0);

  //  one decimal place, but no trailing ".0" on a whole number
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

//  start_time and end_time are 'HH:MM:SS' strings from Postgres.
function minutesBetween(start, end) {
  const toMinutes = (t) => {
    const [h, m] = String(t || '0:0').split(':').map(Number);
    return h * 60 + m;
  };
  return Math.max(0, toMinutes(end) - toMinutes(start));
}
