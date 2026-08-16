# 04 — Data Model

PostgreSQL 16. All DDL below is the intended target schema; migrations are generated from it, not hand-written against it.

**Global conventions**

- Primary keys are `TEXT` prefixed ULIDs (`ses_01HQ…`) — sortable by creation time, safe to expose, self-identifying in logs and support tickets.
- `created_at` / `updated_at` are `timestamptz NOT NULL DEFAULT now()` on every table (omitted below for brevity except where semantically relevant).
- Money columns are `BIGINT`, named `*_poisha`. 1 BDT = 100 poisha. **No floats, no `NUMERIC` for money, no exceptions.**
- Soft deletion via `deleted_at timestamptz` only where users can restore; otherwise hard delete plus an audit-log entry.
- Every foreign key is indexed.
- Tables are grouped below by module for readability, so a few foreign keys reference tables defined further down (`bookings → hour_packs`, `earnings → payouts`). Migrations create tables first and add those constraints in a later `ALTER TABLE` step.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- required for the booking exclusion constraints
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

---

## 4.1 Identity

```sql
CREATE TYPE user_status AS ENUM ('active','suspended','deleted');

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  phone_e164        TEXT NOT NULL UNIQUE,          -- +8801XXXXXXXXX, normalised at the edge
  phone_verified_at timestamptz,
  email             CITEXT UNIQUE,                 -- optional; low engagement in this market
  email_verified_at timestamptz,
  full_name         TEXT NOT NULL,
  display_name      TEXT,
  avatar_url        TEXT,
  locale            TEXT NOT NULL DEFAULT 'bn-BD' CHECK (locale IN ('bn-BD','en')),
  timezone          TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  status            user_status NOT NULL DEFAULT 'active',
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON users USING gin (full_name gin_trgm_ops);

-- Roles are additive: one human may be student, tutor and guardian at once.
CREATE TYPE user_role AS ENUM ('student','tutor','guardian','admin','support','finance');

CREATE TABLE user_roles (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, role)
);

-- OTP is the primary auth factor. Hash it; never store or log the plaintext code.
CREATE TABLE otp_challenges (
  id            TEXT PRIMARY KEY,
  phone_e164    TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  purpose       TEXT NOT NULL,           -- login | phone_change | payout_method_change
  attempts      SMALLINT NOT NULL DEFAULT 0,
  max_attempts  SMALLINT NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_ip    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_challenges (phone_e164, created_at DESC);

CREATE TABLE refresh_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  device_label TEXT,
  user_agent   TEXT,
  ip           inet,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

### Guardian links

```sql
CREATE TABLE guardian_links (
  id             TEXT PRIMARY KEY,
  guardian_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship   TEXT NOT NULL,            -- father | mother | sibling | other
  permissions    JSONB NOT NULL DEFAULT
                 '{"fund_wallet":true,"view_ledger":true,"receive_notifications":true,"approve_bookings":false}',
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, student_id),
  CHECK (guardian_id <> student_id)
);
```

`approve_bookings` defaults to `false` but is forced `true` when the student's stored date of birth indicates they are under 16 — see [14](14-security-compliance.md#143-minors).

---

## 4.2 Catalog (reference data)

```sql
CREATE TYPE curriculum_code AS ENUM ('NCTB_BN','NCTB_EN','CAMBRIDGE_EDEXCEL','MADRASAH');
CREATE TYPE stream_code     AS ENUM ('SCIENCE','HUMANITIES','BUSINESS_STUDIES','GENERAL');

CREATE TABLE grade_levels (
  code        TEXT PRIMARY KEY,            -- CLASS_9, O_LEVEL, ALIM, ADMISSION …
  name_en     TEXT NOT NULL,
  name_bn     TEXT NOT NULL,
  stage       TEXT NOT NULL,               -- primary | junior | secondary | higher_secondary | admission
  sort_order  INT  NOT NULL
);

CREATE TABLE boards (
  code     TEXT PRIMARY KEY,               -- DHAKA, CHATTOGRAM, MADRASAH, TECHNICAL …
  name_en  TEXT NOT NULL,
  name_bn  TEXT NOT NULL
);

