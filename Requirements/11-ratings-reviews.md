# 11 — Ratings, Reviews & Trust

*Implements capability 7: ratings and reviews per tutor — plus the broader trust and anti-leakage system they belong to.*

## 11.1 What reviews are for

Reviews are the mechanism by which a stranger becomes bookable. For a parent deciding whether to put an unknown person in front of their child and ৳900 on the table, the review corpus is the entire basis of the decision.

That gives them one job: **discriminate between tutors.** A review system where 94% of ratings are 5★ conveys nothing and is worse than no reviews at all, because it looks informative while being noise. Everything below is designed to preserve signal.

## 11.2 The model

| Property | Decision |
|---|---|
| **Who can review** | Only a student with an `attended` booking. Enforced by `reviews.booking_id UNIQUE NOT NULL`. |
| **Granularity** | One review per booking, not per tutor — so a long relationship produces a trail over time |
| **Window** | Opens at session completion, closes after 30 days |
| **Overall rating** | 1–5 stars, required |
| **Sub-ratings** | Clarity of explanation, punctuality, helpfulness — 1–5, optional |
| **Comment** | Optional, 0–2,000 chars, bn or en |
| **Editable** | For 48 h, then frozen. Edits are versioned. |
| **Tutor reply** | Exactly one, public, permanent |
| **Anonymity** | Displayed as first name + last initial ("Tanvir A."). Fully anonymous reviews attract abuse; full names deter honest negative feedback. |
| **Deletion** | Students cannot delete a review after 48 h. Only moderation removes it, always with a logged reason. |

`booking_id UNIQUE` is the entire integrity foundation compressed into one constraint: **no attended, paid booking → no review.** Manufacturing a fake review requires manufacturing a paid booking, which costs real money and leaves an immutable ledger trail. Nearly every review-fraud problem other marketplaces have is a consequence of not doing this.

## 11.3 Aggregation

The displayed rating is a **Bayesian average**, not an arithmetic mean:

```
displayed_rating = (C · m + Σ ratings) / (C + n)
    m = platform-wide mean rating
    C = 10   (prior weight ≈ "ten average reviews of prior belief")
```

A tutor with one 5★ shows ~4.4, not 5.0. A tutor with two hundred 4.8★ shows 4.79. This is the difference between a ranking that can be gamed by a single friend and one that cannot.

Displayed alongside the number, because a single scalar hides too much:

- Review count and sessions completed
- A rating distribution histogram
- Recency weighting — reviews decay to 50% weight over 12 months, so a tutor who was good in 2024 and is coasting now does not keep the benefit
- Sub-rating breakdown
- Repeat-booking rate: *"68% of students book again"* — arguably the most honest quality signal on the platform, because it is behavioural rather than stated

**Reviews are not shown at all below 3 reviews.** Instead: "New tutor — 4 sessions completed." One review is not data, and displaying it as though it were misleads both sides.

## 11.4 Integrity

