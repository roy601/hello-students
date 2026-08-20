// ============================================================
//  UDDOKTAPAY
//
//  Your own instance lives at PAYMENT_BASE_URL, for example
//  https://hello-students.paymently.io — the dashboard shows
//  it with /api on the end, and either form works here.
//
//  Two calls are all we use:
//
//    POST /api/checkout-v2      start a payment, get a URL
//    POST /api/verify-payment   ask whether it really happened
//
//  Both carry the key in the header RT-UDDOKTAPAY-API-KEY,
//  which must never reach the browser. That is the whole
//  reason this file lives in /server.
//
//  THREE THINGS THAT WILL CATCH YOU OUT, all confirmed by
//  calling their sandbox rather than reading the docs:
//
//    1. Everything answers HTTP 200 — even a wrong API key and
//       an unknown invoice. Never branch on the status code,
//       only on what is in the body.
//
//    2. The "status" field is not one type. Creating a charge
//       answers  status: true  (a boolean). Verifying answers
//       status: "COMPLETED" | "PENDING" | "ERROR" (a string).
//
//    3. Creating a charge does NOT give you an invoice id — it
//       only gives you a URL, and the token in that URL is not
//       the invoice id either (verifying with it comes back
//       "No Data Found"). The id exists only once the student
//       has been through the page, and reaches us on the way
//       back or in the webhook. That is why our own reference
//       travels in metadata: it is the one thread that ties a
//       payment back to a row in our payments table.
// ============================================================

//  Accept the root or the /api form, and never end in a slash.
const BASE = (process.env.PAYMENT_BASE_URL || 'https://sandbox.uddoktapay.com')
  .replace(/\/+$/, '')
  .replace(/\/api$/, '');

const KEY = process.env.PAYMENT_API_KEY;

const HEADER = 'RT-UDDOKTAPAY-API-KEY';

//  server.js reads this so a missing key switches payments off
//  cleanly, instead of failing halfway through a checkout.
function missingSettings() {
  return [['PAYMENT_API_KEY', KEY]].filter(([, v]) => !v).map(([n]) => n);
}

async function call(path, body) {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      [HEADER]: KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    //  A misconfigured base URL answers with an HTML page.
    //  Saying that beats "unexpected token < in JSON".
    throw new Error(
      'UddoktaPay at ' + BASE + ' did not answer with JSON (HTTP ' +
        response.status + '). Check PAYMENT_BASE_URL.'
    );
  }

  //  A wrong key looks exactly like a missing payment unless
  //  the message is read, so name that case out loud.
  if (data && data.message === 'Api Do Not Match') {
    throw new Error('UddoktaPay rejected the API key. Check PAYMENT_API_KEY.');
  }

  return data;
}


// ============================================================
//  1. START A PAYMENT
// ============================================================
async function createCharge({ order, name, contact, urls }) {
  const data = await call('/api/checkout-v2', {
    full_name: name || 'Student',
    //  Their field is email and they do validate it, so a phone
    //  number cannot go here.
    email: contact,
    amount: String(order.amount),
    metadata: { tran_id: order.tran_id },
    redirect_url: urls.success,
    cancel_url: urls.cancel,
    webhook_url: urls.webhook,
    return_type: 'GET',
  });

  if (!data || data.status !== true || !data.payment_url) {
    throw new Error(data?.message || 'UddoktaPay did not give a payment page');
  }

  //  No invoice id exists yet (see note 3 at the top), so there
  //  is nothing to hand back but the URL.
  return { redirectUrl: data.payment_url };
}


// ============================================================
//  2. IS IT REAL?
//
//  Asked of UddoktaPay directly, never taken from whatever the
//  browser or the webhook body claims. A message saying "this
//  was paid" proves nothing on its own — anyone can send one.
// ============================================================
async function verify(invoiceId) {
  const data = await call('/api/verify-payment', {
    invoice_id: String(invoiceId),
  });

  const state = String(data?.status || '').toUpperCase();

  if (state !== 'COMPLETED') {
    return { paid: false, why: data?.message || state || 'unknown' };
  }

  return {
    paid: true,
    //  amount comes back as a decimal string like "100.00"
    amount: Number(data.amount),
    tranId: data.metadata?.tran_id || null,
    reference: data.transaction_id || String(invoiceId),
    method: data.payment_method || null,
    sender: data.sender_number || null,
  };
}


// ============================================================
//  3. IS THIS WEBHOOK FROM UDDOKTAPAY?
//
//  It arrives with the same key in the header. Anything else
//  is someone guessing at the address, and gets a 401. We
//  still verify afterwards: a correct key proves who sent the
//  message, not that money moved.
// ============================================================
function webhookKeyIsGood(headers) {
  //  Node lower-cases incoming header names; the others are
  //  here for anything sitting in front of us that does not.
  const sent =
    headers[HEADER.toLowerCase()] ||
    headers[HEADER] ||
    headers['rt-uddoktapay-api-key'];

  if (!sent || !KEY) return false;

  //  Compared the boring way rather than with ===, so the time
  //  it takes does not leak how much of the key was right.
  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(KEY));
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

//  return_type is GET, so the student comes back with
//  ?invoice_id=... on the URL. The webhook carries it in the
//  body instead.
function readInvoiceId(req) {
  const from = { ...(req.query || {}), ...(req.body || {}) };
  return from.invoice_id || null;
}

module.exports = {
  name: 'uddoktapay',
  missingSettings,
  createCharge,
  verify,
  webhookKeyIsGood,
  readInvoiceId,
  baseUrl: BASE,
};
