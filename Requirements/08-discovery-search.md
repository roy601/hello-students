# 08 — Discovery & Search

*Implements capability 3: browse/search tutors by subject, grade level, area, price.*

## 8.1 What discovery has to accomplish

A parent in Mirpur types "class 9 math" — or "ক্লাস ৯ গণিত", or "nine e math tutor mirpur" — and needs to reach a booked session in under three minutes. Search is not a feature here; it is the demand-side conversion funnel in its entirety.

Two failure modes to design against, and they pull in opposite directions:

- **Empty results.** Early on, with sparse supply, over-filtering returns nothing and the user leaves permanently. **Never return zero results without an escape route** — always fall back to a relaxed query and say plainly what was relaxed: *"No Chemistry tutors free at 5 PM in Bashundhara. Here are 8 nearby, and 12 online."*
- **Undifferentiated results.** Forty tutors who all look identical produce paralysis, not choice. Ranking and the *reasons* for ranking carry as much weight as the filtering.

## 8.2 Entry points

| Surface | Purpose |
|---|---|
| Home | Grade + subject picker as the primary control. Two taps to a result set. |
| Search bar | Free text, bn/en, typo-tolerant, with typeahead |
| Category browse | Subject → grade → area, fully crawlable static URLs |
| Tutor profile | SSR'd, indexable, canonical — organic search is a real acquisition channel here |
| "Available now" | Tutors with a free slot in the next 3 hours; converts unusually well for exam-panic demand |
| Similar tutors | On every profile, so a rejected result is not a dead end |

SEO-friendly URLs are a deliberate acquisition strategy, not an afterthought:

```
/tutors/dhaka/dhanmondi/hsc-physics
/tutors/chattogram/nasirabad/class-9-math
/tutor/rifat-hossain-01hq8zk
```

Each carries bn/en `hreflang` alternates, `Course`/`Person` structured data, and a server-rendered result list.

## 8.3 Filters

| Filter | Type | Notes |
|---|---|---|
| Subject | multi | From the curated taxonomy; alias-matched |
| Grade level | single | Drives subject validity |
| Curriculum | single | Defaults from the student's profile |
| Board | single | National curriculum only |
| Area | hierarchical | Matched through `location_closure`, so "Dhaka" includes every area beneath it |
| Delivery mode | multi | Online / in-person / recorded |
| Format | multi | One-to-one / group |
| Price range | range | In BDT, presented as a histogram slider |
| Rating | min | 4.0+ / 4.5+ |
| Verification | min | L1 / L2 / L3 |
| Availability | window | "Free Sun–Thu after 5 PM" — the highest-intent filter in the whole set |
| Language | multi | Bangla / English medium of instruction |
| Gender | single | Policy-governed — see §8.7 |
| Experience | min years | |

**Defaults matter more than the filter list.** A logged-in student's grade, curriculum and area pre-populate from their profile, so the default result set is already relevant before they touch anything. An empty search must never be a blank page.

Every filter shows a live result count, and any filter that would produce zero results is shown disabled with its count — so the user learns the shape of supply instead of hitting a wall.

## 8.4 Bangla text

The hardest technical problem in this document, and it is squarely on the critical path because most students search in Bangla or in mixed script.

**The problems:**

1. **PostgreSQL ships no Bangla full-text dictionary.** `to_tsvector('simple', …)` gives no stemming, no stop words.
2. **Bengali is morphologically rich.** গণিত / গণিতের / গণিতে are the same concept with different case endings.
3. **Unicode normalisation.** The same visual conjunct can be encoded multiple ways; ZWJ/ZWNJ appear inconsistently.
4. **Mixed script and transliteration are the norm.** "class 9 math", "ক্লাস ৯ গণিত", "নাইনের অংক", and "nine er math" are all the same query from four real users.
5. **Numerals.** ৯ and 9 must be interchangeable everywhere.
6. **Phonetic Latin input.** Users type Bangla words in Latin script constantly ("gonit", "podartho") — often from Avro/phonetic keyboard habits.

**The approach, in layers:**