| Threat | Control |
|---|---|
| Fake positive reviews from friends | Requires a real paid booking; self-booking and circular-payment detection ([14 §14.5](14-security-compliance.md#145-fraud)); reviews from accounts sharing a device/payment instrument with the tutor are excluded from aggregates |
| Review farming (many cheap bookings) | Weight per reviewing student is capped — 10 reviews from one student count roughly as one; minimum session duration and minimum price thresholds apply |
| Retaliatory negative reviews | Tutors cannot see who left which review until the review window closes; tutors cannot review students publicly |
| Extortion ("refund me or I leave 1★") | Reportable; a review by a student with an open unresolved refund demand is held for moderation |
| Rating inflation | Rating prompts avoid leading language; the star selector has no pre-selection; the platform never asks "was it 5 stars?" |
| Review bombing | Velocity anomaly detection; a sudden cluster of low ratings from new accounts is auto-held |
| Bought reviews | Behavioural clustering on booking patterns; economically unattractive because each fake review costs a real session fee |

**Counter-metric:** the share of 5★ reviews is tracked as a *health* metric. Above ~80%, the system is not discriminating and needs intervention — usually in the prompt design rather than the algorithm.

## 11.5 Moderation

Auto-published by default, with automated pre-screening:

| Check | Action |
|---|---|
| Profanity / slurs (bn + en lexicons) | Held for review |
| Contact details (phone, email, social handles, in either script or in Bangla numerals) | **Auto-redacted**, review published, both parties warned |
| Personally identifying info about third parties | Held |
| Off-topic or spam | Held |
| Safeguarding language (any allegation involving a minor) | **Escalated immediately** to a named human, review held, tutor's future in-person sessions paused pending review |

Safeguarding reports never sit in a general moderation queue. They route to a specific person with a hard SLA, and the precautionary action happens before the investigation concludes, not after.

Users may report any published review; a reported review stays visible while under review unless it is a safeguarding matter, in which case it is hidden immediately.

Removal reasons are recorded in `audit_log` and the review author is told which rule applied. **A rating is never removed simply because a tutor disputes it** — a tutor who can get bad reviews deleted is a marketplace with no reviews.

## 11.6 Leakage and disintermediation

Having removed the coaching centre from between tutor and student, HelloStudents becomes the thing that can be removed. Tutor and student meet here, then move to bKash-and-WhatsApp for session two. **This is the largest existential risk to the business model** and it is a permanent operational concern, not a launch checklist item.

### Reduce the opportunity

| Control | Detail |
|---|---|
| Contact masking | Phone numbers and emails are never exposed on profiles or in search. Pre-booking messaging is platform-only. |
| Pattern redaction | Phone numbers, emails and social handles are detected and redacted in profiles, offering descriptions, reviews and messages — in Latin *and* Bengali script, including spelled-out digits and common obfuscations ("zero one seven one two…") |
| Progressive disclosure | Contact details are exchanged only after a confirmed booking, and only what the session requires |
| Link protection | Meeting links are released only from T−15 min to confirmed bookers, never by SMS or on any public surface |

Detection must be honest about its limits: a determined pair will exchange numbers verbally during a class, and no amount of regex prevents it. Redaction raises friction at the margin; it does not solve the problem.

### Make staying worth more

This is the part that actually works.

| Value that only exists on-platform | Why it holds |
|---|---|
| **Payment protection** | Refund on no-show, dispute resolution, an actual receipt. Off-platform, the student has no recourse and knows it. |
| **Recordings** | The library disappears the moment they leave |
| **Reputation** | The tutor's reviews are their most valuable asset and are non-portable. Every off-platform session is a review they will never earn. |
| **Scheduling and reminders** | The SMS reminder ladder measurably reduces no-shows for both sides |
| **Discovery** | The tutor keeps receiving new students only while they remain active and well-rated |
| **Earnings record** | A verifiable income history — genuinely useful in a market where informal earnings are hard to evidence |
| **Low commission** | At 15%, evasion saves ৳135 on a ৳900 class and forfeits all of the above. At 30% the arithmetic flips. |

The commission rate is therefore a **trust-and-retention parameter**, not just a revenue one. Raising it must be evaluated against the leakage metric, never against a revenue projection alone. See [09 §9.6](09-payments-credits.md#96-commission-and-take-rate).

### Measure it

Leakage is invisible by nature — nobody announces it. Proxies:

- **Repeat rate decay**: a student books once, rates highly, then never books again while the tutor remains active. High-signal.
- **Session-duration drift**: bookings shifting to the minimum billable duration while the relationship continues (booking one 30-minute session per month to keep a nominal connection).
- **Survey**, occasionally and honestly: "Do you also take classes with this tutor outside HelloStudents?" Framed without penalty, because punishing the answer just ends the data.
- **Cohort curves**: sessions-per-student-per-month by cohort, watched for a cliff after month one.

### Enforce sparingly

Explicit off-platform solicitation ("pay me directly on bKash, it's cheaper") is a policy violation: warning, then suspension for repeats. But enforcement is a weak tool here — a tutor who feels the platform is worth less than its commission will leave regardless, and heavy-handed policing accelerates the exit. **The primary defence is being worth the commission; enforcement handles the residual.**

## 11.7 Trust signals beyond reviews

What a parent actually looks at, in order:

1. Verification badges (L1/L2/L3) — see [06 §6.3](06-tutor-onboarding.md#63-verification-tiers)
2. Sessions completed — volume as social proof
3. Repeat-booking rate — the behavioural quality signal
4. Response time — "usually replies within 2 hours"
5. Reviews and the distribution
6. Intro video — the single strongest conversion element on the profile
7. Institution and credentials
8. Cancellation rate — shown when it is bad (>10%), because it is material to a booking decision

Deliberately **not** shown: exact profile view counts, "N people are viewing this tutor", countdown timers, or any other artificial-scarcity pattern. This is a market where parents are already anxious about being taken advantage of; manufactured urgency reads as a scam and costs more trust than it gains in conversion.

## 11.8 Student-side reputation

Tutors need protection too — a student who repeatedly no-shows wastes a tutor's reserved hour.

- A **private** reliability signal on student accounts: attendance rate, cancellation rate, no-show count. Visible to the tutor as a coarse band ("Reliable" / "Some cancellations"), never as a public score and never as a number.
- Three no-shows in 30 days requires prepayment with no free-cancellation window.
- Tutors may decline a booking request from a student with a poor record, with the reason logged.
- **Students are never publicly rated.** They are frequently minors, and a public reputation score attached to a child is not a system worth building.

---

Next: [12 — Admin Console](12-admin-console.md)
