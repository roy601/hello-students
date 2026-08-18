// ============================================================
//  ADMIN — COMPLAINTS
//
//  A student says something went wrong with a batch they paid
//  for. An admin reads it and does one of two things:
//
//    Refund   the student gets their money back, the tutor
//             loses the 85% they were paid, and the seat goes
//             back on sale
//    Turn down  nothing moves, and the student is told why
//
//  Neither decision is made here. Both call resolve_dispute in
//  the database, which checks the caller really is an admin
//  before touching a single wallet. This page only collects
//  the decision and shows the result.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { renderTopbar, requireRole } from './session.js';
import { toast, busy, showLoading, showEmpty, renderPageHero,
         setupReveal, confirmBox } from './ui.js';
import { safe, taka, timeAgo, initials } from './format.js';

const statsBox = document.getElementById('dispute-stats');
const openBox = document.getElementById('open-list');
const closedBox = document.getElementById('closed-list');
const openCount = document.getElementById('open-count');

let me = null;

start();

async function start() {
  renderTopbar('admin-disputes.html');
  renderPageHero({
    eyebrow: 'Admin',
    title: 'Complaints',
    subtitle: 'Refund a student, or turn the complaint down.',
  });
  setupReveal();

  me = await requireRole('admin');
  if (!me) return;

  await load();
}

async function load() {
  showLoading(openBox, 2);
  showLoading(closedBox, 2);

  const { data, error } = await supabase
    .from('disputes')
    .select(`
      id, reason, status, admin_note, refunded, created_at, resolved_at,
      enrolment_id, batch_id,
      profiles ( full_name, phone ),
      batches ( title, monthly_fee, tutor_profiles ( profiles ( full_name ) ) )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    openBox.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    closedBox.innerHTML = '';
    return;
  }

  const all = data || [];
  const open = all.filter((d) => d.status === 'open');
  const closed = all.filter((d) => d.status !== 'open');

  drawStats(all, open, closed);

  openCount.textContent = open.length;

  if (open.length === 0) {
    showEmpty(openBox, 'tick', 'Nothing waiting', 'Every complaint has been dealt with.');
  } else {
    openBox.innerHTML = open.map(openHtml).join('');
    wireOpen();
  }

  if (closed.length === 0) {
    showEmpty(closedBox, 'chat', 'Nothing settled yet', 'Decisions you make will be listed here.');
  } else {
    closedBox.innerHTML = closed.map(closedHtml).join('');
  }
}

function drawStats(all, open, closed) {
  const refunded = closed.filter((d) => d.status === 'refunded');
  const givenBack = refunded.reduce((sum, d) => sum + (d.refunded || 0), 0);

  statsBox.innerHTML = `
    <div class="stat">
      <div class="label">Waiting</div>
      <div class="value brand">${open.length}</div>
    </div>
    <div class="stat">
      <div class="label">Refunded</div>
      <div class="value">${refunded.length}</div>
    </div>
    <div class="stat">
      <div class="label">Turned down</div>
      <div class="value">${closed.length - refunded.length}</div>
    </div>
    <div class="stat">
      <div class="label">Given back</div>
      <div class="value">${taka(givenBack)}</div>
      <div class="sub">across every refund</div>
    </div>`;
}


// ============================================================
//  ONE COMPLAINT STILL WAITING
// ============================================================
function openHtml(d) {
  const student = d.profiles?.full_name || 'Student';
  const tutor = d.batches?.tutor_profiles?.profiles?.full_name || 'Tutor';
  const fee = d.batches?.monthly_fee || 0;

  return `
    <div class="dispute">
      <div class="dispute-head">
        <span class="avatar">${initials(student)}</span>
        <div class="dispute-who">
          <div class="strong">${safe(student)}</div>
          <div class="hint">
            ${safe(d.profiles?.phone || 'no phone')} · complained ${timeAgo(d.created_at)}
          </div>
        </div>
        <span class="badge badge-warning">Waiting</span>
      </div>

      <p class="dispute-about">
        About <strong>${safe(d.batches?.title || 'a batch')}</strong>,
        taught by ${safe(tutor)} · ${taka(fee)} per month
      </p>

      <blockquote class="dispute-reason">${safe(d.reason)}</blockquote>

      <div class="field">
        <label for="note-${d.id}">Your note to the student</label>
        <input id="note-${d.id}" type="text" maxlength="1000"
               placeholder="Why you decided this. The student will read it." />
      </div>

      <div class="row-end mt-sm">
        <button class="btn btn-outline" type="button" data-reject="${d.id}"
                id="rej-${d.id}">
          Turn down
        </button>
        <button class="btn btn-danger" type="button" data-refund="${d.id}"
                id="ref-${d.id}">
          ${icon('wallet', 'ico-sm')} Refund ${taka(fee)}
        </button>
      </div>
    </div>`;
}

function closedHtml(d) {
  const student = d.profiles?.full_name || 'Student';
  const wasRefund = d.status === 'refunded';

  return `
    <div class="dispute settled">
      <div class="dispute-head">
        <span class="avatar avatar-sm">${initials(student)}</span>
        <div class="dispute-who">
          <div class="strong">${safe(student)}</div>
          <div class="hint">
            ${safe(d.batches?.title || 'a batch')} · settled ${timeAgo(d.resolved_at)}
          </div>
        </div>
        <span class="badge ${wasRefund ? 'badge-success' : ''}">
          ${wasRefund ? 'Refunded ' + taka(d.refunded) : 'Turned down'}
        </span>
      </div>

      <blockquote class="dispute-reason">${safe(d.reason)}</blockquote>

      ${d.admin_note
        ? `<p class="hint"><strong>You said:</strong> ${safe(d.admin_note)}</p>`
        : ''}
    </div>`;
}


// ============================================================
//  DECIDING
// ============================================================
function wireOpen() {
  openBox.querySelectorAll('[data-refund]').forEach((button) =>
    button.addEventListener('click', () => decide(button.dataset.refund, 'refund'))
  );

  openBox.querySelectorAll('[data-reject]').forEach((button) =>
    button.addEventListener('click', () => decide(button.dataset.reject, 'reject'))
  );
}

async function decide(id, action) {
  const isRefund = action === 'refund';

  //  Refunding moves real money and cannot be undone from this
  //  page, so ask once before doing it.
  if (isRefund) {
    const yes = await confirmBox(
      'Refund this student?',
      'The money goes back to the student, the tutor loses their share, ' +
        'and the seat is put back on sale. This cannot be undone here.',
      'Refund'
    );
    if (!yes) return;
  }

  const button = document.getElementById((isRefund ? 'ref-' : 'rej-') + id);
  const note = document.getElementById('note-' + id).value.trim();

  busy(button, true, isRefund ? 'Refunding...' : 'Saving...');

  const { error } = await supabase.rpc('resolve_dispute', {
    p_dispute_id: Number(id),
    p_action: action,
    p_note: note,
  });

  busy(button, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast(isRefund ? 'Refunded. The student has been told.' : 'Complaint turned down.', 'success');
  await load();
}