| Layer | Technique |
|---|---|
| Normalisation | Unicode **NFC**; strip ZWJ/ZWNJ; Bangla digits → ASCII; lowercase Latin; collapse whitespace. Applied identically to indexed text and to queries — a single `normalizeSearchText()` in `packages/domain` used by both paths. |
| Trigram matching | `pg_trgm` GIN indexes on the normalised concatenation of names and aliases. Trigrams handle Bengali case endings and typos surprisingly well without any linguistic model. |
| Alias expansion | Every subject carries hand-curated aliases in Bangla, English, transliteration and common abbreviations. This is unglamorous manual work and it is the single highest-leverage thing for search quality. |
| Transliteration | A Bangla↔Latin phonetic map applied to the query, searching both forms. "gonit" → গণিত. |
| Synonym dictionary | Curated: অংক ↔ গণিত ↔ math ↔ mathematics; পদার্থ ↔ physics; নাইন ↔ ৯ ↔ class 9 ↔ নবম |
| Typo tolerance | Trigram similarity threshold 0.3 in Phase 1; Typesense fuzzy matching from Phase 2 |

Search quality is measured, not assumed: a fixed **golden query set** of ~200 real queries in both scripts, with expected top-3 results, is asserted in CI. Any change to ranking or normalisation that regresses the golden set fails the build.

## 8.5 Search backend

**Phase 1 — PostgreSQL.** Up to a few thousand tutors, `pg_trgm` plus well-chosen partial indexes meet the p95 < 800 ms budget. No new infrastructure, no sync lag, no consistency problems, and filters compose naturally with the availability join. Starting with Elasticsearch here would be spending the operational budget on the wrong problem.

**Phase 2 — Typesense.** Adopted when any of these triggers fire:

- p95 search latency > 800 ms
- Faceted counts across ≥ 8 filters become the bottleneck
- Typo tolerance quality is demonstrably costing conversion (measurable via zero-result rate)
- Tutor count > ~10,000

Typesense over Elasticsearch: dramatically lower operational burden, built-in typo tolerance that handles Bengali acceptably, native faceting, and a fraction of the memory footprint. The index is a projection maintained from domain events with a nightly full reconcile; **Postgres remains the source of truth and the fallback path if the index is stale or unavailable.**

### Index document

```jsonc
{
  "id": "tut_01HQ…",
  "name": "Rifat Hossain",
  "name_bn": "রিফাত হোসেন",
  "headline": "HSC Physics · 8 years · 200+ students to A+",
  "search_blob": "rifat hossain physics podartho পদার্থবিজ্ঞান hsc class 12 …",
  "subject_ids": ["sub_hsc_physics_1", "sub_hsc_physics_2"],
  "subject_names": ["Physics 1st Paper", "পদার্থবিজ্ঞান ১ম পত্র"],
  "grade_levels": ["CLASS_11", "CLASS_12"],
  "curricula": ["NCTB_BN", "NCTB_EN"],
  "boards": ["DHAKA", "CHATTOGRAM"],
  "location_ids": ["loc_dhaka", "loc_dhaka_dhanmondi", "loc_dhaka_mohammadpur"],
  "delivery_modes": ["live_online", "live_in_person"],
  "min_price_poisha": 70000,
  "max_price_poisha": 120000,
  "rating_bayesian": 4.62,
  "rating_count": 47,
  "verification_tier": "L2",
  "sessions_completed": 312,
  "quality_score": 0.8134,
  "next_available_at": 1755172800,
  "available_weekday_hours": ["0_16","0_17","2_16","2_17"],
  "is_active": true
}
```

`location_ids` is denormalised with the full ancestor chain so an area query and a division query are the same single indexed lookup. `available_weekday_hours` is a coarse bitmap enabling fast "free Sunday evening" filtering without joining the live calendar — the precise calendar check happens only on the shortlisted results.

## 8.6 Ranking

```
score = 0.35 · text_relevance
      + 0.25 · quality_score
      + 0.15 · availability_fit
      + 0.10 · location_fit
      + 0.10 · price_fit
      + 0.05 · freshness_boost
```

| Component | Definition |
|---|---|
| `text_relevance` | Trigram/BM25 similarity over `search_blob`, subject names and aliases. 1.0 for an exact subject-filter match with no free text. |
| `quality_score` | See below |
| `availability_fit` | 1.0 if free within the requested window; decays with time-to-next-slot when no window is specified |
| `location_fit` | 1.0 same area; 0.7 adjacent area; 0.5 same district; 0.85 flat for online-only |
| `price_fit` | Gaussian centred on the segment median, so both extremes are mildly penalised — not a cheapest-first sort |
| `freshness_boost` | New approved tutors get a decaying boost for 21 days |

