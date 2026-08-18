// ============================================================
//  EDGE FUNCTION: payment-ipn
//
//  SSLCommerz calls this by itself after a student pays.
//  IPN means "instant payment notification".
//
//  THE IMPORTANT RULE:
//  We do NOT believe what this message says. Anyone could send
//  a fake one. So we call SSLCommerz back and ask "is this
//  real, and was it really this much money?" before marking
//  anything as paid.
//
//  This function uses the SERVICE ROLE key, which ignores the
//  security rules, because it is the only thing allowed to
//  turn an order into 'paid'. That key must never appear in
//  the browser.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STORE_ID = Deno.env.get('STORE_ID')!;
const STORE_PASSWORD = Deno.env.get('STORE_PASSWORD')!;
const IS_LIVE = Deno.env.get('SSLC_LIVE') === 'true';

const VALIDATION_URL = IS_LIVE
  ? 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php'
  : 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';

Deno.serve(async (req) => {
  try {
    const body = await req.formData();
    const tranId = String(body.get('tran_id') ?? '');
    const valId = String(body.get('val_id') ?? '');

    if (!tranId || !valId) return new Response('missing fields', { status: 400 });

    // The service role key ignores Row Level Security, so this
    // function can update any order. Nothing else can.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: payment } = await supabase
      .from('payments')
      .select('id, amount, status')
      .eq('tran_id', tranId)
      .maybeSingle();

    if (!payment) return new Response('unknown order', { status: 404 });
    if (payment.status !== 'initiated') return new Response('already handled');

    // ---- ask SSLCommerz whether this is genuine ------------
    const check = await fetch(
      `${VALIDATION_URL}?val_id=${encodeURIComponent(valId)}` +
      `&store_id=${encodeURIComponent(STORE_ID)}` +
      `&store_passwd=${encodeURIComponent(STORE_PASSWORD)}&format=json`
    );
    const proof = await check.json();

    const reallyPaid =
      proof.status === 'VALID' || proof.status === 'VALIDATED';

    // The amount must match too, or someone could pay 1 taka
    // for a 2500 taka batch.
    const amountMatches = Math.round(Number(proof.amount)) === payment.amount;

    if (!reallyPaid || !amountMatches) {
      await supabase.from('payments')
        .update({ status: 'failed', provider_ref: valId })
        .eq('id', payment.id);
      return new Response('not valid');
    }

    await supabase.from('payments')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        provider: 'sslcommerz',
        provider_ref: valId,
      })
      .eq('id', payment.id);

    return new Response('ok');
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
