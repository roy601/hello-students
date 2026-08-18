// ============================================================
//  STUDENT DASHBOARD
//
//  Lists the batches this student joined, lets them leave a
//  review for each one, and lets them report a problem if
//  something went wrong.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { toast, busy, showLoading, showEmpty, renderPageHero,
         setupReveal } from './ui.js';
import { formatTime, taka, formatDate, stars, safe } from './format.js';

const statsBox = document.getElementById('stats');
const classesBox = document.getElementById('classes');

let me = null;
let disputes = new Map();   // enrolment id -> the complaint on it

start();

async function start() {
  renderTopbar('student-dashboard.html');
  renderPageHero({
    eyebrow: 'Student',
    title: 'My classes',
    subtitle: 'Every batch you have joined.',
    actions: '<a class="btn btn-outline" href="browse.html">Find another batch</a>',
  });
  setupReveal();

  me = await requireRole('student');
  if (!me) return;

  await loadClasses();
}

async function loadClasses() {
  showLoading(classesBox, 3);

  // Bring the enrolment, the batch, its subject and area, and
  // the tutor's name, all in one request.
  const { data: rows, error } = await supabase
    .from('enrolments')
    .select(`
      id, fee_paid, created_at,
      batches (
        id, title, days, start_time, end_time, monthly_fee, is_online, is_live,
        subjects ( name_en, grade_level ),
        areas ( name_en, city ),
        tutor_profiles ( id, profiles ( full_name ) )
      )
    `)
    .eq('student_id', me.id)
    //  A refunded class is set to 'left', so leaving it out
    //  keeps it from being counted in "batches joined" and
    //  "paid in total" when the money has gone back.
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    classesBox.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  // Which of these have I already reviewed?
  const { data: myReviews } = await supabase
    .from('reviews')
    .select('enrolment_id, rating')
    .eq('student_id', me.id);

  const reviewed = new Map((myReviews || []).map((r) => [r.enrolment_id, r.rating]));

  drawStats(rows || []);

  if (!rows || rows.length === 0) {
    showEmpty(
      classesBox,
      'book',
      'You have not joined a batch yet',
      'Find a batch by subject, area and monthly fee.',
      { href: 'browse.html', label: 'Find a batch' }
    );
    return;
  }

  await loadDisputes(rows.map((r) => r.id));

  classesBox.innerHTML = rows
    .map((row) => classHtml(row, reviewed.get(row.id)))
    .join('');

  // Wire up every "Rate tutor" button.
  classesBox.querySelectorAll('[data-review]').forEach((button) => {
    button.addEventListener('click', () => openReview(button.dataset.review));
  });

  // ...and every "Report a problem" button.
  classesBox.querySelectorAll('[data-dispute]').forEach((button) => {
    button.addEventListener('click', () => openDispute(button.dataset.dispute));
  });
}

//  Any complaint this student has already made. One query for
//  the whole list rather than one per row.
async function loadDisputes(enrolmentIds) {
  disputes = new Map();
  if (enrolmentIds.length === 0) return;

  const { data } = await supabase
    .from('disputes')
    .select('id, enrolment_id, status, reason, admin_note, refunded')
    .in('enrolment_id', enrolmentIds);

  (data || []).forEach((d) => disputes.set(d.enrolment_id, d));
}

function drawStats(rows) {
  const totalPaid = rows.reduce((sum, r) => sum + r.fee_paid, 0);

  statsBox.innerHTML = `
    <div class="stat">
      <div class="label">Batches joined</div>
      <div class="value brand">${rows.length}</div>
    </div>
    <div class="stat">
      <div class="label">Paid in total</div>
      <div class="value">${taka(totalPaid)}</div>
    </div>
    <div class="stat">
      <div class="label">Per month</div>
      <div class="value">${taka(totalPaid)}</div>
      <div class="sub">while you stay in these batches</div>
    </div>`;
}