CREATE TABLE subjects (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,     -- HSC_PHYSICS_1
  name_en        TEXT NOT NULL,
  name_bn        TEXT NOT NULL,
  curricula      curriculum_code[] NOT NULL,
  grade_levels   TEXT[] NOT NULL,          -- references grade_levels.code
  stream         stream_code NOT NULL DEFAULT 'GENERAL',
  aliases        TEXT[] NOT NULL DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0
);
CREATE INDEX ON subjects USING gin (grade_levels);
CREATE INDEX ON subjects USING gin (aliases);
CREATE INDEX ON subjects USING gin ((name_en || ' ' || name_bn) gin_trgm_ops);
```

Subjects are curated. Tutors submit requests into `subject_requests`; an admin promotes them ([12](12-admin-console.md#123-taxonomy-requests)). Free-text subjects are never written directly into `subjects`.

### Geography

```sql
CREATE TYPE location_level AS ENUM ('division','district','upazila','area');

CREATE TABLE locations (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES locations(id),
  level      location_level NOT NULL,
  name_en    TEXT NOT NULL,
  name_bn    TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,          -- dhaka/dhanmondi
  centroid   POINT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON locations (parent_id);
CREATE INDEX ON locations USING gin ((name_en || ' ' || name_bn) gin_trgm_ops);

-- Materialised ancestry so "all tutors in Dhaka division" is one indexed lookup.
CREATE TABLE location_closure (
  ancestor_id   TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  descendant_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  depth         SMALLINT NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);
```

---

## 4.3 Tutor

```sql
CREATE TYPE tutor_status        AS ENUM ('draft','submitted','under_review','approved','rejected','suspended');
CREATE TYPE verification_tier   AS ENUM ('L0','L1','L2','L3');

CREATE TABLE tutor_profiles (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  headline_en           TEXT,
  headline_bn           TEXT,
  bio_en                TEXT,
  bio_bn                TEXT,
  intro_video_asset_id  TEXT,
  years_experience      SMALLINT NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 60),
  status                tutor_status NOT NULL DEFAULT 'draft',
  verification_tier     verification_tier NOT NULL DEFAULT 'L0',
  teaches_online        BOOLEAN NOT NULL DEFAULT TRUE,
  teaches_in_person     BOOLEAN NOT NULL DEFAULT FALSE,
  travel_radius_km      SMALLINT,
  base_hourly_rate_poisha BIGINT CHECK (base_hourly_rate_poisha >= 0),
  gender                TEXT CHECK (gender IN ('male','female','prefer_not_to_say')),
  languages             TEXT[] NOT NULL DEFAULT '{bn,en}',
  -- denormalised aggregates, maintained by the reviews module
  rating_avg            NUMERIC(3,2),
  rating_count          INT NOT NULL DEFAULT 0,
  rating_bayesian       NUMERIC(4,3),
  sessions_completed    INT NOT NULL DEFAULT 0,
  response_rate         NUMERIC(4,3),
  repeat_rate           NUMERIC(4,3),
  quality_score         NUMERIC(6,4) NOT NULL DEFAULT 0,   -- see 08 §8.6
  approved_at           timestamptz,
  suspended_at          timestamptz,
  suspension_reason     TEXT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tutor_profiles (status) WHERE status = 'approved';
CREATE INDEX ON tutor_profiles (quality_score DESC) WHERE status = 'approved';

CREATE TABLE tutor_subjects (
  id                  TEXT PRIMARY KEY,
  tutor_id            TEXT NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  subject_id          TEXT NOT NULL REFERENCES subjects(id),
  grade_level         TEXT NOT NULL REFERENCES grade_levels(code),
  curriculum          curriculum_code NOT NULL,
  board               TEXT REFERENCES boards(code),
  hourly_rate_poisha  BIGINT NOT NULL CHECK (hourly_rate_poisha >= 0),
  UNIQUE (tutor_id, subject_id, grade_level, curriculum)
);
CREATE INDEX ON tutor_subjects (subject_id, grade_level);
CREATE INDEX ON tutor_subjects (hourly_rate_poisha);

CREATE TABLE tutor_service_areas (
  tutor_id     TEXT NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  location_id  TEXT NOT NULL REFERENCES locations(id),
  PRIMARY KEY (tutor_id, location_id)
);
```

### Credentials and verification

```sql
CREATE TYPE credential_type AS ENUM
  ('nid','passport','birth_certificate','degree','transcript','certification','employment_letter','other');
CREATE TYPE credential_status AS ENUM ('pending','verified','rejected','expired');

CREATE TABLE tutor_credentials (
  id              TEXT PRIMARY KEY,
  tutor_id        TEXT NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  type            credential_type NOT NULL,
  institution     TEXT,
  title           TEXT,                       -- "BSc in EEE"
  year_awarded    SMALLINT,
  -- PII: encrypted at rest with an app-managed key, never returned by any API
  document_number_enc BYTEA,
  document_asset_key  TEXT NOT NULL,          -- private bucket key; never a public URL
  status          credential_status NOT NULL DEFAULT 'pending',
  reviewed_by     TEXT REFERENCES users(id),
  reviewed_at     timestamptz,
  reject_reason   TEXT,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tutor_credentials (status) WHERE status = 'pending';
```

`document_number_enc` holds the NID/passport number encrypted with AES-256-GCM under a KMS-held data key. It exists to deduplicate identities and to answer law-enforcement requests — **it is never exposed through any API surface, including admin**, which sees only a `••••1234` suffix.

---

## 4.4 Scheduling

```sql
CREATE TYPE delivery_mode  AS ENUM ('live_online','live_in_person','recorded');
CREATE TYPE class_format   AS ENUM ('one_to_one','group');
CREATE TYPE offering_status AS ENUM ('draft','published','paused','archived');

CREATE TABLE class_offerings (
  id                   TEXT PRIMARY KEY,
  tutor_id             TEXT NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  title_en             TEXT NOT NULL,
  title_bn             TEXT,
  description_en       TEXT,
  description_bn       TEXT,
  subject_id           TEXT NOT NULL REFERENCES subjects(id),
  grade_level          TEXT NOT NULL REFERENCES grade_levels(code),
  curriculum           curriculum_code NOT NULL,
  board                TEXT REFERENCES boards(code),
  delivery_mode        delivery_mode NOT NULL,
  format               class_format NOT NULL,
  duration_minutes     SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 15 AND 300),
  capacity             SMALLINT NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 200),
  price_poisha         BIGINT NOT NULL CHECK (price_poisha >= 0),   -- per seat, per session
  location_id          TEXT REFERENCES locations(id),               -- required when live_in_person
  venue_note           TEXT,
  status               offering_status NOT NULL DEFAULT 'draft',
  cancellation_policy  TEXT NOT NULL DEFAULT 'standard',            -- see 07 §7.7
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (format = 'group' OR capacity = 1),
  CHECK (delivery_mode <> 'live_in_person' OR location_id IS NOT NULL)
);
CREATE INDEX ON class_offerings (tutor_id, status);
CREATE INDEX ON class_offerings (subject_id, grade_level, status) WHERE status = 'published';
```

### Availability

```sql
CREATE TABLE availability_rules (
  id           TEXT PRIMARY KEY,
  tutor_id     TEXT NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  weekday      SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday (BD week start)
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  valid_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until  DATE,
  CHECK (end_time > start_time)
);
CREATE INDEX ON availability_rules (tutor_id, weekday);

