# full-quotes-2026-09-21-availability: live after

Measured 2026-09-21T15:54:23.712Z. Three-part identity: named phase, selected source/gold hashes and configuration SHA-256 `b5448cc538925c184d12991c31eff9d51cce0fb2b4293d846c34028b2831f203`. Code stable during run: true.

3 complete synthetic development originals; 18 logical items; 140 field assertions. Held-out reads/model calls: 0/0.

| Document | Result | Parser ms | Extraction ms |
|---|---|---:|---:|
| industrial-1 | partial | 881 | 194938 |
| translation-2 | partial | 1 | 249781 |
| office-2 | rejected: invalid_output | 14 | 190638 |

Complete 0/3; partial 2; rejected 1; unattempted 0. Complete means the application accepted coverage; accuracy is scored separately.

| Extraction measurement | Result |
|---|---|
| statedFieldAccuracy | 34.8% (48/138) |
| criticalFieldAccuracy | 32.6% (42/129) |
| annotatedMissingStateAccuracy | 0.0% (0/2) |
| lineItemPrecision | 100.0% (6/6) |
| lineItemRecall | 33.3% (6/18) |
| annotatedReviewSignalRecall | 0.0% (0/2) |
| sourceReferenceResolvability | 100.0% (48/48) |
| correctFieldLocationAgreement | 100.0% (48/48) |

Returned responses 11, without usage 2; known input/output tokens 23114/9613. Reserved attempt slots 22/24, estimated tokens 153906/170000. Durable reservations are conservative attempt counts and heuristic token estimates, not measured billing or a hard tokenizer bound. Two attempt slots cover one possible internal transient retry. Returned token totals exclude explicitly unavailable usage; transport failures can have unreported usage. A reservation survives interruption, including dispatches whose outcome is unknown.

- Development-only adaptive evidence; no held-out or general supplier-format accuracy claim.
- All complete selected documents are supplied; no cropped successful section is substituted for a quotation.
- Field metrics include partial accepted output. Rejected attempted documents earn zero credit; unattempted documents are counted separately. Zero source/precision denominators mean unavailable.
- Item alignment uses exact identifiers. Source reference resolvability and location agreement are narrower than independent semantic correctness.
- Matching and arithmetic are not remeasured by this extraction-only cohort. No model matching calls are made.
- A complete extraction status does not imply every field is correct or every review issue resolved. Inspect accuracy denominators and issues.
- Code/runtime drift during execution invalidates a paired causal comparison and is exposed explicitly.
- This executable imports no deployment client and makes no production writes. Its environment guard is defense in depth, not an audit of other simultaneously running processes.

[Machine-readable report](live-after.json). Existing public benchmark and latest reports are unchanged.

Chunk failure policy: `retain_valid_chunks_v1`. Retaining valid chunks measures partial availability; it does not imply complete extraction or improved model generation. Annotated matching missing states without source evidence: 0. Historical missing-state scoring is unchanged. A matching not-stated/not-applicable/ambiguous default without source evidence is not verified absence, especially after rejected sections. Inspect this diagnostic separately from accuracy.

Original baseline: [full-quotes-2026-09-21-v2](../full-quotes-2026-09-21-v2/live-before.json), measured 2026-09-21T15:05:39.146Z; report SHA-256 `f1f383809cf3ba9503ac659bfc8af5e687fc209506b59728b35c9ee6aedbe70a`. The baseline was referenced without rerunning or copying it.
