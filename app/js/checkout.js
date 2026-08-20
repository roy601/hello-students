// ============================================================
//  CHECKOUT — paying for one batch
//
//  This one page handles the whole payment:
//
//    checkout.html?batch=7      pick how to pay, then pay
//    checkout.html?tran=HS-7-x  coming back from the gateway
//
//  The second address is what the gateway sends the student
//  back to, so the page has to work both ways.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { renderPageHero, toast, busy, showLoading } from './ui.js';
import { taka, formatTime, safe } from './format.js';
import {
  METHODS,
  startPayment, openGateway, getPayment, finishEnrolment,
} from './gateway.js';

const box = document.getElementById('checkout');
const params = new URLSearchParams(window.location.search);
const batchId = Number(params.get('batch'));
const tranId = params.get('tran');

let me = null;

start();

async function start() {
  renderTopbar();
  renderPageHero({
    eyebrow: 'Secure payment',
    title: tranId ? 'Finishing your payment' : 'Checkout',
    subtitle: 'Pay for one batch with bKash, Nagad, Rocket or a card.',
  });
  showLoading(box, 1);

  me = await requireRole('student');
  if (!me) return;

  // Coming back from the gateway
  if (tranId) {
    await handleReturn();
    return;
  }

  if (!batchId) {
    box.innerHTML = '<div class="alert alert-danger">No batch was chosen.</div>';
    return;
  }

  await showOrder();
}


// ============================================================
//  BEFORE PAYING — show what they are buying
// ============================================================
async function showOrder() {
  const { data: batch, error } = await supabase
    .from('batches')
    .select(`
      id, title, days, start_time, end_time, monthly_fee,
      seat_limit, seats_taken, is_online,
      subjects ( name_en, grade_level ),
      areas ( name_en ),
      tutor_profiles ( profiles ( full_name ) )
    `)
    .eq('id', batchId)
    .maybeSingle();

  if (error || !batch) {
    box.innerHTML = '<div class="alert alert-danger">This batch was not found.</div>';
    return;
  }

  const tutorName = batch.tutor_profiles?.profiles?.full_name || 'Tutor';
  const place = batch.is_online
    ? 'Online'
    : batch.areas ? batch.areas.name_en : 'In person';

  const methodButtons = METHODS.map(
    (m, i) => `
      <label class="pay-opt ${i === 0 ? 'on' : ''}">
        <input type="radio" name="method" value="${m.id}" ${i === 0 ? 'checked' : ''} />
        <span>${m.label}</span>
      </label>`
  ).join('');

  box.innerHTML = `
    <div class="card mb">
      <h2 class="mb">You are paying for</h2>

      <div class="order-line">
        <div>
          <h3>${safe(batch.title)}</h3>
          <p class="muted">${safe(batch.subjects.name_en)} · ${safe(batch.subjects.grade_level)}</p>
          <p class="muted">
            ${safe(batch.days)} · ${formatTime(batch.start_time)}–${formatTime(batch.end_time)}
          </p>
          <p class="muted">${safe(place)} · with ${safe(tutorName)}</p>
        </div>
        <div class="price">${taka(batch.monthly_fee)}<small>per month</small></div>
      </div>

      <div class="order-total">
        <span>Total to pay now</span>
        <span class="price">${taka(batch.monthly_fee)}</span>
      </div>
      <p class="hint">This covers one month. You can leave any time after that.</p>
    </div>

    <div class="card mb">
      <h2 class="mb">How do you want to pay?</h2>
      <div class="pay-grid mb">${methodButtons}</div>

      <div class="alert alert-info mb">
        You will be taken to a secure payment page to finish paying.
      </div>

      <button class="btn btn-lg btn-block" type="button" id="pay-btn">
        Pay ${taka(batch.monthly_fee)}
      </button>
      <p class="hint center mt-sm">
        Prefer your wallet instead?
        <a href="batch.html?id=${batch.id}">Go back and use your balance</a>.
      </p>
    </div>`;

  // highlight the chosen method
  box.querySelectorAll('.pay-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      box.querySelectorAll('.pay-opt').forEach((o) => o.classList.remove('on'));
      opt.classList.add('on');
    });
  });

  document.getElementById('pay-btn').addEventListener('click', () => pay(batch));
}


// ============================================================
//  PAYING
// ============================================================
async function pay(batch) {
  const button = document.getElementById('pay-btn');
  const method = box.querySelector('input[name="method"]:checked').value;

  busy(button, true, 'Starting payment...');

  try {
    // 1. make the order in our database
    const newTranId = await startPayment(batch.id, method);

    // 2. send the student to the gateway
    //    This is the only way a payment can be completed. If it
    //    throws we stay here and say why, rather than pretending.
    const redirectUrl = await openGateway(newTranId);
    window.location.href = redirectUrl;
  } catch (err) {
    toast(err.message, 'error');
    busy(button, false);
  }
}


// ============================================================
//  AFTER PAYING — the gateway sent them back here
// ============================================================
async function handleReturn() {
  box.innerHTML = `
    <div class="card center">
      <div class="spinner" id="spin"></div>
      <h2 class="mt">Checking your payment</h2>
      <p class="muted mt-xs">This takes a few seconds. Please do not close the page.</p>
    </div>`;

  let payment = null;

  // The gateway may take a moment to tell our server, so look
  // a few times before giving up.
  for (let tries = 0; tries < 6; tries += 1) {
    payment = await getPayment(tranId);

    if (!payment) {
      box.innerHTML = '<div class="alert alert-danger">Payment not found.</div>';
      return;
    }
    if (payment.status !== 'initiated') break;

    await new Promise((r) => setTimeout(r, 1500));
  }

  if (payment.status === 'initiated') {
    showResult(false, 'Still waiting for the bank',
      'Your payment has not been confirmed yet. Refresh this page in a moment.');
    return;
  }

  if (payment.status === 'failed' || payment.status === 'cancelled') {
    showResult(false, 'Payment did not go through',
      'No money was taken. You can try again.');
    return;
  }

  // 'paid' -> give the seat.  'used' -> it already happened.
  if (payment.status === 'paid') {
    try {
      await finishEnrolment(tranId);
    } catch (err) {
      showResult(false, 'Payment received, but the seat failed', err.message);
      return;
    }
  }

  showResult(true, 'Payment complete',
    'You have joined the batch. It is now in My Classes.', payment);
}

function showResult(ok, title, message, payment) {
  box.innerHTML = `
    <div class="card center">
      <div class="result-mark ${ok ? 'good' : 'bad'}">${ok ? '&#10003;' : '&#10007;'}</div>
      <h2 class="mt">${title}</h2>
      <p class="muted mt-xs">${safe(message)}</p>

      ${payment
        ? `<div class="receipt mt">
             <div><span>Amount</span><span class="strong">${taka(payment.amount)}</span></div>
             <div><span>Method</span><span>${safe(payment.method || 'card')}</span></div>
             <div><span>Reference</span><span class="mono">${safe(payment.tran_id)}</span></div>
           </div>`
        : ''}

      <div class="row center-row mt-md">
        ${ok
          ? '<a class="btn btn-lg" href="student-dashboard.html">Go to my classes</a>'
          : '<a class="btn btn-lg" href="browse.html">Back to batches</a>'}
      </div>
    </div>`;
}
