# 09 — Payments, Credits & Payouts

*Implements capability 5: credit/hour-based payment with bKash/Nagad.*

This is the module where bugs cost real money and destroy trust permanently. Everything here is designed around one assumption: **any external call may fail, time out, or succeed-without-telling-us, and the system must still converge to a correct balance.**

## 9.1 Money representation

- Stored as `BIGINT` **poisha**. 1 BDT = 100 poisha. `৳900.00` is `90000`.
- Never a float. Never `NUMERIC` for balances. Never a decimal string in JSON.
- Rounding is **banker's rounding at the poisha**, applied once, at commission calculation, with the remainder always assigned to the tutor. The `CHECK (gross = commission + net)` constraint on `earnings` makes a rounding bug fail at write time rather than accumulate silently.
- Display: `৳900` (`bn-BD`) / `BDT 900` (`en`), thousands grouped in the **South Asian convention** — ৳1,20,000, not ৳120,000. Bangla numerals when the locale calls for it.

## 9.2 Why the brief's credit model needed adjusting

The brief specifies "buy N hours, deduct per class". That breaks immediately in an open marketplace:

> A student buys 10 hours for ৳5,000 (implying ৳500/hr). They then book Rifat at ৳900/hr. Does one hour of credit cover it? If yes, the platform is subsidising ৳400 out of its own pocket. If no, the credit is not really an hour and the promise was false.

A single global hour-price only works when the platform sets prices — which is exactly the centrally-produced model we are explicitly not building. Tutor-set pricing and fungible hour-credits are mutually incompatible.

**Resolution — two instruments** ([ADR-001](adr/ADR-001-credit-unit.md)):

| Instrument | Unit | Scope | Purpose |
|---|---|---|---|
| **Wallet Credits** | 1 credit = 1 poisha | Fungible, any tutor | The general-purpose prepaid balance. Buy ৳1,000, spend anywhere. |
| **Hour Packs** | Hours | One specific tutor, rate locked | The literal "buy N hours" product, at a rate that is unambiguous because it is scoped to one tutor. |

Both are prepaid, both feel like "topping up", and the UI presents wallet balance in hours where a tutor context exists: *"৳2,400 — about 2.6 hours with Rifat."* The intent of the brief is fully preserved; the arithmetic now works.

