// ============================================================
//  THE PAYMENT GATEWAY (SSLCommerz)
//
//  The browser is NOT allowed to talk to SSLCommerz directly,
//  because that needs the store password. If that password
//  were in this folder, anyone could read the page source and
//  charge money through the account.
//
//  So the browser only talks to our own small server in
//  /server, and that server holds the password.
//
//      browser  ->  our server  ->  SSLCommerz
//
//  Two modes:
//    'sslcommerz'  the real thing (needs the server running)
//    'demo'        no gateway at all, for showing the project
//                  without a merchant account
// ============================================================

import { supabase } from './supabase.js';
import { GATEWAY_MODE, PAYMENT_SERVER_URL } from './config.js';

// GATEWAY_MODE lives in config.js, with all the other settings.
export { GATEWAY_MODE };

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

// ---- Step 2: ask our server for the SSLCommerz page --------
// Returns null in demo mode, because there is nowhere to go.
export async function openGateway(tranId) {
  if (GATEWAY_MODE === 'demo') return null;

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

  return result.redirect_url;
}

// ---- DEMO ONLY: pretend the gateway said yes ---------------
export async function demoPay(tranId) {
  const { error } = await supabase.rpc('demo_confirm_payment', {
    p_tran_id: tranId,
  });
  if (error) throw new Error(error.message);
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
