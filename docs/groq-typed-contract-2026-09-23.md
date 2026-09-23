# Typed item fields and service billing review — 23 September 2026

The [completed Groq run](groq-live-validation-2026-09-23.md) exposed a mismatch between the model-facing schema and the application: optional numeric fields were unconstrained text, duplicate item keys could appear in a list, and billing basis could be omitted. This change fixes that contract and the review visibility gap. **It does not establish better live extraction accuracy. Production AI remains disabled.**

## Change and acceptance boundary

The new development option is `focused_fields_v2`, identified on requests as `quotation-v10`. Each item has all 16 named core field objects, including billing basis, scope, package size, minimum order, order increment and tax rate. Numeric fields use the same canonical decimal constraint at the provider and decoder boundaries. Fields still represent `not_stated`, `not_applicable`, `ambiguous` and numeric zero separately. No values are inferred, stripped from unit strings or populated from benchmark answers.

The fixed object replaces the optional `fields` list, preventing repeated entries such as three `scope` fields. Unexpected keys and the old list shape are rejected. This does not prove that a provider cannot emit duplicate property names in raw JSON; it removes the observed repeated-list contract. Arrays for attributes, tiers, discounts and uncertainties still require actual arrays and are not unwrapped from malformed objects. Historical provider failures remain failures.

The v2 adapter performs only a validated shape conversion into the existing domain pipeline. It preserves original values, excerpts and parser references, reuses item ownership and coverage validation, and gives its requests a distinct checkpoint identity. The document schema, planner, item grouping, model profiles, output caps, monetary calculations and application default extraction transport remain unchanged.

Service/mixed/unknown items now show a source-linked billing review issue when the existing billing vocabulary cannot interpret their basis. The calculator already blocked these items; extraction review previously failed to explain that reason. Supplier-stated billing also receives the normal missing/foreign-source check. Corrections remain audited and require affected matches to be approved again.

Independent review reproduced an additional failure: a recognized `hourly` assertion could cite only an `hour` unit and avoid that warning. The experimental v2 path now checks actual cited source clauses for a matching explicit billing phrase or billing/rate wording. Unit-only evidence, a service adjective, a different billing family, alternatives and tested negation forms produce `unverified_evidence`, while preserving the asserted field for review. The matrix retains the amount with a review status and blocks recommendations. This is a conservative English phrase check, not semantic proof or universal language support; unsupported wording needs buyer review.

