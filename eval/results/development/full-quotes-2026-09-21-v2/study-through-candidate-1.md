# Development study through candidate 1

**No complete-document improvement was measured.** The original before and candidate 1 each rejected all three complete quotations. Each phase scored 0/138 stated fields, 0/129 critical fields and 0/18 line-item recall. No accepted document output means row precision and source-reference precision have zero denominators and are unavailable.

The cohort contains three distinct synthetic originals and 18 authored line items. Repeating it in two phases creates six document attempts, not six distinct documents. Accepted intermediate chunks do not count as complete quotations.

| Recorded run | Returned responses | Without usage | Known input tokens | Known output tokens | Complete documents |
|---|---:|---:|---:|---:|---|
| Interrupted harness preflight | 2 | 0 | 5,152 | 2,393 | Unfinished cohort; excluded |
| Original before | 4 | 0 | 10,173 | 4,903 | 0/3 |
| Candidate 1 | 5 | 1 | 10,621 | 5,752 | 0/3 |
| Total recorded usage | 11 | 1 | 25,946 | 13,048 | — |

Known tokens total **38,994**, excluding the one response without token usage. Summed returned-response time is **40,190 ms**; this excludes quota waiting and is not end-to-end latency. The provider invoice was not measured. Held-out and production model calls from this study: zero.

The [comparison](comparison.md) retains both failed phases. The [interrupted preflight](../full-quotes-2026-09-21/preflight-interrupted.md) remains separate. The [study ledger](study-through-candidate-1.json) records every source report's SHA-256, so later candidates can be added without replacing these historical measurements.
