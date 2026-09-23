# groq-focused-v2-2026-09-23: live before

Measured 2026-09-23T04:53:25.002Z. Three-part identity: named phase, selected source/gold hashes and configuration SHA-256 `ed2325459633c4c4e6524dbdaad3722671e903ccbe6ffe3ac8e6d444ce54d8a3`. Code stable during run: true.

3 complete synthetic development originals; 18 logical items; 140 field assertions. Held-out reads/model calls: 0/0.

| Document | Result | Parser ms | Extraction ms |
|---|---|---:|---:|
| industrial-1 | partial | 1320 | 195099 |
| translation-2 | partial | 0 | 253309 |
| office-2 | partial | 224 | 253222 |

Complete 0/3; partial 3; rejected 0; unattempted 0. Complete means the application accepted coverage; accuracy is scored separately.

| Extraction measurement | Result |
|---|---|
| statedFieldAccuracy | 60.1% (83/138) |
| criticalFieldAccuracy | 59.7% (77/129) |
| annotatedMissingStateAccuracy | 0.0% (0/2) |
| lineItemPrecision | 100.0% (10/10) |
| lineItemRecall | 55.6% (10/18) |
| annotatedReviewSignalRecall | 0.0% (0/2) |
| sourceReferenceResolvability | 100.0% (86/86) |
| correctFieldLocationAgreement | 91.9% (79/86) |

Returned responses 12, without usage 2; known input/output tokens 38643/12530. Reserved attempt slots 12/12, estimated tokens 58648/90000. One attempt per dispatch with no automatic retry. Whole-phase estimated reservations are additionally charged to the shared UTC-day ledger; unknown usage is never refunded. Returned token totals exclude unavailable usage and are not measured billing or account-wide remaining quota.

- Development-only adaptive evidence; no held-out or general supplier-format accuracy claim.
- All complete selected documents are supplied; no cropped successful section is substituted for a quotation.
- Field metrics include partial accepted output. Rejected attempted documents earn zero credit; unattempted documents are counted separately. Zero source/precision denominators mean unavailable.
- Item alignment uses exact identifiers. Source reference resolvability and location agreement are narrower than independent semantic correctness.
- Matching and arithmetic are not remeasured by this extraction-only cohort. No model matching calls are made.
- A complete extraction status does not imply every field is correct or every review issue resolved. Inspect accuracy denominators and issues.
- Code/runtime drift during execution invalidates a paired causal comparison and is exposed explicitly.
- This executable imports no deployment client and makes no production writes. Its environment guard is defense in depth, not an audit of other simultaneously running processes.

[Machine-readable report](live-before.json). Existing public benchmark and latest reports are unchanged.

Extraction transport: `focused_fields_v1`. Chunk failure policy: `retain_valid_chunks_v1`. Retaining valid chunks measures partial availability; it does not imply complete extraction or improved model generation. Annotated matching missing states without source evidence: 0. Historical missing-state scoring is unchanged. A matching not-stated/not-applicable/ambiguous default without source evidence is not verified absence, especially after rejected sections. Inspect this diagnostic separately from accuracy.

Selected-annotation quality gate: 0/3 documents pass; 3 outputs audited. Separate selected-annotation quality gate; application complete/ready status and identifier-only row recall are insufficient. Rejected and unattempted documents do not pass and remain in the fixed quality denominators. Critical non-value states must agree without synthesizing absent containers; not_stated is absence of assertion, not verified absence. Source-linked non-value counts are separate diagnostics. No claim of unannotated semantic correctness or held-out reliability.
