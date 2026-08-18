// ============================================================
//  BATCH DETAILS PAGE  —  and joining a batch
//
//  Joining calls one database function, enrol_in_batch().
//  That function checks the seats, checks the wallet, takes
//  the money, gives the seat and pays the tutor. It all
//  happens together, or none of it happens.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, getMyProfile } from './session.js';
import { toast, busy, showLoading } from './ui.js';
import { formatTime, taka, stars, safe, timeAgo, initials } from './format.js';

const content = document.getElementById('content');
const batchId = Number(new URLSearchParams(window.location.search).get('id'));

let profile = null;
let batch = null;

start();

async function start() {
  renderTopbar();
  showLoading(content, 2);

  profile = await getMyProfile();

  if (!batchId) {
    content.innerHTML = '<div class="alert alert-danger">No batch was chosen.</div>';
    return;
  }

  await loadBatch();
}

async function loadBatch() {
  const { data, error } = await supabase
    .from('batches')
    .select(`
      *,
      subjects ( name_en, name_bn, grade_level ),
      areas ( name_en, city ),
      tutor_profiles (
        id, headline, bio, years_experience, rating_avg, rating_count,
        students_taught, verified_level,
        profiles ( full_name )
      )
    `)
    .eq('id', batchId)
    .maybeSingle();

  if (error || !data) {
    content.innerHTML =
      '<div class="alert alert-danger">This batch was not found, or it is not open yet.</div>';
    return;
  }

  batch = data;
  await draw();
}

async function draw() {
  const tutor = batch.tutor_profiles;
  const tutorName = tutor?.profiles?.full_name || 'Tutor';
  const seatsLeft = batch.seat_limit - batch.seats_taken;

  const place = batch.is_online
    ? 'Online class'
    : batch.areas
      ? batch.areas.name_en + ', ' + batch.areas.city
      : 'Area not set';

  // Has this student already joined?
  let alreadyJoined = false;
  if (profile?.role === 'student') {
    const { data: mine } = await supabase
      .from('enrolments')
      .select('id')
      .eq('batch_id', batchId)
      .eq('student_id', profile.id)
      .maybeSingle();
    alreadyJoined = Boolean(mine);
  }

  content.innerHTML = `
    <div class="card mb">
      <div class="card-head">
        <div>
          <h1>${safe(batch.title)}</h1>
          <p class="lead mt-xs">
            ${safe(batch.subjects.name_en)} · ${safe(batch.subjects.grade_level)}
          </p>
        </div>
        <div class="price">${taka(batch.monthly_fee)}<small>per month</small></div>
      </div>

      <div class="grid-2 mt">
        <div class="stat">
          <div class="label">Class days</div>
          <div class="value text-size">${safe(batch.days)}</div>
          <div class="sub">${formatTime(batch.start_time)} – ${formatTime(batch.end_time)}</div>
        </div>
        <div class="stat">
          <div class="label">Where</div>
          <div class="value text-size">${safe(place)}</div>
          <div class="sub">${seatsLeft} of ${batch.seat_limit} seats left</div>
        </div>
      </div>

      ${batch.description
        ? `<p class="lead mt">${safe(batch.description)}</p>`
        : ''}

      <div id="join-area" class="mt-md"></div>
    </div>

    <div class="card mb">
      <h2 class="mb">About the tutor</h2>
      <div class="row">
        <div class="avatar lg">${initials(tutorName)}</div>
        <div>
          <h3>${safe(tutorName)}</h3>
          <p class="muted">${safe(tutor?.headline || 'Tutor on HelloStudents')}</p>
          <div class="row mt-xs">
            ${tutor?.rating_count > 0
              ? `<span class="stars">${stars(tutor.rating_avg)}</span>
                 <span class="muted">${tutor.rating_avg} from ${tutor.rating_count} reviews</span>`
              : '<span class="muted">No reviews yet</span>'}
          </div>
        </div>
      </div>
      <div class="grid-3 mt">
        <div class="stat">
          <div class="label">Experience</div>
          <div class="value">${tutor?.years_experience || 0}<span class="sub"> years</span></div>
        </div>
        <div class="stat">
          <div class="label">Students taught</div>
          <div class="value">${tutor?.students_taught || 0}</div>
        </div>
        <div class="stat">
          <div class="label">Checked</div>
          <div class="value text-size">
            ${tutor?.verified_level === 'certificate_verified'
              ? 'Certificate'
              : tutor?.verified_level === 'id_verified'
                ? 'ID'
                : 'Not yet'}
          </div>
        </div>
      </div>
      ${tutor?.bio ? `<p class="lead mt">${safe(tutor.bio)}</p>` : ''}
    </div>

    <div class="card">
      <h2 class="mb">Reviews</h2>
      <div id="reviews"></div>
    </div>
  `;

  drawJoinArea(alreadyJoined, seatsLeft);
  loadReviews(tutor.id);
}

