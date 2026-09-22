# Complete quotation before/after comparison

full-quotes-2026-09-21-v2: 3 synthetic development quotations, 18 line items and 140 field assertions. Held-out calls: zero.

| Document | Before | After |
|---|---|---|
| industrial-1 | rejected: invalid_output | rejected: invalid_output |
| translation-2 | rejected: invalid_output | rejected: invalid_output |
| office-2 | rejected: invalid_evidence | rejected: invalid_evidence |

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
| Responses | 4 | 5 |
| Responses without usage | 0 | 1 |
| Known input tokens | 10173 | 10621 |
| Known output tokens | 4903 | 5752 |
| Phase elapsed ms, including pacing | 194524 | 259973 |

Before configuration: `ecad31806bbce4e4c9a0d3b5b361aa277d14a602590f12accc1ec0f94bfb5d62`. After: `fcf4f713a057e295100c5c90035ab0171958792ea71b27248b075620a57ea724`. Changed files: `package.json`, `src/lib/ai/groq.ts`, `src/lib/ai/transport.ts`, `src/lib/ai/chunks.ts`, `eval/development-control.ts`.

- Adaptive development comparison of the same small synthetic cohort; no held-out measurement or causal guarantee.
- Inspect all changed configuration files, including any harness changes, before attributing a difference to the model implementation.
- Document acceptance, partial output and correctness are separate. Rejected attempts retain zero recall credit; unattempted documents remain explicit.
- Precision/source denominators depend on returned output; unavailable denominators have no numeric improvement score.
- Elapsed time includes deliberate quota pacing and cannot establish production latency. Usage totals exclude unavailable response usage; no provider invoice is measured.
- The separate interrupted harness preflight is excluded from both phases and their metrics.

[Before](live-before.json) · [After](live-after.json) · [Comparison JSON](comparison.json).
