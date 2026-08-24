// ============================================================
//  HelloStudents — the server
//
//  It does two jobs:
//
//    1. SERVES THE WEBSITE from the /app folder
//    2. HANDLES PAYMENTS, because a gateway needs a secret
//       key. That key proves a request came from our
//       business. If it sat in app/js it would be public and
//       anyone could charge money through our account.
//
//       PAYMENT_PROVIDER in server/.env picks which gateway
//       runs:
//         uddoktapay  (default) your own instance
//         piprapay    self-hosted alternative
//         sslcommerz  the hosted gateway
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

const piprapay = require('./piprapay');
const uddoktapay = require('./uddoktapay');

const STORE_ID = process.env.STORE_ID;
const STORE_PASSWORD = process.env.STORE_PASSWORD;
const IS_LIVE = process.env.IS_LIVE === 'true';

// Which gateway is in charge. A blank setting lands on the one
// you actually use.
const PROVIDER = ['sslcommerz', 'piprapay', 'uddoktapay']
  .includes(process.env.PAYMENT_PROVIDER)
  ? process.env.PAYMENT_PROVIDER
  : 'uddoktapay';

// The two self-hosted ones share a shape, so the routes below
// talk to whichever is picked through the same three calls.
const ADAPTER = PROVIDER === 'piprapay' ? piprapay
  : PROVIDER === 'uddoktapay' ? uddoktapay
  : null;
const PORT = process.env.PORT || 5500;
const SELF = process.env.SELF_URL || 'http://localhost:' + PORT;
// The website and the API are on the same address now.
const SITE_URL = process.env.SITE_URL || SELF;

const path = require('path');
const APP_DIR = path.join(__dirname, '..', 'app');

// ---- which settings are present? ---------------------------
// The website must always run, even before you have a merchant
// account. So missing settings only switch OFF the payment
// routes, they never stop the server.
const gatewaySettings = ADAPTER
  ? ADAPTER.missingSettings().map((name) => [name, null])
  : [['STORE_ID', STORE_ID], ['STORE_PASSWORD', STORE_PASSWORD]];