CREATE TABLE availability_exceptions (
  id          TEXT PRIMARY KEY,
  tutor_id    TEXT NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  window      tstzrange NOT NULL,
  is_available BOOLEAN NOT NULL,     -- false = blocked (holiday); true = extra one-off availability
  reason      TEXT
);
CREATE INDEX ON availability_exceptions USING gist (tutor_id, window);
```

Availability rules store **wall-clock time plus an IANA zone**, so "every Sunday 4pm" survives any future zone change and reads correctly to the tutor. Materialising them into instants happens at query time.

### Sessions — and the conflict constraint

```sql
CREATE TYPE session_status AS ENUM
  ('scheduled','live','completed','cancelled_by_tutor','cancelled_by_student','no_show_tutor','no_show_student');

CREATE TABLE class_sessions (
  id                 TEXT PRIMARY KEY,
  offering_id        TEXT NOT NULL REFERENCES class_offerings(id),
  tutor_id           TEXT NOT NULL REFERENCES tutor_profiles(id),
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  buffer_before_min  SMALLINT NOT NULL DEFAULT 0,
  buffer_after_min   SMALLINT NOT NULL DEFAULT 10,
  -- occupies = [starts_at - buffer_before, ends_at + buffer_after)
  -- Written by the application, never by a generated expression: timestamptz +/- interval
  -- is only STABLE, and an exclusion constraint requires IMMUTABLE inputs.
  occupies           tstzrange NOT NULL,
  capacity           SMALLINT NOT NULL CHECK (capacity >= 1),
  seats_taken        SMALLINT NOT NULL DEFAULT 0 CHECK (seats_taken >= 0),
  price_poisha       BIGINT NOT NULL,          -- snapshot of offering price at creation
  status             session_status NOT NULL DEFAULT 'scheduled',
  meeting_provider   TEXT,                     -- zoom | google_meet | other
  meeting_url        TEXT,
  meeting_external_id TEXT,
  tutor_joined_at    timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      TEXT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (seats_taken <= capacity)
);