Hour packs are also commercially stronger than fungible hours: they lock in a rate (valuable to the student when a tutor's price rises), commit the student to one tutor (which raises repeat rate, the metric that matters most), and give the tutor guaranteed forward income — a powerful retention argument for supply.

## 9.3 The ledger

Every movement of value is an immutable, signed `ledger_entries` row. Nothing else may change a balance.

**Rules:**

1. **Append-only.** No `UPDATE`, no `DELETE`. Corrections are compensating entries.
2. **Every entry carries a unique `idempotency_key`.** A retried operation is a no-op, not a double credit.
3. **`balance_credits` on the account is a cache.** `SUM(amount_credits)` is the truth. A nightly job asserts they agree; a mismatch pages the on-call engineer immediately, with no threshold ([04 §4.12](04-data-model.md#412-invariants)).
4. **Balance may never go negative** — a `CHECK` constraint, inside the same transaction.
5. Entries are always written **inside the transaction** that causes them, never asynchronously.

### Hold / capture / release

Booking money moves in two stages, mirroring card authorisation:

```
Booking confirmed  →  hold      (−900.00, available balance drops, `held` rises)
Session completed  →  capture   (hold consumed; earnings accrue to the tutor)
Booking cancelled  →  release   (+900.00 back to available)
Late cancellation  →  partial capture + partial release, per policy
```

The gap between hold and capture is where cancellation policy, disputes and no-show detection all live. Capturing at booking time would mean refunding — a strictly worse operation, since it requires reversing money that has already begun accruing to a tutor.

### Worked example

Student tops up ৳2,000, books a ৳900 class, attends, then books another and cancels late under `standard` policy (50%):

| # | Entry | Amount | Balance | Held |
|---|---|---|---|---|
| 1 | `purchase` | +200000 | 200000 | 0 |
| 2 | `hold` (bkg_A) | −90000 | 110000 | 90000 |
| 3 | `capture` (bkg_A) | 0 | 110000 | 0 |
| 4 | `hold` (bkg_B) | −90000 | 20000 | 90000 |
| 5 | `capture` (bkg_B, 50%) | 0 | 20000 | 45000 |
| 6 | `hold_release` (bkg_B, 50%) | +45000 | 65000 | 0 |

Capture entries carry `amount_credits = 0` because the value already left the available balance at hold time — capture moves it out of `held` and into the tutor's `earnings`. The `held` column is what makes this legible on a statement.

## 9.4 Hour packs

Purchased against a specific tutor, optionally scoped to one subject:

```
"10 hours with Rifat Hossain — HSC Physics"
   rate locked at ৳850/hr (5% below his ৳900 list price)
   total ৳8,500 · expires in 6 months
```

- Consumed **before** wallet credits when both could pay, so prepaid tutor-specific value does not expire unused.
- `hours_remaining` decrements by the session's duration in hours (a 90-minute class deducts 1.5).
- Partial coverage: if 0.5 h remains against a 1 h class, the pack covers 0.5 h at the locked rate and the wallet covers the rest at list price. The UI states this before confirming — surprise split-charges generate support tickets.
- Expiry defaults to 6 months. **A warning SMS goes out at 30 days and 7 days before expiry**, and expired hours convert to wallet credits at 80% of value rather than vanishing. Confiscating prepaid value outright is a trust catastrophe in a market that has been burned by informal arrangements, and the 20% haircut is disclosed at purchase.
- If a tutor leaves the platform or is suspended, all outstanding packs against them are refunded to wallet credits at **100%** of remaining value, automatically.

## 9.5 Payment integration

### Strategy

**Aggregator first, direct bKash later** — [ADR-005](adr/ADR-005-payments-aggregator-first.md).

An aggregator (SSLCommerz or ShurjoPay) delivers bKash, Nagad, Rocket, Upay, cards and internet banking through one integration, one settlement report and one reconciliation process. Direct bKash integration is a lower per-transaction cost but is a separate merchant agreement, a separate settlement cycle, and its own failure modes — worth doing at volume, not at launch.

The code depends on a `PaymentProvider` interface from day one, so adding direct bKash later is an adapter, not a rewrite:

```ts
interface PaymentProvider {
  createPayment(o: OrderIntent): Promise<{ redirectUrl: string; providerRef: string }>;
  verifyPayment(providerRef: string): Promise<PaymentStatus>;   // authoritative
  refund(p: RefundRequest): Promise<RefundResult>;
  parseWebhook(raw: RawWebhook): Promise<WebhookEvent>;         // signature verification included
}
```

### Payment methods, in expected volume order

| Method | Share (expected) | Notes |
|---|---|---|
| **bKash** | ~55–65% | Dominant. Must be the first, largest, most obvious button. |
| **Nagad** | ~20–25% | Growing fast, strong in non-metro areas |
| **Rocket / Upay** | ~5% | |
| **Cards** | ~5–10% | Skews to English-medium and expat-funded families |
| **Internet banking** | < 5% | |

MDR in the Bangladeshi market generally sits in the low single-digit percent for mobile-wallet merchant payments and is negotiable with volume. **Verify the current rate card directly with the provider** — do not build pricing assumptions on figures quoted in any documentation, including this page. Model contribution margin against the actual contracted rate before setting the top-up service fee.

### Purchase flow

```mermaid
sequenceDiagram
    participant U as User
    participant API
    participant PSP
    participant W as Worker

    U->>API: POST /billing/orders {package_id} + Idempotency-Key
    API->>API: create order (initiated, expires in 30m)
    API->>PSP: create payment session
    PSP-->>API: redirect_url + provider_ref
    API-->>U: {redirect_url, poll_url}
    U->>PSP: authorise in bKash app / OTP
    par Webhook path
        PSP-->>API: POST /webhooks/psp (signed)
        API->>API: verify sig, persist, dedupe, enqueue
    and Return path
        U->>API: GET poll_url
    end
    W->>PSP: verifyPayment(provider_ref)   [authoritative]
    PSP-->>W: captured, amount, trx_id
    W->>W: TX { order=captured; ledger_entry(purchase); outbox }
    W-->>U: SMS "৳1,000 যোগ হয়েছে। ব্যালেন্স ৳2,400"
```

**Non-negotiable rules:**

1. **Credits are never issued from webhook data alone.** A server-to-server `verifyPayment` call confirms status and amount first. Webhook payloads are a hint that something happened.
2. **Amount is verified against the order.** A mismatch never credits — it opens a finance alert.
3. **Every webhook is persisted before processing** and deduped on `(source, external_id)`.
4. **A reconciliation job sweeps every `initiated`/`pending` order older than 15 minutes** and queries the PSP directly. In this market a meaningful share of successful wallet payments never deliver a usable webhook — the user's money left their bKash account and the platform must find it without being told. This job is what prevents the worst possible support ticket.
5. **Orders expire after 30 minutes.** An expired order that later verifies as captured still credits, and raises an alert.

### Failure handling

| Failure | Behaviour |
|---|---|
| PSP unreachable at create | `503 dependency_unavailable`; suggest another method; never create a phantom order |
| User abandons the redirect | Order expires; no ledger movement; a "complete your top-up" nudge after 1 h |
| Webhook lost | Reconciliation job catches it within 15 min |
| Duplicate webhook | Deduped on `(source, external_id)` |
| Payment succeeds, credit write fails | Order stays `pending`; the reconciliation job retries the credit; the ledger idempotency key makes retry safe |
| Amount mismatch | Never auto-credit. Finance alert, manual resolution, user informed within the hour. |
| Refund fails at the PSP | Fall back to credits, notify the user, escalate |

## 9.6 Commission and take rate

| Parameter | Value |
|---|---|
| Default commission | **15%** of gross session value |
| L3 tutors | 12% — a retention incentive for the highest-quality supply |
| High-volume (>80 sessions/month) | 12% |
| Launch cohort (first 200 tutors) | **0% for 6 months**, then 10% permanently |
| Student service fee on top-up | 0–2%, disclosed before purchase, sized to cover PSP MDR |

Take rate is a strategic instrument, not a revenue dial. Coaching centres take 40–70%. At 15% the arbitrage is overwhelming and easy to explain in one sentence — which is the entire supply-acquisition pitch. Push it toward 25% and the pitch weakens exactly as leakage pressure rises. **Any proposal to raise commission must be evaluated against the leakage metric in [11 §11.6](11-ratings-reviews.md#116-leakage-and-disintermediation), not against a revenue projection in isolation.**

Commission is calculated at capture and stored on the `earnings` row with its rate, so a later rate change never retroactively alters historical earnings — and a tutor can always be shown exactly what was deducted and why.

## 9.7 Refunds

| Trigger | Amount | Destination | Approval |
|---|---|---|---|
| Student cancels in free window | 100% | Credits | Automatic |
| Student cancels late | Per policy | Credits | Automatic |
| Tutor cancels | 100% + ৳50 grant if < 24 h | Credits | Automatic |
| Tutor no-show | 100% | Credits | Automatic, system-detected |
| Platform technical failure | 100% | Credits | Automatic |
| Quality dispute upheld | 100% or partial | Credits | Admin |
| Refund to original source | Case by case | bKash/Nagad/card | Admin, dual approval above ৳50,000 |
| Unused credits, account closure | 100% less PSP cost | Source | Admin, ID verification |

Refund-to-credits is the default because it is instant, costs nothing, and keeps value on-platform. Refund-to-source is always granted when the platform or tutor was at fault and the user asks — **making a wronged user argue for their money back is how a marketplace acquires a reputation it cannot shed.**

Every refund writes a compensating ledger entry; nothing is ever reversed by editing history.

## 9.8 Accounting treatment

This matters and is routinely got wrong by early-stage marketplaces.

- **Unspent credits are a liability, not revenue.** Selling ৳1,000 of credits creates ৳1,000 of deferred revenue. Revenue is recognised only when a session completes, and only the commission portion. A team that books top-ups as revenue will report a growing, profitable business that is actually accumulating an obligation.
- **The tutor's share is never platform revenue.** It passes through. Report **net revenue** (commission + fees) as the headline, with GMV alongside.
- **`credit_liability = SUM(credit_accounts.balance_credits) + SUM(hour_packs.hours_remaining × locked_rate)`** — a daily-tracked figure on the [admin dashboard](12-admin-console.md#124-revenue-dashboard).
- **Held funds should be segregated.** Prepaid customer money is not working capital. Holding it in a separate account is both correct practice and materially reduces regulatory risk.
- **Regulatory posture.** Holding prepaid customer balances touches Bangladesh Bank's payments and e-money regime, and marketplace settlement, VAT (standard rate 15%) and withholding-tax treatment all apply. **This is not something to determine from a technical document — engage a Bangladeshi corporate lawyer and a chartered accountant before launch**, and specifically ask: whether the credit balance requires a payment-service registration or must sit in an escrow/settlement account; how VAT applies to commission versus GMV; and what tax must be deducted at source from tutor payouts. Build the ledger so that either answer is implementable — which the design above already permits.

## 9.9 Payouts

### Cycle

```
Session completes
  → earnings row (accruing), payable_at = ends_at + 48h dispute window
  → nightly job: accruing & payable_at < now & no open dispute → payable
  → weekly batch (Sunday 02:00 Asia/Dhaka): payable → batched → payout created
  → disbursement executed → sent → provider confirms → confirmed
```

| Parameter | Value |
|---|---|
| Dispute window | 48 h after session end |
| Payout frequency | Weekly (Sunday); twice-weekly for L3 |
| Minimum payout | ৳500 (below this, rolls to the next cycle) |
| Instant payout | Available on request, 1% fee, L2+ only |
| Payout methods | bKash, Nagad, bank transfer (BEFTN) |

Payout speed is a top-three supply-retention factor. A tutor who waits three weeks for their money goes back to the coaching centre that pays cash on the day. Weekly is the floor, and instant payout exists specifically for the tutors who need liquidity.

### Execution

- Disbursement runs through the aggregator's payout API, bKash's B2C disbursement API, or BEFTN for banks — behind a `DisbursementProvider` interface mirroring `PaymentProvider`.
- **Every payout carries an `idempotency_key`.** A retried batch never double-pays.
- Payout method changes require **OTP step-up plus a 24-hour cooling period** during which payouts are held and the old number is notified. Payout-detail substitution is the highest-value attack on this system and this control is what blocks it.
- Failed payouts (wrong number, closed account) retry twice, then flag for support and notify the tutor by SMS.
- Name matching between the tutor's verified identity and the payout account name is checked; a mismatch requires manual review.

### Tutor-facing earnings view

Non-negotiable transparency, because opacity about money is precisely what tutors are escaping:

```
This week                      ৳ 18,450
  ├─ 21 sessions completed     ৳ 21,700
  ├─ Platform commission 15%   − ৳ 3,255
  └─ Next payout: Sun 17 Aug   ৳ 18,445

Pending (dispute window)       ৳  2,700
Lifetime earnings              ৳ 284,300
```

Every session's gross, commission and net is individually inspectable and exportable as CSV.

## 9.10 Testing and safeguards

| Control | Detail |
|---|---|
| Ledger property tests | Randomised operation sequences must always satisfy `balance = Σ entries` and `balance ≥ 0` |
| Idempotency tests | Every money endpoint replayed 10× concurrently must produce exactly one effect |
| PSP contract tests | Recorded sandbox fixtures for success, failure, timeout, duplicate webhook, amount mismatch |
| Reconciliation | Nightly, all invariants from [04 §4.12](04-data-model.md#412-invariants); mismatch pages immediately |
| Kill switch | Feature flag halting all top-ups and payouts independently, without a deploy |
| Dual approval | Any manual adjustment above ৳50,000 needs two admins; every adjustment is audited with a mandatory reason |
| No direct DB writes | Money tables are written only through the billing module's service layer; production credentials do not permit ad-hoc `UPDATE` on ledger tables |

---

Next: [10 — Recordings & Media](10-media-recordings.md)
