# Complete-quotation development study — 21 September 2026

**Development-only section recovery made validated data available, but complete-document extraction remains unreliable.** The original baseline returned no quotation data. The final opt-in candidate returned two partial quotations containing six correct identified items and 42 of 129 expected critical fields. The third quotation was still rejected. **Complete quotations remained 0/3. Production AI stays disabled.**

| Fixed three-document cohort | Complete | Partial | Rejected | Critical fields correct | Item recall |
|---|---:|---:|---:|---:|---:|
| Original implementation | 0/3 | 0 | 3 | 0/129 | 0/18 |
| Candidate 1: chunk boundaries and contract clarification | 0/3 | 0 | 3 | 0/129 | 0/18 |
| Candidate 2: explicit incomplete-coverage recovery | 0/3 | 0 | 3 | 0/129 | 0/18 |
| Candidate 3: opt-in rejected-section isolation | 0/3 | 2 | 1 | 42/129 (32.6%) | 6/18 (33.3%) |

The final [before/after comparison](../eval/results/development/full-quotes-2026-09-21-availability/comparison.md) preserves the original baseline by SHA-256 reference. All three source parsers completed in every formal phase; no document was unattempted. This is an availability improvement under unchanged evidence checks, not evidence that model generation became more accurate. It remains far below the release's 90% critical-field target.

## Predeclared protocol

- Paired cohort, selected before any new model response: `industrial-1` (two-page text PDF, goods and services), `translation-2` (service quotation text), `office-2` (CSV goods and services). Three complete synthetic quotations, six expected items each.
- Use only separate development gold and exact SHA-256-checked originals under `eval/originals/dev`. Do not open held-out quotation content, regenerate originals, or use gold values in requests.
- Keep the model fixed at `openai/gpt-oss-120b`, temperature zero, low reasoning effort and the existing strict-output/evidence checks. Any change to this protocol requires explicit disclosure.
- Run the unchanged extraction code first. Record each document, returned response, validation failure, source coverage, field/item denominators, latency, reported usage and unknown usage separately. A valid intermediate chunk is not a completed quotation.
- Identical per-phase ceilings: 24 possible HTTP-attempt slots and 170,000 conservatively estimated reserved tokens. The adapter can retry a transient failure once, so each dispatch reserves two slots and twice its input/output estimate. Semantic failures do not retry automatically.
- Quota pauses retain checkpoints and reservations; final reports are immutable. Keep failed response bodies in ignored local files and publish only synthetic aggregate metrics and sanitized failure categories.
- Diagnose from actual responses and parser boundaries. Keep only changes that preserve supplier values, parser-owned references, unknown states and existing arithmetic/coverage checks; validate each change with a regression test and a paired after run.
- Production deployment, worker and environment configuration will not be changed by the evaluation. Compare public processing status and private configuration hashes before and after.

## Initial evidence

The hosted status returned HTTP 200, cloud mode, `processingMode=parse_only` and `canExtract=false`. Vercel production deployment is `dpl_5zFn3crD9Ro7u6dftUAeYyr4v1nC`. Local production configuration hashes are stored privately for a later equality check; no credential values are published.

Before changes, offline parsing produced four, three and three extraction chunks for the respective cohort documents. The original text chunker placed the third translation item's minimum-order continuation at the beginning of the next chunk, apart from its priced item. This observed boundary defect motivated the first candidate; its measured outcomes follow below.

## Original baseline and failed first candidate

The original baseline and candidate 1 each rejected all three complete quotations: **0/3 complete, 0 partial, 3 rejected**. Both received zero availability-adjusted credit for the 138 stated fields, 129 critical fields and 18 expected items. Precision and source-location metrics have no accepted-output denominator; they are unavailable, not measured zero accuracy. The unchanged [before report](../eval/results/development/full-quotes-2026-09-21-v2/live-before.json), [candidate 1 report](../eval/results/development/full-quotes-2026-09-21-v2/live-after.json) and [comparison](../eval/results/development/full-quotes-2026-09-21-v2/comparison.md) retain these failures.

Observed causes are distinct:

