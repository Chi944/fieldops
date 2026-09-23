# Groq live validation — 23 September 2026

The user requested the frozen full-document run and production AI activation only if it works. This is the live execution of [protocol 2](groq-focused-study-v2-2026-09-23.md), using the existing dedicated Groq Free development configuration. No prompt, parser, schema, expected annotation or model profile changes are made between the two phases.

## Scope and decision boundary

- Three complete synthetic development originals: industrial PDF, translation text and office CSV; 18 expected items, 129 critical stated fields and 138 stated fields. All 99 parser source records remain in scope.
- GPT-OSS 120B/low first, then Qwen 3.8 27B/none/hidden through Groq, with the same source/code hashes, request caps and single-attempt policy.
- Admission verified a new UTC day with 180,000 tokens of local shared reservation allowance available, sufficient for both 90,000-token complete-phase reservations. This does not measure the provider's remaining account quota. Authenticated model discovery returned both configured models active without inference calls. Unknown consumption and failed requests are not refunded.
- No held-out inputs are read or used to tune prompts. Three adaptive development originals do not establish broad supplier-format, OCR, spreadsheet or matching reliability.

The production decision considers complete-document output, the existing selected-annotation readiness gate, original-source preservation, material values and unresolved evidence—not whether the API merely returned HTTP 200. Failed or incomplete documents stay in the fixed denominators. Valid sections do not substitute for a complete quotation.

Independent activation review also found that the hosted worker still uses legacy extraction with a different failure/retry policy. The tested focused transport, development outcome ledger and Qwen preview access are not automatically enabled by setting a production key. Any viable candidate would require explicit policy promotion, free-budget controls and hosted synthetic acceptance; the same configuration also affects AI matching, which this extraction-only run does not measure. Existing parser-only uploads must remain pinned to their original processing mode.

## Execution

Both phases finalized on 23 September 2026, between 04:41:41 and 05:03:43 UTC (12:41–13:03 Singapore). **Neither candidate passes: production AI remains disabled.** GPT-OSS returned three partial quotations; Qwen returned two partial quotations and stopped during the third with a quota error. No production setting has been changed.

The frozen code, originals, annotations, output caps and budgets are identical across the two phases; their model/reasoning profiles differ. The comparison helper verifies no implementation files changed. Qwen's quota-limited output is not evidence that its intrinsic accuracy is lower: the missing final quotation receives zero recall credit in the fixed cohort. This is an operational model-profile comparison, not a causal ranking or an implementation before/after improvement claim. Quota-limited execution and changing output denominators prevent these deltas from ranking model quality, cost or speed.

| Measurement | GPT-OSS 120B, low | Qwen 3.8 27B, none/hidden |
| --- | ---: | ---: |
| Complete quotations | 0/3 | 0/3 |
| Partial / rejected quotations | 3 / 0 | 2 / 1 (quota) |
| Critical stated fields | 77/129 (59.7%) | 54/129 (41.9%) |
| All stated fields | 83/138 (60.1%) | 59/138 (42.8%) |
| Identifier-aligned items | 10/18 (55.6%) | 8/18 (44.4%) |
| Strict selected-annotation/source-location item gate | 8/18 | 2/18 |
| Selected-field reference resolvability | 86/86 | 69/69 |
| Correct value and annotated location agreement | 79/86 | 59/61 |
| Selected-annotation document readiness | 0/3 | 0/3 |
| Dispatched requests / planned requests | 12/12 | 10/12 |
| Returned responses | 12 | 9 |
| Rejected responses / operational failures | 4 / 0 | 2 / 1 |
| Responses with unavailable usage | 2 | 1, plus the operational failure |
| Known input + output tokens | 38,643 + 12,530 = 51,173 | 6,361 + 7,170 = 13,531 |
| Conservative per-request accounting floor | 61,058 | 48,394 |
| Retained complete-phase reservation | 90,000 | 90,000 |
| Elapsed time, including deliberate pacing | 703.2 s | 592.2 s |
| Quota pacing within elapsed time | 659.7 s | 572.5 s |
| Provider invoice cost | Unmeasured | Unmeasured |