const missing = [
  ...gatewaySettings,
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

    // ---- ask the gateway for a payment page ----------------
    if (ADAPTER) {
      const charge = await ADAPTER.createCharge({
        order,
        name: (profile && profile.full_name) || 'Student',
        //  UddoktaPay validates this as an email, so the login
        //  address is what goes here, not the phone number.
        contact: user.email || 'student@hellostudents.com',
        urls: {
          success: SELF + '/api/payment/success',
          cancel: SELF + '/api/payment/cancel',
          webhook: SELF + '/api/payment/ipn',
        },
      });

      //  Some gateways hand back their own id here and some do
      //  not (UddoktaPay has no invoice until the student has
      //  been through the page). Store it when there is one.
      const patch = { provider: PROVIDER };
      if (charge.providerRef) patch.provider_ref = charge.providerRef;

      await db.from('payments').update(patch).eq('tran_id', order.tran_id);

      return res.json({ redirect_url: charge.redirectUrl });
    }

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
async function confirmPayment(tranId, ref) {
  //  WHICH ORDER IS THIS?
  //
  //  Three different answers depending on the gateway:
  //    SSLCommerz  sends our own reference back
  //    PipraPay    gives an id at checkout, which we stored
  //    UddoktaPay  gives nothing until the student has paid
  //
  //  For that last case the only way to know is to verify the
  //  invoice and read our reference out of the metadata we sent
  //  with it. So when we have no reference, verify first and
  //  let the answer tell us.
  let proof = null;

  if (!tranId && ADAPTER && ref) {
    proof = await ADAPTER.verify(ref);
    if (proof.tranId) tranId = proof.tranId;
  }

  let query = db.from('payments').select('id, amount, status, provider_ref, tran_id');

  query = tranId
    ? query.eq('tran_id', tranId)
    : query.eq('provider_ref', String(ref));

  const { data: order } = await query.maybeSingle();

  if (!order) return { ok: false, why: 'unknown order', tranId: tranId || null };
  if (order.status === 'paid' || order.status === 'used') {
    return { ok: true, why: 'already confirmed', tranId: order.tran_id };
  }
  if (order.status !== 'initiated') {
    return { ok: false, why: order.status, tranId: order.tran_id };
  }

  const fail = async (why, providerRef) => {
    await db.from('payments')
      .update({ status: 'failed', provider: PROVIDER, provider_ref: String(providerRef) })
      .eq('id', order.id);
    return { ok: false, why, tranId: order.tran_id };
  };

  const succeed = async (providerRef) => {
    await db.from('payments')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        provider: PROVIDER,
        provider_ref: String(providerRef),
      })
      .eq('id', order.id);
    return { ok: true, tranId: order.tran_id };
  };

  // ---- UddoktaPay / PipraPay -----------------------------
  if (ADAPTER) {
    //  Prefer an id we stored ourselves when the charge was
    //  made; a URL the student came back on can be edited.
    //  UddoktaPay has no such id, so there the invoice from the
    //  return or the webhook is all there is — which is exactly
    //  why it gets verified rather than believed.
    const gatewayId = ref || order.provider_ref;
    if (!gatewayId) return { ok: false, why: 'no payment id', tranId: order.tran_id };

    //  Reuse the answer from the lookup above rather than
    //  asking the same question twice.
    if (!proof) proof = await ADAPTER.verify(gatewayId);

    if (!proof.paid) return fail(proof.why || 'not completed', gatewayId);

    //  The amount has to be checked or someone could pay 1 taka
    //  for a 2,500 taka batch. It arrives as "2500.00", so it is
    //  rounded before comparing.
    if (Math.round(Number(proof.amount)) !== order.amount) {
      return fail('wrong amount', gatewayId);
    }

    //  And the payment must be for THIS order. Without this a
    //  real 100 taka invoice could be replayed against someone
    //  else's 2,500 taka batch.
    if (proof.tranId && proof.tranId !== order.tran_id) {
      return fail('belongs to another order', gatewayId);
    }

    return succeed(proof.reference || gatewayId);
  }

  // ---- SSLCommerz ------------------------------------------
  const sslProof = await gateway().validate({ val_id: ref });

  const reallyPaid = sslProof.status === 'VALID' || sslProof.status === 'VALIDATED';
  const amountMatches = Math.round(Number(sslProof.amount)) === order.amount;

  if (!reallyPaid || !amountMatches) {
    return fail(!reallyPaid ? 'not valid' : 'wrong amount', ref);
  }

  return succeed(sslProof.bank_tran_id || ref);
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
  let tranId = req.body.tran_id || req.query.tran_id || '';

  try {
    if (ADAPTER) {
      //  The gateway returns its own id, not our reference.
      const gatewayId = ADAPTER.readInvoiceId
        ? ADAPTER.readInvoiceId(req)
        : ADAPTER.readPaymentId(req);

      if (gatewayId) {
        const found = await confirmPayment(null, gatewayId);
        if (!found.ok) console.error(PROVIDER + ' return:', found.why);

        //  Take our reference straight from the answer.
        //  It used to be looked up by provider_ref instead, and
        //  that quietly broke: confirmPayment writes the gateway
        //  reference into that column as it goes, so by the time
        //  we searched, the value we were searching FOR was no
        //  longer the value in the row. The student then arrived
        //  at checkout.html with an empty tran and saw the wrong
        //  page, even though the payment had gone through.
        if (!tranId && found.tranId) tranId = found.tranId;
      }
    } else {
      const valId = req.body.val_id || req.query.val_id;
      if (tranId && valId) await confirmPayment(tranId, valId);
    }
  } catch (err) {
    console.error('confirm failed:', err);
  }

  //  If we still cannot say which order this was, do NOT send
  //  them to a bare checkout page — it would say "No batch was
  //  chosen", which is a frightening thing to read straight
  //  after paying. Say plainly that we could not match it.
  if (!tranId) {
    return res.redirect(SITE_URL + '/checkout.html?unmatched=1');
  }

  res.redirect(SITE_URL + '/checkout.html?tran=' + encodeURIComponent(tranId));
}

