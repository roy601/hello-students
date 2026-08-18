// ============================================================
//  EDGE FUNCTION: create-payment
//
//  This runs on Supabase's server, NOT in the browser.
//  That matters, because it uses the secret merchant password.
//  If that password were in the browser, anyone could look at
//  the page source and charge money through your account.
//
//  What it does:
//    1. checks the student is really logged in
//    2. reads their order from the payments table
//    3. asks SSLCommerz for a payment page
//    4. sends back the address of that page
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Set with:  npx supabase secrets set STORE_ID=... STORE_PASSWORD=...
const STORE_ID = Deno.env.get('STORE_ID')!;
const STORE_PASSWORD = Deno.env.get('STORE_PASSWORD')!;
const IS_LIVE = Deno.env.get('SSLC_LIVE') === 'true';
const SITE_URL = Deno.env.get('SITE_URL') || 'http://localhost:5500';

const SSLC_URL = IS_LIVE
  ? 'https://securepay.sslcommerz.com/gwprocess/v4/api.php'
  : 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { tran_id } = await req.json();

    // ---- 1. who is asking? ---------------------------------
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);

    // ---- 2. read the order ---------------------------------
    // Row Level Security means this only returns their own row.
    const { data: payment } = await supabase
      .from('payments')
      .select('tran_id, amount, method, status, batches ( title )')
      .eq('tran_id', tran_id)
      .maybeSingle();

    if (!payment) return json({ error: 'Order not found' }, 404);
    if (payment.status !== 'initiated') {
      return json({ error: 'This order is already ' + payment.status }, 400);
    }

    // ---- 3. ask SSLCommerz for a payment page --------------
    const form = new URLSearchParams({
      store_id: STORE_ID,
      store_passwd: STORE_PASSWORD,
      total_amount: String(payment.amount),
      currency: 'BDT',
      tran_id: payment.tran_id,

      success_url: `${SITE_URL}/checkout.html?tran=${payment.tran_id}`,
      fail_url:    `${SITE_URL}/checkout.html?tran=${payment.tran_id}`,
      cancel_url:  `${SITE_URL}/checkout.html?tran=${payment.tran_id}`,
      ipn_url:     `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-ipn`,

      product_name: payment.batches?.title ?? 'HelloStudents batch',
      product_category: 'Education',
      product_profile: 'non-physical-goods',

      cus_name: user.user_metadata?.full_name ?? 'Student',
      cus_email: user.email ?? 'student@hellostudents.com',
      cus_phone: '01700000000',
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',

      shipping_method: 'NO',
    });

    const reply = await fetch(SSLC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });

    const result = await reply.json();

    if (result.status !== 'SUCCESS' || !result.GatewayPageURL) {
      return json({ error: result.failedreason || 'Gateway refused' }, 502);
    }

    return json({ redirect_url: result.GatewayPageURL });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