1. The PDF model response classified an earlier page's currency context as an excluded target. The runtime correctly rejected that target/context contradiction. Its public error incorrectly described every normalization failure as a foreign reference; the new diagnostics preserve the actual sanitized error category.
2. The translation response omitted coverage explanations for two known source records. The first candidate corrected a real chunk boundary that separated an item's minimum-order continuation, but still did not complete the quotation. Its second response failed the provider's JSON validation; the privately retained generation is syntactically malformed. There is no returned finish reason proving output-token exhaustion, so that cause remains unknown.
3. The CSV response supplied an identifier excerpt with an added `ID ` label, although the cited cell contained only the identifier. The value and cell selection do not authorize fabricating a literal excerpt. The evidence validator continues to reject it.

Candidate 1 constrained excluded source IDs to actual targets and clarified the existing wire contract. This removed the observed context-exclusion pattern in that PDF response, but the response instead left two target records unaccounted for. **No complete-document improvement was measured.** The experiment does not establish a causal effect from one stochastic response per phase.

[Groq's structured-output documentation](https://console.groq.com/docs/structured-outputs) lists strict JSON Schema support for this model. That describes the expected API contract; it does not overturn the observed rejected response. Schema conformance, source support and full-document completeness require separate checks.

The interrupted harness preflight is [reported separately](../eval/results/development/full-quotes-2026-09-21/preflight-interrupted.md). It exposed pacing from reservation rather than response settlement; the runner now waits after settlement and has a startup-delay regression. Its two responses are included in the [study usage ledger](../eval/results/development/full-quotes-2026-09-21-v2/study-through-candidate-1.md), but excluded from paired field metrics.

## Predeclared second candidate

The second candidate changed known-source coverage recovery only. It permits retaining independently validated fields when a model omits or contradicts a coverage explanation, while preserving source-linked unresolved interpretation issues and a **partial** quotation status. Unknown references, unsupported values, invalid literal excerpts and malformed JSON remain hard failures. It does not implement a parser-context replacement for model excerpts, and did not change prompt wording further.

The experiment name `full-quotes-2026-09-21-grounded` is an identifier, not a grounding-quality claim. Its after phase references the original before report by hash instead of rerunning or copying that baseline. The same three originals, model and ceilings apply. A partial result cannot count as complete, and unresolved interpretation coverage must block price recommendations and remain in exports.

The second candidate also produced **0/3 complete, 0 partial and 3 rejected** quotations. Its [immutable comparison](../eval/results/development/full-quotes-2026-09-21-grounded/comparison.md) retains the result. All three second-section responses placed unit text inside a minimum-order value where a precise decimal string was required. A local PDF replay reproduced that validation error without an additional model call. Coverage recovery alone does not solve the complete-document failure.

## Final bounded availability experiment

The final candidate, `full-quotes-2026-09-21-availability`, tested section failure isolation rather than another prompt. The same three full originals, original before reference, model and per-phase ceilings applied. No further live candidate was run in this investigation.

The explicit development-only `retain_valid_chunks_v1` option preserves only atomically validated sections. A schema/evidence-rejected section contributes no fields; every target in it receives an unresolved, source-linked interpretation issue. Remaining planned sections are attempted within the unchanged budget. Cancellation, quota, timeout, configuration, storage and other operational failures still stop processing. The existing application default continues to reject the document after a rejected section.

Any recovered document is partial and ineligible for automatic price recommendations while issues remain. Blanks in rejected sections are **unconfirmed**, not evidence that a supplier omitted a term. Complete-document and partial-availability metrics remain separate; source-reference resolvability does not establish semantic support. The independent evaluation journal includes rejected responses and unknown usage, while a returned partial quotation's own usage must explicitly identify incomplete accounting.

| Final document outcome | Validated / planned sections | Retained items | Critical fields | Failed source records flagged |
|---|---:|---:|---:|---:|
| Industrial text PDF — partial | 2/4 | 4/6 | 27/43 | 21/40 |
| Translation text — partial | 2/4 | 2/6 | 15/45 | 13/32 |
| Office CSV — rejected | No retained output; 3 responses rejected | 0/6 | 0/41 | No returned quotation to audit |

The [source audit](../eval/results/development/full-quotes-2026-09-21-availability/section-audit.md) verified identical source arrays for both returned quotations, exact failed-section target sets and 68/68 resolvable references across their fields. All six retained rows explicitly hit the existing coverage-review cost gate; no cost recommendation was produced. The CSV's original is still available, but its rejected responses were not converted into a usable quotation. Its section attribution is left unavailable instead of inferred from response counts.

Across all three attempted quotations, stated-field accuracy was **48/138 (34.8%)**, critical-field accuracy **42/129 (32.6%)**, identified-item precision **6/6**, and recall **6/18**. The 48 scored field references resolved and agreed with their gold locations. That location check applies only to returned annotated fields; it is not a semantic audit of all possible claims. Both annotated missing-state and review-signal scores were **0/2**. No matching unsourced default received missing-state credit in this final run.

All 11 planned requests ran; four sections validated and seven responses were rejected. The phase used 22/24 reserved attempt slots and 153,906/170,000 estimated reserved tokens. No quota or admission halt occurred. Its measured duration was **636.3 seconds**, including **599.8 seconds of deliberate quota pacing**; summed returned-response time was **35.1 seconds**. Known input/output usage was **23,114 / 9,613 tokens**, with two responses lacking usage. [Exact measurements and fingerprint](../eval/results/development/full-quotes-2026-09-21-availability/live-after.json) retain all denominators and unknowns.

## Study usage and production isolation

| Run | Returned responses | Responses without usage | Known input tokens | Known output tokens |
|---|---:|---:|---:|---:|
| Interrupted preflight, excluded from field comparison | 2 | 0 | 5,152 | 2,393 |
| Original baseline | 4 | 0 | 10,173 | 4,903 |
| Candidate 1 | 5 | 1 | 10,621 | 5,752 |
| Candidate 2 | 6 | 0 | 15,824 | 8,075 |
| Candidate 3 | 11 | 2 | 23,114 | 9,613 |
| Entire investigation | **28** | **3** | **64,884** | **30,736** |

Known usage totals **95,620 tokens**, excluding three responses without usage. The four formal phases represent 12 document attempts over **three distinct originals**. No provider invoice was measured. The configured account remained Free; no paid fallback, purchase, provisioning or billing change was made.

The [read-only isolation check](../eval/results/development/full-quotes-2026-09-21-availability/production-isolation.json) confirmed unchanged local production/worker configuration files and hosted HTTP 200 status with `processingMode=parse_only`, `canExtract=false`. Production `main` remained `660382b`. Results and code are prepared on a separate review branch; no production worker or AI integration was enabled by this study.

## Verification and interpretation

The final candidate passed **354 tests across 44 files**, including six real PostgreSQL concurrency tests, in 41.76 seconds. TypeScript, ESLint, the Next.js production build and the runtime dependency audit passed. All **10 browser workflows passed in 50.6 seconds** against an isolated local production build with AI disabled. Those browser checks establish workflow regression coverage, not live AI correctness.

The new section-isolation regressions exercise valid → rejected → valid sections, tentative-field rollback, source-linked export warnings, blocked price ranking, operational-error propagation, cancellation during journaling, checkpoint separation and missing usage. Existing raw excerpt, numeric, currency, tax and malformed-response checks remain active. A response-validation marker carries only usage metadata; storage failures cannot obtain partial-recovery behavior merely by sharing an error code.

The [independent gold audit](../eval/results/development/gold-audits/2026-09-21T15-26-06-190Z.json) matched 18 quantities, 18 unit prices, three stated minimum orders and 15 absent minimum orders against the three originals. It uses separate label-based logic but shares PDF.js/csv-parse libraries with the application. It is **not human verification** or a full semantic review of all gold fields. Reproduce it without a model:

```powershell
npx tsx scripts/check-development-gold.ts
```

For a complete paired rerun, use the [isolated-worktree protocol](development-evaluation-protocol.md). It restores the original five AI modules from `660382b`, uses new experiment names, preserves historical reports and records current code/runtime/source/gold identities. Reproducing the experiment does not guarantee identical provider generations.

This cohort contains only three distinct self-authored quotations. Repeated phases are not additional independent documents. The study runner reads development-only files; the existing offline regression suite also checks split metadata in the combined manifest, and those outcomes were not used for prompt tuning. There were no held-out model calls. Scanned documents, XLSX, matching precision, arithmetic reliability and live production behavior are outside this extraction cohort.

Partial-output field accuracy uses the full annotated denominators. Item alignment uses exact identifiers. Source-ID resolvability and location agreement do not independently establish semantic support. Missing-state defaults without source evidence remain explicitly unconfirmed after failed interpretation, even when their stored state happens to match gold. End-to-end timing includes deliberate free-quota pacing; provider invoices and unavailable token usage are not inferred.
