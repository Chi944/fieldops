# Release work and complete-document investigation — 23 September 2026

## Scope recorded before model use

The user authorized completing the project, committing/pushing changes and resolving/merging its pull requests. The release remains an invited private pilot with a working parser/manual comparison path. Production AI remains disabled unless independent measurements justify a separately verified rollout. Free-service limits, private evidence and held-out separation remain requirements.

The previous typed contracts recovered less data than the validated-section baseline. Rejections repeatedly mixed item/charge object properties despite request-schema acceptance. This suggests a contract-complexity problem rather than missing retry logic. The next architectural experiment uses one uniform fact shape, with deterministic grouping into items, charges and commercial rules. It retains exact raw excerpts and parser-owned references; numeric/state/section constraints remain enforced by application code. It must not repair invalid responses, infer missing prices or turn omitted commercial rules into complete coverage.

One initial complete-cohort phase is predeclared: the original industrial-1 PDF, translation-2 text and office-2 CSV, the same model `openai/gpt-oss-120b`, maximum 24 reserved attempt slots, 170,000 estimated reserved tokens and 600,000 ms total quota waiting. A fresh experiment name and code/source/gold fingerprints preserve all previous failures. No held-out files are used for implementation or model calls. No provider key, plan or billing setting changes; no paid fallback. Before dispatch, an offline capture must show that every complete document is traversed within these limits.

Only a candidate that passes complete-document and evidence/annotation gates proceeds to broader frozen development validation. A failed candidate remains explicitly experimental, and the deployed manual path remains available. Passing automated tests is not a claim of reliable AI extraction.

The release verification includes independent code review, database concurrency/isolation and deterministic comparison tests, the production build, browser workflows, dependency audit, PR checks and a post-merge deployment smoke test. Existing personal data and the active port 3000 server are outside the test workspace. Merge only reviewed, verified changes; preserve measured experimental snapshots and disclose remaining release limitations.

## Post-hoc decoder probe declared during the frozen run

The first response passed the provider wire schema and ended normally, but the local decoder rejected root entity labels `supplier` and `quotation` because it expected `document`. The root section already defines the destination; this is application grouping bookkeeping, not a source value or citation. The live phase continues with its original frozen implementation and budget.

After that phase and its original audits finish, preserve its measured code in Git before changing the decoder. A narrowly bounded offline follow-up may accept either `document` or the exact matching section name for a root entity. Mixed aliases within one root, cross-section aliases and arbitrary identifiers still reject. Item identities, facts, raw excerpts, decimal values, citations, exclusions and missing-data states remain unchanged.

Replay only this phase's saved responses through the changed decoder and existing domain checks, with zero provider calls and separately named immutable artifacts. Never revive provider-schema failures, truncation, unavailable responses or operational failures. The original live result and usage journal stay intact. This is a post-hoc application-decoder experiment on development responses, not a fresh model result, held-out evaluation or evidence of generalization. No further live phase is authorized by this probe.

Readiness v4 separately replaces positional charge scoring with unique commercial-context and source-location alignment. Its strict gate cannot automatically verify source-free `not_stated` charge placeholders. Report that annotation/identity limitation independently of model failures; do not invent absence evidence or compare v4 gate scores directly with historical positional versions.

## Measured result

The frozen live implementation is preserved at **`92e786f`**. All 30 fingerprinted source blobs matched the staged Git snapshot before commit. Configuration stayed identical throughout the phase. [Original live report](../eval/results/development/full-quotes-2026-09-23-facts/live-after.json), [paired comparison with the original baseline](../eval/results/development/full-quotes-2026-09-23-facts/comparison.md), [separate decoder replay](../eval/results/development/full-quotes-2026-09-23-facts/fact-decoder-replay.json).

