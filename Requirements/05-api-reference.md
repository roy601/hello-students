# 05 — API Reference

Base URL: `https://api.hellostudents.com.bd/v1`

The API is REST over JSON, versioned in the path. The OpenAPI 3.1 document is generated from the zod schemas in `packages/contracts` and served at `/v1/openapi.json` — that document, not this page, is the machine-readable contract. This page defines the conventions and catalogues the surface.

---

## 5.1 Conventions

### Requests

- `Content-Type: application/json; charset=utf-8`
- `Accept-Language: bn-BD` or `en` — selects the language of `error.message` and any localised content. Defaults to the authenticated user's `locale`.
- `X-Client: web/1.4.2` or `android/2.0.1` — required; used for staged rollout and forced-upgrade responses.
- All timestamps in and out are RFC 3339 with an explicit offset: `2026-08-14T16:00:00+06:00`.
- Money is always an integer plus a currency: `{"amount_poisha": 90000, "currency": "BDT"}`. Never a decimal string, never a float.

### Responses

Single resource:

```json
{ "data": { "id": "tut_01HQ8ZK3M4N5P6Q7R8S9T0V1W2", "…": "…" } }
```

Collection, cursor-paginated:

```json
{
  "data": [ /* … */ ],
  "page": { "next_cursor": "eyJpZCI6InR1dF8wMUhR…", "has_more": true, "total_estimate": 412 }
}
```

Offset pagination is not offered on any user-facing list. Cursors are opaque base64 of the sort key plus tiebreaker ID. `total_estimate` is exactly that — an estimate from the planner — and is omitted where it would require a full scan.

### Errors

Every error, at every status code, has the same shape:

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "আপনার ব্যালেন্সে পর্যাপ্ত ক্রেডিট নেই।",
    "message_en": "Your balance is not sufficient for this booking.",
    "details": { "required_poisha": 90000, "available_poisha": 42000 },
    "trace_id": "01HQ8ZK3M4N5P6Q7R8S9T0V1W2"
  }
}
```

`code` is a stable machine-readable string that clients switch on; `message` is localised prose that clients may display verbatim. `trace_id` is echoed in logs and is what a user reads out to support.

| Status | When |
|---|---|
| 400 `validation_failed` | Malformed request; `details.fields` lists field-level errors |
| 401 `unauthenticated` | Missing/expired access token |
| 403 `forbidden` | Authenticated but not permitted |
| 404 `not_found` | Also returned instead of 403 where existence itself is sensitive |
| 409 `conflict` | State conflict — see the specific codes below |
| 410 `gone` | Session already started, offer expired |
| 422 `unprocessable` | Semantically invalid (booking in the past, rate below floor) |
| 429 `rate_limited` | `Retry-After` header always present |
| 500 `internal_error` | Never leaks internals; always carries `trace_id` |
| 503 `dependency_unavailable` | PSP/SMS/Zoom down; `details.dependency` names it |

Domain-specific conflict codes: `session_conflict`, `session_full`, `student_double_booked`, `insufficient_credits`, `booking_cutoff_passed`, `tutor_not_approved`, `already_reviewed`, `payout_method_unverified`, `idempotency_key_reused`.

### Authentication

Phone + OTP is the primary flow. Password login does not exist.

```
POST /v1/auth/otp/request   { "phone": "01712345678", "purpose": "login" }
POST /v1/auth/otp/verify    { "phone": "+8801712345678", "code": "483920" }
  → { "access_token": "…", "refresh_token": "…", "expires_in": 900, "user": {…} }
```

- Access token: JWT, 15 min, `RS256`, claims `sub`, `roles`, `sid`, `ver`.
- Refresh token: opaque, 60 days, single-use with rotation, hashed at rest. Reuse of a rotated token revokes the entire family and forces re-auth — the standard detection for a stolen refresh token.
- Header: `Authorization: Bearer <access_token>`.
- Phone input is normalised server-side; clients may send any of the local formats described in [02](02-domain-model.md#24-phone-numbers).

**OTP protections** (details in [14](14-security-compliance.md#142-authentication)): 5 sends per number per hour, 20 per IP per hour, 5 verification attempts per challenge, 60 s resend cooldown, exponential backoff after 3 failed challenges, and a hard daily spend cap on SMS per number. OTP codes are 6 digits, valid 5 minutes, single-use, stored only as a hash.

### Idempotency

**Required on every `POST`/`PATCH`/`DELETE` that moves money or creates a booking.** Recommended everywhere else.

```
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

Semantics: the first request with a given key executes and its status + body are stored for 24 h. A replay with the same key and the same request body returns the stored response with `Idempotency-Replayed: true`. A replay with the same key but a *different* body returns `409 idempotency_key_reused`. Keys are scoped per user and per endpoint.

