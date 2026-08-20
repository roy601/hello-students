// ============================================================
//  PIPRAPAY
//
//  PipraPay is not a bank and it does not hold money. It is an
//  automation layer that sits on top of the bKash, Nagad and
//  Rocket accounts YOU already own: the student pays your
//  number, and PipraPay records and confirms it. That means
//  two things worth knowing before reading further.
//
//    1. You still need your own merchant accounts.
//    2. PipraPay itself is software you host. The address it
//       lives at goes in PIPRAPAY_BASE_URL. Their sandbox,
//       https://sandbox.piprapay.com, is fine for testing
//       before you stand your own copy up.
//
//  Three calls are all we use:
//
//    POST /api/create-charge     start a payment, get a URL
//    POST /api/verify-payments   ask whether it really happened
//    (webhook)                   PipraPay tells us directly
//
//  Every one of them carries the API key in the header
//  mh-piprapay-api-key. That key must never reach the browser,
//  which is the whole reason this file lives in /server.
// ============================================================

const BASE = (process.env.PIPRAPAY_BASE_URL || 'https://sandbox.piprapay.com')
  .replace(/\/+$/, '');                       // no trailing slash
const KEY = process.env.PIPRAPAY_API_KEY;

const HEADER = 'mh-piprapay-api-key';

//  Which settings this provider needs. server.js reads it so a
//  missing key switches payments off rather than failing oddly
//  halfway through a student's checkout.
function missingSettings() {
  return [['PIPRAPAY_API_KEY', KEY]].filter(([, v]) => !v).map(([n]) => n);
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
    //  A self-hosted PipraPay behind a broken web server answers
    //  with an HTML error page. Saying so beats "unexpected
    //  token < in JSON".
    throw new Error(
      'PipraPay at ' + BASE + ' did not answer with JSON (HTTP ' +
        response.status + '). Check PIPRAPAY_BASE_URL.'
    );
  }

  return data;
}


// ============================================================
//  1. START A PAYMENT
//
//  Our own order reference travels in metadata. That is the
//  thread that ties PipraPay's payment back to the row in our
//  payments table when the student comes back or the webhook
//  fires — neither of which is guaranteed to carry anything
//  else we recognise.
// ============================================================
async function createCharge({ order, name, contact, urls }) {
  const data = await call('/api/create-charge', {
    full_name: name || 'Student',
    email_mobile: contact || 'student@hellostudents.com',
    amount: String(order.amount),
    currency: 'BDT',
    metadata: { tran_id: order.tran_id },
    redirect_url: urls.success,
    cancel_url: urls.cancel,
    webhook_url: urls.webhook,
    return_type: 'GET',
  });

  if (!data || data.status !== true || !data.pp_url) {
    throw new Error(data?.message || 'PipraPay did not give a payment page');
  }

  return { redirectUrl: data.pp_url, providerRef: String(data.pp_id) };
}


// ============================================================
//  2. IS IT REAL?
//
//  Asked of PipraPay directly, never taken from whatever the
//  browser or the webhook body claims. A message saying "this
//  was paid" proves nothing on its own — anyone can send one.
// ============================================================
async function verify(ppId) {
  const data = await call('/api/verify-payments', { pp_id: String(ppId) });

  if (!data || data.status === false) {
    return { paid: false, why: data?.message || 'not valid' };
  }

  //  verify-payments answers with the payment itself, where
  //  status is the payment's own state, not a success flag.
  const state = String(data.status || '').toLowerCase();

  return {
    paid: state === 'completed',
    why: state || 'unknown',
    amount: Number(data.amount),
    tranId: data.metadata?.tran_id || null,
    reference: data.transaction_id || String(ppId),
    method: data.payment_method || null,
  };
}


// ============================================================
//  3. IS THIS WEBHOOK FROM PIPRAPAY?
//
//  It arrives with the same API key in the header. Anything
//  else is someone guessing at the address, and gets a 401.
//  We still call verify afterwards: a correct key proves who
//  sent it, not that the money moved.
// ============================================================
function webhookKeyIsGood(headers) {
  const sent =
    headers[HEADER] ||
    headers[HEADER.toUpperCase()] ||
    headers['Mh-Piprapay-Api-Key'];

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

//  PipraPay sends the student back with the payment id on the
//  URL. The docs call it invoice_id in one place and pp_id in
//  another, so accept either rather than break on the wording.
function readPaymentId(req) {
  const from = { ...(req.query || {}), ...(req.body || {}) };
  return from.pp_id || from.invoice_id || from.id || null;
}

module.exports = {
  name: 'piprapay',
  missingSettings,
  createCharge,
  verify,
  webhookKeyIsGood,
  readPaymentId,
  baseUrl: BASE,
};
