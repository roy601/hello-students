# ADR-002 — Modular monolith, not microservices

**Status:** Accepted · **Date:** 2026-08-10

## Context

The system has thirteen identifiable domains (identity, tutor, catalog, scheduling, booking, billing, payouts, media, reviews, search, notifications, admin, platform). That decomposition invites a service-per-domain architecture, and the team will be asked why it isn't one.

The relevant facts about this specific project:

- Team of 3 engineers at Phase 1, perhaps 8 by end of year 1.
- Realistic year-1 scale: ~5,000 tutors, ~80,000 students, ~1,500 sessions/day peak. A single well-indexed Postgres instance handles this without strain.
- **The core flows are transactional across domain boundaries.** Booking a session touches scheduling, booking and billing atomically: reserve the seat and hold the credits, or do neither. In a monolith this is `BEGIN … COMMIT`. Across services it is a saga, with compensating transactions, partial-failure states, and a class of bug that produces either double-booked tutors or lost money.
- Deployment complexity is a direct tax on a small team's throughput, and this team's scarce resource is attention, not CPU.

## Decision

**One deployable API service, internally structured as strictly-bounded modules**, plus one worker service running the same codebase against queues.

Boundaries are enforced mechanically, not by convention:

1. A module exposes a **service interface** and a set of **domain events**. Nothing else is public.
2. **No cross-module database access.** A module may not query, join to, or write another module's tables. Reads across boundaries go through the service interface or a maintained read model.
3. **No cross-module imports** except of the published interface and shared kernel types. Enforced by a `dependency-cruiser` rule that fails CI.
4. Each module owns its tables, with an enforced table-name prefix.
5. Cross-module side effects go through the **transactional outbox** — events written in the same transaction as the state change, relayed asynchronously.

Rule 2 is the one that actually matters. A "modular monolith" whose modules share a database schema is a monolith with extra folders.

## Consequences

**Positive**

- **Booking is one ACID transaction.** The most correctness-critical flow needs no distributed coordination, and the database enforces the invariants directly ([ADR-004](ADR-004-booking-concurrency.md)).
- One deploy, one log stream, one trace, one rollback. A three-person team can operate this.
- Refactoring boundaries is cheap while the domain is still being learned — and it *is* still being learned.
- Local development is `docker compose up`. Integration tests run the real system against Testcontainers.
- No network hop, no serialisation, no service-discovery failure mode between modules.

**Negative**

- The whole application scales as one unit. Accepted: the load profile is uniform and dominated by a predictable evening peak.
- A memory leak or crash in one module affects all. Mitigated by separating the worker process from the API process — a runaway transcode orchestration cannot take down booking.
- Team scaling beyond ~8 engineers will create merge contention. That is a year-2 problem with a year-2 answer.
- Boundary discipline requires enforcement. Hence the CI rule; a convention alone will be violated within a month.

## Extraction triggers

Extract a module into its own service only when a specific, measured condition holds:

| Module | Trigger |
|---|---|
| `media` | Transcode orchestration needs independent scaling or a different runtime |
| `search` | Index maintenance load interferes with API latency |
| `notifications` | Provider integrations need independent deploy cadence, or volume warrants dedicated capacity |
| `payouts` | Compliance requires a separately-audited deployment boundary |

Never extract `booking`, `scheduling` or `billing` from each other. Their transactional coupling is the reason the monolith exists.

## Consequences if this is wrong

The failure mode is merge contention and deploy-queue congestion at team scale, both of which are visible months in advance and both of which are fixed by extracting a module — a bounded, incremental operation *because* the boundaries were enforced from day one. That is the actual insurance policy here: strict module boundaries make the microservices option cheap to exercise later, without paying for it now.

## References

- [03 — System Architecture](../03-architecture.md)
