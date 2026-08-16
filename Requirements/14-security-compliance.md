# 14 — Security, Privacy & Compliance

The platform holds three things that make it a target: **prepaid customer money**, **identity documents**, and **data about minors**. The third is the one that ends the company if mishandled.

## 14.1 Threat model

| Threat | Impact | Priority |
|---|---|---|
| Payout-detail substitution (attacker redirects a tutor's earnings) | Direct financial loss, unrecoverable | **Critical** |
| Account takeover via SIM swap or number recycling | Money theft, impersonation | **Critical** |
| Safeguarding incident involving a minor | Existential | **Critical** |
| Credential/NID document leak | Regulatory and reputational catastrophe | **Critical** |
| Recording leak | Privacy harm to minors, tutor IP loss | High |
| OTP pumping (SMS-cost fraud) | Direct cost, then SMS provider suspension | High |
| Payment manipulation (amount tampering, replayed webhooks) | Financial loss | High |
| Fake tutor accounts | Trust collapse | High |
| Scraping tutor contact data | Leakage to competitors, spam | Medium |
| Review manipulation | Degraded marketplace signal | Medium |

## 14.2 Authentication

Phone + OTP is the only login path. No passwords means no password reuse, no credential stuffing, no reset-flow vulnerabilities — and one concentrated dependency on SMS delivery and on the phone number itself.

| Control | Detail |
|---|---|
| OTP format | 6 digits, cryptographically random, 5-minute validity, single use |
| Storage | **Hashed** (Argon2id). Never stored, logged, or returned in plaintext — including in dev and staging logs. |
| Attempt limits | 5 verification attempts per challenge, then the challenge is destroyed |
| Send limits | 5/hour per number, 20/hour per IP, 60 s resend cooldown, exponential backoff after 3 failed challenges |
| Spend cap | Hard daily SMS ceiling per number; exceeded numbers require support contact |
| Enumeration | The response is identical whether or not the number is registered |
| Access token | JWT RS256, 15 min, key rotated quarterly |
| Refresh token | Opaque, 60 days, single-use with rotation, hashed at rest. **Reuse of a rotated token revokes the whole family** and forces re-auth — the standard stolen-token signal. |
| Device management | Users see and revoke active sessions |

### Step-up authentication

Fresh OTP required regardless of an active session for: changing a payout method, changing the account phone number, withdrawing to source, any admin write action, and viewing an identity document in the console.

## 14.3 Minors

A large share of students are under 18, and a meaningful share under 16.

| Rule | Detail |
|---|---|
| Under-16 accounts require a **verified guardian link** | Booking requires guardian approval; the guardian receives all transactional notifications |
| Date of birth is collected at student registration | Drives the entire minors regime; not optional |
| No public student profiles | Students are never publicly listed, searchable, rated, or discoverable |
| Minimal data | No address, no school, no photo required for students |
| **In-person tutoring with a minor requires an L3 tutor** | The safeguarding line. Non-negotiable. |
| Recording consent | Guardian consent captured before a minor is recorded; see [10 §10.7](10-media-recordings.md#107-consent-and-privacy) |
| Messaging | Guardian-visible by default for under-16 accounts, disclosed to both parties |
| No behavioural advertising | Ever, to any account, but especially these |
| Safeguarding reports | Bypass every queue, route to a named individual, precautionary suspension **before** investigation concludes |

The precautionary-suspension ordering is deliberate and is worth stating plainly: when a safeguarding allegation arrives, in-person sessions stop first and the facts are established second. The cost of being wrong in that direction is an inconvenienced tutor. The cost of being wrong in the other direction is a child.

## 14.4 Data protection

### Classification

| Class | Examples | Handling |
|---|---|---|
| **Restricted** | NID numbers, payout account numbers, identity documents, OTP hashes | Encrypted at rest with KMS-held keys; access logged individually; never in any API response; never in logs; excluded from all non-production environments |
| **Sensitive** | Phone, email, DOB, address, recordings, ledger | Encrypted at rest; role-gated; masked in the admin console; masked in logs |
| **Internal** | Bookings, sessions, earnings | Access-controlled |
| **Public** | Tutor profiles, reviews, offerings | Intentionally public |

### Controls

- TLS 1.3 in transit; HSTS with preload; TLS to the database and to Redis.
- AES-256 at rest for all volumes; field-level AES-256-GCM under KMS data keys for restricted fields.
- Identity documents live in a **separate private bucket** with no public access path, short-TTL signed URLs, and per-view audit logging.
- **Log scrubbing is centralised and tested.** Phone numbers appear as last-4 only; tokens, OTPs and document numbers are stripped by a shared serialiser, and there is a test asserting that a payload containing each pattern is redacted.
- Non-production environments get anonymised data: phone numbers rewritten into a reserved test range, names replaced, **identity documents excluded entirely** rather than obfuscated.
- Database access from production is role-limited; ad-hoc `UPDATE` on ledger tables is not permitted for any human account.
- Backups: encrypted, 30-day retention, **restore tested quarterly** — an untested backup is a hypothesis.

### Retention

| Data | Retention |
|---|---|
| Identity documents | 90 days after verification, then only the encrypted number hash and the verification outcome |
| Recordings | Per [10 §10.6](10-media-recordings.md#106-retention-and-cost); legal holds override |
| Financial records | 7 years (statutory expectation for business records — confirm the applicable period with counsel) |
| Audit logs | 3 years |
| Deleted accounts | PII erased within 30 days; financial records retained with the identity pseudonymised |
| Search analytics | 12 months, then aggregated |

### User rights

Access (export), correction, deletion, and portability, honoured within 30 days. Deletion pseudonymises rather than erases where financial-record retention applies, and this is explained plainly rather than being used as a reason to refuse.

## 14.5 Fraud

| Vector | Detection | Response |
|---|---|---|
| **Self-booking** (tutor books own class to farm reviews/ratings) | Shared device fingerprint, payment instrument, IP, or a payout number matching a student's wallet number | Exclude from aggregates; investigate; suspend |
| **Circular booking rings** | Graph analysis of booking flows between accounts | Investigate; hold payouts |
| **Payment fraud** | Server-side verification of every payment; amount matching; velocity checks | Never credit on mismatch; finance alert |
| **Refund abuse** | Repeated late cancellations, dispute rate per student | Restrict to no-free-cancellation terms |
| **OTP pumping** | Send velocity per number, per IP, per country prefix | Rate limit, spend cap, block |
| **Payout hijacking** | Payout method change patterns | Step-up OTP + **24 h cooling period** with notification to the old number |
| **Fake tutors** | Duplicate NID hashes, device fingerprints, stock/reused photos | Blocked at verification |
| **Scraping** | Request velocity on profile and search endpoints | Rate limit, bot management at the edge, contact data never present in the payload to begin with |

The payout cooling period is the single most valuable anti-fraud control in the system. An attacker who takes over a tutor account still cannot extract money without 24 hours passing and the legitimate owner receiving an SMS on their original number.

## 14.6 Account recovery and number recycling

Mobile numbers in Bangladesh are reclaimed and reissued by operators after prolonged inactivity. That makes "log in with phone + OTP" quietly dangerous over time: the new holder of a recycled number can authenticate into the previous owner's account, including its wallet balance.

Mitigations:

- Accounts dormant > 12 months require **additional verification** at next login: a secondary identifier (name, DOB, last transaction, or the linked guardian's confirmation).
- Any login from a new device on an account with a balance above ৳2,000 triggers a step-up check and notifies the previous device.
- Number changes require OTP on **both** the old and new number where the old number is still reachable; where it is not, a manual identity check with a 72-hour hold.
- Recovery when a number is genuinely lost: identity verification against the NID on file, a 72-hour hold, and notification to every channel on the account.
- Suspicious recovery attempts freeze the balance rather than allowing a race to spend it.

## 14.7 Regulatory posture

**This section states what to ask, not what the law is.** It is written by engineers, not lawyers. Bangladesh's regulatory environment for digital payments and data protection is actively evolving, and the correct move is to engage Bangladeshi counsel and a chartered accountant before launch.

Questions that must be answered before taking real money:

| Area | The question |
|---|---|
| **Corporate** | RJSC registration, trade licence, TIN/BIN, and any DBID requirement for e-commerce |
| **Holding customer funds** | Does a prepaid credit balance require a payment-service registration or authorisation under Bangladesh Bank's regime? Must funds sit in escrow or a segregated settlement account? |
| **PSP relationship** | Does the aggregator's licence cover our model, or do we need our own? What settlement cycle and chargeback liability applies? |
| **VAT** | Standard rate 15%. Is it charged on commission only, or on GMV? Who is the supplier of record for a tutor's service — the tutor or the platform? |
| **Withholding tax** | What must be deducted at source from tutor payouts, and what reporting follows? |
| **Tutor classification** | Independent contractors, not employees — confirm the contractual structure holds under BD labour law |
| **Data protection** | Track the current status of Bangladesh's data-protection legislation and any localisation or cross-border transfer requirement — this directly affects hosting in Singapore |
| **Telecom** | BTRC requirements for masked sender IDs and commercial SMS |
| **Child safety** | Any statutory duty regarding services used by minors, and mandatory reporting obligations |

**Build so that either answer is implementable.** The ledger design already permits segregated funds; the architecture already permits regional relocation; the tax fields already exist on `earnings`. That flexibility is deliberate — it means a legal answer arriving late is a configuration change, not a rewrite.

## 14.8 Application security

- OWASP Top 10 covered by design review and automated scanning in CI.
- All input validated at the boundary with zod schemas shared between client and server; **the server never trusts a client-computed value** — prices, durations, availability and entitlements are always recomputed server-side.
- Parameterised queries only; no string-built SQL anywhere.
- Authorisation checked at the **resource** level, not the route level. Every handler asks "may *this* user act on *this* object?" — the most common real-world API vulnerability is a correct route guard with no object check.
- CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on all responses.
- Uploads: type verified by magic bytes, size-limited, stored off the app domain, never executed, served with `Content-Disposition: attachment` where not media.
- Secrets in a managed secret store, rotated quarterly, never in the repository. A pre-commit hook plus CI scanning blocks accidental commits.
- Dependencies: automated updates, `npm audit` gating CI, lockfiles committed.
- Penetration test before public launch and annually; the payments and identity flows are always in scope.
- A responsible-disclosure policy with a published contact and a commitment not to pursue good-faith researchers.

## 14.9 Incident response

| Severity | Definition | Response |
|---|---|---|
| **SEV1** | Money loss, data breach, safeguarding incident, total outage | Page immediately; incident commander; regulator/user notification assessed within hours |
| **SEV2** | Payments or login degraded, ledger mismatch | Page; fix within 4 h |
| **SEV3** | Feature broken, no money impact | Next business day |

Every SEV1/SEV2 gets a blameless postmortem within 5 business days with dated action items. **Data-breach notification obligations are established with counsel in advance, not discovered during the incident** — the middle of a breach is the worst possible time to be researching notification timelines.

Break-glass production access requires two people, generates an alert, and is time-boxed and fully session-recorded.

---

Next: [15 — Delivery Plan & Roadmap](15-roadmap-delivery.md)
