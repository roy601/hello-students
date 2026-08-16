# ADR-001 — Credits are money-pegged; "hours" are a tutor-scoped product on top

**Status:** Accepted · **Date:** 2026-08-10 · **Supersedes:** the literal reading of requirement 5

## Context

The brief specifies a "credit/hour-based payment model (buy N hours, deduct per class)". Taken literally — one credit equals one hour, spendable with any tutor — this is incompatible with the core product decision that **tutors set their own prices**.

The failure is immediate and unavoidable:

> A student buys 10 hours for ৳5,000, implying ৳500/hour. They book Rifat, who charges ৳900/hour.
>
> - If one credit covers the hour, the platform eats ৳400 per session. At any volume this is fatal.
> - If it does not, the "hour" was never an hour, and the platform sold something it did not deliver.
> - If credits are priced at the maximum tutor rate, the product is unsellable — nobody prepays ৳2,000/hour for a ৳500 tutor.

There is no pricing of a fungible hour-credit that works across a marketplace with heterogeneous, seller-set prices. The only systems where fungible hour-credits function are ones where a central authority sets a single price — precisely the centrally-produced model this product exists to compete against.

Meanwhile the *intent* behind the requirement is sound and worth preserving: prepayment reduces payment friction per booking, commits the student, gives the tutor forward visibility, and — critically for Bangladesh — batches expensive mobile-wallet transactions into one larger payment instead of one per class.

## Options considered

**A. Fungible hour-credits at a single platform rate.** Requires platform-set pricing. Rejected — it eliminates the marketplace.

**B. Hour-credits with tutor rate tiers** (a Tier-2 tutor costs 1.5 credits/hour). Preserves fungibility, but every tier boundary is a pricing cliff the tutor cannot cross without a large jump, tier assignment becomes a political fight, and students still cannot predict what an hour costs. Rejected.

**C. Money-pegged wallet credits only.** Correct arithmetic, but loses the "buy N hours" product entirely, and the psychological commitment that comes with it.

**D. Money-pegged wallet + tutor-scoped hour packs.** *(Chosen.)*

## Decision

Two prepaid instruments.

### Wallet Credits

- **1 credit = 1 poisha = 0.01 BDT.** A pure money peg.
- Fungible across every tutor. Purchased in packages, which may carry bonus credits (pay ৳1,000, receive ৳1,050) — the discount lives in the *package*, not in the unit.
- Presented to the user as taka, never as "credits" in the UI. The internal unit exists for ledger precision; users see `৳2,400`.
- Where a tutor context exists, the balance is expressed in hours: **"৳2,400 — about 2.6 hours with Rifat."** This is where the brief's mental model is delivered.

### Hour Packs

- **N hours with one specific tutor**, at a rate locked at purchase, optionally scoped to one subject.
- "10 hours with Rifat Hossain — HSC Physics · ৳850/hr (5% off list) · ৳8,500 · valid 6 months."
- Non-fungible. Consumed before wallet credits when both could pay.
- Partial coverage falls back to the wallet for the remainder, disclosed before confirming.
- Expiry warned at 30 and 7 days; expired hours convert to wallet credits at 80% of value rather than being confiscated.
- Refunded to wallet credits at **100%** if the tutor leaves the platform or is suspended.

This is the literal "buy N hours, deduct per class" product from the brief. It works because scoping to one tutor makes the rate unambiguous.

## Consequences

**Positive**

- The arithmetic is correct at every price point, with no subsidy and no misrepresentation.
- Tutors retain full pricing freedom — the product's whole premise.
- The ledger is a single integer unit; no conversion tables, no rounding between units.
- Hour packs are commercially *stronger* than fungible hours: they lock a rate (valuable when a tutor raises prices), commit the student to one tutor — which directly lifts repeat rate, the metric that matters most — and give the tutor guaranteed forward income, a genuine supply-retention argument.
- Prepayment batching still works: one ৳2,000 top-up covers several sessions, avoiding per-class mobile-wallet friction and per-transaction PSP cost.

**Negative**

- Two instruments to explain, two code paths in payment-source resolution, two things on the billing screen.
- Hour packs create a per-tutor liability that must be tracked separately in `credit_liability`.
- Users may still say "I bought 10 hours" and mean wallet credits. The UI mitigates with the hours-equivalent display.

**Mitigations**

- `payment_source: "auto"` resolves hour pack → wallet → shortfall automatically. **Most users never make this choice consciously.**
- Hour packs are Phase 2. Phase 1 ships wallet credits alone, which proves the model with the simpler instrument.

## Notes

If a future business model introduces platform-set pricing for a subset of supply — a standardised "verified batch class" product, say — fungible hour-credits become viable *within that subset*. That would be an additive third instrument, not a replacement, and would need its own ADR.

## References

- [09 — Payments, Credits & Payouts](../09-payments-credits.md)
- [04 §4.6 — Billing schema](../04-data-model.md#46-billing)
