// ============================================================
//  HelloStudents — the server
//
//  It does two jobs:
//
//    1. SERVES THE WEBSITE from the /app folder
//    2. HANDLES PAYMENTS, because SSLCommerz needs a store
//       password. That password proves a request came from
//       our business. If it sat in app/js it would be public
//       and anyone could charge money through our account.
//
//  Both on one address, so the page and the payment API are
//  the same origin and no CORS setup is needed.
//
//  What the payment side does:
//    POST /api/payment/init     start a payment, get the URL
//    POST /api/payment/success  the student came back
//    POST /api/payment/fail     the payment failed
//    POST /api/payment/cancel   the student backed out
//    POST /api/payment/ipn      SSLCommerz tells us directly
//
//  Run it with:  npm start
// ============================================================

require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const SSLCommerzPayment = require('sslcommerz-lts');
const { createClient } = require('@supabase/supabase-js');
const { startEmailWorker } = require('./email');

const STORE_ID = process.env.STORE_ID;
const STORE_PASSWORD = process.env.STORE_PASSWORD;
const IS_LIVE = process.env.IS_LIVE === 'true';
const PORT = process.env.PORT || 5500;
const SELF = process.env.SELF_URL || 'http://localhost:' + PORT;
// The website and the API are on the same address now.
const SITE_URL = process.env.SITE_URL || SELF;

const path = require('path');
const APP_DIR = path.join(__dirname, '..', 'app');

// ---- which settings are present? ---------------------------
// The website must always run, even before you have an
// SSLCommerz account. So missing settings only switch OFF the
// payment routes, they never stop the server.
const missing = [
  ['STORE_ID', STORE_ID],
  ['STORE_PASSWORD', STORE_PASSWORD],
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
].filter(([, value]) => !value).map(([name]) => name);

const paymentsReady = missing.length === 0;

// This Supabase client uses the service role key, so it can
// change any row and ignores the security rules. That is
// exactly why it may only live here on the server.
const db = paymentsReady
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // SSLCommerz posts a form

// ---- serve the website -------------------------------------
// no-store stops the browser keeping old HTML and CSS, which
// otherwise makes design changes look like they did nothing.
app.use(express.static(APP_DIR, {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  },
}));

// ---- payment routes need the settings ----------------------
// If they are missing, say so clearly instead of failing oddly.
app.use('/api/payment', (req, res, next) => {
  if (paymentsReady) return next();
  res.status(503).json({
    error: 'Payments are switched off: server/.env is missing ' + missing.join(', '),
  });
});

function gateway() {
  return new SSLCommerzPayment(STORE_ID, STORE_PASSWORD, IS_LIVE);
}


// ============================================================
//  1. START A PAYMENT
//  The browser has already created the order in the database
//  (start_batch_payment). Here we ask SSLCommerz for a page.
// ============================================================
app.post('/api/payment/init', async (req, res) => {
  try {
    const { tran_id } = req.body;
    if (!tran_id) return res.status(400).json({ error: 'tran_id is missing' });

    // ---- who is asking? ------------------------------------
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { data: userData } = await db.auth.getUser(token);
    const user = userData && userData.user;
    if (!user) return res.status(401).json({ error: 'Please log in again' });

    // ---- read the order ------------------------------------
    const { data: order } = await db
      .from('payments')
      .select('tran_id, amount, method, status, student_id, batches ( title )')
      .eq('tran_id', tran_id)
      .maybeSingle();

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // The order must belong to the person asking.
    if (order.student_id !== user.id) {
      return res.status(403).json({ error: 'This order is not yours' });
    }
    if (order.status !== 'initiated') {
      return res.status(400).json({ error: 'This order is already ' + order.status });
    }

    // ---- read the student's own details --------------------
    const { data: profile } = await db
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .maybeSingle();

    // ---- ask SSLCommerz for a payment page -----------------
    const data = {
      total_amount: order.amount,
      currency: 'BDT',
      tran_id: order.tran_id,

      // where the student's browser goes afterwards
      success_url: SELF + '/api/payment/success',
      fail_url: SELF + '/api/payment/fail',
      cancel_url: SELF + '/api/payment/cancel',
      // where SSLCommerz's own server tells us, behind the scenes
      ipn_url: SELF + '/api/payment/ipn',

      shipping_method: 'NO',
      product_name: (order.batches && order.batches.title) || 'HelloStudents batch',
      product_category: 'Education',
      product_profile: 'non-physical-goods',

      cus_name: (profile && profile.full_name) || 'Student',
      cus_email: user.email || 'student@hellostudents.com',
      cus_phone: (profile && profile.phone) || '01700000000',
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_state: 'Dhaka',
      cus_postcode: '1000',
      cus_country: 'Bangladesh',

      ship_name: (profile && profile.full_name) || 'Student',
      ship_add1: 'Dhaka',
      ship_city: 'Dhaka',
      ship_state: 'Dhaka',
      ship_postcode: 1000,
      ship_country: 'Bangladesh',
    };

    const apiResponse = await gateway().init(data);

    if (!apiResponse || !apiResponse.GatewayPageURL) {
      console.error('SSLCommerz refused:', apiResponse);
      return res.status(502).json({
        error: (apiResponse && apiResponse.failedreason) || 'Gateway did not answer',
      });
    }

    res.json({ redirect_url: apiResponse.GatewayPageURL });
  } catch (err) {
    console.error('init failed:', err);
    res.status(500).json({ error: 'Could not start the payment' });
  }
});


