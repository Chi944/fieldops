# Groq follow-up: date contract and interrupted-run recovery

**Execution update:** the frozen v2 live phases subsequently finalized on 23 September. Both returned **0/3 complete quotations**; Qwen stopped during its final document with a quota error. See the [measured live validation and activation decision](groq-live-validation-2026-09-23.md). The pre-run protocol below is preserved as the declared study boundary; production AI remains disabled.

## Original evidence and decision

The first focused study is **closed as interrupted**, not a completed model comparison. Seven responses were received before the local runner stopped; the process was subsequently confirmed absent. The interruption cause was not established. No rejected request was retried. The [sealed interruption report](../eval/results/development/groq-focused-2026-09-23/interrupted-before.json) preserves the original code, source, journal and returned-quotation hashes.

Only the industrial PDF reached a returned quotation: six items, 40/43 selected critical fields and 40/46 stated fields, with its document task rejected and coverage marked partial. Translation had three returned item-task responses but no final quotation; office was not attempted. Across the original entire cohort, this gives 40/129 critical fields, 40/138 stated fields and 6/18 items. Those penalties preserve the full denominator; they are not an estimate of the model's accuracy on completed work. Cached translation sections are not silently substituted for a complete quotation.

All seven responses returned usage: 26,888 input and 9,421 output tokens. These **36,309 known tokens exceed the 33,278 character-based estimated request reservations**. The larger 60,000 phase allocation was not exceeded and is not refunded. The report's generic legacy usage-scope prose mentions two retry slots; this study's configuration, actual counters and protocol use one transport attempt and no automatic retry. Provider invoice cost and complete latency are unavailable.

## Diagnosed contract gap

The industrial document response stopped normally and supplied valid source excerpts. Of 32 fields checked with the unchanged validator, only `quotation.date` failed: it contained a written full-month date, whereas the domain required `YYYY-MM-DD`. The focused prompt and wire schema had omitted that format requirement. This was a wire/domain contract mismatch, not malformed JSON, token truncation or an invented citation.

The next correction is deliberately narrow:

- The focused provider schema requires ISO-shaped core date values; the prompt preserves ambiguous dates as ambiguous.
- The domain can canonicalize a complete English full-month date only when the exact model value already appears in its cited raw excerpt and the calendar date is valid. Raw excerpts, parser references and stored original responses remain unchanged. Numeric dates, abbreviated months, incomplete years and OCR repairs are unsupported by this normalizer.
- An offline replay supplies the same four saved industrial responses to the corrected domain validator. It makes zero model calls and reports only this fully observed document. It does not test the new provider prompt or reconstruct unfinished quotations.

## Measured saved-response replay

The [immutable replay result](../eval/results/development/groq-focused-2026-09-23/written-date-replay.json), measured at 22:59:26 UTC on 22 September (06:59 Singapore on 23 September), covers **one complete synthetic development original, six items and four saved responses**. It is an adaptive decoder regression, not a fresh generation or held-out accuracy result.

| Measurement | Original returned quotation | Same responses, corrected date decoder |
| --- | ---: | ---: |
| Critical stated fields | 40/43 | 43/43 |
| All annotated stated fields | 40/46 | 45/46 |
| Identifier-aligned expected items | 6/6 | 6/6 |
| Accepted focused tasks | 3/4 | 4/4 |
| Selected-field reference resolvability | 40/40 | 46/46 |
| Correct value and annotated source-location agreement | 40/40 | 45/46 |
| Application result | Partial | Partial |
| Retained prices blocked by completeness/evidence review | 6/6 | 6/6 |

All 40 parser source records and their locations remain identical. All 73 field references in the replay resolve, but resolution alone is not semantic evidence correctness. Three unresolved coverage/evidence issues remain, and the comparison guard produces zero cost recommendations. Removing the date rejection does not establish full extraction completeness or correct every interpretation. The increase in visible review issues reflects the now-retained document interpretation rather than a hidden acceptance of missing evidence.

Independent inspection found the remaining value miss at `supplier.name`: the model omitted a trailing name token present in its own excerpt. The unresolved issues concern nine uncited targets (including six repeated page-preamble records), two charge scope assertions without explicit quotation-wide wording, and a payment/validity record falsely caught by the possible-price heuristic. These are recorded limitations of this frozen candidate. No supplier name was filled from gold, no repeated source was silently dropped, and no charge scope or review approval was invented to raise the score. The heuristic false alert needs a separate generic regression fix; it does not justify accepting the other unresolved evidence.

Reproduce the one-time replay from the frozen implementation with `npx tsx scripts/replay-focused-date.ts --name groq-focused-2026-09-23`; it requires the original private response artifacts and refuses to overwrite its existing immutable reports. The original plan binds both source and annotation hashes. The provider schema/prompt change still needs a fresh live run.

## Verification and frozen follow-up

