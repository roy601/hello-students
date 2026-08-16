# 15 — Delivery Plan & Roadmap

## 15.1 Sequencing principle

A marketplace is not built feature-by-feature; it is built **liquidity-first**. The only question that matters in the first six months is whether a real tutor can earn real money from a real student who found them here. Every feature is sequenced by how directly it serves that loop.

The corollary: several capabilities in the brief are genuinely important but are *not* what makes the first transaction happen, and shipping them early would delay the thing that proves the business. Recordings, group classes and a native classroom all fall into that category and are scheduled accordingly.

## 15.2 Phase 0 — Foundations (Weeks 1–3)

Nothing user-facing. Everything downstream depends on this being right.

- Monorepo, CI/CD, environments, IaC
- Postgres schema for identity, catalog, tutor, scheduling, booking, billing
- **The taxonomy** — subjects, grades, curricula, boards, and the location tree for Dhaka and Chattogram. This is data-entry work, it is on the critical path, and it is consistently underestimated. Start it in week 1.
- Auth: phone normalisation, OTP, JWT, refresh rotation
- SMS provider integration + **masked sender ID application submitted** (multi-week lead time; it will block launch if left late)
- Payment aggregator sandbox integration behind the `PaymentProvider` interface
- Ledger with property tests
- Observability, error tracking, structured logging with scrubbing

**Exit criteria:** a user can register with a phone number; the ledger passes randomised property tests; a sandbox payment credits an account end to end.

## 15.3 Phase 1 — MVP: the first real transaction (Weeks 4–12)

Scope is ruthlessly limited to the loop: **tutor onboards → student finds them → books → pays → attends → rates → tutor gets paid.**

| Week | Deliverable |
|---|---|
| 4–5 | Tutor onboarding: profile, subjects, rates, availability, credential upload |
| 5–6 | Admin console: approval queue, audit log, basic user management |
| 6–7 | Offerings and sessions; availability engine; the exclusion constraint |
| 7–8 | Search and browse (Postgres-backed); tutor profile pages, SSR |
| 8–9 | Booking with conflict checks, hold/capture, cancellation policy |
| 9–10 | Credits: packages, top-up via bKash/Nagad through the aggregator, ledger UI, reconciliation job |
| 10–11 | Notifications: the full SMS reminder ladder; live-link handling; no-show detection |
| 11 | Reviews; payouts (manual execution with dual approval — automation comes later) |
| 12 | Hardening, load test, pen test, pilot |

**In scope:** one-to-one live online classes only. Dhaka only. Bangla + English UI. Web only (mobile-responsive).

**Explicitly out of scope for Phase 1** — and this list is the plan working, not the plan failing:

- Recordings (Phase 2)
- Group classes (Phase 2)
- Pre-recorded course offerings (Phase 2)
- In-person tutoring (Phase 2 — requires the L3 tier and the safeguarding regime)
- Native mobile apps (Phase 3)
- Hour packs (Phase 2 — wallet credits alone prove the model)
- Typesense (Phase 2)
- Organisations/coaching centres (Phase 3)

**Exit criteria:**
- 50 approved tutors, ≥ 30 with a published offering
- 200 completed paid sessions
- Payment success rate ≥ 92%
- Zero ledger reconciliation failures over 14 consecutive days
- ≥ 1 successful payout batch executed and confirmed by tutors
- Median tutor approval time < 12 h

## 15.4 Phase 2 — Depth (Weeks 13–24)

Once the loop works, widen it.