```
quality_score = 0.40 · bayesian_rating_normalised
              + 0.20 · completion_rate
              + 0.15 · repeat_booking_rate
              + 0.10 · response_rate
              + 0.10 · verification_tier_weight
              + 0.05 · profile_completeness
```

Bayesian average, so a single 5★ review cannot outrank a 4.8 with two hundred:

```
bayesian_rating = (C · m + Σ ratings) / (C + n)
    where m = platform mean rating, C = 10 (prior weight)
```

### The cold-start problem for new tutors

The ranking above is self-reinforcing: no bookings → no reviews → no ranking → no bookings. A marketplace that lets this ossify stops acquiring supply. Countermeasures:

- **`freshness_boost`** for 21 days after approval.
- **Exploration slots**: positions 4 and 8 on page one are reserved for randomised eligible new tutors (ε-greedy, ε ≈ 0.1). The cost is a small amount of relevance; the return is a functioning supply funnel.
- **"New" badge** — framed as an opportunity (often with introductory pricing), not a warning.
- Credential verification (L2) substitutes for review history in `quality_score` until reviews accumulate.

### Anti-gaming

- No ranking component a tutor can directly set (price is fitted to the median, not sorted ascending).
- Review weight is capped per reviewing student — ten reviews from one student count roughly as one.
- Self-bookings and circular bookings between linked accounts are detected and excluded from `quality_score` ([14 §14.5](14-security-compliance.md#145-fraud)).
- Paid placement, when it eventually exists, is capped, clearly labelled, and never occupies the first organic position.

## 8.7 The gender filter

Students and parents in Bangladesh — particularly for female students, and particularly for in-person tutoring — frequently and legitimately need a female tutor. A platform that omits this filter does not eliminate the preference; it just pushes those users back to coaching centres that accommodate it. Omitting it is the wrong call.

The implementation is narrow and deliberate:

- Tutor gender is **self-declared and optional** (`male` / `female` / `prefer_not_to_say`).
- The filter is a **student-side preference**, applied only when explicitly chosen. It is never a default, never inferred, and never pre-set from the student's own gender.
- Tutors who decline to state are included in unfiltered results and excluded only from an explicit gendered filter.
- Ranking **never** uses gender as a signal. It is a filter, not a score input.
- Gender is not exposed in the API except as a display field on the profile, and it is never used in any automated decision — approval, pricing, payouts, or ranking.

The policy is documented here rather than left implicit precisely because the boundary between "a filter that serves a real cultural need" and "a system that discriminates against tutors" lives in these details.

## 8.8 Zero-result handling

Never a dead end. In order:

1. Drop the availability filter → "No tutors free at 5 PM. **12 available at other times.**"
2. Widen area → "None in Bashundhara. **8 in nearby Badda and Rampura.**"
3. Widen price → "None under ৳500. **Lowest available is ৳650.**"
4. Switch to online → "**23 online tutors** teach this subject."
5. Adjacent subjects within the same grade and stream.
6. Last resort: capture demand. *"Notify me when a Class 9 Chemistry tutor joins in Bashundhara."*

Step 6 is not a consolation prize — it is a demand signal feeding directly into supply acquisition. The [admin console](12-admin-console.md#125-demand-gaps) surfaces unmet-demand clusters by `(subject, grade, area)`, which is how the supply team knows which neighbourhood to recruit in next. **Every failed search is market research.**

## 8.9 Performance

| Concern | Approach |
|---|---|
| Caching | Reference data 1 h at the CDN; result sets 60 s keyed on the normalised filter set; tutor profiles 60 s SSR with stale-while-revalidate |
| Availability | The coarse bitmap filters candidates; exact calendar checks run only on the top 20 |
| Pagination | Cursor-based, 20 per page, prefetch page 2 on idle |
| Images | AVIF/WebP, explicit dimensions, lazy below the fold |
| Payload | Search results return a lean projection — 14 fields, not the full profile |
| Mobile | Filters open in a bottom sheet, applied in one batch rather than one request per toggle |

Budget: p95 < 800 ms to first result paint on Dhaka 4G, cold cache.

## 8.10 Analytics

Every search logs `(normalised query, filters, result count, results shown, position clicked, booked?)` to an append-only events table. This drives:

- Zero-result rate by query — the top of the search-quality backlog
- Search → profile → booking funnel conversion at each step
- Position bias, used to calibrate exploration slots
- Unmet demand clusters for supply recruitment
- The golden query set, refreshed quarterly from real traffic

---

Next: [09 — Payments, Credits & Payouts](09-payments-credits.md)
