// ============================================================
//  WITHDRAW EARNINGS  (tutor side)
//
//  A tutor earns 85% of every fee into their wallet. This is
//  how it comes back out: they ask, an admin sends the money
//  by bKash or Nagad by hand, and marks it done.
//
//  The wallet is debited the moment the request is made, not
//  when it is paid. Otherwise the same 5,000 taka could be
//  requested twice and the site would owe money it never had.
//  Turning a request down puts it straight back.
//
//  Both of those steps are database functions, so the browser
//  cannot move its own money.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { toast, busy, showLoading } from './ui.js';
import { safe, taka, timeAgo } from './format.js';

//  Small withdrawals cost the admin the same effort as large
//  ones, so there is a floor. It must match the check on the
//  payout_requests table.
const MIN = 500;

let me = null;
let box = null;
let balance = 0;

export async function mountPayout(element, profile, walletBalance) {
  me = profile;
  box = element;
  balance = walletBalance || 0;

  await draw();
}

async function draw() {
  showLoading(box, 1);

  const { data: rows, error } = await supabase
    .from('payout_requests')
    .select('id, amount, method, account, status, admin_note, reference, created_at, settled_at')
    .eq('tutor_id', me.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    box.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  const list = rows || [];
  const waiting = list.find((r) => r.status === 'pending');

  box.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Withdraw earnings</h2>
        <span class="badge badge-brand">${taka(balance)} available</span>
      </div>

      ${waiting ? waitingHtml(waiting) : formHtml()}

      ${list.length > 0
        ? `<h4 class="mt-md mb-sm">Past withdrawals</h4>${list.map(rowHtml).join('')}`
        : ''}
    </div>`;

  if (!waiting) {
    document.getElementById('payout-form').addEventListener('submit', send);
  }
}

// ------------------------------------------------------------
//  Nothing to do while one is in flight, so say so plainly
//  rather than showing a form that would be refused.
// ------------------------------------------------------------
function waitingHtml(r) {
  return `
    <div class="alert alert-info">
      <strong>${taka(r.amount)} is on its way.</strong>
      Asked ${timeAgo(r.created_at)}, going to your ${safe(r.method)}
      account ${safe(r.account)}. You can ask for another once
      this one is done.
    </div>`;
}

function formHtml() {
  //  Nothing to withdraw yet: explain instead of showing a form
  //  that can only fail.
  if (balance < MIN) {
    return `
      <p class="muted">
        You can withdraw once you have ${taka(MIN)}. You have
        ${taka(balance)} so far — it grows every time a student
        joins one of your batches.
      </p>`;
  }

  return `
    <form id="payout-form">
      <div class="grid-2">
        <div class="field">
          <label for="po-amount">How much?</label>
          <input id="po-amount" type="number" min="${MIN}" max="${balance}"
                 value="${balance}" required />
          <p class="hint">Between ${taka(MIN)} and ${taka(balance)}.</p>
        </div>

        <div class="field">
          <label for="po-method">Send it to</label>
          <select id="po-method">
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
            <option value="bank">Bank account</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label for="po-account">Your number</label>
        <input id="po-account" type="text" maxlength="40" required
               placeholder="01XXXXXXXXX" />
        <p class="hint">Check this carefully. Money sent to a wrong number cannot be got back.</p>
      </div>

      <button class="btn" type="submit" id="po-btn">
        ${icon('wallet', 'ico-sm')} Request withdrawal
      </button>
    </form>`;
}

function rowHtml(r) {
  const badge =
    r.status === 'paid'
      ? '<span class="badge badge-success">Paid</span>'
      : r.status === 'rejected'
        ? '<span class="badge badge-danger">Turned down</span>'
        : '<span class="badge badge-warning">Waiting</span>';

  return `
    <div class="list-row compact">
      <div class="body">
        <h3>${taka(r.amount)} ${badge}</h3>
        <p class="muted small">
          ${safe(r.method)} · ${safe(r.account)} · asked ${timeAgo(r.created_at)}
        </p>
        ${r.reference ? `<p class="hint">Reference: ${safe(r.reference)}</p>` : ''}
        ${r.admin_note ? `<p class="hint">${safe(r.admin_note)}</p>` : ''}
      </div>
    </div>`;
}

async function send(event) {
  event.preventDefault();

  const button = document.getElementById('po-btn');
  const amount = Number(document.getElementById('po-amount').value);
  const method = document.getElementById('po-method').value;
  const account = document.getElementById('po-account').value.trim();

  if (amount < MIN) {
    toast('The smallest withdrawal is ' + taka(MIN) + '.', 'error');
    return;
  }
  if (amount > balance) {
    toast('You only have ' + taka(balance) + '.', 'error');
    return;
  }

  busy(button, true, 'Sending...');

  const { error } = await supabase.rpc('request_payout', {
    p_amount: amount,
    p_method: method,
    p_account: account,
  });

  busy(button, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Requested. An admin will send the money.', 'success');

  //  the wallet has just been debited, so the figure on screen
  //  would otherwise be wrong until a refresh
  balance -= amount;
  await draw();
}