| Theme | Work |
|---|---|
| **Recordings** | Manual upload, transcode, entitlement, playback ([10](10-media-recordings.md)) |
| **Group classes** | Capacity, `min_seats`, per-seat pricing |
| **Hour packs** | The tutor-scoped prepaid product ([09 §9.4](09-payments-credits.md#94-hour-packs)) |
| **In-person tutoring** | L3 tier, travel buffers, area matching, safeguarding controls |
| **Search** | Typesense, Bangla transliteration, exploration slots, demand-gap reporting |
| **Zoom OAuth** | Automatic meeting creation, attendance, recording pull |
| **Payouts** | Automated weekly batches, instant payout for L2+ |
| **Recorded offerings** | Sell a lesson library without a calendar |
| **Chattogram launch** | Second city; validates that the geo model generalises |

**Exit criteria:** 500 active tutors, 5,000 monthly sessions, repeat rate ≥ 50%, tutor activation ≥ 55%.

## 15.5 Phase 3 — Scale (Months 7–12)

| Theme | Work |
|---|---|
| **Mobile apps** | Expo, Android-first — the market is overwhelmingly Android |
| **Organisations** | Coaching centres as sellers with revenue splits ([06 §6.6](06-tutor-onboarding.md#66-coaching-centres-as-sellers-phase-3)) |
| **WhatsApp notifications** | Likely cheaper and richer than SMS at volume |
| **Direct bKash integration** | Once volume justifies the separate merchant relationship |
| **Bangla captions** | ASR on recordings |
| **Geographic expansion** | Sylhet, Khulna, Rajshahi |
| **Referral programme** | Both sides; the strongest organic channel in this market |
| **Trust upgrades** | Automated NID verification through an authorised provider |

## 15.6 Phase 4 — Platform (Year 2)

Deferred deliberately until liquidity is proven — each of these is a distraction before then.

- Native in-browser classroom (LiveKit/100ms) with whiteboard and integrated recording
- Featured placement in search — capped, labelled, never displacing the top organic result
- Outbound webhooks and a partner API for coaching centres
- Adaptive practice and assessment
- Group/batch products at coaching-centre scale
- Institutional partnerships (schools)

## 15.7 Team

Minimum viable team through Phase 1:

| Role | Count | Notes |
|---|---|---|
| Full-stack engineers | 3 | One with real payments experience — this is not a role to learn on |
| Product / design | 1 | Must design in Bangla first, not translate |
| Operations / verification | 1–2 | Ramps with the approval queue; the SLA is a growth lever |
| Supply growth | 2 | Feet on the ground. **The critical hire.** |
| Founder / commercial | 1 | Regulatory, PSP, SMS relationships |

**Supply growth is the constraint, not engineering.** A perfect platform with 20 tutors is worth nothing. Recruiting the first 300 tutors is field work — visiting coaching centres, university departments and teacher networks in specific Dhaka neighbourhoods — and it should be staffed and budgeted as the primary activity of the launch, not as marketing support.

## 15.8 Launch plan

**Pilot (weeks 12–16): one neighbourhood, two subjects.**

Dhanmondi + Mohammadpur, Physics and Mathematics, Classes 9–12. 50 tutors, each bringing 5–10 existing students. This cohort is not the growth engine — it is the proof that approval, booking, payment, reminders and payouts all work with real money. Fix everything they surface before widening.

**Launch cohort incentives:** first 200 tutors pay 0% commission for 6 months, then 10% permanently. Expensive, correct, and the cheapest customer acquisition available — early tutors take real risk on an unproven platform and recruit their own students.

**Expansion order:** Dhanmondi/Mohammadpur → Uttara → Mirpur → Bashundhara/Badda → Chattogram. Density before breadth, always. A marketplace spread thin over eight divisions is eight failed marketplaces.

**Go/no-go gates:** payment success ≥ 92%, SMS delivery ≥ 95%, zero unresolved ledger mismatches, pen test findings closed, legal sign-off on holding customer funds, masked sender ID approved.

## 15.9 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Supply doesn't onboard** | Medium | Fatal | 0% launch commission; field recruitment; sub-12-minute onboarding; sub-6-hour approval |
| **Leakage to off-platform** | **High** | Severe | Low take rate; on-platform-only value; measurement via repeat-rate decay ([11 §11.6](11-ratings-reviews.md#116-leakage-and-disintermediation)) |
| **Safeguarding incident** | Low | Fatal | L3 gate for in-person with minors; guardian consent; immediate escalation; precautionary suspension |
| **Regulatory block on holding funds** | Medium | Severe | Legal review **before** launch; segregated account; architecture already supports either answer |
| **Payment reliability** | Medium | Severe | Aggregator + reconciliation job + independent verification; multiple methods |
| **SMS provider failure** | Medium | Severe | Two providers with automatic failover; synthetic canaries per operator |
| **10 Minute School enters the marketplace space** | Medium | Moderate | Speed; supply relationships; they are structurally a content business and marketplace is a different muscle |
| **Coaching centres retaliate against tutors** | Medium | Moderate | Support online-only tutors first; onboard centres themselves in Phase 3 |
| **Chargebacks / payment disputes** | Low | Moderate | Prepaid model limits exposure; clear receipts; ledger evidence |
| **Storage costs outrun revenue** | Medium | Moderate | Tiered lifecycle; view-based retention; per-session cost tracking |
| **Founder-led legal work is wrong** | Medium | Severe | Engage BD counsel and a chartered accountant in Phase 0, not at launch |

## 15.10 What would make us stop

Honest kill criteria, agreed in advance while judgement is still uncommitted — because the point of writing them down now is that they are much harder to write down later:

- **Tutor activation below 30% at month 6.** Supply is onboarding but not transacting; the value proposition is not real.
- **Repeat rate below 30% at month 6.** Either the matching is bad or leakage has already won.
- **Contribution margin negative at 5,000 monthly sessions.** The unit economics do not close and no amount of volume fixes them.
- **A regulatory finding that prohibits holding prepaid balances with no workable alternative structure.**

None of these are expected. All of them are checkable, on a date, against a number — which is the only kind of kill criterion worth having.

---

Back to the [documentation index](../README.md).