The [immutable comparison](../eval/results/development/groq-focused-v2-2026-09-23/comparison.json) and [readable comparison](../eval/results/development/groq-focused-v2-2026-09-23/comparison.md) preserve exact counts and configuration hashes. Source and precision denominators depend on returned output; their percentages cannot establish general semantic correctness. Neither phase made matching-model calls or tested additional formats. Both full-phase reservations remain charged to the local shared allowance after completion; no quota refund or extra attempt was made.

GPT-OSS finished all 12 planned single-attempt requests on the frozen code. Its finalized result is **0/3 complete, 3 partial; 77/129 critical fields, 83/138 stated fields, 10/18 identifier-aligned items and 8/18 items passing the strict selected-annotation/source-location gate**. Neither of the two annotated non-value states received credit under the frozen alignment metric. The [immutable report](../eval/results/development/groq-focused-v2-2026-09-23/live-before.json) and [focused audit](../eval/results/development/groq-focused-v2-2026-09-23/focused-task-audit-before.json) preserve that result. All source arrays match their originals, all 134 field references resolve, and all ten retained price rows remain blocked with no cost recommendation. Reference resolution does not establish semantic correctness.

The phase took 703.2 seconds, including 659.7 seconds of quota pacing. Ten responses reported usage: 38,643 input plus 12,530 output tokens (51,173 known); two responses had unavailable usage. The per-request accounting floor is 61,058 tokens, and the full 90,000-token phase reservation remains charged. Provider invoice cost is not measured. These figures are not representative production latency or a refund of unknown consumption.

Independent inspection of the first saved GPT-OSS rejection found a genuine structured-output failure: nine array properties were emitted as objects containing an `items` array. The provider rejected the response with `json_validate_failed`; the saved generation is parseable JSON, with no truncation indicator, but it does not match the required schema. The failure occurred before domain/evidence validation, and provider usage was unavailable. No wrapper was repaired or silently unwrapped, and the reserved consumption remains accounted for.

The complete rejection review found two such provider failures (industrial section 1 and office section 1), a duplicate core `scope` key in translation section 1, and a unit-bearing `minimumOrder` value where a decimal was required in office section 2. The latter two returned normally but failed the typed adapter. No failure indicates token truncation. Eight validated tasks remain available; four failed tasks leave 25 of 99 target records explicitly unresolved. The stated-value misses comprise 52 missing item fields from eight lost rows, plus three supplier-name omissions or truncations.

Qwen's [immutable report](../eval/results/development/groq-focused-v2-2026-09-23/live-after.json) and [source/coverage audit](../eval/results/development/groq-focused-v2-2026-09-23/focused-task-audit-after.json) retain two partial quotations with eight items. All 72 source records in those returned quotations match their originals, all 131 field references resolve, and all eight retained price rows remain blocked with zero cost recommendations. Office has no finalized quotation: one returned task remains in its private checkpoint, but it is not silently scored as a complete or partial document. Source-retention and cost checks for that unavailable output are explicitly unavailable.

The two Qwen interpretation failures differ from GPT-OSS: industrial section 1 contains noncanonical decimal strings in optional `packageSize` and `orderIncrement` fields; translation section 2 omits required core fields, an entire caller-assigned item slot and the uncertainty list. The former passes the focused wire schema but fails its typed adapter; the latter is rejected by the provider schema. Neither provides evidence of a token-length stop. No rejected reply was repaired, replayed or retried during this study.

The settled office failure records `quota` and a 60,000 ms retry interval, but no HTTP status, provider error text or quota dimension. The frozen control flow and recorded reservations rule out the local request/phase limits, making the request adapter's HTTP 429 branch the supported inference. The retained evidence cannot distinguish provider requests-per-day, tokens-per-day or another limit, or establish whether the interval came from a header or the default. This was an operational quota abort, not a model-quality rejection. The saved successful office task is preserved privately; no extra attempt or quota reset was used to complete it.

