# ADR-003 — Bring-your-own Zoom/Meet link before a native classroom

**Status:** Accepted · **Date:** 2026-08-10

## Context

Live online classes need a video channel. Three broad options:

1. **BYO link** — the tutor pastes their own Zoom/Meet/Teams URL; the platform stores it and releases it to confirmed students at class time.
2. **Platform-managed meetings** — the platform holds a Zoom or Meet integration and creates meetings on the tutor's behalf via OAuth.
3. **Native classroom** — WebRTC in the platform (LiveKit, 100ms, Agora, or self-hosted Jitsi), with whiteboard, screen share and server-side recording.

Relevant context:

- Zoom is already ubiquitous among Bangladeshi tutors and students post-2020. Both sides know how to join a Zoom link; neither needs teaching.
- A native classroom is a substantial, ongoing engineering commitment: TURN/STUN infrastructure, bandwidth cost, echo cancellation, mobile browser quirks, recording pipeline, and a permanent on-call burden for real-time media — which fails in ways HTTP services do not.
- The product's risk at Phase 1 is **not** "is the video good enough". It is "will tutors onboard and will students pay". Spending the first three months on WebRTC answers a question nobody is asking yet.
- Network conditions in Bangladesh are variable. Zoom's client has years of adaptive-bitrate and packet-loss engineering behind it. A first-generation in-house classroom will be worse on a congested 4G cell, not better.

## Decision

**Phase 1: BYO link.** The tutor supplies a meeting URL per session or per recurring series. The platform:

- Validates the URL against an allowlist of Zoom/Meet/Teams URL shapes.
- **Releases it only through `POST /bookings/{id}/join`, only from T−15 min, and only to confirmed bookers.** Never in an SMS, never on a public page.
- Records `joined_at` when the endpoint is called, which is the attendance signal and the no-show detector.
- Warns when the same link is reused across overlapping sessions — a common tutor error that lets the wrong students into a class.

**Phase 2: optional Zoom OAuth.** A tutor may connect their Zoom account, after which the platform creates meetings itself, receives per-participant attendance reports, and pulls cloud recordings via the `recording.completed` webhook.

**Phase 4: native classroom**, and only if measurement justifies it.

## Consequences

**Positive**

- Ships in days rather than months. Phase 1 stays focused on the liquidity loop.
- Zero real-time media infrastructure, zero bandwidth cost, zero WebRTC on-call.
- Tutors use a tool they already know, on a free Zoom account. **No supply is excluded by a tooling requirement** — which matters, because the marginal tutor is the one this platform exists to reach.
- Students join something familiar; no app install, no browser-permission confusion.

**Negative and how each is handled**

| Problem | Handling |
|---|---|
| Link leakage — a shared Zoom link is a public class | Gated release at T−15 min to confirmed bookers only; never in SMS; Zoom waiting room recommended in tutor onboarding |
| Free Zoom's 40-minute limit on group meetings | Detected and flagged; tutors offering >40-min group classes are guided to a paid tier or to splitting sessions |
| Weak attendance data | `joined_at` from the join endpoint is a proxy; upgraded to real participant data with Zoom OAuth in Phase 2 |
| Recording depends on the tutor | Manual upload is the Phase 1 path and remains the permanent fallback ([10 §10.2](../10-media-recordings.md#102-sources)) |
| Tutor forgets to attach a link | Alert at T−10 min if `meeting_url` is null; escalates to SMS |
| No whiteboard | Tutors already use their own tools; not a Phase 1 blocker |
| Off-platform relationship is easier when contact happens in Zoom | Real. Countered by on-platform value rather than by control ([11 §11.6](../11-ratings-reviews.md#116-leakage-and-disintermediation)) |

## Revisit criteria

Build a native classroom only when one of these is **measured**, not assumed:

- Join-failure rate (booked, paid, never joined, no tutor no-show) exceeds 5%
- Recording coverage stays below 60% of sessions despite Phase 2 Zoom OAuth
- Support contacts about joining exceed 3 per 100 sessions
- A concrete pedagogical feature (shared whiteboard, in-class quizzing) is shown to lift retention in a test
- Leakage attributable to off-platform meeting tools is measurable and material

Absent those, the native classroom is an expensive way to build something Zoom already does better.

## References

- [07 §7.8 — Live class delivery](../07-classes-scheduling.md#78-live-class-delivery)
- [10 — Recordings & Media](../10-media-recordings.md)