// ---- The join button changes depending on who is looking ----
function drawJoinArea(alreadyJoined, seatsLeft) {
  const area = document.getElementById('join-area');

  if (!profile) {
    area.innerHTML = `
      <div class="alert alert-info mb">Log in as a student to join this batch.</div>
      <a class="btn btn-block" href="login.html">Log in to join</a>`;
    return;
  }

  if (profile.role === 'tutor' || profile.role === 'admin') {
    area.innerHTML =
      '<div class="alert alert-info">Only students can join a batch.</div>';
    return;
  }

  if (alreadyJoined) {
    area.innerHTML = `
      <div class="alert alert-success mb">&#10003; You have already joined this batch.</div>
      <a class="btn btn-block ${batch.is_live ? '' : 'btn-outline'}"
         href="batch-room.html?id=${batchId}">
        ${batch.is_live ? '&#9679; Class is live — join now' : 'Open the class room'}
      </a>
      <p class="hint center mt-sm">Live class and class chat are in here.</p>`;
    return;
  }

  if (seatsLeft <= 0) {
    area.innerHTML =
      '<div class="alert alert-warning">This batch is full. Try another one.</div>';
    return;
  }

  // Two ways to pay: straight from the wallet, or a fresh
  // payment with bKash / Nagad / Rocket / card.
  area.innerHTML = `
    <a class="btn btn-lg btn-block" href="checkout.html?batch=${batchId}">
      Pay ${taka(batch.monthly_fee)} and join
    </a>
    <p class="hint center mt-sm">bKash · Nagad · Rocket · Card</p>

    <div class="or-line"><span>or</span></div>

    <button class="btn btn-outline btn-block" id="join-btn" type="button">
      Use my wallet balance
    </button>
    <p class="hint center mt-sm">
      Takes ${taka(batch.monthly_fee)} from the money already in your wallet.
    </p>`;

  document.getElementById('join-btn').addEventListener('click', joinBatch);
}

// ---- Joining -----------------------------------------------
async function joinBatch() {
  const button = document.getElementById('join-btn');
  busy(button, true, 'Joining...');

  // One call. The database does all the steps together.
  const { error } = await supabase.rpc('enrol_in_batch', { p_batch_id: batchId });

  if (error) {
    // The database sends back a clear sentence, so show it.
    toast(error.message, 'error');
    busy(button, false);

    if (error.message.includes('balance')) {
      setTimeout(() => (window.location.href = 'student-wallet.html'), 1500);
    }
    return;
  }

  toast('You joined the batch.', 'success');
  setTimeout(() => (window.location.href = 'student-dashboard.html'), 900);
}

// ---- Reviews of this tutor ---------------------------------
async function loadReviews(tutorId) {
  const box = document.getElementById('reviews');

  const { data: reviews } = await supabase
    .from('reviews')
    .select('rating, comment, created_at, profiles ( full_name )')
    .eq('tutor_id', tutorId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!reviews || reviews.length === 0) {
    box.innerHTML = '<p class="muted">No reviews yet for this tutor.</p>';
    return;
  }

  box.innerHTML = reviews
    .map(
      (r) => `
      <div class="review-item">
        <div class="row">
          <span class="stars">${stars(r.rating)}</span>
          <span class="strong">${safe(r.profiles?.full_name || 'Student')}</span>
          <span class="muted">${timeAgo(r.created_at)}</span>
        </div>
        ${r.comment ? `<p class="mt-xs">${safe(r.comment)}</p>` : ''}
      </div>`
    )
    .join('');
}