### Rate limits

| Bucket | Limit |
|---|---|
| Unauthenticated | 60 req/min per IP |
| Authenticated | 600 req/min per user |
| `POST /auth/otp/request` | 5/hour per phone, 20/hour per IP |
| `POST /bookings` | 30/hour per user |
| `GET /search/tutors` | 120/min per user |
| Webhooks (inbound) | Not limited; verified by signature |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on 429.

---

## 5.2 Endpoint catalogue

Legend — 🔓 public · 👤 authenticated · 🎓 student role · 🧑‍🏫 tutor role · 🛡️ admin role

### Auth & identity

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/otp/request` | 🔓 | Send an OTP |
| POST | `/auth/otp/verify` | 🔓 | Exchange OTP for tokens |
| POST | `/auth/refresh` | 🔓 | Rotate refresh token |
| POST | `/auth/logout` | 👤 | Revoke current session |
| GET | `/me` | 👤 | Current user, roles, profiles, balance summary |
| PATCH | `/me` | 👤 | Update name, locale, avatar |
| GET | `/me/sessions` | 👤 | Active devices |
| DELETE | `/me/sessions/{id}` | 👤 | Revoke a device |
| POST | `/me/guardians` | 🎓 | Invite a guardian |
| POST | `/me/students` | 👤 | Link a student (guardian side) |
| PATCH | `/guardian-links/{id}` | 👤 | Change permissions |

### Catalog (reference data — cacheable, `Cache-Control: public, max-age=3600`)

| Method | Path | Access |
|---|---|---|
| GET | `/catalog/subjects?curriculum=&grade_level=&q=` | 🔓 |
| GET | `/catalog/grade-levels` | 🔓 |
| GET | `/catalog/boards` | 🔓 |
| GET | `/catalog/locations?parent_id=&level=&q=` | 🔓 |
| GET | `/catalog/credit-packages` | 🔓 |

### Tutor — self-service

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/tutors` | 👤 | Create own tutor profile (`draft`) |
| GET | `/tutors/me` | 🧑‍🏫 | Own profile incl. `draft` fields |
| PATCH | `/tutors/me` | 🧑‍🏫 | Update bio, rates, areas, modes |
| POST | `/tutors/me/submit` | 🧑‍🏫 | Submit for review (validates completeness) |
| GET/POST/DELETE | `/tutors/me/subjects[/{id}]` | 🧑‍🏫 | Subjects taught + per-subject rates |
| POST | `/tutors/me/credentials` | 🧑‍🏫 | Register a credential, returns a presigned upload |
| GET | `/tutors/me/credentials` | 🧑‍🏫 | Verification status |
| GET/PUT | `/tutors/me/availability` | 🧑‍🏫 | Weekly rules (PUT replaces the whole set) |
| POST/DELETE | `/tutors/me/availability/exceptions[/{id}]` | 🧑‍🏫 | Block or open one-off windows |
| GET | `/tutors/me/calendar?from=&to=` | 🧑‍🏫 | Sessions + blocks in one payload |
| GET | `/tutors/me/earnings?status=&from=&to=` | 🧑‍🏫 | Earnings ledger |
| GET/POST | `/tutors/me/payout-methods` | 🧑‍🏫 | Manage payout destinations (OTP step-up required) |
| GET | `/tutors/me/payouts` | 🧑‍🏫 | Payout history |
| GET | `/tutors/me/stats` | 🧑‍🏫 | Profile views, conversion, repeat rate |

### Tutor — public

| Method | Path | Access |
|---|---|---|
| GET | `/tutors/{id}` | 🔓 — public profile, SSR-cached 60 s |
| GET | `/tutors/{id}/offerings` | 🔓 |
| GET | `/tutors/{id}/reviews` | 🔓 |
| GET | `/tutors/{id}/availability?from=&to=&duration=` | 🔓 — bookable slots, conflict-filtered |