Local checks pass **577/577 tests across 67 files**, including real PostgreSQL integration, TypeScript, ESLint, the production build and **10/10 isolated browser workflows in 34.7 seconds**. The tests include a reproduced no-refund accounting counterexample, crash-window response recovery, rejected-response reuse, midnight budget handling, unchanged evidence, invalid dates, ambiguity, export and the complete manual workflow. Injected test responses are not model measurements.

The [v2 offline preflight](../eval/results/development/groq-focused-v2-2026-09-23/offline-preflight.json) captures 12 requests and 58,648 estimated request tokens per model, under the 90,000 complete-phase reservation. Both configurations preserve all 99 source records in the same three development originals. The frozen GPT-OSS configuration is `ed2325459633c4c4e6524dbdaad3722671e903ccbe6ffe3ac8e6d444ce54d8a3`; Qwen is `644f358e770d520dfef49503c61c8b3d71b7cdfa50123e46cd7c2f51482eae62`. All 36 implementation files are fingerprinted. This capture makes zero provider calls and does not assert that the provider accepts the new date schema.

The stopped shared lock was archived byte-for-byte after confirming PID 32844 absent. The original phase lock and shared quota ledger remain unchanged. The fresh study is prepared; **neither v2 live phase has run**. Production still reports `processingMode=parse_only` and `canExtract=false`, and all 11 private environment-file hashes remain unchanged. No new credentials, purchases or paid fallback were needed.

## Recovery and next live protocol, declared before inference

A simple restart of the old harness could retry the already rejected document task. The replacement development harness therefore persists exact request identities and terminal outcomes. Resumption must revalidate saved successes, preserve settled failures without another call, and stop on an unknown dispatched outcome. Replayed responses must not create another reservation, quota wait or usage count. Session records preserve the original phase start and make interruption time visible. The sealed interrupted study cannot be resumed as a clean baseline.

Use a **new** study name, `groq-focused-v2-2026-09-23`, after this correction is frozen and tested. Keep the same three development originals, 18 items, annotations, models and reasoning profiles. No held-out source or model request informs these changes.

Protocol 2 reserves **90,000 estimated tokens per complete phase**, identically for both models, under the unchanged **180,000 shared UTC-day ceiling**. The larger phase reservation accounts for the observed estimate shortfall; it does not raise the daily allowance or change the provider plan. Twelve requests, one attempt per request, no semantic retry, 720,000 ms pacing allowance and the existing single-request limit remain. Accounting must sum the greater of each request's reservation and known usage, with the complete phase allocation as an additional floor. An overrun on one response cannot offset another request's unknown consumption; reservations are never refunded.

Both models must run on the same frozen code and output caps. Compare GPT-OSS120B/low with Qwen3.8-27B/none/hidden as configured profiles, not a causal claim about model architecture alone. The original day's 178,920 committed reservations leave 1,080, so **neither new phase can start before the UTC reset (08:00 Singapore time on 23 September)**. Provider quota may impose an additional delay. Production AI, billing settings and the existing personal workspace remain unchanged.

```powershell
# After the v2 code is frozen; no credentials or model calls for preflight.
npx tsx scripts/preflight-development.ts --name groq-focused-v2-2026-09-23 --extraction-transport focused_fields_v1 --comparison-kind model

# Dedicated ignored development credentials only. Whole-phase quota admission is mandatory.
npm run eval:dev -- --name groq-focused-v2-2026-09-23 --phase before --live --env-file .env.ai.local --comparison-kind model --model openai/gpt-oss-120b --chunk-failure-policy retain_valid_chunks_v1 --extraction-transport focused_fields_v1
npm run eval:dev -- --name groq-focused-v2-2026-09-23 --phase after --live --env-file .env.ai.local --comparison-kind model --model qwen/qwen3.8-27b --chunk-failure-policy retain_valid_chunks_v1 --extraction-transport focused_fields_v1
npx tsx scripts/compare-development.ts --name groq-focused-v2-2026-09-23
```

Do not delete historical reports, outcome receipts or the shared quota ledger to restart a budget. The new integration and its date correction remain development evidence until a complete live run and later independent validation support a broader claim.

### Recovering an interrupted v2 process

The runner deliberately does not remove process locks automatically. Inspect the selected phase's `eval/runs/private/development/<name>/live-<phase>/run.lock` and the shared `_model-study/run.lock`. Verify the recorded process is absent before archiving those exact lock files with a unique name. An active or unverifiable process must not lose its lock. Keep the receipts, journal, plan and quota ledger intact; a lock archive does not restore spent or reserved quota.

Repeat the same command, name, phase and frozen configuration. Saved returned responses pass through domain validation again. Settled rejections remain rejected without another provider call. A reservation with no durable outcome stops the run for review because its provider consumption is unknown. The original `groq-focused-2026-09-23` study is sealed and cannot be resumed as a new baseline; these recovery instructions apply to the new protocol only.
