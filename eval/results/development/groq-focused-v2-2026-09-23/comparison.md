# Complete quotation before/after comparison

groq-focused-v2-2026-09-23: 3 synthetic development quotations, 18 line items and 140 field assertions. Held-out calls: zero.

| Document | Before | After |
|---|---|---|
| industrial-1 | partial | partial |
| translation-2 | partial | partial |
| office-2 | partial | rejected: quota |

| Metric | Before | After | Change (percentage points) |
|---|---|---|---:|
| statedFieldAccuracy | 60.1% (83/138) | 42.8% (59/138) | -17.4 |
| criticalFieldAccuracy | 59.7% (77/129) | 41.9% (54/129) | -17.8 |
| annotatedMissingStateAccuracy | 0.0% (0/2) | 0.0% (0/2) | 0.0 |
| lineItemPrecision | 100.0% (10/10) | 100.0% (8/8) | 0.0 |
| lineItemRecall | 55.6% (10/18) | 44.4% (8/18) | -11.1 |
| annotatedReviewSignalRecall | 0.0% (0/2) | 0.0% (0/2) | 0.0 |
| sourceReferenceResolvability | 100.0% (86/86) | 100.0% (69/69) | 0.0 |
| correctFieldLocationAgreement | 91.9% (79/86) | 96.7% (59/61) | 4.9 |

Complete documents: 0/3 before, 0/3 after. Partial documents: 3 / 2; unattempted: 0 / 0.

| Returned usage | Before | After |
|---|---:|---:|
| Responses | 12 | 9 |
| Responses without usage | 2 | 1 |
| Known input tokens | 38643 | 6361 |
| Known output tokens | 12530 | 7170 |
| Phase elapsed ms, including pacing | 703197 | 592191 |

Before configuration: `ed2325459633c4c4e6524dbdaad3722671e903ccbe6ffe3ac8e6d444ce54d8a3`. After: `644f358e770d520dfef49503c61c8b3d71b7cdfa50123e46cd7c2f51482eae62`. Changed files: none.

- Adaptive development comparison of the same small synthetic cohort; no held-out measurement or causal guarantee.
- Pipeline, runtime, originals, annotations and phase budgets are identical. Model and explicitly recorded reasoning profile differ. Sequential phases may occur on separate UTC days; provider conditions are not controlled.
- This version gives rejected and unattempted documents zero recall credit in the full fixed cohort. It does not rewrite or directly equate historical metrics that omitted unattempted recall denominators.
- Document acceptance, partial output and correctness are separate. Rejected attempts retain zero recall credit; unattempted documents remain explicit.
- Precision/source denominators depend on returned output; unavailable denominators have no numeric improvement score.
- Elapsed time includes deliberate quota pacing and cannot establish production latency. Usage totals exclude unavailable response usage; no provider invoice is measured.
- The separate interrupted harness preflight is excluded from both phases and their metrics.

[Before](live-before.json) · [After](live-after.json) · [Comparison JSON](comparison.json).

Chunk failure policy: before `retain_valid_chunks_v1`, after `retain_valid_chunks_v1`. Any gain from retaining validated chunks is partial availability, not complete interpretation or better model generation. Matching missing states without source evidence: before 0, after 0. Unsourced defaults are not verified absence; historical scoring remains unchanged.