### Discovery

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/search/tutors` | 🔓 | Full filter set, see below |
| GET | `/search/suggest?q=` | 🔓 | Typeahead across subjects, tutors, areas |
| GET | `/search/offerings` | 🔓 | Search classes rather than people |

`GET /search/tutors` parameters:

```
q                  free text (bn or en)
subject_id         repeatable
grade_level        CLASS_11
curriculum         NCTB_BN
board              DHAKA
location_id        area/district/division — matched through the closure table
delivery_mode      live_online | live_in_person | recorded
format             one_to_one | group
price_min_poisha   / price_max_poisha
rating_min         4.0
verification_min   L1
available_from     / available_until   (RFC 3339 — only tutors with a free slot in the window)
language           bn | en
gender             tutor-declared; see 08 §8.7 for the policy governing this filter
sort               relevance | price_asc | price_desc | rating | newest
cursor, limit      limit ≤ 50, default 20
```

### Offerings & sessions

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/offerings` | 🧑‍🏫 | Create an offering |
| PATCH | `/offerings/{id}` | 🧑‍🏫 | Edit (price changes never affect existing bookings) |
| POST | `/offerings/{id}/publish` | 🧑‍🏫 | Requires `approved` tutor |
| POST | `/offerings/{id}/pause` | 🧑‍🏫 | Hides from search; keeps existing sessions |
| GET | `/offerings/{id}` | 🔓 | |
| POST | `/offerings/{id}/sessions` | 🧑‍🏫 | Create one or a recurring series |
| GET | `/sessions/{id}` | 👤 | |
| PATCH | `/sessions/{id}` | 🧑‍🏫 | Reschedule — re-runs conflict checks, notifies all bookers |
| DELETE | `/sessions/{id}` | 🧑‍🏫 | Cancel — triggers automatic full refund to credits |
| POST | `/sessions/{id}/meeting-link` | 🧑‍🏫 | Attach or replace the Zoom/Meet URL |
| POST | `/sessions/{id}/start` | 🧑‍🏫 | Marks `live`, records `tutor_joined_at` |
| POST | `/sessions/{id}/complete` | 🧑‍🏫 | Marks `completed`, triggers capture + earnings accrual |
| POST | `/sessions/{id}/attendance` | 🧑‍🏫 | Mark per-student attendance |

### Booking

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/bookings` | 🎓 | Book a seat. **Idempotency-Key required.** |
| GET | `/bookings?status=&from=&to=` | 🎓 | Own bookings |
| GET | `/bookings/{id}` | 👤 | Visible to the student, their guardian, and the tutor |
| DELETE | `/bookings/{id}` | 🎓 | Cancel; refund per policy |
| POST | `/bookings/{id}/join` | 🎓 | Returns the live link, records `joined_at`. Link is only issued from T−15 min. |
| POST | `/enrolments` | 🎓 | Buy access to a recorded offering |
| GET | `/enrolments` | 🎓 | |

`POST /bookings` request/response:

```jsonc
// →
{
  "session_id": "ses_01HQ8ZK3M4N5P6Q7R8S9T0V1W2",
  "student_id": "usr_01HQ…",        // omit for self; guardians pass the child's ID
  "payment_source": "auto"          // auto | wallet | hour_pack:hpk_01HQ…
}
// ← 201
{
  "data": {
    "id": "bkg_01HQ…",
    "status": "confirmed",
    "session": { "starts_at": "2026-08-14T16:00:00+06:00", "duration_minutes": 60 },
    "charged": { "source": "hour_pack", "hour_pack_id": "hpk_01HQ…", "hours_deducted": 1.0 },
    "wallet_balance_poisha": 42000,
    "cancellation": { "free_until": "2026-08-13T16:00:00+06:00", "policy": "standard" }
  }
}
```

`payment_source: "auto"` resolves in this order: a matching non-expired hour pack for that tutor → wallet credits → `409 insufficient_credits` with the shortfall in `details`. Clients use that shortfall to deep-link straight into top-up.

### Billing

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/billing/account` | 👤 | Balance, held, currency |
| GET | `/billing/ledger?from=&to=&type=` | 👤 | Paginated statement |
| POST | `/billing/orders` | 👤 | Buy a credit package or hour pack. **Idempotency-Key required.** |
| GET | `/billing/orders/{id}` | 👤 | Status polling after redirect return |
| POST | `/billing/orders/{id}/cancel` | 👤 | Abandon before capture |
| GET | `/billing/hour-packs` | 🎓 | Active packs with remaining hours |
| POST | `/billing/refunds` | 👤 | Request a refund (creates a review task) |
| GET | `/billing/invoices/{id}` | 👤 | PDF/HTML receipt |

`POST /billing/orders` returns a `redirect_url` for the hosted PSP page plus a `poll_url`. Mobile-wallet flows in Bangladesh drop out of the browser frequently, so clients **must** poll `poll_url` on return rather than trusting the callback query string.