CREATE INDEX ON class_sessions (tutor_id, starts_at);
CREATE INDEX ON class_sessions (starts_at) WHERE status = 'scheduled';
CREATE INDEX ON class_sessions USING gist (occupies);

-- THE core scheduling invariant: an active tutor cannot hold two overlapping sessions.
-- Enforced by the database so that concurrent booking requests cannot interleave past it.
ALTER TABLE class_sessions
  ADD CONSTRAINT class_sessions_no_tutor_overlap
  EXCLUDE USING gist (
    tutor_id WITH =,
    occupies WITH &&
  ) WHERE (status IN ('scheduled','live'));
```

> **Why an exclusion constraint and not a `SELECT … WHERE overlaps` check:** two requests can both read "no conflict" before either writes. Advisory locks would work but must be remembered at every call site, including future ones. The constraint cannot be forgotten, cannot be raced, and survives bulk imports, admin tooling and manual SQL. See [ADR-004](adr/ADR-004-booking-concurrency.md).

---

## 4.5 Booking

```sql
CREATE TYPE booking_status AS ENUM
  ('pending_payment','confirmed','attended','missed','cancelled','refunded');

CREATE TABLE bookings (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES class_sessions(id),
  student_id      TEXT NOT NULL REFERENCES users(id),
  booked_by       TEXT NOT NULL REFERENCES users(id),   -- student or their guardian
  status          booking_status NOT NULL DEFAULT 'pending_payment',
  price_poisha    BIGINT NOT NULL,
  hour_pack_id    TEXT REFERENCES hour_packs(id),        -- set when paid from a pack, not the wallet
  occupies        tstzrange NOT NULL,                    -- denormalised from the session
  joined_at       timestamptz,
  attended_minutes SMALLINT,
  cancelled_at    timestamptz,
  cancelled_by    TEXT REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
CREATE INDEX ON bookings (student_id, created_at DESC);
CREATE INDEX ON bookings (session_id);

-- A student cannot be in two classes at once either.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_student_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    occupies WITH &&
  ) WHERE (status IN ('confirmed','attended'));