| Measurement | Original live fact decoder | Same responses, corrected decoder |
|---|---:|---:|
| Complete quotations | 0/3 | 0/3 |
| Partial / rejected quotations | 1 / 2 | 2 / 1 |
| Correct critical stated fields | 6/129 | 34/129 |
| Correct stated fields | 6/138 | 39/138 |
| Aligned expected items found | 1/18 | 5/18 |
| Aligned items / retained rows | 1/4 | 5/8 |
| Critical stated fields with matching source location | 6/129 | 30/129 |
| Fully correct, source-linked annotated items | 0/18 | 0/18 |
| Selected-annotation gate v4 | 0/3 | 0/3 |
| Validated sections | 2/11 | 5/11 |
| New provider dispatches | 11 | 0 |

This is an improvement in available validated data from a narrow application fix, **not reliable full-document extraction**. It also remains below the previous 21 September recovery result of 42/129 critical fields and 6/18 aligned items. Neither this transport nor the recovery policy becomes the application default; production stays parser-only.

The three complete originals contain 18 logical items, 140 field annotations, 138 stated values and two critical non-value states. Their bytes and gold hashes are unchanged. No held-out original or annotation was used. The fixtures are self-authored; no human verification or general supplier accuracy is claimed. Historical positional field metrics remain unchanged alongside the stricter v4 charge alignment. V4's inability to verify source-free missing-charge identities is an evaluation limitation, separate from the observed extraction failures.

## Diagnosed failure and fix

The homogeneous shape avoided nested item/charge property confusion, but it did not eliminate failures. The original offline rejection audit found nine rejected responses: four provider-schema rejections involving excluded source references, and five locally rejected, schema-valid responses. All nine contained syntactically valid JSON. [Sanitized original rejection audit](../eval/results/development/full-quotes-2026-09-23-facts/rejection-audit.json).

The first schema-valid response used the exact root section names as entity labels. It ended with `finishReason=stop` and 2,064 output tokens; there is no evidence of truncation in that response. The decoder unnecessarily required the label `document` even though the section already fixed the destination. The fix accepts either spelling only when it identifies the same root, with one consistent spelling per section. Cross-section aliases, arbitrary root IDs and mixed aliases still reject. Tests exercise all eight valid root combinations and confirm identical decoded data, unchanged inputs, and continuing rejection of fabricated excerpts or unsupported numbers. No prompt, schema, value, citation, source span or non-root identity changed.

The offline replay bound all 11 saved responses to exact original request hashes. Four provider-schema failures remained rejected without decoding. One local response still failed decoding and one failed domain evidence validation. It never selected a more favorable response, replaced an excerpt, removed an exclusion or overwrote a live checkpoint.

Both partial replay outputs preserve the complete original source arrays. **87/87 field references resolve**, with no unsourced stated field; this is reference integrity, not semantic entailment. Exact failed target sets remain unresolved. **All eight retained prices remain blocked, with zero cost recommendations** in the in-memory guard test. The narrower annotated-field metric has 35/40 correct-location agreements; resolving a source ID alone does not establish that it supports a claim. These distinctions explain why full extraction and the stricter gate still fail.

## Usage and release decision

The live phase took **652.6 seconds**, including **599.8 seconds of quota pacing**. Eleven dispatches reserved 22 attempt slots and 118,920 estimated tokens. Known returned usage was **9,827 input + 12,879 output = 22,706 tokens**; four responses lack usage. Provider invoice cost is unavailable. The offline replay has no fresh provider latency, token usage or cost measurement. No purchase, billing change, paid fallback, production key change or held-out model call occurred.

The release retains the working personal and invited parser/manual workflow. Reliable automatic full-document extraction remains a release blocker. Further work needs a separately declared development experiment, then independent validation on a frozen viable candidate; changing a run name or passing software tests does not establish model reliability.

## Second offline correction: stated tier intervals

The first replay and its exact implementation are preserved at **`36d405e`**, including the replay tool's recorded code hash. Read-only diagnosis then found a second application failure: an explicitly stated tier upper bound was rejected because the numeric evidence tokenizer read the hyphen in a range as a negative sign. The raw source clause contained the lower bound, upper bound and price. The model had supplied a complete same-item tier; its values had not been invented. This is distinct from the still-valid rejection of repeated/misplaced exclusion facts and omitted item identifiers.

