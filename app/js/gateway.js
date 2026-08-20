// ============================================================
//  THE PAYMENT GATEWAY
//
//  The browser is NOT allowed to talk to the gateway directly,
//  because that needs a secret key. If that key were in this
//  folder, anyone could read the page source and charge money
//  through the account.
//
//  So the browser only talks to our own small server in
//  /server, and that server holds the password.
//
//      browser  ->  our server  ->  the gateway
//
//  This file does not care WHICH gateway. Our server picks
//  that with PAYMENT_PROVIDER in server/.env, so switching
//  from PipraPay to SSLCommerz changes nothing here.
//
//  There is no demo or test mode in here on purpose. There
//  used to be one, and it marked orders paid without any money
//  moving — which is exactly the hole you do not want in the
//  one file that handles money. To try the flow without real
//  taka, point the SERVER at the gateway's sandbox instead.
// ============================================================

import { supabase } from './supabase.js';
import { PAYMENT_SERVER_URL } from './config.js';

export const METHODS = [
  { id: 'bkash', label: 'bKash' },
  { id: 'nagad', label: 'Nagad' },
  { id: 'rocket', label: 'Rocket' },
  { id: 'card', label: 'Card' },
];

// ---- Step 1: make the order in our database ----------------
// The database checks the batch is open, has a free seat, and
// that this student has not already joined.
export async function startPayment(batchId, method) {
  const { data, error } = await supabase.rpc('start_batch_payment', {
    p_batch_id: batchId,
    p_method: method,
  });

  if (error) throw new Error(error.message);
  return data;              // our reference, e.g. HS-7-1a2b3c4d
}

// ---- Step 2: ask our server for the payment page -----------
// There is no way around this. A payment can only be completed
// by the gateway telling our server it happened, so if this
// throws, the student does not get the seat.
export async function openGateway(tranId) {
  // Our login token proves to the server who we are.
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token;

  let response;
  try {
    response = await fetch(PAYMENT_SERVER_URL + '/api/payment/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ tran_id: tranId }),
    });
  } catch (err) {
    throw new Error(
      'The payment server is not running. Start it with "npm start".'
    );
  }

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Gateway did not answer');
  if (!result.redirect_url) throw new Error('The gateway did not give a payment page');

  return result.redirect_url;
}

// ---- Step 3: read the order back ---------------------------
export async function getPayment(tranId) {
  const { data, error } = await supabase
    .from('payments')
    .select('tran_id, amount, method, status, provider_ref, batch_id')
    .eq('tran_id', tranId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

// ---- Step 4: turn a paid order into a seat -----------------
export async function finishEnrolment(tranId) {
  const { error } = await supabase.rpc('enrol_with_payment', {
    p_tran_id: tranId,
  });
  if (error) throw new Error(error.message);
}
