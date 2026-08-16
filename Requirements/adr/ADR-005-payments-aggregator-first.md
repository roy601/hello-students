# ADR-005 — Payment aggregator first, direct bKash later

**Status:** Accepted · **Date:** 2026-08-10

## Context

Requirement 5 calls for bKash/Nagad integration. Two routes exist:

**Direct integration** with each wallet provider — a separate merchant agreement, separate credentials, separate API, separate settlement cycle and separate reconciliation per provider. bKash's tokenised checkout uses a grant-token → create → execute → query lifecycle; Nagad's uses RSA-signed initialise/complete with encrypted sensitive data. They share nothing.

**Aggregator integration** — SSLCommerz, ShurjoPay, aamarPay and similar expose bKash, Nagad, Rocket, Upay, cards and internet banking through one API, one merchant relationship, one settlement report.

The trade-off is per-transaction cost against integration and operational cost. Aggregators add a margin on top of the underlying wallet MDR. Direct integration is cheaper per transaction but multiplies the fixed cost of building, certifying and operating each rail — and each rail has its own failure modes, its own sandbox quirks, and its own settlement-reconciliation process.

Additional considerations:

- Payment coverage is a **conversion** issue, not a feature issue. A student whose preferred method is missing does not switch methods — they leave. bKash alone is roughly 55–65% of expected volume; Nagad another 20–25%. Launching with one is launching with a large hole.
- Merchant onboarding with a wallet provider directly requires company registration, trade licence, and a compliance review that takes weeks and cannot be usefully parallelised with a three-person engineering team's Phase 1.
- Reconciliation effort scales with the number of settlement sources. One provider means one daily settlement file to match against the ledger.

## Decision

**Phase 1–2: a single aggregator** (SSLCommerz or ShurjoPay, selected on commercial terms and sandbox quality), covering bKash, Nagad, Rocket, Upay and cards.

**Phase 3: direct bKash**, added as a second provider once volume makes the MDR delta exceed the integration and operating cost, with the aggregator retained for everything else and as failover.

All payment code sits behind a provider interface from day one:

```ts
interface PaymentProvider {
  createPayment(o: OrderIntent): Promise<{ redirectUrl: string; providerRef: string }>;
  verifyPayment(providerRef: string): Promise<PaymentStatus>;   // authoritative
  refund(r: RefundRequest): Promise<RefundResult>;
  parseWebhook(raw: RawWebhook): Promise<WebhookEvent>;
}

interface DisbursementProvider {
  send(p: PayoutInstruction): Promise<DisbursementResult>;      // idempotency key required
  status(providerRef: string): Promise<DisbursementStatus>;
}
```

Provider selection is per-order, driven by config, so direct bKash can be enabled for a percentage of traffic and rolled back without a deploy.

## Rules that hold regardless of provider

These are provider-independent and are the actual defence against losing money:

1. **Never issue credits from webhook data alone.** A server-to-server `verifyPayment` call confirms status and amount first. Webhooks are a hint that something happened.
2. **Verify the amount against the order.** A mismatch never credits; it raises a finance alert.
3. **Persist every webhook before processing**, deduped on `(source, external_id)`.
4. **Sweep unresolved orders.** A job queries the provider for every `initiated`/`pending` order older than 15 minutes. In this market a meaningful share of successful wallet payments never deliver a usable webhook — the user's money left their bKash account and the platform has to find it without being told. **This job prevents the single worst support ticket the business can generate.**
5. **Idempotency keys on every payment and payout operation.**
6. **Kill switch per provider**, flag-controlled, no deploy required.

## Consequences

**Positive**

- One integration for launch, covering ~95% of expected volume across all major methods.
- One merchant relationship, one settlement file, one reconciliation process — proportionate to a three-person team.
- Full method coverage from day one; no conversion lost to a missing payment option.
- The provider interface makes direct bKash an adapter, not a rewrite.
- The aggregator absorbs PCI scope for card payments entirely (hosted checkout, no PAN ever touching our systems).

**Negative**

- Higher per-transaction cost than direct integration. Real, and it compresses contribution margin on low-value sessions. Partly offset by the top-up service fee and by prepayment batching — a ৳2,000 top-up carries one MDR charge instead of four.
- A single point of failure for all payments in Phase 1. Mitigated by the kill switch, by monitoring per-method success rates (bKash and Nagad fail independently even behind one aggregator), and by prioritising the direct-bKash second rail if aggregator reliability proves poor.
- Less control over the checkout UX; the hosted page is the aggregator's.
- Settlement timing is the aggregator's, adding a day or two to the payout cycle.

## Selection criteria for the aggregator

Evaluate on, in order: **bKash and Nagad both present and reliable**; sandbox quality and documentation; webhook reliability and signature verification; refund API; **disbursement/payout API** (needed for tutor settlement, and not all aggregators offer it); settlement frequency; MDR and its volume tiers; and support responsiveness in Bangladesh business hours.

Disbursement support deserves particular weight — if the aggregator cannot pay tutors out, a second provider relationship is needed immediately and much of the simplicity this decision buys is lost.

## Revisit criteria

Add direct bKash when: monthly bKash volume × MDR delta exceeds roughly 3 months of integration and operating cost; or aggregator bKash success rate falls below 92%; or the aggregator's settlement timing becomes a supply-retention complaint.

## Note on API details

Provider API shapes, MDR rates and settlement terms change. **Verify everything against the provider's current documentation and your signed rate card** — nothing in this repository, including this ADR, should be treated as a current statement of a third party's commercial or technical terms.

## References

- [09 §9.5 — Payment integration](../09-payments-credits.md#95-payment-integration)
- [09 §9.9 — Payouts](../09-payments-credits.md#99-payouts)
