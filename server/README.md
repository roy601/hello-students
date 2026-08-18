# Payment server (SSLCommerz)

The one part of HelloStudents that does **not** run in the browser.

---

## Why it has to exist

SSLCommerz checks two things on every request: your **store id** and your
**store password**. The password is what proves the request came from your
business.

If it lived in `app/js/`, anyone could open the page source, copy it, and charge
money through your account. So it lives here, in a folder the browser never
sees.

```
  Browser                Our server              SSLCommerz
     |                       |                       |
     |-- "start payment" --->|                       |
     |                       |-- id + password ----->|
     |                       |<--- payment page URL -|
     |<--- payment page URL -|                       |
     |                                               |
     |--------- student pays on the real page ------>|
     |                       |                       |
     |<-- browser sent back to /api/payment/success --|
     |                       |                       |
     |                       |-- "was that real?" -->|
     |                       |<-- "yes, 2500 BDT" ---|
     |                       |  marks the order paid |
```

The last two lines are the ones that matter. **We never trust a message that
says "this was paid".** Anyone could send one. We ask SSLCommerz directly, and
we check the amount too — otherwise someone could pay 1 taka for a 2,500 taka
batch.

---

## Setup

### 1. Install what is missing

`sslcommerz-lts` is already installed. Add the rest:

```bash
npm install
```

### 2. Get a free sandbox account

Register at [developer.sslcommerz.com](https://developer.sslcommerz.com/).
You get a **store id** and **store password** for testing. No real money is ever
involved in the sandbox.

### 3. Make your settings file

```bash
copy server\.env.example server\.env
```

Then open `server/.env` and fill in:

| Setting | Where to find it |
|---|---|
| `STORE_ID`, `STORE_PASSWORD` | Your SSLCommerz sandbox account |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, the **service_role** key |

> The **service_role** key ignores every security rule. It is the only thing
> allowed to mark an order as paid. Never put it in `app/js/`. `.env` is already
> in `.gitignore`, so it will not go to GitHub.

### 4. Start both parts

Two terminals:

```bash
# terminal 1 — the payment server
npm start

# terminal 2 — the website
cd app
python -m http.server 5500
```

Check the server is happy: <http://localhost:3030/api/health>

```json
{ "running": true, "mode": "sandbox", "store_id_set": true, "supabase_set": true }
```

If `store_id_set` or `supabase_set` is `false`, your `.env` is not filled in.

### 5. Remove the demo shortcut

In the Supabase SQL Editor:

```sql
drop function if exists demo_confirm_payment(text);
```

That function let the browser mark an order as paid, which was only there so the
project could be shown without a merchant account. **Now that a real gateway
exists, it must go** — otherwise anyone could still give themselves a free seat.

---

## Testing

1. Log in as a student, open a batch
2. **Pay ৳2,500 and join** → pick a method → **Pay**
3. You land on the real SSLCommerz sandbox page
4. Pay with one of their test cards
5. You come back to `checkout.html?tran=…` and the seat is given

### One thing about local testing

`ipn_url` is where SSLCommerz's own server calls us. **It cannot reach
`http://localhost`** — your laptop is not on the internet.

That is fine, because the **success page does the same check**. When the student
comes back, the server validates the payment right then. IPN is the backup that
matters in production, for when a student pays and immediately closes the tab.

To test IPN locally, put a tunnel in front of the server:

```bash
npx localtunnel --port 3030
```

then set `SELF_URL` in `.env` to the address it gives you.

---

## The endpoints

| Route | Who calls it | What it does |
|---|---|---|
| `POST /api/payment/init` | The browser | Asks SSLCommerz for a payment page |
| `POST /api/payment/success` | The browser, sent by SSLCommerz | Validates, then returns the student to the app |
| `POST /api/payment/fail` | Same | Marks the order failed |
| `POST /api/payment/cancel` | Same | Marks the order cancelled |
| `POST /api/payment/ipn` | SSLCommerz's server | Validates, in the background |
| `GET /api/health` | You | Shows whether the settings loaded |

---

## Going live

1. Swap in your live store id and password
2. Set `IS_LIVE=true`
3. Set `SITE_URL` and `SELF_URL` to your real web addresses
4. Change `PAYMENT_SERVER_URL` in `app/js/config.js` to the real server address
5. Make sure `demo_confirm_payment` is dropped from the database

---

## Why this is still safe even though the browser can be edited

Look at PART 10 of `../app/db/schema.sql`. The `payments` table has **no insert
and no update policy**, so the browser can never write a payment row at all.

- A student can only **start** an order — `start_batch_payment()`
- Only this server, holding the service_role key, can mark it **paid**
- A seat is only given if the order is already paid — `enrol_with_payment()`

So even someone who rewrites the JavaScript cannot give themselves a free seat.
The rule is enforced inside the database, not in the page.
