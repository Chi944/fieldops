# Complete quotation before/after comparison

full-quotes-2026-09-21-grounded: 3 synthetic development quotations, 18 line items and 140 field assertions. Held-out calls: zero.

| Document | Before | After |
|---|---|---|
| industrial-1 | rejected: invalid_output | rejected: invalid_output |
| translation-2 | rejected: invalid_output | rejected: invalid_output |
| office-2 | rejected: invalid_evidence | rejected: invalid_output |

| Metric | Before | After | Change (percentage points) |
|---|---|---|---:|
| statedFieldAccuracy | 0.0% (0/138) | 0.0% (0/138) | 0.0 |
| criticalFieldAccuracy | 0.0% (0/129) | 0.0% (0/129) | 0.0 |
| annotatedMissingStateAccuracy | 0.0% (0/2) | 0.0% (0/2) | 0.0 |
| lineItemPrecision | unavailable (0/0) | unavailable (0/0) | unavailable |
| lineItemRecall | 0.0% (0/18) | 0.0% (0/18) | 0.0 |
| annotatedReviewSignalRecall | 0.0% (0/2) | 0.0% (0/2) | 0.0 |
| sourceReferenceResolvability | unavailable (0/0) | unavailable (0/0) | unavailable |
| correctFieldLocationAgreement | unavailable (0/0) | unavailable (0/0) | unavailable |

Complete documents: 0/3 before, 0/3 after. Partial documents: 0 / 0; unattempted: 0 / 0.

| Returned usage | Before | After |
|---|---:|---:|
| Responses | 4 | 6 |
| Responses without usage | 0 | 0 |
| Known input tokens | 10173 | 15824 |
| Known output tokens | 4903 | 8075 |
| Phase elapsed ms, including pacing | 194524 | 323710 |

Before configuration: `ecad31806bbce4e4c9a0d3b5b361aa277d14a602590f12accc1ec0f94bfb5d62`. After: `c66c280a9d1ab73231bce4a67660ea1e43f6ec8d3efd6e75ef69e3a1498025a6`. Changed files: `package.json`, `src/lib/ai/index.ts`, `src/lib/ai/schema.ts`, `src/lib/ai/groq.ts`, `src/lib/ai/transport.ts`, `src/lib/ai/chunks.ts`, `eval/development-control.ts`, `scripts/evaluate-development.ts`.

- Adaptive development comparison of the same small synthetic cohort; no held-out measurement or causal guarantee.
- Inspect all changed configuration files, including any harness changes, before attributing a difference to the model implementation.
- Document acceptance, partial output and correctness are separate. Rejected attempts retain zero recall credit; unattempted documents remain explicit.
- Precision/source denominators depend on returned output; unavailable denominators have no numeric improvement score.
- Elapsed time includes deliberate quota pacing and cannot establish production latency. Usage totals exclude unavailable response usage; no provider invoice is measured.
- The separate interrupted harness preflight is excluded from both phases and their metrics.

[Original before: full-quotes-2026-09-21-v2](../full-quotes-2026-09-21-v2/live-before.json) · [After](live-after.json) · [Comparison JSON](comparison.json).

The baseline was originally measured 2026-09-21T15:05:39.146Z and referenced by SHA-256 `f1f383809cf3ba9503ac659bfc8af5e687fc209506b59728b35c9ee6aedbe70a`; no baseline rerun or copy was made. Earlier candidates retain their original reports.
