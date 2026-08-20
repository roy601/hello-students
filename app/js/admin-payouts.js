// ============================================================
//  ADMIN — WITHDRAWALS
//
//  A tutor asked for their earnings. The admin sends the money
//  by bKash or Nagad by hand, then records it here.
//
//  Worth being clear about what "Mark as paid" does: nothing
//  to the money. The tutor's wallet was debited the moment
//  they asked, so this only writes down that the transfer
//  happened, and stores the bKash reference next to it.
//
//  "Turn down" is the one that moves money — it puts the held
//  amount back in the tutor's wallet.
//
//  Both go through settle_payout in the database, which checks
//  the caller is really an admin.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { renderTopbar, requireRole } from './session.js';
import { toast, busy, showLoading, showEmpty, renderPageHero,
         setupReveal, confirmBox } from './ui.js';
import { safe, taka, timeAgo, initials } from './format.js';

const statsBox = document.getElementById('payout-stats');
const pendingBox = document.getElementById('pending-list');
const settledBox = document.getElementById('settled-list');
const pendingCount = document.getElementById('pending-count');

let me = null;

start();

async function start() {
  renderTopbar('admin-payouts.html');
  renderPageHero({
    eyebrow: 'Admin',
    title: 'Withdrawals',
    subtitle: 'Send tutors their earnings, then record it here.',
  });
  setupReveal();

  me = await requireRole('admin');
  if (!me) return;

  await load();
}

async function load() {
  showLoading(pendingBox, 2);
  showLoading(settledBox, 2);

  const { data, error } = await supabase
    .from('payout_requests')
    .select(`
      id, amount, method, account, status, admin_note, reference,
      created_at, settled_at,
      profiles ( full_name, phone )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    pendingBox.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    settledBox.innerHTML = '';
    return;
  }

  const all = data || [];
  const pending = all.filter((r) => r.status === 'pending');
  const settled = all.filter((r) => r.status !== 'pending');

  drawStats(pending, settled);
  pendingCount.textContent = pending.length;

  if (pending.length === 0) {
    showEmpty(pendingBox, 'tick', 'Nothing waiting', 'Every tutor has been paid.');
  } else {
    pendingBox.innerHTML = pending.map(pendingHtml).join('');
    wire();
  }

  if (settled.length === 0) {
    showEmpty(settledBox, 'wallet', 'Nothing settled yet', 'Withdrawals you handle will be listed here.');
  } else {
    settledBox.innerHTML = settled.map(settledHtml).join('');
  }
}

function drawStats(pending, settled) {
  const owed = pending.reduce((sum, r) => sum + r.amount, 0);
  const paid = settled.filter((r) => r.status === 'paid');
  const sent = paid.reduce((sum, r) => sum + r.amount, 0);

  statsBox.innerHTML = `
    <div class="stat">
      <div class="label">Waiting</div>
      <div class="value brand">${pending.length}</div>
    </div>
    <div class="stat">
      <div class="label">You owe</div>
      <div class="value">${taka(owed)}</div>
      <div class="sub">already held from wallets</div>
    </div>
    <div class="stat">
      <div class="label">Paid out</div>
      <div class="value">${taka(sent)}</div>
      <div class="sub">across ${paid.length} withdrawals</div>
    </div>
    <div class="stat">
      <div class="label">Turned down</div>
      <div class="value">${settled.length - paid.length}</div>
    </div>`;
}


// ============================================================
//  ONE WITHDRAWAL STILL WAITING
// ============================================================
function pendingHtml(r) {
  const tutor = r.profiles?.full_name || 'Tutor';

  return `
    <div class="dispute">
      <div class="dispute-head">
        <span class="avatar">${initials(tutor)}</span>
        <div class="dispute-who">
          <div class="strong">${safe(tutor)}</div>
          <div class="hint">
            ${safe(r.profiles?.phone || 'no phone')} · asked ${timeAgo(r.created_at)}
          </div>
        </div>
        <span class="badge badge-warning">Waiting</span>
      </div>

      <p class="dispute-about">
        Send <strong>${taka(r.amount)}</strong> to
        <strong>${safe(r.method)} ${safe(r.account)}</strong>
      </p>

      <div class="grid-2">
        <div class="field">
          <label for="ref-${r.id}">bKash / Nagad reference</label>
          <input id="ref-${r.id}" type="text" maxlength="60"
                 placeholder="TrxID from your app" />
        </div>
        <div class="field">
          <label for="pnote-${r.id}">Note <span class="muted">(optional)</span></label>
          <input id="pnote-${r.id}" type="text" maxlength="1000"
                 placeholder="The tutor will read this." />
        </div>
      </div>

      <div class="row-end mt-sm">
        <button class="btn btn-outline" type="button"
                data-reject="${r.id}" id="prej-${r.id}">
          Turn down
        </button>
        <button class="btn" type="button" data-paid="${r.id}" id="ppaid-${r.id}">
          ${icon('tick', 'ico-sm')} Mark as paid
        </button>
      </div>
    </div>`;
}

function settledHtml(r) {
  const tutor = r.profiles?.full_name || 'Tutor';
  const wasPaid = r.status === 'paid';

  return `
    <div class="dispute settled">
      <div class="dispute-head">
        <span class="avatar avatar-sm">${initials(tutor)}</span>
        <div class="dispute-who">
          <div class="strong">${safe(tutor)}</div>
          <div class="hint">
            ${safe(r.method)} ${safe(r.account)} · settled ${timeAgo(r.settled_at)}
          </div>
        </div>
        <span class="badge ${wasPaid ? 'badge-success' : 'badge-danger'}">
          ${wasPaid ? 'Paid ' + taka(r.amount) : 'Turned down'}
        </span>
      </div>

      ${r.reference ? `<p class="hint"><strong>Reference:</strong> ${safe(r.reference)}</p>` : ''}
      ${r.admin_note ? `<p class="hint"><strong>You said:</strong> ${safe(r.admin_note)}</p>` : ''}
    </div>`;
}


// ============================================================
//  DECIDING
// ============================================================
function wire() {
  pendingBox.querySelectorAll('[data-paid]').forEach((b) =>
    b.addEventListener('click', () => settle(b.dataset.paid, 'paid'))
  );
  pendingBox.querySelectorAll('[data-reject]').forEach((b) =>
    b.addEventListener('click', () => settle(b.dataset.reject, 'reject'))
  );
}

async function settle(id, action) {
  const isPaid = action === 'paid';

  const yes = await confirmBox(
    isPaid ? 'Mark this as paid?' : 'Turn this withdrawal down?',
    isPaid
      ? 'Only do this once the money has actually left your bKash or Nagad account.'
      : 'The money goes back into the tutor’s wallet and they can ask again.',
    isPaid ? 'Mark as paid' : 'Turn down'
  );
  if (!yes) return;

  const button = document.getElementById((isPaid ? 'ppaid-' : 'prej-') + id);

  busy(button, true, 'Saving...');

  const { error } = await supabase.rpc('settle_payout', {
    p_payout_id: Number(id),
    p_action: action,
    p_note: document.getElementById('pnote-' + id).value.trim(),
    p_reference: document.getElementById('ref-' + id).value.trim(),
  });

  busy(button, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast(isPaid ? 'Recorded as paid.' : 'Turned down, money returned.', 'success');
  await load();
}