The provider contract was checked against current [Groq structured-output documentation](https://console.groq.com/docs/structured-outputs): objects remain closed and their named properties required. Provider schema support does not replace local evidence validation, nor erase the observed provider failures.

## Reproducible offline findings

The [immutable contract audit](../eval/results/development/groq-focused-contract-v2-2026-09-23/focused-contract-audit.json), measured at 05:27:34 UTC, uses only the same three development originals and their saved responses. It makes **zero model calls, zero accepted extraction outputs and zero checkpoint writes**. No held-out original is read or used for tuning. Original reports, receipt hashes, request identities, source hashes and annotations are checked before analysis.

| Observation | Previous contract | New contract or guard |
| --- | --- | --- |
| Saved optional numeric violations | Three unchanged numeric fragments pass the loose field shape, then fail typed decoding | All three fail the actual new field schema: minimum order, package size and order increment |
| Repeated scope | One saved field list contains three scope entries | Named properties reject the list shape; no old response is repaired |
| Omitted billing object | Could be omitted and become an absent domain field | Its state object is required; an explicit absent/ambiguous answer remains allowed and reviewable |
| Unit-only billing counterexample | Recognized value could appear comparable without a specific evidence warning | The same retained assertion is flagged; a controlled comparison probe changes from eligible to needs-review with no cost recommendation |
| Historical rejected replies | Six, including three provider schema failures | All six remain rejected |
| Historical accepted checkpoints | Fifteen already-expanded objects; original wire replies unavailable | No candidate wire-compliance or new accuracy claim is made for them |

Nine unchanged optional-field fragments were inspected in total. This fragment check measures earlier error detection, not that a future model will generate correct values. The historical finalized quotations still contain 8/10 correct annotated billing assertions for GPT-OSS and 0/10 for Qwen; Qwen has six retained service rows missing the basis, and the quota-aborted office quotation remains unavailable. None was filled or reclassified to raise a score.

The [offline preflight](../eval/results/development/groq-focused-contract-v2-2026-09-23/offline-preflight.json) preserves all **99 source records, 18 expected items and 12 requests across three full originals**. Estimated single-attempt tokens rise from **58,648 to 63,339 (+8.0%)**; maximum per-request estimate stays **5,843**, below the existing 7,500 cap. Output limits remain 2,400 tokens per item task and 3,000 per document task. Whether those caps reliably accommodate the new required fields is **unverified by fresh generation**.

The preflight pins 37 implementation files. GPT-OSS fingerprint: `6bd525798774f45fd1717868892ea68f48630afc071367c7caa417f0d36013ad`. Qwen fingerprint: `b6915fb8461cd560744f736002d278147834951c0114e98898aafaa978783198`. Both retain the original 90,000-token whole-phase reservation, 180,000 daily ceiling, one-attempt policy and bounded pacing.

## Verification and remaining live gate

Fresh local checks pass **600/600 tests across 71 files in 38.19 seconds**, including real Docker PostgreSQL integration, TypeScript, ESLint and the production build. Regression tests first reproduced the contract and missing-review failures, then passed after the fixes. They also cover unchanged raw evidence, fabricated numeric reinterpretation rejection, correction history, stale match approvals and comparison eligibility. Injected responses in tests are not model measurements. All **10/10 isolated browser workflows pass in 34.1 seconds**, covering upload, evidence review, corrections, grouping, comparison, Excel/print, persistence, duplicate recovery, keyboard use and automated accessibility.

All 11 private environment-file hashes still match the pre-run snapshot. No production AI, credentials, provider plans, spending settings, storage or Trigger configuration changed. There is no paid fallback.

The earlier live pair committed **180,000/180,000** of the local shared allowance for 23 September. No new live phase is admitted today. The earliest local reset is **00:00 UTC on 24 September (08:00 Singapore)**; the provider may impose additional quota limits. A fresh generation must validate the new contract before any accuracy improvement or production activation can be claimed. General classification, supplier-name omissions, array/required-field provider failures and broader held-out reliability remain unresolved by these software tests.

## Commands

The following commands produced the immutable offline artifacts. Repeating the same output name refuses to overwrite them; the audit requires the original private saved-response files. After the standard [local setup](../README.md#run-locally), a clean checkout can run the synthetic tests and a fresh-name preflight without credentials. It also needs the ignored private ledger parent directory: the read-only budget inspector expects that directory to exist. Create the directory without clearing any existing ledger or reservations. To reproduce a new audit capture, choose a fresh output name and keep the original source study unchanged.

```powershell
New-Item -ItemType Directory -Force eval/runs/private/development | Out-Null
npx tsx scripts/audit-focused-contract.ts --source-name groq-focused-v2-2026-09-23 --candidate-name groq-focused-contract-v2-2026-09-23
npx tsx scripts/preflight-development.ts --name groq-focused-contract-v2-2026-09-23 --extraction-transport focused_fields_v2 --comparison-kind model
```

After quota admission and on the frozen configuration, the prepared live commands retain the exact model profiles and cohort:

```powershell
npm run eval:dev -- --name groq-focused-contract-v2-2026-09-23 --phase before --live --env-file .env.ai.local --comparison-kind model --model openai/gpt-oss-120b --chunk-failure-policy retain_valid_chunks_v1 --extraction-transport focused_fields_v2
npm run eval:dev -- --name groq-focused-contract-v2-2026-09-23 --phase after --live --env-file .env.ai.local --comparison-kind model --model qwen/qwen3.8-27b --chunk-failure-policy retain_valid_chunks_v1 --extraction-transport focused_fields_v2
```

Do not clear reservations, retry a settled rejection, repair an old response or read held-out quotations to make this candidate pass. A successful API response is separate from complete extraction, supported comparison and the remaining production release gates.