function classHtml(row, myRating) {
  const batch = row.batches;
  if (!batch) return '';

  const tutorName = batch.tutor_profiles?.profiles?.full_name || 'Tutor';
  const place = batch.is_online
    ? 'Online'
    : batch.areas
      ? batch.areas.name_en
      : 'Area not set';

  //  A class can be in one of three states here: no complaint,
  //  one waiting for an admin, or one already settled.
  const dispute = disputes.get(row.id);

  const disputePart = !dispute
    ? `<button class="btn btn-ghost btn-sm" type="button" data-dispute="${row.id}">
         Report a problem
       </button>`
    : dispute.status === 'open'
      ? '<span class="badge badge-warning">Complaint being reviewed</span>'
      : dispute.status === 'refunded'
        ? `<span class="badge badge-success">Refunded ${taka(dispute.refunded)}</span>`
        : '<span class="badge">Complaint turned down</span>';

  const reviewPart =
    myRating !== undefined
      ? `<span class="stars">${stars(myRating)}</span>
         <span class="muted small">You rated this</span>`
      : `<button class="btn btn-outline btn-sm" type="button"
                 data-review="${row.id}|${batch.id}|${batch.tutor_profiles.id}">
           Rate tutor
         </button>`;

  return `
    <div class="list-row">
      <div class="body">
        <h3><a href="batch.html?id=${batch.id}">${safe(batch.title)}</a></h3>
        <p class="muted">${safe(batch.subjects.name_en)} · ${safe(batch.subjects.grade_level)}</p>
        <p class="muted">
          ${safe(batch.days)} · ${formatTime(batch.start_time)}–${formatTime(batch.end_time)}
        </p>
        <p class="muted">${safe(place)} · with ${safe(tutorName)}</p>
        <p class="muted small mt-xs">Joined ${formatDate(row.created_at)}</p>
      </div>
      <div class="side stack-sm">
        <div class="price">${taka(batch.monthly_fee)}<small>per month</small></div>
        <a class="btn btn-sm ${batch.is_live ? '' : 'btn-outline'}"
           href="batch-room.html?id=${batch.id}">
          ${batch.is_live ? '&#9679; Class is live — join' : 'Class room'}
        </a>
        <div class="row-end">${reviewPart}</div>
          <div class="row-end mt-xs">${disputePart}</div>
      </div>
    </div>`;
}

// ---- The complaint box -------------------------------------
//
//  Opening a complaint can move money, if an admin upholds it,
//  so the browser does not write to the disputes table itself.
//  It calls raise_dispute, which checks the enrolment really
//  belongs to this student before writing anything.
function openDispute(enrolmentId) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <h2>Report a problem</h2>
      <p class="muted mb">
        Tell us what went wrong. An admin reads every complaint and
        can refund the month if it is fair.
      </p>

      <div class="field mb">
        <label for="dispute-text">What happened?</label>
        <textarea id="dispute-text" rows="5" maxlength="2000"
                  placeholder="The tutor did not take any class this month."></textarea>
        <p class="hint">Please write at least a sentence.</p>
      </div>

      <div class="row-end">
        <button class="btn btn-outline" type="button" data-cancel>Cancel</button>
        <button class="btn" type="button" data-send>Send complaint</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  const close = () => back.remove();
  back.querySelector('[data-cancel]').addEventListener('click', close);
  back.addEventListener('click', (event) => {
    if (event.target === back) close();
  });

  back.querySelector('[data-send]').addEventListener('click', async () => {
    const send = back.querySelector('[data-send]');
    const reason = back.querySelector('#dispute-text').value.trim();

    if (reason.length < 10) {
      toast('Please explain the problem in a sentence or two.', 'error');
      return;
    }

    busy(send, true, 'Sending...');

    const { error } = await supabase.rpc('raise_dispute', {
      p_enrolment_id: Number(enrolmentId),
      p_reason: reason,
    });

    busy(send, false);

    if (error) {
      toast(error.message, 'error');
      return;
    }

    close();
    toast('Complaint sent. An admin will look at it.', 'success');
    await loadClasses();
  });
}


// ---- The review box ----------------------------------------
function openReview(dataString) {
  const [enrolmentId, batchId, tutorId] = dataString.split('|');
  let chosen = 0;

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <h2>Rate your tutor</h2>
      <p class="muted mb">Your rating helps other students choose.</p>

      <div class="star-pick mb" id="star-pick">
        ${[1, 2, 3, 4, 5]
          .map((n) => `<button type="button" data-star="${n}">&#9733;</button>`)
          .join('')}
      </div>

      <div class="field mb">
        <label for="review-text">Comment (you can leave this empty)</label>
        <textarea id="review-text" placeholder="How were the classes?"></textarea>
      </div>

      <div class="row-end">
        <button class="btn btn-outline" type="button" data-cancel>Cancel</button>
        <button class="btn" type="button" data-send>Send review</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  // Light up the stars up to the one clicked.
  const starButtons = back.querySelectorAll('[data-star]');
  starButtons.forEach((button) => {
    button.addEventListener('click', () => {
      chosen = Number(button.dataset.star);
      starButtons.forEach((other) => {
        other.classList.toggle('on', Number(other.dataset.star) <= chosen);
      });
    });
  });

  back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
  back.addEventListener('click', (e) => {
    if (e.target === back) back.remove();
  });

  back.querySelector('[data-send]').addEventListener('click', async () => {
    if (chosen === 0) {
      toast('Please choose from 1 to 5 stars.', 'error');
      return;
    }

    const { error } = await supabase.from('reviews').insert({
      enrolment_id: Number(enrolmentId),
      batch_id: Number(batchId),
      tutor_id: tutorId,
      student_id: me.id,
      rating: chosen,
      comment: back.querySelector('#review-text').value.trim() || null,
    });

    if (error) {
      toast(error.message, 'error');
      return;
    }

    back.remove();
    toast('Thank you for your review.', 'success');
    await loadClasses();
  });
}