// ============================================================
//  2. CHECK A PAYMENT IS REAL
//
//  THE MOST IMPORTANT FUNCTION HERE.
//  A message saying "this was paid" proves nothing — anyone
//  could send one. So we ask SSLCommerz directly, and we also
//  check the amount, or someone could pay 1 taka for a 2,500
//  taka batch.
//
//  Safe to call twice: if the order is already handled it
//  simply stops.
// ============================================================
async function confirmPayment(tranId, valId) {
  const { data: order } = await db
    .from('payments')
    .select('id, amount, status')
    .eq('tran_id', tranId)
    .maybeSingle();

  if (!order) return { ok: false, why: 'unknown order' };
  if (order.status === 'paid' || order.status === 'used') {
    return { ok: true, why: 'already confirmed' };
  }
  if (order.status !== 'initiated') return { ok: false, why: order.status };

  // ---- ask SSLCommerz whether this really happened ---------
  const proof = await gateway().validate({ val_id: valId });

  const reallyPaid = proof.status === 'VALID' || proof.status === 'VALIDATED';
  const amountMatches = Math.round(Number(proof.amount)) === order.amount;

  if (!reallyPaid || !amountMatches) {
    await db.from('payments')
      .update({ status: 'failed', provider: 'sslcommerz', provider_ref: valId })
      .eq('id', order.id);
    return { ok: false, why: !reallyPaid ? 'not valid' : 'wrong amount' };
  }

  await db.from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      provider: 'sslcommerz',
      provider_ref: proof.bank_tran_id || valId,
    })
    .eq('id', order.id);

  return { ok: true };
}


// ============================================================
//  3. THE STUDENT COMES BACK
//
//  SSLCommerz sends the browser here with a form POST.
//  We check the payment, then send them to the app.
//
//  Note: this is also where a local test is confirmed, because
//  SSLCommerz cannot reach http://localhost with its IPN.
// ============================================================
async function handleReturn(req, res) {
  const tranId = req.body.tran_id || req.query.tran_id;
  const valId = req.body.val_id || req.query.val_id;

  if (tranId && valId) {
    try {
      await confirmPayment(tranId, valId);
    } catch (err) {
      console.error('confirm failed:', err);
    }
  }

  res.redirect(SITE_URL + '/checkout.html?tran=' + encodeURIComponent(tranId || ''));
}

app.post('/api/payment/success', handleReturn);
app.get('/api/payment/success', handleReturn);


async function handleStopped(req, res, newStatus) {
  const tranId = req.body.tran_id || req.query.tran_id;

  if (tranId) {
    await db.from('payments')
      .update({ status: newStatus })
      .eq('tran_id', tranId)
      .eq('status', 'initiated');
  }

  res.redirect(SITE_URL + '/checkout.html?tran=' + encodeURIComponent(tranId || ''));
}

app.post('/api/payment/fail', (req, res) => handleStopped(req, res, 'failed'));
app.get('/api/payment/fail', (req, res) => handleStopped(req, res, 'failed'));
app.post('/api/payment/cancel', (req, res) => handleStopped(req, res, 'cancelled'));
app.get('/api/payment/cancel', (req, res) => handleStopped(req, res, 'cancelled'));


// ============================================================
//  4. IPN — SSLCommerz tells our server directly
//
//  This is the reliable one in production: it arrives even if
//  the student closes the browser after paying.
//  It cannot reach a laptop, so during local testing the
//  success page above does the same job.
// ============================================================
app.post('/api/payment/ipn', async (req, res) => {
  try {
    const { tran_id, val_id } = req.body;
    if (!tran_id || !val_id) return res.status(400).send('missing fields');

    const result = await confirmPayment(tran_id, val_id);
    res.send(result.ok ? 'ok' : 'rejected: ' + result.why);
  } catch (err) {
    console.error('ipn failed:', err);
    res.status(500).send('error');
  }
});


// ============================================================
//  5. EMAIL
//
//  Turns notifications the app already writes into emails.
//  Needs the service role key as well as the mail settings,
//  because ticking a notification as sent must not be
//  something the browser can do.
// ============================================================
const emailDb = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? db || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const email = startEmailWorker(emailDb);


// ---- a quick way to see the server is alive ----------------
app.get('/api/health', (req, res) => {
  res.json({
    website: 'running',
    payments: paymentsReady ? 'ready' : 'off',
    missing_settings: missing,
    email: email.on ? 'sending' : 'off',
    email_missing: email.missing,
    mode: IS_LIVE ? 'LIVE' : 'sandbox',
    site: SITE_URL,
  });
});


// ---- anything else is a page that does not exist -----------
// Without this the visitor gets Express's plain "Cannot GET".
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'No such endpoint' });
  }
  res.status(404).sendFile(path.join(APP_DIR, '404.html'));
});


app.listen(PORT, () => {
  console.log('');
  console.log('  HelloStudents is running');
  console.log('  http://localhost:' + PORT);
  console.log('');
  if (paymentsReady) {
    console.log('  Payments: SSLCommerz ' + (IS_LIVE ? 'LIVE' : 'sandbox'));
  } else {
    console.log('  Payments: OFF (demo mode still works)');
    console.log('  To switch them on, fill in server/.env:');
    console.log('    ' + missing.join(', '));
  }

  if (email.on) {
    console.log('  Email:    sending notifications');
  } else {
    console.log('  Email:    OFF (the bell in the app still works)');
    console.log('  To switch it on, fill in server/.env:');
    console.log('    ' + email.missing.join(', '));
  }
  console.log('');
});