### Media

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/media/uploads` | 🧑‍🏫 | Request a direct-to-storage presigned upload |
| POST | `/media/uploads/{id}/complete` | 🧑‍🏫 | Signal upload finished; enqueues transcode |
| GET | `/media/assets/{id}` | 👤 | Status and metadata |
| GET | `/sessions/{id}/recording` | 🎓 | Entitlement-checked; returns a short-TTL signed playback token |
| GET | `/offerings/{id}/lessons` | 🎓 | Recorded lesson list for an enrolment |
| POST | `/media/assets/{id}/progress` | 🎓 | Playback position, for resume |

### Reviews

| Method | Path | Access |
|---|---|---|
| POST | `/reviews` | 🎓 — requires an `attended` booking within 30 days |
| GET | `/reviews?tutor_id=` | 🔓 |
| PATCH | `/reviews/{id}` | 🎓 — editable for 48 h, then frozen |
| POST | `/reviews/{id}/reply` | 🧑‍🏫 — one reply per review |
| POST | `/reviews/{id}/report` | 👤 |

### Notifications

| Method | Path | Access |
|---|---|---|
| GET | `/notifications?unread=true` | 👤 |
| POST | `/notifications/read` | 👤 |
| GET/PATCH | `/me/notification-preferences` | 👤 |
| POST | `/me/devices` | 👤 — register an FCM token |

### Disputes

| Method | Path | Access |
|---|---|---|
| POST | `/disputes` | 👤 |
| GET | `/disputes` | 👤 |
| POST | `/disputes/{id}/messages` | 👤 |
| POST | `/disputes/{id}/evidence` | 👤 |

### Admin (`/admin/*`, 🛡️ — separate origin, IP-allowlisted, step-up MFA)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/tutors?status=submitted` | Approval queue |
| POST | `/admin/tutors/{id}/approve` | Approve; `reason` required and audited |
| POST | `/admin/tutors/{id}/reject` | Reject with a reason code sent to the tutor |
| POST | `/admin/tutors/{id}/suspend` | Suspend; cancels and refunds future sessions |
| POST | `/admin/credentials/{id}/verify` | Set verification tier |
| GET | `/admin/disputes?status=open` | Dispute queue with SLA countdown |
| POST | `/admin/disputes/{id}/resolve` | Resolve, optionally issuing a refund |
| POST | `/admin/refunds/{id}/approve` | Two-person approval above a threshold |
| GET | `/admin/metrics/revenue?from=&to=&granularity=` | GMV, net revenue, take rate |
| GET | `/admin/metrics/liquidity` | The metrics in [01 §1.7](01-product-overview.md#17-success-metrics) |
| GET | `/admin/ledger/reconciliation` | Invariant check results |
| POST | `/admin/payouts/run` | Trigger a payout batch (dual approval) |
| GET | `/admin/audit-log?entity_id=` | Immutable audit trail |
| POST | `/admin/subjects` | Promote a taxonomy request |

Admin write endpoints require `X-Reason` — a free-text justification persisted to `audit_log`. Endpoints that move money above ৳50,000 require two distinct admin approvals recorded separately.

---

## 5.3 Webhooks (inbound)

| Source | Path | Verification |
|---|---|---|
| Payment aggregator | `/webhooks/psp/{provider}` | HMAC signature + IP allowlist + server-side verify call |
| bKash | `/webhooks/bkash` | Signature + `executePayment`/`queryPayment` confirmation |
| Zoom | `/webhooks/zoom` | `x-zm-signature` HMAC + URL-validation challenge |
| Cloudflare Stream | `/webhooks/stream` | Webhook secret HMAC |
| SMS gateway | `/webhooks/sms/dlr` | Shared secret; updates delivery receipts |

Contract for all inbound webhooks:

1. Verify signature. Invalid → `401`, persist with `signature_ok = false`, alert.
2. Persist raw to `webhook_events` keyed `(source, external_id)`. Duplicate → `200` immediately, no reprocessing.
3. Return `200` within 5 seconds. **Processing happens in a worker, never inline.**
4. For anything money-related, re-verify against the provider's API before mutating state. The webhook is a notification, not an authority.

## 5.4 Webhooks (outbound, Phase 4)

For coaching centres integrating their own systems: `tutor.approved`, `booking.confirmed`, `session.completed`, `payout.sent`. HMAC-SHA256 signed with a per-subscriber secret in `X-HelloStudents-Signature`, timestamped to prevent replay, retried with exponential backoff for 24 h.

## 5.5 Versioning

- Breaking changes require a new path version (`/v2`). Additive changes do not.
- **Additive** = new optional request field, new response field, new enum value in a field documented as open-ended. Clients must ignore unknown response fields and tolerate unknown enum values by falling back to a documented default.
- A deprecated version is supported for 12 months minimum with `Deprecation` and `Sunset` headers, because a meaningful share of Android users in this market do not auto-update.
- Mobile clients receive `426 Upgrade Required` with a store link when below the minimum supported build.

---

Next: [06 — Tutor Onboarding & Verification](06-tutor-onboarding.md)