Before measuring the next replay, restrict the fix to a decimal maximum-bound attribute of an explicitly supported complete tier. Accept only an exact unsigned interval, optionally followed by `at` and the stated unit price. Both endpoints, the optional price, the same-item tier and shared parser source must agree. Bounds must be nonnegative and ordered. Preserve the original raw clause and references; do not strip hyphens globally or change monetary validation. Dates, multiple ranges, unrelated attributes, different prices/endpoints or unrelated sources must not gain acceptance.

The explicit `tier-range` replay variant writes new immutable report/output paths and allows only the root decoder and this field-validation file to differ from the original live snapshot. It reuses the same saved responses, preserves provider failures, and makes zero model calls. The first live and root-only replay artifacts remain unchanged.

The second replay is now finalized. Its [sanitized JSON](../eval/results/development/full-quotes-2026-09-23-facts/fact-decoder-replay-tier-range.json) and [section summary](../eval/results/development/full-quotes-2026-09-23-facts/fact-decoder-replay-tier-range.md) retain the original live report as the before result. The table above remains the historical root-only replay; the following table records the additional tier-range correction on exactly the same saved responses.

| Measurement | Root-only replay | Root alias plus tier-range replay |
|---|---:|---:|
| Complete quotations | 0/3 | 0/3 |
| Partial / unavailable or rejected quotations | 2 / 1 | 3 / 0 |
| Correct critical stated fields | 34/129 | 47/129 |
| Correct stated fields | 39/138 | 55/138 |
| Aligned expected items found | 5/18 | 7/18 |
| Aligned items / retained rows | 5/8 | 7/10 |
| Critical stated fields with matching source location | 30/129 | 41/129 |
| Fully correct, source-linked annotated items | 0/18 | 0/18 |
| Selected-annotation gate v4 | 0/3 | 0/3 |
| Validated sections | 5/11 | 6/11 |
| New provider calls | 0 | 0 |

All 11 planned requests matched their saved response hashes. The industrial PDF retained 2/4 sections, translation text 3/4, and office CSV 1/3. Four original provider-schema failures stayed rejected without decoding, and one response still failed local decoding. No response was regenerated, repaired or selected from competing retries. This exceeds the earlier partial-field recovery of 42/129 critical fields, but **no quotation or annotated item is complete**. Aligned items use the identifier-based scoring rule; 7/18 is not a semantic matching benchmark.

All three outputs preserve their complete original source arrays. **117/117 field references resolve**, with zero unsourced stated fields. Exact failed target sets account for **42/99 source spans** and remain blocking. The audit forced approved singleton groups only in memory: **all 10 retained comparison rows were blocked and zero cost recommendations appeared**. This tests the coverage/evidence calculation guard, not cross-supplier recommendation quality.

Reference integrity remains distinct from supported interpretation. The selected-field metric reports **49/56 correct-location agreements**, and the fixed critical-field denominator gives **41/129 correct values with matching source locations**. Neither establishes semantic entailment of all supplier claims. Both critical non-value annotations remain unresolved (0/2); strict v4 charge identity does not invent evidence of absence.

The replay references original live report SHA-256 `5d3f3032525bf5f7496eab371c9d84c9cf35b3ecb9686403644e196ef239e2fd` and replay script SHA-256 `ef22202d288a6cd6b451c8217ba2c6351cba82df9b2e908d63a22854c28e7369`. Its only allowed runtime source differences are `fact-transport.ts` and `index.ts`; original prompt, schema and source request hashes still match. It adds **no fresh provider latency, tokens or invoice-cost measurement**. The original live usage remains 22,706 known tokens plus four responses with unavailable usage. Production AI stays disabled, and no held-out validation or broader reliability claim follows from this adaptive offline correction.
