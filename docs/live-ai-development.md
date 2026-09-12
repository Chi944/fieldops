# Live AI development verification

Measured on 13 September 2026 (Asia/Singapore). The real Groq extraction path works for two small synthetic quotations in the local application. A subsequent, more demanding two-page quotation still failed to complete. These results support an opt-in development integration; they do not establish production extraction reliability or broad format accuracy. Hosted AI remains disabled.

## Separate evidence, separate denominators

| Verification | Actual result | Scope |
| --- | --- | --- |
| Full offline benchmark | See [24-document report](evaluation-report.md) and [JSON](../eval/results/baseline.json) | Local parsing and identifier/text matching on gold-normalized rows; no model calls |
| Final complete-document live probe | 0/1 quotation completed; two validated chunks retained; final chunk rejected twice | One selected development text PDF, two pages, six goods/service items |
| Local application extraction smoke | 2/2 small quotations eventually ready, one item each | Self-authored Atlas and Beacon quotations; Atlas failed twice before the schema/validation fixes |
| Local application semantic matching | One proposed equivalent pair, evidence linked; reviewed and approved in the UI | CT-10 nylon 100 mm cable ties, each; no benchmark precision/recall claim |
| Held-out AI evaluation | 0 requests | Not started; held-out content was not used to tune extraction prompts |

The independent original-document review and full offline parser measurements include held-out originals. That inspection is distinct from sending held-out content to the model. No live held-out result or full 12-document development result is available.

## Final live quotation probe

The [archived live report](evaluation-live-industrial-1.md) and [machine-readable result](../eval/results/live-industrial-1.json) retain configuration `2cde89584bf4c470c14a4c5a8d312d54c987e90254d5d05ff5c28acc86413690`. It selected `industrial-1` explicitly from the development set. The parser completed both PDF pages, found all six authored identifiers and supplied 40 bounded source regions. This verifies parser coverage, not semantic correctness.

The first two extraction chunks validated and were checkpointed. The third response was rejected by the provider with `json_validate_failed`; the retained synthetic diagnostic contains invalid JSON near a service-field array closure. One exact-configuration retry reused both successful chunks and again failed the remaining chunk. FieldOps did not publish those partial chunks as a complete interpretation. The saved result reports `invalid_output` and keeps source/manual recovery available.

End-to-end accepted-output scores are **0/46 selected stated fields**, **0/43 critical fields** and **0/6 item recall**. This is the failure penalty for no accepted complete document, not evidence that every tentative field was semantically incorrect. Item precision and semantic source-reference accuracy have zero denominators; they are unavailable, not 100%. Supplier matching is inapplicable to this single-document probe.

The four returned responses contain **5,242 known input tokens and 3,951 known output tokens**. Two provider rejections did not return token usage. Their usage is unknown, not zero. Recorded provider-response time totals **18,899 ms** across both sessions, excluding quota waits; it is not complete document latency. Accepted chunks reported USD 0 under the verified Free Plan, but full rejected-request usage and a provider invoice were not measured. No paid fallback was enabled.

## Application smoke

These values were read from the isolated synthetic application state after the root agent exercised upload, processing, review and matching through the actual local application. They are outside the benchmark and were not substituted into its results.

| Synthetic quotation | Source records | Items | Input / output tokens | Recorded extraction time |
| --- | ---: | ---: | ---: | ---: |
| Atlas Supply | 14 | 1 | 2,453 / 1,912 | 4,832 ms |
| Beacon Supply | 7 | 1 | 1,953 / 1,713 | 3,850 ms |

Both final successful extractions used `openai/gpt-oss-120b` and reported USD 0. The final Atlas success followed two earlier validation failures and a worker restart after code updates; it is not a first-attempt success claim. The reviewer changed Beacon's unit price from 1.10 to 1.05. The comparison retained the supplier's stated 2.20 line amount and displayed its difference from the independently calculated 2.10. The approved matching pair referenced the two actual quotations. Matching token usage and latency were not recorded, so they are not reported.

## What changed, and what remains unresolved

Development failures led to a consistent closed field shape, section-specific key validation, compact source aliases restored only through parser IDs, grounded unit-metadata normalization, and validation before successful checkpoint writes. Private rejection journals retain failure codes and available usage. Unreturned token usage is counted explicitly. A deterministic regression also fixed decimal punctuation being misread as grouping, and now checks tier/discount values and commercial basis against source evidence; see [failure notes](failure-notes.md).

Nine adaptive benchmark configurations are preserved in the [development experiment ledger](../eval/results/live-development-experiments.json): six validated chunks and 13 rejected responses, with zero complete benchmark quotations. The ledger records 20,897 known input tokens and 13,946 known output tokens; 11 of 19 returned responses lack usage. These overlapping development probes must not be pooled into an accuracy estimate or treated as total account consumption. Separate small smoke tests and bounded transport diagnostics are excluded. A few diagnostics explicitly tried `openai/gpt-oss-20b` in the same free provider; the application's configured default remains 120b.

[Groq's official structured-output documentation](https://console.groq.com/docs/structured-outputs) supports strict closed schemas, nullable fields and `anyOf`; it also asks users to report unexpected schema-validation failures. Observed provider rejections do not prove those documented features are unsupported. Some earlier rejected generations passed local schema validation, while the final remaining failure was syntactically malformed JSON. The precise provider-side cause is unresolved. No report was sent to the provider.

The current source-character budget does not independently bound the number of expanded structured item fields. Dense tables and context across chunk boundaries need further development evaluation. Unusual commercial wording is conservatively queued for review. These limitations, the failed complete-document probe, missing rejection usage, and untouched live held-out set prevent a credible broad AI reliability claim today.

## Reproduction

`npm run eval -- --mode baseline` makes no model calls. After explicit local AI configuration and quota authorization, a bounded live development probe is:

```powershell
node --env-file=.env.ai.local --import tsx scripts/evaluate.ts --live --split dev --document industrial-1 --max-new-requests 1
```

The development-only selector prevents a single-file held-out probe. Identical source and configuration hashes reuse accepted checkpoints; changed source, package lock, Node runtime or OCR-language identity produces a new run. The final offline report has a different configuration hash from the archived live probe because reporting prose was corrected afterward; no new model result is implied. Rejected model payloads and local credentials remain ignored private files. Public artifacts contain measurements, synthetic fixture identifiers and failure codes.
