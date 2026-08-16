# 01 — Product Overview

## 1.1 The problem

Private tutoring in Bangladesh is enormous, essential, and almost entirely informal. Household spending on private coaching is a routine line item for urban middle-class families, and for secondary and higher-secondary students it is closer to the norm than the exception. Yet the market runs on:

- **Physical noticeboards and word of mouth.** A tutor's reachable market is the few square kilometres around their home and the WhatsApp groups of parents they already know.
- **Coaching centres as rent-extracting intermediaries.** A centre in Farmgate or Chawkbazar recruits students, sets the price, takes the majority of the fee, and hands the teacher a fraction. The teacher carries the reputation risk; the centre owns the relationship and the brand.
- **Cash, with no record.** No receipt, no refund path, no evidence a class happened, no recourse when it doesn't.
- **Zero portability of reputation.** A teacher with ten years of excellent results has no artefact proving it. Moving neighbourhoods means starting over.

Meanwhile the visible ed-tech layer — 10 Minute School, Bohubrihi, Shikho — solved a *different* problem. They are content publishers. A central team decides what gets produced, produces it well, and distributes it at near-zero marginal cost. That model has real strengths, but it structurally cannot include the 100,000+ individual teachers who already do the actual work, and it cannot deliver the thing families are actually paying for: **a specific named human, accountable for a specific student's board exam result.**

## 1.2 The wedge

> HelloStudents is where an individual teacher becomes a business with a price list, a calendar, a payment rail and a public reputation — without a coaching centre in the middle.

Concretely, the platform disintermediates the coaching centre by giving the teacher, for free, the four things the centre currently sells them:

| What the coaching centre provides today | What HelloStudents replaces it with |
|---|---|
| Student acquisition (the noticeboard, the location) | Search and ranking across the whole city, not one street |
| Collection and enforcement of fees | Prepaid credits — money is collected before the class, not chased after it |
| A room and a timetable | Availability rules, conflict-checked booking, a live link, a recording |
| Perceived credibility ("Uttara's #1 Physics centre") | Verification badges and accumulated public reviews owned by the teacher |