app.post('/api/payment/success', handleReturn);
app.get('/api/payment/success', handleReturn);


async function handleStopped(req, res, newStatus) {
  let tranId = req.body.tran_id || req.query.tran_id || '';

  //  A student who backs out comes back the same way as one who
  //  paid: with the GATEWAY's invoice id, not our reference. So
  //  the order has to be found through the invoice before it can
  //  be marked cancelled — otherwise it sits on 'initiated' for
  //  ever and the student lands on an empty checkout page.
  if (!tranId && ADAPTER) {
    const gatewayId = ADAPTER.readInvoiceId
      ? ADAPTER.readInvoiceId(req)
      : ADAPTER.readPaymentId(req);

    if (gatewayId) {
      try {
        const proof = await ADAPTER.verify(gatewayId);

        //  Backing out and then paying anyway on the gateway's
        //  own page is possible, so if it turns out to be paid,
        //  treat it as paid rather than cancelling real money.
        if (proof.paid) {
          const found = await confirmPayment(null, gatewayId);
          return res.redirect(
            SITE_URL + '/checkout.html?tran=' + encodeURIComponent(found.tranId || '')
          );
        }

        if (proof.tranId) tranId = proof.tranId;
      } catch (err) {
        console.error('cancel lookup failed:', err.message);
      }
    }
  }

  if (tranId) {
    await db.from('payments')
      .update({ status: newStatus })
      .eq('tran_id', tranId)
      .eq('status', 'initiated');
  }

  //  If we still cannot say which order this was, do NOT send
  //  them to a bare checkout page — it would say "No batch was
  //  chosen", which is a frightening thing to read straight
  //  after paying. Say plainly that we could not match it.
  if (!tranId) {
    return res.redirect(SITE_URL + '/checkout.html?unmatched=1');
  }

  res.redirect(SITE_URL + '/checkout.html?tran=' + encodeURIComponent(tranId));
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
    if (ADAPTER) {
      //  Anyone can post to this address, so the key in the
      //  header is what says the message is really the gateway.
      if (!ADAPTER.webhookKeyIsGood(req.headers)) {
        return res.status(401).json({ status: false, message: 'Unauthorized Action' });
      }

      //  The body says it was paid. We still ask the gateway
      //  ourselves inside confirmPayment, because a correct key
      //  proves who sent the message, not that money moved.
      const gatewayId = req.body.invoice_id || req.body.pp_id;

      if (!gatewayId) {
        return res.status(400).json({ status: false, message: 'missing invoice_id' });
      }

      //  Deliberately NOT passing the tran_id from the body:
      //  it is unverified. confirmPayment reads it back out of
      //  the gateway's own answer instead.
      const result = await confirmPayment(null, gatewayId);
      if (!result.ok) console.error(PROVIDER + ' webhook:', result.why);

      return res.status(200).json({ status: true, message: 'Webhook received' });
    }

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
    provider: PROVIDER,
    gateway_url: ADAPTER ? ADAPTER.baseUrl : undefined,
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


// ============================================================
//  RUNNING IT
//
//  Two ways, on purpose:
//
//    npm start        a normal long-lived process on your
//                     machine. That is the branch below.
//
//    on Vercel        the file is imported, not run, and each
//                     request wakes a short-lived function.
//                     There is no port to listen on, so we
//                     must NOT call listen — we just hand the
//                     app over with module.exports.
//
//  require.main === module is what tells the two apart: it is
//  true only when node was pointed straight at this file.
// ============================================================
module.exports = app;

if (require.main !== module) {
  //  Imported, so something else is doing the listening.
  //  Stop here before the banner and the listen call.
  return;
}

app.listen(PORT, () => {
  console.log('');
  console.log('  HelloStudents is running');
  console.log('  http://localhost:' + PORT);
  console.log('');
  if (paymentsReady) {
    console.log('  Payments: ' + (ADAPTER
      ? ADAPTER.name + ' via ' + ADAPTER.baseUrl
      : 'SSLCommerz ' + (IS_LIVE ? 'LIVE' : 'sandbox')));
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
