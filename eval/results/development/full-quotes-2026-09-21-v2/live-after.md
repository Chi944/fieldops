# full-quotes-2026-09-21-v2: live after

Measured 2026-09-21T15:13:39.235Z. Three-part identity: named phase, selected source/gold hashes and configuration SHA-256 `fcf4f713a057e295100c5c90035ab0171958792ea71b27248b075620a57ea724`. Code stable during run: true.

3 complete synthetic development originals; 18 logical items; 140 field assertions. Held-out reads/model calls: 0/0.

| Document | Result | Parser ms | Extraction ms |
|---|---|---:|---:|
| industrial-1 | rejected: invalid_output | 883 | 68402 |
| translation-2 | rejected: invalid_output | 1 | 127234 |
| office-2 | rejected: invalid_evidence | 22 | 63416 |

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

Returned responses 5, without usage 1; known input/output tokens 10621/5752. Reserved attempt slots 10/24, estimated tokens 70348/170000. Durable reservations are conservative attempt counts and heuristic token estimates, not measured billing or a hard tokenizer bound. Two attempt slots cover one possible internal transient retry. Returned token totals exclude explicitly unavailable usage; transport failures can have unreported usage. A reservation survives interruption, including dispatches whose outcome is unknown.

- Development-only adaptive evidence; no held-out or general supplier-format accuracy claim.
- All complete selected documents are supplied; no cropped successful section is substituted for a quotation.
- Field metrics include partial accepted output. Rejected attempted documents earn zero credit; unattempted documents are counted separately. Zero source/precision denominators mean unavailable.
- Item alignment uses exact identifiers. Source reference resolvability and location agreement are narrower than independent semantic correctness.
- Matching and arithmetic are not remeasured by this extraction-only cohort. No model matching calls are made.
- A complete extraction status does not imply every field is correct or every review issue resolved. Inspect accuracy denominators and issues.
- Code/runtime drift during execution invalidates a paired causal comparison and is exposed explicitly.
- This executable imports no deployment client and makes no production writes. Its environment guard is defense in depth, not an audit of other simultaneously running processes.

[Machine-readable report](live-after.json). Existing public benchmark and latest reports are unchanged.
