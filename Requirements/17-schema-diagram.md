# 17 — Schema Diagram

Visual companion to [04 — Data Model](04-data-model.md), which holds the authoritative DDL. This page shows **shape and relationships**; where the two disagree, [04](04-data-model.md) wins.

The schema is drawn per module rather than as one 40-table diagram, because module ownership is a real constraint here: **a module may only reach another module's tables through its service interface, never by a SQL join** ([ADR-002](adr/ADR-002-modular-monolith.md)). Cross-module edges in these diagrams are therefore *logical* references, and are drawn separately in [§17.8](#178-cross-module-reference-map).

Legend: `PK` primary key · `FK` foreign key · `UK` unique · **bold entities** carry a database-enforced invariant.

---

## 17.1 Module ownership

```mermaid
flowchart TB
    subgraph identity["identity"]
        I1[users]
        I2[user_roles]
        I3[otp_challenges]
        I4[refresh_tokens]
        I5[guardian_links]
    end

    subgraph catalog["catalog — reference data"]
        C1[subjects]
        C2[grade_levels]
        C3[boards]
        C4[locations]
        C5[location_closure]
    end

    subgraph tutor["tutor"]
        T1[tutor_profiles]
        T2[tutor_subjects]
        T3[tutor_service_areas]
        T4[tutor_credentials]
    end

    subgraph scheduling["scheduling"]
        S1[class_offerings]
        S2[class_sessions]
        S3[availability_rules]
        S4[availability_exceptions]
    end

    subgraph booking["booking"]
        B1[bookings]
        B2[enrolments]
    end

    subgraph billing["billing"]
        M1[credit_accounts]
        M2[ledger_entries]
        M3[hour_packs]
        M4[orders]
        M5[payments]
        M6[credit_packages]
        M7[refunds]
        M8[webhook_events]
    end

    subgraph payouts["payouts"]
        P1[earnings]
        P2[payouts]
        P3[tutor_payout_methods]
    end

    subgraph media["media"]
        D1[media_assets]
        D2[recordings]
        D3[playback_grants]
    end

    subgraph reviews["reviews"]
        R1[reviews]
        R2[review_reports]
    end

    subgraph notifications["notifications"]
        N1[notifications]
        N2[notification_deliveries]
        N3[notification_templates]
        N4[notification_preferences]
    end

    subgraph platform["platform / admin"]
        X1[disputes]
        X2[audit_log]
        X3[outbox]
        X4[idempotency_keys]
    end

    identity --> tutor
    catalog --> tutor
    catalog --> scheduling
    tutor --> scheduling
    scheduling --> booking
    booking --> billing
    booking --> payouts
    booking --> reviews
    scheduling --> media
    billing --> platform
```

---