### Scoring qualifications from independent source inspection

The office quotation's four apparent location mismatches use valid alternate cells: identifiers in C7/C8 rather than the annotation's B7/B8 narrative cells, and explicit currencies in B7/B8 rather than only the B2 header. Direct CSV parsing confirms the cited cells support these values. The frozen 8/18 selected-location item gate is retained unchanged, but it must not be presented as proof that those two retained items lack supporting evidence. All 10 retained items align by identifier; lost rows still make the phase fail.

Qwen's 2/18 strict item gate has a substantive additional cause: all six retained service rows omit the core billing basis. That is material to comparing hourly, fixed-scope and recurring services. Its industrial supplier name is truncated, while its translation supplier name is correct. The output's resolvable citations do not make these missing or incomplete values correct.

The legacy missing-state metric also retains positional charge limitations. A tax charge can occupy array index 0 where gold places a missing-shipping placeholder. Its 0/2 result must not be described as invented shipping. The separate charge-kind-aware gate leaves absent shipping unresolved without fabricating charge containers or citations. These limitations are disclosed rather than changing annotations or scores after seeing model output.

## Activation decision and next engineering work

**Keep production `FIELDOPS_PROCESSING_MODE=parse_only`.** Neither candidate meets the complete-document boundary; GPT-OSS also misses the planned 90% critical-field accuracy and item-recall targets. Qwen's quota halt prevents a full generation comparison, and its two returned quotations already fail readiness. Passing reference-resolution checks does not overcome missing items or incorrect values.

The next development candidate should address the observed wire/domain mismatches generically: make optional numeric contracts explicit, distinguish supported decimals from unit-bearing ambiguity, and prevent duplicate core keys. Service billing basis must remain an explicit source-backed requirement, with missing values blocking equivalence. Provider array/required-field failures need a bounded, measurable transport change rather than silent JSON repair. Any decoder conversion must preserve original raw text and verify its source. Re-run a newly named, predeclared development study after those changes; preserve this failed pair and do not tune on held-out fixtures. Model switching alone did not establish a viable release candidate here.

Before production activation, promote the exact successfully tested extraction policy into the worker, add persistent shared free-budget admission, and keep unmeasured AI matching disabled or validate it separately. Then verify the hosted synthetic workflow, stale-result/correction fences and the documented independent acceptance gates. The existing parser/manual pilot remains usable throughout.

## Verification and reproduction

This run uses frozen implementation `6aecd4281abad3762f42fbae9052d926f676021a`, merged in PR #3. Its previously recorded verification is **577 passing tests and 10 isolated browser workflows**, plus TypeScript, lint, build and clean Linux CI. This publication changes only documentation and measured result artifacts; it does not claim those suites were rerun during inference. Fresh verification here consists of both finalized live phases, their read-only source/coverage/score audits, configuration equality checks and the immutable comparison. All 11 private environment-file hashes remained unchanged at the 05:01 UTC check; production returned `cloud`, `parse_only`, `canExtract=false`.

Use the commands and fixed limits in the [frozen protocol](groq-focused-study-v2-2026-09-23.md). Existing report paths are immutable; do not overwrite them or clear the shared allowance to repeat inference. The audit and comparison commands used after finalization were:

```powershell
npx tsx scripts/audit-focused-development.ts --name groq-focused-v2-2026-09-23 --phase before
npx tsx scripts/audit-focused-development.ts --name groq-focused-v2-2026-09-23 --phase after
npx tsx scripts/compare-development.ts --name groq-focused-v2-2026-09-23
```

Audits require the operator's original private response/output checkpoints; sanitized public results alone cannot reconstruct raw supplier interpretations. Credentials and raw replies are gitignored. No held-out original was read, no production AI was enabled, and no purchase, billing change or paid fallback occurred. Free quotas remain finite; known token counts are not a provider invoice or a statement of remaining account quota.