```

`occupies` is denormalised onto `bookings` specifically so this constraint can exist — an exclusion constraint cannot reach through a foreign key. When a session is rescheduled, every child booking's `occupies` is updated in the same transaction.

### Enrolments (recorded offerings)

```sql
CREATE TABLE enrolments (
  id            TEXT PRIMARY KEY,
  offering_id   TEXT NOT NULL REFERENCES class_offerings(id),
  student_id    TEXT NOT NULL REFERENCES users(id),
  price_poisha  BIGINT NOT NULL,
  access_from   timestamptz NOT NULL DEFAULT now(),
  access_until  timestamptz,                    -- NULL = lifetime
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, student_id)
);
```

---

## 4.6 Billing

The ledger is the most consequential table in the system. Rules, in priority order:

1. **Append-only.** No `UPDATE`, no `DELETE`, ever. Reversals are new rows with opposite sign.
2. **Every row carries an idempotency key.** Retries cannot double-credit.
3. **The materialised balance is a cache**; `SUM(amount_credits)` is the truth, and a nightly job asserts they agree.
4. **Balance may never go negative** — enforced by a check on the account row inside the same transaction.

```sql
CREATE TABLE credit_accounts (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  balance_credits BIGINT NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  held_credits   BIGINT NOT NULL DEFAULT 0 CHECK (held_credits >= 0),
  currency       TEXT NOT NULL DEFAULT 'BDT',
  version        BIGINT NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE ledger_entry_type AS ENUM (
  'purchase',            -- credits bought with money
  'promo_grant',         -- marketing credit
  'referral_bonus',
  'hold',                -- reserved at booking (negative)
  'hold_release',        -- booking cancelled before capture (positive)
  'capture',             -- session completed, hold converted to spend
  'refund',              -- credits returned after capture (positive)
  'payout_adjustment',
  'admin_adjustment',
  'expiry'               -- promo credits lapsing (negative)
);

CREATE TABLE ledger_entries (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES credit_accounts(id),
  entry_type       ledger_entry_type NOT NULL,
  amount_credits   BIGINT NOT NULL,          -- signed: negative = leaving the account
  balance_after    BIGINT NOT NULL,          -- snapshot for audit; never read for logic
  ref_type         TEXT,                     -- order | booking | dispute | promo | admin
  ref_id           TEXT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  note             TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ledger_entries (account_id, created_at DESC);
CREATE INDEX ON ledger_entries (ref_type, ref_id);
```

### Hour packs

```sql
CREATE TABLE hour_packs (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES users(id),
  tutor_id            TEXT NOT NULL REFERENCES tutor_profiles(id),
  subject_id          TEXT REFERENCES subjects(id),        -- NULL = any subject this tutor teaches
  hours_purchased     NUMERIC(6,2) NOT NULL CHECK (hours_purchased > 0),
  hours_remaining     NUMERIC(6,2) NOT NULL CHECK (hours_remaining >= 0),
  locked_rate_poisha  BIGINT NOT NULL,        -- per hour, fixed for the pack's life
  total_paid_poisha   BIGINT NOT NULL,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (hours_remaining <= hours_purchased)
);
CREATE INDEX ON hour_packs (student_id, tutor_id) WHERE hours_remaining > 0;
```

Hour packs are the literal "buy N hours, deduct per class" instrument, scoped to one tutor so the rate is unambiguous. Wallet credits are the fungible fallback. [ADR-001](adr/ADR-001-credit-unit.md) explains why both exist.

### Orders and payments

```sql
CREATE TYPE order_status   AS ENUM ('initiated','pending','captured','failed','expired','refunded');
CREATE TYPE payment_method AS ENUM ('bkash','nagad','rocket','upay','card','bank');

CREATE TABLE credit_packages (
  id              TEXT PRIMARY KEY,
  name_en         TEXT NOT NULL,
  name_bn         TEXT NOT NULL,
  price_poisha    BIGINT NOT NULL,
  credits         BIGINT NOT NULL,            -- may exceed price_poisha => bonus credits
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  kind               TEXT NOT NULL,           -- credit_package | hour_pack | direct_booking
  package_id         TEXT REFERENCES credit_packages(id),
  hour_pack_spec     JSONB,
  amount_poisha      BIGINT NOT NULL CHECK (amount_poisha > 0),
  service_fee_poisha BIGINT NOT NULL DEFAULT 0,
  status             order_status NOT NULL DEFAULT 'initiated',
  idempotency_key    TEXT NOT NULL UNIQUE,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON orders (status, created_at) WHERE status IN ('initiated','pending');

CREATE TABLE payments (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES orders(id),
  provider           TEXT NOT NULL,           -- sslcommerz | shurjopay | bkash_direct
  method             payment_method,
  amount_poisha      BIGINT NOT NULL,
  provider_ref       TEXT,                    -- paymentID / sessionkey
  provider_trx_id    TEXT,                    -- bKash trxID, shown on the user's receipt
  status             TEXT NOT NULL,
  failure_code       TEXT,
  failure_message    TEXT,
  raw_response       JSONB,                   -- scrubbed of any PAN/credential material
  verified_at        timestamptz,             -- set only after server-to-server verification
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);

-- Every inbound webhook is persisted before it is processed, and deduped.
CREATE TABLE webhook_events (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL,               -- sslcommerz | bkash | zoom | stream
  external_id    TEXT NOT NULL,
  signature_ok   BOOLEAN NOT NULL,
  payload        JSONB NOT NULL,
  processed_at   timestamptz,
  process_error  TEXT,
  received_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
```

### Refunds

```sql
CREATE TABLE refunds (
  id                TEXT PRIMARY KEY,
  booking_id        TEXT REFERENCES bookings(id),
  order_id          TEXT REFERENCES orders(id),
  amount_poisha     BIGINT NOT NULL CHECK (amount_poisha > 0),
  destination       TEXT NOT NULL,            -- credits | source
  reason            TEXT NOT NULL,
  requested_by      TEXT REFERENCES users(id),
  approved_by       TEXT REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'pending',
  provider_refund_id TEXT,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

Refunds default to `destination = 'credits'` (instant, no PSP cost, keeps value on-platform). Refund-to-source is available on request and for disputes resolved against the platform — see [09](09-payments-credits.md#97-refunds).

---

## 4.7 Payouts

```sql
CREATE TABLE tutor_payout_methods (
  id             TEXT PRIMARY KEY,
  tutor_id       TEXT NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  method         payment_method NOT NULL,     -- bkash | nagad | bank
  account_ref_enc BYTEA NOT NULL,             -- wallet MSISDN or bank account, encrypted
  account_last4  TEXT NOT NULL,               -- for display
  account_name   TEXT NOT NULL,
  bank_name      TEXT,
  branch_routing TEXT,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One row per completed session: what the tutor earned and when it becomes payable.
CREATE TABLE earnings (
  id                  TEXT PRIMARY KEY,
  tutor_id            TEXT NOT NULL REFERENCES tutor_profiles(id),
  booking_id          TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  gross_poisha        BIGINT NOT NULL,
  commission_poisha   BIGINT NOT NULL,
  commission_rate     NUMERIC(5,4) NOT NULL,
  net_poisha          BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'accruing',   -- accruing|payable|batched|paid|reversed|held
  payable_at          timestamptz NOT NULL,               -- session end + dispute window
  payout_id           TEXT REFERENCES payouts(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (gross_poisha = commission_poisha + net_poisha)
);
CREATE INDEX ON earnings (tutor_id, status);
CREATE INDEX ON earnings (payable_at) WHERE status = 'accruing';

CREATE TABLE payouts (
  id                 TEXT PRIMARY KEY,
  tutor_id           TEXT NOT NULL REFERENCES tutor_profiles(id),
  payout_method_id   TEXT NOT NULL REFERENCES tutor_payout_methods(id),
  amount_poisha      BIGINT NOT NULL CHECK (amount_poisha > 0),
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  provider           TEXT,
  provider_ref       TEXT,
  failure_reason     TEXT,
  idempotency_key    TEXT NOT NULL UNIQUE,
  sent_at            timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

The `CHECK (gross = commission + net)` constraint means a rounding bug in commission calculation fails loudly at write time rather than silently producing a few poisha of drift per session that compounds into an unexplainable variance months later.

---

## 4.8 Media

```sql
CREATE TYPE asset_kind   AS ENUM ('session_recording','uploaded_lesson','intro_video','attachment','image');
CREATE TYPE asset_status AS ENUM ('pending_upload','uploaded','processing','ready','failed','deleted');

CREATE TABLE media_assets (
  id                 TEXT PRIMARY KEY,
  owner_tutor_id     TEXT REFERENCES tutor_profiles(id),
  kind               asset_kind NOT NULL,
  status             asset_status NOT NULL DEFAULT 'pending_upload',
  storage_key        TEXT,
  provider           TEXT,                     -- cloudflare_stream | r2
  provider_asset_id  TEXT,
  playback_id        TEXT,
  duration_seconds   INT,
  size_bytes         BIGINT,
  width              INT,
  height             INT,
  transcode_error    TEXT,
  captions_status    TEXT,
  retention_until    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recordings (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES class_sessions(id),
  asset_id      TEXT NOT NULL REFERENCES media_assets(id),
  source        TEXT NOT NULL,                 -- zoom_cloud | manual_upload | google_drive
  available_at  timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

-- Every playback URL issued, for leak attribution.
CREATE TABLE playback_grants (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES media_assets(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          inet,
  user_agent  TEXT
);
CREATE INDEX ON playback_grants (asset_id, user_id, issued_at DESC);
```

---

## 4.9 Reviews

```sql
CREATE TABLE reviews (
  id                TEXT PRIMARY KEY,
  tutor_id          TEXT NOT NULL REFERENCES tutor_profiles(id),
  student_id        TEXT NOT NULL REFERENCES users(id),
  booking_id        TEXT NOT NULL UNIQUE REFERENCES bookings(id),   -- one review per attended booking
  rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  rating_clarity    SMALLINT CHECK (rating_clarity BETWEEN 1 AND 5),
  rating_punctuality SMALLINT CHECK (rating_punctuality BETWEEN 1 AND 5),
  rating_helpfulness SMALLINT CHECK (rating_helpfulness BETWEEN 1 AND 5),
  comment           TEXT,
  is_published      BOOLEAN NOT NULL DEFAULT TRUE,
  moderation_state  TEXT NOT NULL DEFAULT 'auto_approved',
  tutor_reply       TEXT,
  tutor_replied_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reviews (tutor_id, created_at DESC) WHERE is_published;

CREATE TABLE review_reports (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id),
  reported_by TEXT NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,
  detail      TEXT,
  resolved_at timestamptz,
  resolution  TEXT,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

`booking_id UNIQUE` is the whole review-integrity model in one constraint: **no attended, paid booking → no review.** Fake reviews require fake paid bookings, which cost real money and leave a ledger trail.

---

## 4.10 Notifications

```sql
CREATE TABLE notification_templates (
  key            TEXT NOT NULL,               -- booking.confirmed.student
  channel        TEXT NOT NULL,               -- sms | email | push | in_app
  locale         TEXT NOT NULL,               -- bn-BD | en
  subject        TEXT,
  body           TEXT NOT NULL,               -- {{student_name}}, {{starts_at}} …
  is_transactional BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (key, channel, locale)
);

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  template_key TEXT NOT NULL,
  payload      JSONB NOT NULL,
  dedupe_key   TEXT UNIQUE,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
  id              TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  channel         TEXT NOT NULL,
  destination     TEXT NOT NULL,              -- masked in logs
  provider        TEXT,
  provider_msg_id TEXT,
  status          TEXT NOT NULL,              -- queued|sent|delivered|failed|suppressed
  cost_poisha     BIGINT,
  attempts        SMALLINT NOT NULL DEFAULT 0,
  failure_reason  TEXT,
  sent_at         timestamptz,
  delivered_at    timestamptz
);
CREATE INDEX ON notification_deliveries (status, sent_at);

CREATE TABLE notification_preferences (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sms_marketing   BOOLEAN NOT NULL DEFAULT FALSE,
  email_marketing BOOLEAN NOT NULL DEFAULT FALSE,
  push_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end   TIME DEFAULT '08:00'
);
```

Transactional notifications ignore marketing preferences but still respect quiet hours unless the message is time-critical (class starting in 10 minutes). See [13](13-notifications.md#136-quiet-hours).

---

## 4.11 Platform / admin

```sql
CREATE TABLE disputes (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES bookings(id),
  raised_by     TEXT NOT NULL REFERENCES users(id),
  category      TEXT NOT NULL,      -- tutor_no_show | quality | technical | billing | conduct
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  resolution    TEXT,
  refund_id     TEXT REFERENCES refunds(id),
  assigned_to   TEXT REFERENCES users(id),
  sla_due_at    timestamptz NOT NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON disputes (status, sla_due_at);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      TEXT REFERENCES users(id),
  actor_role    TEXT,
  action        TEXT NOT NULL,       -- tutor.approve | refund.issue | user.suspend
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  before        JSONB,
  after         JSONB,
  ip            inet,
  reason        TEXT,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX ON audit_log (actor_id, created_at DESC);

-- Transactional outbox: domain events written in the same TX as the state change.
CREATE TABLE outbox (
  id           BIGSERIAL PRIMARY KEY,
  event_type   TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload      JSONB NOT NULL,
  published_at timestamptz,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_code SMALLINT,
  response_body JSONB,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
```

---

## 4.12 Invariants

Asserted by a nightly reconciliation job; any violation pages the on-call engineer.

| # | Invariant |
|---|---|
| I1 | For every credit account: `balance_credits = SUM(ledger_entries.amount_credits)` |
| I2 | No `credit_accounts.balance_credits < 0` |
| I3 | For every session: `seats_taken = COUNT(bookings WHERE status IN ('confirmed','attended'))` |
| I4 | No two `scheduled`/`live` sessions for one tutor with overlapping `occupies` *(constraint-enforced; re-verified in case a constraint was dropped during a migration)* |
| I5 | Every `attended` booking has exactly one `earnings` row |
| I6 | `SUM(earnings.net) WHERE status='paid'` = `SUM(payouts.amount) WHERE status='confirmed'` |
| I7 | Every `captured` order has a `payments` row with `verified_at IS NOT NULL` |
| I8 | Credit liability (`SUM(balance_credits)`) matches the deferred-revenue figure in the finance export |
| I9 | Every `ready` recording's asset has `retention_until > now()` or is `deleted` |

---

Next: [05 — API Reference](05-api-reference.md)
