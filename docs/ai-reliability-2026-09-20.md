# AI reliability review — 20 September 2026

**Release decision: keep hosted AI disabled.** Local parsing, manual review and deterministic comparison remain usable. This work improved evidence validation and processing bounds, but it did not establish a reliable complete-document AI extraction candidate. No held-out quotation was sent to a model.

The [full offline baseline](evaluation-report.md) remains separate from the [latest live probe](evaluation-live-latest.md). Historical [13 September live measurements](live-ai-development.md) and original failure artifacts are preserved.

## Actual development measurements

This was adaptive debugging on **one repeated self-authored development quotation**, `industrial-1`: two text-PDF pages, six goods/service items, 46 selected stated fields and 43 critical fields. Six configurations were tried, including one explicitly selected 20b comparison; these are not six independent documents and cannot be pooled into an accuracy estimate.

| Measurement | Observed result |
| --- | ---: |
| Complete benchmark quotations accepted | 0 |
| Validated intermediate chunks | 2 |
| Returned provider responses | 8 |
| Rejected responses | 6 |
| Known input / output tokens | 7,956 / 5,190 |
| Responses without token usage | 4/8 |
| Sum of recorded provider-response times | 24,296 ms |
| Held-out model requests | 0 |

The [per-configuration ledger](../eval/results/live-development-2026-09-20.json) records models, fingerprints, failure codes and usage. Time excludes quota waiting and is not a whole-document latency distribution. Known token totals exclude unreported usage; unreported usage is not zero. The Free Plan and inference Zero Data Retention settings were rechecked before these synthetic requests. No paid fallback or production AI setting was enabled. Cost from a provider invoice was not measured.

Two `finish_reason=stop` responses were rejected inside transport normalization before the original evaluator journal counted them. Their private rejection records retained the actual usage. This ledger reconstructs each returned response once from successful checkpoints and non-cached rejections, correcting the undercount. A new transport-stage marker and regression prevent that loss in future runs. Original probe reports remain preserved rather than silently rewritten.

## Diagnosis and changes

The September 13 retry was not a second identical syntax failure: its JSON was syntactically valid but put validity, lead time, payment and tax rate in the quotation-only field array. Earlier and current failures span provider schema violations, incomplete item content and an invented subtotal. No retained response establishes `finish_reason=length`; provider rejections often omit usage. Truncation or reasoning-token exhaustion is therefore **not an established root cause**. Character counts of content and reasoning, without reasoning text, are now retained when a successful provider response supplies them.

The initial contract repeated eight metadata properties for every core field and required a verbose disposition for every source. It also bounded only source characters. A new synthetic regression demonstrated that 15 short priced rows could fit one request. Processing now preserves every source while limiting detected priced rows to three, separates commercial summaries from item sections, and carries bounded nearest earlier header context from the same sheet. This heuristic controls batching; it does not prove a row's business meaning.

The final transport uses six direct common item fields—description, identifier, quantity, unit, unit price and line amount—with explicit value states and source excerpts. Sparse typed extra fields preserve industry information. Application code determines core labels and types, routes document terms, restores only known parser IDs and runs the existing schema, literal-evidence, arithmetic and coverage checks before checkpointing. Used coverage comes from extracted facts; every remaining target source needs an explicit disposition. Context cannot become a new item or charge. Existing persisted quotation types, correction history and stale-result fences remain unchanged.

A flat cross-reference experiment and an intermediate contract with competing fields/attributes arrays were rejected during development; they are not the deployed contract. The [ledger](../eval/results/live-development-2026-09-20.json) retains their failures. A fixed-code 20b comparison also failed, including an invented subtotal and empty item fields; the application continues to default to 120b, with no automatic fallback.

## Final bounded probe

Configuration `a7401194e35b` used `openai/gpt-oss-120b` and the final fixed-common-field contract. The provider rejected its first response because both item objects omitted the required `kind` property despite `strict:true`. The response took **3,196 ms**; token usage was unavailable. The interpretation was rejected, never promoted to a complete quotation.

Its accepted-output scores are **0/46 selected fields**, **0/43 critical fields** and **0/6 item recall** because no complete output was accepted. These are availability penalties, not proof that every tentative field was wrong. Item precision and semantic source-reference precision have zero denominators. The [archived JSON](../eval/results/live-industrial-1-2026-09-20.json) retains the exact original fingerprint. The diagnostics-only accounting correction afterward changes the final code fingerprint but does not imply a new live result.

[Groq's official structured-output documentation](https://console.groq.com/docs/structured-outputs) describes strict schema enforcement and supported closed-object constraints. The observed provider errors conflict with that expected behavior; this report does not claim that a documented schema feature is unsupported or that the provider-side cause is known. No malformed generation was repaired into accepted data, and no provider support message was sent.

## Concrete evidence failures fixed

These are injected-response regressions, not claims of model accuracy:

- A source excerpt stating SGD could previously validate a normalized USD value. Explicit currency codes or an allowlisted unambiguous currency name are now required; a bare dollar symbol remains insufficient.
- `Tax amount 0; discount 5%` could previously justify tax rate zero. The exact percentage must now attach to tax, VAT or GST wording; an unrelated percentage is rejected.
- An omitted integer-only spreadsheet row could be labelled header, or referenced only by a generic note, and escape the per-cell price check. Row-aware review now marks a possible priced row incomplete unless actual item fields or a charge amount account for it. Vertical price continuations remain supported.

Relevant regressions are in `tests/ai-commercial-evidence.test.ts`, `tests/ai-row-coverage.test.ts`, `tests/ai-bounded-extraction.test.ts` and `tests/ai-checkpoint.test.ts`. The initial dense-row test failed with 15 rows; the commercial-summary test failed with one mixed section instead of two; the two currency/tax tests and three omitted-row tests reproduced their respective unsafe behavior before fixes. Final focused verification passed **73 tests across eight files**, with a clean TypeScript check and scoped lint, including the added diagnostics-accounting regression. The root release verification records the final full-suite and build totals separately.

## Remaining work

A viable next milestone needs a reproducible complete-document development result before freezing a live held-out evaluation. The finite English synthetic set, small currency-name allowlist, conservative English price/tax heuristics, unmeasured provider rejection usage and missing complete-document success are practical limits. The source/manual recovery path is the present release path. Production AI is not ready to enable on this evidence.