The centre takes 40–70% for this. HelloStudents takes a documented, single-digit-to-mid-teens commission (see [09](09-payments-credits.md#96-commission-and-take-rate)). That delta is the entire pitch to supply, and supply is the constraint in every marketplace of this kind.

## 1.3 Who it is for

### Supply — the tutor

**Rifat, 26, Chattogram.** BUET-graduate, teaches HSC Physics. Currently at a coaching centre that pays him ৳18,000/month for 24 batch-hours; the centre charges each of the 40 students ৳1,500/month. He knows the arithmetic. He wants his own students but has no way to find them, no way to make them pay reliably, and no way to prove he is good.

**Nusrat, 34, Dhanmondi.** Teaches Class 6–8 English one-to-one at students' homes. Spends two hours a day in traffic. Wants to convert half her load to online, keep the same rate, and stop having awkward conversations about last month's unpaid fee.

**Shafiq, 48, Mymensingh.** Runs a three-room coaching centre with four teachers. Not a competitor to displace — a *seller*. He should be able to onboard the centre as an organisation, list his teachers, and use the platform's booking and payment rails instead of a paper register. (Phase 3; see [15](15-roadmap-delivery.md).)

### Demand — the student and the payer

**Tanvir, 17, Mirpur, HSC candidate.** Chooses his own tutor, cares about board-exam track record, wants recordings because he misses classes.

**Mrs. Akter, 41, mother of a Class 9 student.** Actually holds the bKash account and makes the purchase decision. Cares about safety, verification, price transparency, and getting an SMS when her daughter's class starts. **She is the real payer and most of the payment UX is designed for her, not for the student.**

The payer and the learner are frequently different people. The product models this explicitly: a guardian account can fund a student account, receive the attendance and billing notifications, and see the ledger — without sitting in the class. This is not an edge case in Bangladesh; it is the median case for under-18 learners.

## 1.4 What we are not building

Scope discipline matters more here than feature count. Explicitly **out of scope for v1**:

- **Original content production.** We do not commission, script, or record lessons. Zero content team.
- **A native video conferencing stack.** v1 carries a Zoom/Meet link. See [ADR-003](adr/ADR-003-live-class-delivery.md).
- **A general LMS.** No gradebooks, no curriculum trees, no institutional SIS integration.
- **University/skills courses.** Bohubrihi's territory. We are K–12, board-exam and admission-test focused, where the coaching-centre economy is thickest.
- **Free-tier content marketing at scale.** Distribution comes from tutors bringing their existing students, not from a YouTube funnel.
- **Nationwide launch.** v1 is Dhaka metro plus Chattogram. A marketplace with thin liquidity spread over eight divisions is eight failed marketplaces.

## 1.5 Marketplace dynamics we have to respect

Everything below is a first-class product concern, not an afterthought.

**Cold start is supply-first, geographically dense.** The launch motion is: recruit 150–300 verified tutors concentrated in ~6 Dhaka neighbourhoods and 2 subjects (Physics and Mathematics, Classes 9–12), each of whom brings 5–20 of their *existing* students onto the platform. Those students are not the growth engine — they are the proof that payouts work. Organic demand is layered on afterwards.

**Disintermediation risk runs both ways.** Having removed the coaching centre, we become the thing that can be removed. Tutor and student meet on HelloStudents, then move to bKash-and-WhatsApp for class two. Defences are documented in [11](11-ratings-reviews.md#116-leakage-and-disintermediation): contact masking before booking, value that only exists on-platform (recordings, ledger, reviews, refund protection), and commission low enough that evading it isn't worth the loss of protection. **This is the single largest existential risk to the business model and it is a permanent, ongoing fight, not a launch checklist item.**

**Trust is the binding constraint, not features.** A parent is putting a stranger in front of their child and money into an app. Verification tiers, refund guarantees, and visible dispute handling do more for conversion than any amount of UI polish.

**Take rate is a strategic weapon, not a revenue dial.** Set it above ~20% and the arbitrage against coaching centres — the whole pitch — weakens, and leakage accelerates. See [09](09-payments-credits.md#96-commission-and-take-rate).

## 1.6 The nine capabilities

The brief's nine requirements, mapped to their specifications.

| # | Capability | Spec |
|---|---|---|
| 1 | Tutor onboarding: profile, subjects, credentials/verification, pricing | [06](06-tutor-onboarding.md) |
| 2 | Class creation: live scheduling (Zoom/Meet) or pre-recorded upload | [07](07-classes-scheduling.md), [10](10-media-recordings.md) |
| 3 | Student browse/search by subject, grade, area, price | [08](08-discovery-search.md) |
| 4 | Booking and calendar with conflict checks | [07](07-classes-scheduling.md#75-booking) |
| 5 | Credit/hour payment model with bKash/Nagad | [09](09-payments-credits.md), [ADR-001](adr/ADR-001-credit-unit.md) |
| 6 | Recording storage and playback for missed sessions | [10](10-media-recordings.md) |
| 7 | Ratings and reviews per tutor | [11](11-ratings-reviews.md) |
| 8 | Admin: approve tutors, disputes, revenue dashboard | [12](12-admin-console.md) |
| 9 | SMS/email notifications | [13](13-notifications.md) |

## 1.7 Success metrics

Vanity metrics (registrations, app downloads, "users") are explicitly not tracked as headline numbers. The marketplace is healthy or it isn't, and these are the measurements that say which.

### Liquidity — the primary health metrics

| Metric | Definition | v1 target (month 6) |
|---|---|---|
| **Search→booking conversion** | Sessions booked ÷ searches with ≥1 result | ≥ 8% |
| **Tutor activation** | % of approved tutors with ≥1 paid session in first 30 days | ≥ 60% |
| **Time to first booking** | Median hours from tutor approval to first paid booking | < 96h |
| **Demand fill rate** | % of student searches returning ≥5 matching, available tutors | ≥ 85% |
| **Repeat rate** | % of students booking a 2nd session with the same tutor within 30 days | ≥ 55% |

Repeat rate is the number to watch above all others. In a tutoring marketplace, a student who books once is noise; a student who books the same tutor eight times is the business. It is also the cleanest early proxy for leakage — a high first-booking rate with a collapsing repeat rate means the relationship moved off-platform.

### Commercial

| Metric | Definition |
|---|---|
| **GMV** | Total value of completed sessions, in BDT |
| **Net revenue** | Commission + service fees, after refunds and PSP costs |
| **Effective take rate** | Net revenue ÷ GMV |
| **Credit liability** | Unspent purchased credits — a balance-sheet liability, not revenue ([09](09-payments-credits.md#98-accounting-treatment)) |
| **Contribution margin per session** | Net revenue − PSP fee − SMS cost − streaming/storage cost |

### Quality and trust

| Metric | Target |
|---|---|
| Session completion rate (booked → attended by both) | ≥ 92% |
| Tutor no-show rate | < 2% |
| Dispute rate | < 1.5% of sessions |
| Refund rate | < 3% of GMV |
| Median tutor payout latency after settlement window | < 24h |
| Verified-tutor share of GMV | ≥ 90% |

### Counter-metrics

Watched to catch a metric being gamed:

- **Rating inflation** — share of reviews at 5★. Above ~80% means reviews carry no signal; see [11](11-ratings-reviews.md#114-integrity).
- **Leakage proxy** — students whose booking count drops to zero within 30 days of a completed first session with a tutor who remains active.
- **Support contacts per 100 sessions** — a rising number means the automation is failing somewhere upstream.

## 1.8 Business model

| Line | Mechanism |
|---|---|
| Primary | Commission on completed sessions, deducted at settlement (default 15%) |
| Secondary | Student service fee on credit top-up, disclosed pre-purchase (0–2%, covers PSP MDR) |
| Tertiary (later) | Featured placement in search for tutors — strictly labelled, capped, never displacing the top organic result |
| Explicitly rejected | Selling student contact data; charging tutors to join; paywalling reviews |

Featured placement is deferred to Phase 4 deliberately: monetising discovery before liquidity exists degrades result quality at exactly the moment result quality is the only thing keeping demand on the platform.

---

Next: [02 — Domain Model & Glossary](02-domain-model.md)