## 17.2 Identity & catalog

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : has
    USERS ||--o{ OTP_CHALLENGES : requests
    USERS ||--o{ REFRESH_TOKENS : holds
    USERS ||--o{ GUARDIAN_LINKS : "guards as guardian"
    USERS ||--o{ GUARDIAN_LINKS : "is guarded as student"

    USERS {
        text id PK
        text phone_e164 UK "E.164 only, primary identifier"
        citext email UK "optional, low engagement"
        text full_name
        text locale "bn-BD default"
        text timezone "Asia/Dhaka"
        enum status "active suspended deleted"
        timestamptz phone_verified_at
    }
    USER_ROLES {
        text user_id PK "FK to users"
        enum role PK "student tutor guardian admin support finance"
        timestamptz granted_at
    }
    OTP_CHALLENGES {
        text id PK
        text phone_e164
        text code_hash "Argon2id, never plaintext"
        text purpose
        smallint attempts
        timestamptz expires_at
        timestamptz consumed_at
    }
    REFRESH_TOKENS {
        text id PK
        text user_id FK
        text token_hash UK "rotation family"
        timestamptz revoked_at
    }
    GUARDIAN_LINKS {
        text id PK
        text guardian_id FK
        text student_id FK
        text relationship
        jsonb permissions "fund_wallet view_ledger approve_bookings"
        timestamptz verified_at
    }
```

```mermaid
erDiagram
    LOCATIONS ||--o{ LOCATIONS : "parent of"
    LOCATIONS ||--o{ LOCATION_CLOSURE : "ancestor of"
    GRADE_LEVELS ||--o{ SUBJECTS : "valid for"

    SUBJECTS {
        text id PK
        text code UK "HSC_PHYSICS_1"
        text name_en
        text name_bn
        array curricula "NCTB_BN NCTB_EN CAMBRIDGE MADRASAH"
        array grade_levels
        enum stream "SCIENCE HUMANITIES BUSINESS GENERAL"
        array aliases "bn en transliterated abbreviations"
        bool is_active
    }
    GRADE_LEVELS {
        text code PK "CLASS_9 O_LEVEL ALIM ADMISSION"
        text name_en
        text name_bn
        text stage
        int sort_order
    }
    BOARDS {
        text code PK "DHAKA CHATTOGRAM MADRASAH TECHNICAL"
        text name_en
        text name_bn
    }
    LOCATIONS {
        text id PK
        text parent_id FK
        enum level "division district upazila area"
        text name_en
        text name_bn
        text slug UK
        point centroid
    }
    LOCATION_CLOSURE {
        text ancestor_id PK "FK to locations"
        text descendant_id PK "FK to locations"
        smallint depth
    }
```

> **Why a closure table.** "All tutors in Dhaka division" must be one indexed lookup, not a recursive CTE on every search request. The closure table is what makes the area filter in [08](08-discovery-search.md#83-filters) cheap at any level of the hierarchy.

---

## 17.3 Tutor

```mermaid
erDiagram
    USERS ||--o| TUTOR_PROFILES : "may be"
    TUTOR_PROFILES ||--o{ TUTOR_SUBJECTS : teaches
    TUTOR_PROFILES ||--o{ TUTOR_SERVICE_AREAS : serves
    TUTOR_PROFILES ||--o{ TUTOR_CREDENTIALS : proves
    SUBJECTS ||--o{ TUTOR_SUBJECTS : "referenced by"
    LOCATIONS ||--o{ TUTOR_SERVICE_AREAS : "referenced by"

    TUTOR_PROFILES {
        text id PK
        text user_id UK "FK to users, one profile per user"
        text headline_en
        text headline_bn
        enum status "draft submitted under_review approved rejected suspended"
        enum verification_tier "L0 L1 L2 L3"
        bool teaches_online
        bool teaches_in_person
        bigint base_hourly_rate_poisha
        numeric rating_avg "denormalised from reviews"
        int rating_count
        numeric rating_bayesian
        int sessions_completed
        numeric repeat_rate
        numeric quality_score "search ranking input"
        timestamptz approved_at
    }
    TUTOR_SUBJECTS {
        text id PK
        text tutor_id FK
        text subject_id FK
        text grade_level FK
        enum curriculum
        text board FK
        bigint hourly_rate_poisha "per subject, not per tutor"
    }
    TUTOR_SERVICE_AREAS {
        text tutor_id PK "FK to tutor_profiles"
        text location_id PK "FK to locations"
    }
    TUTOR_CREDENTIALS {
        text id PK
        text tutor_id FK
        enum type "nid passport degree transcript certification"
        text institution
        text title
        bytea document_number_enc "AES-256-GCM, never in any API"
        text document_asset_key "private bucket"
        enum status "pending verified rejected expired"
        text reviewed_by FK
    }
```

> **Rate lives on `tutor_subjects`, not `tutor_profiles`.** A tutor charges differently for HSC Physics than for Class 9 Maths, and search filters on price must hit the *subject* rate. `base_hourly_rate_poisha` is a display default only.

---

## 17.4 Scheduling & booking — the calendar spine

```mermaid
erDiagram
    TUTOR_PROFILES ||--o{ CLASS_OFFERINGS : publishes
    TUTOR_PROFILES ||--o{ AVAILABILITY_RULES : declares
    TUTOR_PROFILES ||--o{ AVAILABILITY_EXCEPTIONS : blocks
    TUTOR_PROFILES ||--o{ CLASS_SESSIONS : occupies
    CLASS_OFFERINGS ||--o{ CLASS_SESSIONS : instantiates
    CLASS_OFFERINGS ||--o{ ENROLMENTS : "sold as recorded"
    CLASS_SESSIONS ||--o{ BOOKINGS : "holds seats for"
    USERS ||--o{ BOOKINGS : books
    USERS ||--o{ ENROLMENTS : enrols

    CLASS_OFFERINGS {
        text id PK
        text tutor_id FK
        text title_en
        text title_bn
        text subject_id FK
        text grade_level FK
        enum curriculum
        enum delivery_mode "live_online live_in_person recorded"
        enum format "one_to_one group"
        smallint duration_minutes
        smallint capacity "1 unless group"
        bigint price_poisha "per seat per session"
        text location_id FK "required if in_person"
        enum status "draft published paused archived"
        text cancellation_policy "flexible standard strict"
    }
    AVAILABILITY_RULES {
        text id PK
        text tutor_id FK
        smallint weekday "0 = Sunday, BD week start"
        time start_time "wall clock, not UTC"
        time end_time
        text timezone "IANA, Asia/Dhaka"
        date valid_from
        date valid_until
    }
    AVAILABILITY_EXCEPTIONS {
        text id PK
        text tutor_id FK
        tstzrange window
        bool is_available "false = holiday block"
        text reason
    }
    CLASS_SESSIONS {
        text id PK
        text offering_id FK
        text tutor_id FK
        timestamptz starts_at
        timestamptz ends_at
        smallint buffer_before_min
        smallint buffer_after_min
        tstzrange occupies "start-buffer to end+buffer, app-written"
        smallint capacity
        smallint seats_taken
        bigint price_poisha "snapshot at creation"
        enum status "scheduled live completed cancelled no_show"
        text meeting_url "released only at T-15min"
        timestamptz tutor_joined_at "no-show detector"
    }
    BOOKINGS {
        text id PK
        text session_id FK
        text student_id FK
        text booked_by FK "student or guardian"
        enum status "pending_payment confirmed attended missed cancelled refunded"
        bigint price_poisha "snapshot at booking"
        text hour_pack_id FK "null if paid from wallet"
        tstzrange occupies "denormalised from session"
        timestamptz joined_at
    }
    ENROLMENTS {
        text id PK
        text offering_id FK
        text student_id FK
        bigint price_poisha
        timestamptz access_from
        timestamptz access_until "null = lifetime"
    }
```

### The two exclusion constraints

These are the only reason `occupies` exists as a stored column on both tables, and they are the schema's most important feature ([ADR-004](adr/ADR-004-booking-concurrency.md)).

```mermaid
flowchart LR
    subgraph C1["C1 · tutor never double-booked"]
        A1["class_sessions"] --> A2["EXCLUDE USING gist<br/>tutor_id WITH =<br/>occupies OVERLAPS<br/>WHERE status IN scheduled,live"]
    end
    subgraph C2["C2 · student never double-booked"]
        B1["bookings"] --> B2["EXCLUDE USING gist<br/>student_id WITH =<br/>occupies OVERLAPS<br/>WHERE status IN confirmed,attended"]
    end
    subgraph C3["C3 · session never oversold"]
        D1["class_sessions"] --> D2["SELECT FOR UPDATE<br/>+ CHECK seats_taken not above capacity"]
    end
```

`occupies` is written by the application, never by a generated column: `timestamptz ± interval` is only `STABLE`, and a GiST exclusion constraint requires `IMMUTABLE` inputs. It is denormalised onto `bookings` because an exclusion constraint cannot reach through a foreign key to the session's range.

---

## 17.5 Billing — the money spine

```mermaid
erDiagram
    USERS ||--|| CREDIT_ACCOUNTS : owns
    CREDIT_ACCOUNTS ||--o{ LEDGER_ENTRIES : records
    USERS ||--o{ HOUR_PACKS : holds
    TUTOR_PROFILES ||--o{ HOUR_PACKS : "scoped to"
    HOUR_PACKS ||--o{ BOOKINGS : "pays for"
    USERS ||--o{ ORDERS : places
    CREDIT_PACKAGES ||--o{ ORDERS : "purchased as"
    ORDERS ||--o{ PAYMENTS : "settled by"
    ORDERS ||--o{ REFUNDS : "reversed by"
    BOOKINGS ||--o{ REFUNDS : "may trigger"
    LEDGER_ENTRIES }o--|| BOOKINGS : "ref_type=booking"

    CREDIT_ACCOUNTS {
        text id PK
        text user_id UK "FK to users, one account per user"
        bigint balance_credits "CHECK >= 0, cache of SUM entries"
        bigint held_credits "reserved by open bookings"
        text currency "BDT"
        bigint version
    }
    LEDGER_ENTRIES {
        text id PK
        text account_id FK
        enum entry_type "purchase hold hold_release capture refund promo_grant expiry"
        bigint amount_credits "SIGNED, 1 credit = 1 poisha"
        bigint balance_after "audit snapshot, never read for logic"
        text ref_type
        text ref_id
        text idempotency_key UK "retry safety"
        timestamptz created_at "APPEND ONLY, no UPDATE no DELETE"
    }
    HOUR_PACKS {
        text id PK
        text student_id FK
        text tutor_id FK "non-fungible by design"
        text subject_id FK "null = any subject"
        numeric hours_purchased
        numeric hours_remaining
        bigint locked_rate_poisha "fixed for pack lifetime"
        bigint total_paid_poisha
        timestamptz expires_at
    }
    CREDIT_PACKAGES {
        text id PK
        text name_bn
        bigint price_poisha
        bigint credits "may exceed price = bonus"
        bool is_active
    }
    ORDERS {
        text id PK
        text user_id FK
        text kind "credit_package hour_pack direct_booking"
        bigint amount_poisha
        bigint service_fee_poisha
        enum status "initiated pending captured failed expired refunded"
        text idempotency_key UK
        timestamptz expires_at "30 minutes"
    }
    PAYMENTS {
        text id PK
        text order_id FK
        text provider "sslcommerz shurjopay bkash_direct"
        enum method "bkash nagad rocket upay card bank"
        bigint amount_poisha
        text provider_ref UK
        text provider_trx_id "shown on user receipt"
        jsonb raw_response
        timestamptz verified_at "server-to-server verified, NOT webhook"
    }
    REFUNDS {
        text id PK
        text booking_id FK
        text order_id FK
        bigint amount_poisha
        text destination "credits (default) or source"
        text reason
        text approved_by FK
    }
    WEBHOOK_EVENTS {
        text id PK
        text source "sslcommerz bkash zoom stream"
        text external_id UK "dedupe key with source"
        bool signature_ok
        jsonb payload
        timestamptz processed_at
    }
```

> **`verified_at` is the load-bearing column.** Credits are never issued from webhook data — only after an independent `verifyPayment` call confirms status and amount ([09 §9.5](09-payments-credits.md#95-payment-integration)). `WEBHOOK_EVENTS` has no foreign key to `PAYMENTS` on purpose: an unrecognised or replayed webhook must still be persisted and deduped before anything tries to match it.

### Money state machine

```mermaid
stateDiagram-v2
    [*] --> available: purchase entry (+)
    available --> held: hold entry (−) at booking
    held --> spent: capture at session complete
    held --> available: hold_release on cancellation
    spent --> available: refund entry (+)
    available --> [*]: expiry (promo only)

    note right of spent
        capture also writes an
        EARNINGS row for the tutor
        gross = commission + net
    end note
```

---

## 17.6 Payouts

```mermaid
erDiagram
    TUTOR_PROFILES ||--o{ TUTOR_PAYOUT_METHODS : registers
    TUTOR_PROFILES ||--o{ EARNINGS : accrues
    BOOKINGS ||--|| EARNINGS : generates
    EARNINGS }o--o| PAYOUTS : "batched into"
    TUTOR_PAYOUT_METHODS ||--o{ PAYOUTS : "paid to"

    EARNINGS {
        text id PK
        text tutor_id FK
        text booking_id UK "FK, exactly one per attended booking"
        bigint gross_poisha
        bigint commission_poisha
        numeric commission_rate "snapshot, never retroactive"
        bigint net_poisha "CHECK gross = commission + net"
        text status "accruing payable batched paid reversed held"
        timestamptz payable_at "session end + 48h dispute window"
        text payout_id FK
    }
    PAYOUTS {
        text id PK
        text tutor_id FK
        text payout_method_id FK
        bigint amount_poisha
        timestamptz period_start
        timestamptz period_end
        text status "pending sent confirmed failed"
        text provider_ref
        text idempotency_key UK "never double-pay"
    }
    TUTOR_PAYOUT_METHODS {
        text id PK
        text tutor_id FK
        enum method "bkash nagad bank"
        bytea account_ref_enc "encrypted MSISDN or account no"
        text account_last4 "display only"
        text account_name "name-matched against verified identity"
        bool is_default
        timestamptz verified_at
    }
```

> **`CHECK (gross_poisha = commission_poisha + net_poisha)`** turns a rounding bug into a write-time failure instead of a few poisha of drift per session that compounds into an unexplainable variance months later.

---

## 17.7 Media, reviews, notifications, platform

```mermaid
erDiagram
    CLASS_SESSIONS ||--o| RECORDINGS : produces
    RECORDINGS ||--|| MEDIA_ASSETS : "stored as"
    TUTOR_PROFILES ||--o{ MEDIA_ASSETS : owns
    MEDIA_ASSETS ||--o{ PLAYBACK_GRANTS : "issued for"
    USERS ||--o{ PLAYBACK_GRANTS : "granted to"

    MEDIA_ASSETS {
        text id PK
        text owner_tutor_id FK
        enum kind "session_recording uploaded_lesson intro_video"
        enum status "pending_upload uploaded processing ready failed deleted"
        text provider "cloudflare_stream r2"
        text playback_id
        int duration_seconds
        bigint size_bytes
        timestamptz retention_until "lifecycle tier, legal hold overrides"
    }
    RECORDINGS {
        text id PK
        text session_id UK "FK, one recording per session"
        text asset_id FK
        text source "zoom_cloud manual_upload google_drive"
        timestamptz available_at
        timestamptz expires_at
    }
    PLAYBACK_GRANTS {
        text id PK
        text asset_id FK
        text user_id FK
        timestamptz issued_at
        timestamptz expires_at "4h TTL"
        inet ip "leak attribution"
    }
```

```mermaid
erDiagram
    TUTOR_PROFILES ||--o{ REVIEWS : receives
    USERS ||--o{ REVIEWS : writes
    BOOKINGS ||--o| REVIEWS : "entitles exactly one"
    REVIEWS ||--o{ REVIEW_REPORTS : "may be reported"

    REVIEWS {
        text id PK
        text tutor_id FK
        text student_id FK
        text booking_id UK "FK — NO PAID BOOKING, NO REVIEW"
        smallint rating "1-5"
        smallint rating_clarity
        smallint rating_punctuality
        smallint rating_helpfulness
        text comment "contact details auto-redacted"
        bool is_published
        text moderation_state
        text tutor_reply "exactly one, permanent"
    }
    REVIEW_REPORTS {
        text id PK
        text review_id FK
        text reported_by FK
        text reason
        timestamptz resolved_at
    }
```

```mermaid
erDiagram
    USERS ||--o{ NOTIFICATIONS : receives
    NOTIFICATIONS ||--o{ NOTIFICATION_DELIVERIES : "fanned out to"
    NOTIFICATION_TEMPLATES ||--o{ NOTIFICATIONS : renders
    USERS ||--|| NOTIFICATION_PREFERENCES : configures

    NOTIFICATION_TEMPLATES {
        text key PK "booking.confirmed.student"
        text channel PK "sms email push in_app"
        text locale PK "bn-BD en"
        text body "SMS budget: 67 chars in Bangla UCS-2"
        bool is_transactional
    }
    NOTIFICATIONS {
        text id PK
        text user_id FK
        text template_key FK
        jsonb payload
        text dedupe_key UK "never send the same reminder twice"
        timestamptz read_at
    }
    NOTIFICATION_DELIVERIES {
        text id PK
        text notification_id FK
        text channel
        text destination "masked in logs"
        text provider "primary or failover"
        text status "queued sent delivered failed suppressed"
        bigint cost_poisha "per-message spend tracking"
        smallint attempts
    }
    NOTIFICATION_PREFERENCES {
        text user_id PK "FK to users"
        bool sms_marketing "opt-in, default false"
        bool push_enabled
        time quiet_hours_start "22:00"
        time quiet_hours_end "08:00"
    }
```

```mermaid
erDiagram
    BOOKINGS ||--o{ DISPUTES : "may raise"
    USERS ||--o{ DISPUTES : files
    DISPUTES ||--o| REFUNDS : "may resolve with"

    DISPUTES {
        text id PK
        text booking_id FK
        text raised_by FK
        text category "tutor_no_show quality technical billing conduct"
        text status "open awaiting_evidence under_review resolved"
        text refund_id FK
        text assigned_to FK
        timestamptz sla_due_at "conduct = immediate"
    }
    AUDIT_LOG {
        bigint id PK
        text actor_id FK
        text action "tutor.approve refund.issue user.suspend"
        text entity_type
        text entity_id
        jsonb before
        jsonb after
        text reason "mandatory on every admin write"
    }
    OUTBOX {
        bigint id PK
        text event_type
        text aggregate_id
        jsonb payload
        timestamptz published_at "null = pending relay"
    }
    IDEMPOTENCY_KEYS {
        text key PK
        text user_id FK
        text endpoint
        text request_hash
        smallint response_code
        jsonb response_body
        timestamptz expires_at "24h"
    }
```

---

## 17.8 Cross-module reference map

Logical references that cross a module boundary. In code these are resolved through the owning module's service interface or a maintained read model — **never a SQL join** ([ADR-002](adr/ADR-002-modular-monolith.md)).

```mermaid
flowchart LR
    USERS[identity.users] -.-> TP[tutor.tutor_profiles]
    USERS -.-> CA[billing.credit_accounts]
    USERS -.-> BK[booking.bookings]
    USERS -.-> RV[reviews.reviews]
    SUB[catalog.subjects] -.-> TS[tutor.tutor_subjects]
    SUB -.-> OFF[scheduling.class_offerings]
    LOC[catalog.locations] -.-> TSA[tutor.tutor_service_areas]
    LOC -.-> OFF
    TP -.-> OFF
    TP -.-> SES[scheduling.class_sessions]
    TP -.-> HP[billing.hour_packs]
    TP -.-> EA[payouts.earnings]
    OFF --> SES
    SES --> BK
    BK -.-> LE[billing.ledger_entries]
    BK -.-> EA
    BK -.-> RV
    BK -.-> DIS[platform.disputes]
    SES -.-> REC[media.recordings]
```

The two edges drawn solid — `class_offerings → class_sessions` and `class_sessions → bookings` — are the ones that stay inside a single transaction. Everything dotted crosses a module seam and is eventually consistent via the [outbox](03-architecture.md#34-module-boundaries).

---

## 17.9 Database-enforced invariants

What the schema guarantees without any application code cooperating. Full list in [04 §4.12](04-data-model.md#412-invariants).

| Constraint | Table | Guarantees |
|---|---|---|
| `EXCLUDE gist (tutor_id, occupies)` | `class_sessions` | A tutor is never in two sessions at once, under any concurrency |
| `EXCLUDE gist (student_id, occupies)` | `bookings` | A student is never in two classes at once |
| `CHECK (seats_taken <= capacity)` | `class_sessions` | A group session is never oversold |
| `UNIQUE (session_id, student_id)` | `bookings` | One seat per student per session |
| `CHECK (balance_credits >= 0)` | `credit_accounts` | A wallet can never go negative |
| `UNIQUE (idempotency_key)` | `ledger_entries` | A retried payment never double-credits |
| `UNIQUE (idempotency_key)` | `payouts` | A retried batch never double-pays |
| `CHECK (gross = commission + net)` | `earnings` | Commission arithmetic can never silently drift |
| `UNIQUE (booking_id)` | `reviews` | No paid, attended booking → no review |
| `UNIQUE (booking_id)` | `earnings` | Exactly one earnings row per booking |
| `UNIQUE (provider, provider_ref)` | `payments` | One payment per provider reference |
| `UNIQUE (source, external_id)` | `webhook_events` | A replayed webhook is processed once |
| `UNIQUE (session_id)` | `recordings` | One recording per session |
| `UNIQUE (phone_e164)` | `users` | One human, one account |

Every one of these is a rule that would otherwise live in application code, be forgotten by some future call path — an admin tool, a bulk import, a migration script — and fail only under production concurrency. Putting them in the schema is what makes them survive the codebase.

---

Back to the [documentation index](../README.md) · [04 — Data Model](04-data-model.md) holds the DDL.
