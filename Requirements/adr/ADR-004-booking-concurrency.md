# ADR-004 — Booking conflicts enforced by a Postgres exclusion constraint

**Status:** Accepted · **Date:** 2026-08-10

## Context

Requirement 4 asks for "booking & calendar system with conflict checks". Two invariants must hold absolutely:

- **C1** — a tutor is never in two sessions at once (including buffers)
- **C2** — a student is never in two classes at once

These are not validation niceties. A violated C1 means a tutor double-booked at 5 PM, two paying students, one of them refunded and gone. It is exactly the failure that destroys a new marketplace's credibility, and it happens under concurrency — two students booking adjacent slots in the same second, or a tutor creating a session while a student books an overlapping one.

The naive implementation is a race:

```ts
const clash = await db.query(`SELECT 1 FROM class_sessions
  WHERE tutor_id = $1 AND tstzrange(starts_at, ends_at) && $2`);
if (clash) throw new ConflictError();
await db.insert(session);          // ← two requests can both reach here
```

Both requests read "no conflict" before either writes. Under the evening booking peak — which is when 80% of bookings happen — this is not a theoretical window.

## Options considered

**A. Application-level check** (above). Racy. Rejected outright.

**B. Serializable isolation.** Correct, but pushes serialization failures onto every caller, requires retry logic everywhere, and degrades throughput on a table with heavy concurrent access. Reserved as a targeted tool, not a global setting.

**C. Advisory lock per tutor** (`pg_advisory_xact_lock(hash(tutor_id))`). Correct *if remembered at every call site*. It is not enforced by anything — a future admin tool, bulk importer, migration script, or a feature written in 2028 by someone who never read this document will forget it, and the resulting bug appears only under load and only in production.

**D. Postgres exclusion constraint.** *(Chosen.)*

## Decision

Enforce C1 and C2 with GiST exclusion constraints, in the database.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE class_sessions
  ADD CONSTRAINT class_sessions_no_tutor_overlap
  EXCLUDE USING gist (tutor_id WITH =, occupies WITH &&)
  WHERE (status IN ('scheduled','live'));

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_student_overlap
  EXCLUDE USING gist (student_id WITH =, occupies WITH &&)
  WHERE (status IN ('confirmed','attended'));
```

The constraint is checked at write time under the index's own locking, so two concurrent inserts cannot both succeed. `btree_gist` is what allows the equality operator on `tutor_id` to sit in the same GiST index as the range-overlap operator.

### Supporting decisions

**1. `occupies` is a stored column, written by the application — not a generated column.**

The obvious formulation is `EXCLUDE … tstzrange(starts_at - buffer, ends_at + buffer)`. It does not work: `timestamptz ± interval` is `STABLE`, not `IMMUTABLE`, and index expressions require `IMMUTABLE`. So `occupies tstzrange NOT NULL` is materialised at write time by a single helper:

```ts
buildOccupies(startsAt, endsAt, bufferBeforeMin, bufferAfterMin): TstzRange
```

in `packages/domain`, which is the only code permitted to construct it. A trigger asserts `lower(occupies) <= starts_at AND upper(occupies) >= ends_at` as a defence against a future path forgetting.

**2. `occupies` is denormalised onto `bookings`.** An exclusion constraint cannot reach through a foreign key to the session's range. Rescheduling therefore updates every child booking's `occupies` in the same transaction — at which point the C2 constraint may reject, correctly surfacing "these three students now have a clash" ([07 §7.6](../07-classes-scheduling.md#76-conflict-detection)).

**3. Partial `WHERE` clauses.** Cancelled and completed sessions must not block new bookings in the same slot.

**4. Errors are translated, not leaked.** SQLSTATE `23P01` on a named constraint becomes a domain error carrying the *conflicting* session, so the UI says *"You already have HSC Chemistry at 4:00 PM"* rather than "conflict".

**5. Seat capacity (C3) uses `SELECT … FOR UPDATE` plus `CHECK (seats_taken <= capacity)`** — a counter, not a range, so a row lock is the right tool.

## Consequences

**Positive**

- **The invariant cannot be violated by any code path**, present or future, including manual SQL, admin tooling and data migrations. This is the entire point.
- No retry loops, no advisory-lock discipline, no serializable isolation tax.
- The GiST index that enforces the constraint also serves calendar range queries.
- Correctness survives developer turnover — the constraint is documentation that executes.

**Negative**

- Requires the `btree_gist` extension. Available in RDS, Cloud SQL and standard Postgres; a genuine (if unlikely) portability constraint if the database is ever migrated to something without exclusion constraints. Accepted knowingly.
- `occupies` must be kept consistent with `starts_at`/`ends_at`. Mitigated by the single construction helper plus the trigger.
- Bulk operations (importing a coaching centre's timetable) may hit conflicts row-by-row. Handled by validating the batch in a savepoint and reporting all conflicts at once.
- Changing buffer rules requires a backfill of `occupies`.
- Exclusion constraints are slower than plain unique indexes on very high write rates. At 1,500 sessions/day this is not remotely a concern.

## Verification

- Concurrency test: 50 parallel bookings for overlapping slots must produce exactly one success and 49 clean `409`s.
- Property test: randomised session/booking sequences must never yield an overlapping pair.
- Invariant I4 in the nightly reconciliation re-verifies by query, catching the case where a migration accidentally drops the constraint.

## References

- [04 §4.4 — Scheduling schema](../04-data-model.md#44-scheduling)
- [07 §7.6 — Conflict detection](../07-classes-scheduling.md#76-conflict-detection)
