# full-quotes-2026-09-22-typed-compatible: live after

Measured 2026-09-21T16:44:35.100Z. Three-part identity: named phase, selected source/gold hashes and configuration SHA-256 `a84b5f91a643a2cf202fbc9bcc5f9b0085d005fa5e8a668aa67c318c9e53697c`. Code stable during run: true.

3 complete synthetic development originals; 18 logical items; 140 field assertions. Held-out reads/model calls: 0/0.

| Document | Result | Parser ms | Extraction ms |
|---|---|---:|---:|
| industrial-1 | rejected: model_error | 776 | 291 |
| translation-2 | rejected: model_error | 0 | 60189 |
| office-2 | rejected: model_error | 24 | 60151 |

Complete 0/3; partial 0; rejected 3; unattempted 0. Complete means the application accepted coverage; accuracy is scored separately.

| Extraction measurement | Result |
|---|---|
| statedFieldAccuracy | 0.0% (0/138) |
| criticalFieldAccuracy | 0.0% (0/129) |
| annotatedMissingStateAccuracy | 0.0% (0/2) |
| lineItemPrecision | unavailable (0/0) |
| lineItemRecall | 0.0% (0/18) |
| annotatedReviewSignalRecall | 0.0% (0/2) |
| sourceReferenceResolvability | unavailable (0/0) |
| correctFieldLocationAgreement | unavailable (0/0) |

Returned responses 0, without usage 0; known input/output tokens 0/0. Reserved attempt slots 6/24, estimated tokens 42398/170000. Durable reservations are conservative attempt counts and heuristic token estimates, not measured billing or a hard tokenizer bound. Two attempt slots cover one possible internal transient retry. Returned token totals exclude explicitly unavailable usage; transport failures can have unreported usage. A reservation survives interruption, including dispatches whose outcome is unknown.

- Development-only adaptive evidence; no held-out or general supplier-format accuracy claim.
- All complete selected documents are supplied; no cropped successful section is substituted for a quotation.
- Field metrics include partial accepted output. Rejected attempted documents earn zero credit; unattempted documents are counted separately. Zero source/precision denominators mean unavailable.
- Item alignment uses exact identifiers. Source reference resolvability and location agreement are narrower than independent semantic correctness.
- Matching and arithmetic are not remeasured by this extraction-only cohort. No model matching calls are made.
- A complete extraction status does not imply every field is correct or every review issue resolved. Inspect accuracy denominators and issues.
- Code/runtime drift during execution invalidates a paired causal comparison and is exposed explicitly.
- This executable imports no deployment client and makes no production writes. Its environment guard is defense in depth, not an audit of other simultaneously running processes.

[Machine-readable report](live-after.json). Existing public benchmark and latest reports are unchanged.

Extraction transport: `typed_fields_v1`. Chunk failure policy: `retain_valid_chunks_v1`. Retaining valid chunks measures partial availability; it does not imply complete extraction or improved model generation. Annotated matching missing states without source evidence: 0. Historical missing-state scoring is unchanged. A matching not-stated/not-applicable/ambiguous default without source evidence is not verified absence, especially after rejected sections. Inspect this diagnostic separately from accuracy.

Selected-annotation quality gate: 0/3 documents pass; 0 outputs audited. Separate selected-annotation quality gate; application complete/ready status and identifier-only row recall are insufficient. Rejected and unattempted documents do not pass and remain in the fixed quality denominators. Critical non-value states must agree without synthesizing absent containers; not_stated is absence of assertion, not verified absence. Source-linked non-value counts are separate diagnostics. No claim of unannotated semantic correctness or held-out reliability.

Original baseline: [full-quotes-2026-09-21-v2](../full-quotes-2026-09-21-v2/live-before.json), measured 2026-09-21T15:05:39.146Z; report SHA-256 `f1f383809cf3ba9503ac659bfc8af5e687fc209506b59728b35c9ee6aedbe70a`. The baseline was referenced without rerunning or copying it.
