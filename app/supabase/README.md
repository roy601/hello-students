# Turning on the real payment gateway

The app works **right now in demo mode** — no signup, no card, no server.
Follow this only when you want real bKash / Nagad / card pages.

---

## Why a server is needed at all

A payment gateway checks two things on every request: your **store id** and your
**store password**. The password proves the request came from your business.

If it sat in `js/config.js`, anyone could open the page source, copy it, and
charge money through your account. So it has to live somewhere the browser
cannot see — a server.

You already have one: **Supabase Edge Functions**. They are free on the same
plan you are using.

```
Browser                Edge Function              SSLCommerz
   |                        |                          |
   |-- "start payment" ---->|                          |
   |                        |-- store_id + password -->|
   |                        |<---- payment page URL ---|
   |<--- payment page URL --|                          |
   |                                                   |
   |------------- student pays on their page --------->|
   |                        |                          |
   |                        |<--- "someone paid" (IPN)-|
   |                        |---- "is that true?" ---->|
   |                        |<--- "yes, 2500 BDT" -----|
   |                        | marks the order paid     |
```

The last three lines are the important ones. **We never believe the "someone
paid" message on its own** — anyone could fake it. We call SSLCommerz back and
check the amount before marking anything paid.

---

## Steps

### 1. Get a free sandbox account
Register at [developer.sslcommerz.com](https://developer.sslcommerz.com/).
You get a **store id** and **store password** for testing. No real money is
ever involved in the sandbox.

### 2. Install the Supabase CLI
```bash
npm install -g supabase
supabase login
```

### 3. Link this project
Your project ref is the part in the middle of your Supabase URL.

```bash
cd app
supabase link --project-ref YOUR-PROJECT-REF
```

### 4. Store the secrets on the server
These never touch the browser.

```bash
supabase secrets set STORE_ID=your_sandbox_store_id
supabase secrets set STORE_PASSWORD=your_sandbox_password
supabase secrets set SSLC_LIVE=false
supabase secrets set SITE_URL=http://localhost:5500
```

> When you go live: set `SSLC_LIVE=true`, swap in your real store details, and
> set `SITE_URL` to your real web address.

### 5. Deploy the two functions
```bash
supabase functions deploy create-payment
supabase functions deploy payment-ipn --no-verify-jwt
```

`--no-verify-jwt` is needed on the second one because **SSLCommerz** calls it,
not a logged-in user, so it has no login token to send.

### 6. Switch the app over
In [`js/gateway.js`](../js/gateway.js), change one line:

```js
export const GATEWAY_MODE = 'sslcommerz';
```

### 7. Remove the demo shortcut
In the SQL Editor:

```sql
drop function if exists demo_confirm_payment(text);
```

That function lets the browser mark an order as paid. It exists only so the
project can be shown working without a merchant account. **A real site must not
have it.**

---

## Testing in the sandbox

SSLCommerz gives you test cards and a fake bKash screen. Nothing is charged.

1. Open a batch → **Pay and join**
2. Pick a method → **Pay**
3. You land on the real SSLCommerz sandbox page
4. Pay with their test card
5. You come back to `checkout.html?tran=...`, and the seat is given

---

## What each file does

| File | Runs where | Job |
|---|---|---|
| `functions/create-payment/index.ts` | Supabase server | Asks SSLCommerz for a payment page |
| `functions/payment-ipn/index.ts` | Supabase server | Checks the payment is genuine, marks it paid |
| `../js/gateway.js` | Browser | Starts the order, sends the student to the gateway |
| `../js/checkout.js` | Browser | Shows the order, then the result |

---

## The security rule behind all of it

Look at PART 10 of `../db/schema.sql`. The `payments` table has **no insert or
update policy**. That means the browser can never write a payment row at all.

- The student can only **start** an order (`start_batch_payment`)
- Only the server can mark it **paid**
- The seat is only given if the order is already paid (`enrol_with_payment`)

So even if someone edited the JavaScript, they could not give themselves a free
seat. The rule is enforced inside the database, not in the page.
