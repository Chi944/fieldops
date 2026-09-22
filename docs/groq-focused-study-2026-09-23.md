# Groq focused extraction study — 23 September 2026

**Status: closed as interrupted.** Preserve the commands below as the original predeclared protocol; do not resume them or treat this as a completed model comparison. See the [sealed interruption evidence](../eval/results/development/groq-focused-2026-09-23/interrupted-before.json) and the [separately declared date/recovery follow-up](groq-focused-study-v2-2026-09-23.md).

## Decision and scope before inference

The user authorized continuing with Groq first after reviewing the failed full-document results. This study tests a different task boundary: caller-assigned item slots and one document-level extraction task, rather than asking each response to invent entity bookkeeping and exclusion lists. The hypothesis comes from the previous saved development responses: all four provider-schema failures included known context IDs in target-only exclusion lists. None of those five offending references belonged to another document. This does not establish that the remaining values were correct.

Use only the existing complete synthetic development originals `industrial-1`, `translation-2` and `office-2`: 18 items, 138 stated fields, 129 critical stated fields and two non-value annotations. Keep originals and expected values unchanged. No held-out original, gold annotation or model request may inform implementation. Model inputs contain parser-owned records, never expected answers. Previous live and offline-replay reports remain immutable historical references, not newly generated baselines.

The experimental `focused_fields_v1` path keeps every original source in a bounded task plan. Explicit item anchors and their continuation text stay together. Required item fields include identifiers; additional attributes and commercial rules remain source-linked. The application assigns task/slot identity and derives coverage from validated references. Unknown or unreferenced substantive content stays unresolved. It must not count app-assigned slot membership as evidence, infer absent terms or silently treat a partial document as complete. Existing raw-excerpt, decimal, currency, tax, compatibility and recommendation guards remain enforced.

## Frozen two-model comparison

After offline preflight and regression tests, freeze one implementation and run `groq-focused-2026-09-23` with:

- Before: `openai/gpt-oss-120b`, explicit existing `reasoning_effort=low`.
- After: `qwen/qwen3.8-27b`, explicit `reasoning_effort=none`, `reasoning_format=hidden`. This is a Preview evaluation model, not an application default.
- Identical cohort, parser, prompts, schema, task plan, output caps, scoring and runtime except the model-specific documented reasoning profile. Profiles are part of identity. This compares these configured model profiles, not model architecture in isolation.
- One HTTP transport attempt per dispatch, no semantic retries, no paid fallback. Twelve request slots, at most 60,000 reserved estimated tokens and 720,000 ms pacing wait per phase. Both phases have equal budgets; a smaller final allocation may be selected from complete-cohort preflight before inference.
- A durable shared UTC-day reservation ceiling of 180,000 estimated tokens, seeded from earlier development journals and shared across phases/restarts. Unknown use is never refunded. A whole phase must fit before its first request; partial availability does not justify omitting later documents from metric denominators.

The previous live fact phase reserved 118,920 estimated tokens on 22 September UTC. At planning time that leaves at most 61,080 under this conservative daily ceiling, before any additional reservation. This is application accounting, not verified provider quota. The comparison may span a UTC reset; a second phase that does not fit must record a quota-blocked state and retain a reproducible resume command. Never change the experiment name to bypass the shared budget.

Authenticated read-only model listing returned both models active, without an inference call. Current official documentation lists both on Groq Free with 8,000 tokens/minute and 200,000 tokens/day, and strict structured output support. Account limits remain authoritative. Existing dedicated development key and Free/ZDR confirmation are retained; production environment files, keys, billing, uploads and personal workspace data are outside this study.

Sources: [Groq limits](https://console.groq.com/docs/rate-limits), [structured outputs](https://console.groq.com/docs/structured-outputs), [model status](https://console.groq.com/docs/models), [reasoning parameters](https://console.groq.com/docs/reasoning), [data controls](https://console.groq.com/docs/your-data).

## Acceptance and reporting

Publish each result, including provider rejection, truncation, missing rows, inaccurate values, wrong source locations, quota interruption and unknown usage. Report complete/partial/rejected/unattempted documents independently. All requested expected values/items remain in denominators. Source-ID resolution is distinct from correct source location and semantic support. The strict missing-charge identity limitation remains explicit; no fake absence citations may satisfy it.

Do not change either phase's code after it starts or before the paired phase ends. Any later correction is a separately named experiment or zero-call replay preserving originals. Production AI stays disabled. A viable development result requires further frozen validation; passing software tests or this adaptive three-document study cannot establish general extraction reliability.

## Reproduction

The existing ignored `.env.ai.local` supplies the development key and true Free/ZDR confirmations. It must not contain cloud credentials. Do not paste a key into chat or a command. The CLI's explicit model selection takes precedence over that file without editing it. Use the frozen study revision and a fresh name for a new reproduction; never delete the shared quota ledger or historical results to restart a budget.

```powershell
# Offline capture traverses all originals for both models, without an API call.
npx tsx scripts/preflight-development.ts --name groq-focused-2026-09-23 --extraction-transport focused_fields_v1 --comparison-kind model

# First model, complete fixed cohort, one transport attempt per request.
npm run eval:dev -- --name groq-focused-2026-09-23 --phase before --live --env-file .env.ai.local --comparison-kind model --model openai/gpt-oss-120b --chunk-failure-policy retain_valid_chunks_v1 --extraction-transport focused_fields_v1

# Run only after the complete second allocation fits the shared UTC-day budget.
npm run eval:dev -- --name groq-focused-2026-09-23 --phase after --live --env-file .env.ai.local --comparison-kind model --model qwen/qwen3.8-27b --chunk-failure-policy retain_valid_chunks_v1 --extraction-transport focused_fields_v1

# Both immutable live reports must exist; this command makes no model requests.
npx tsx scripts/compare-development.ts --name groq-focused-2026-09-23
```

The code caps item-task output at 2,400 tokens and document-task output at 3,000, identically for both models. Whole-phase admission independently captures the installed requests before dispatch, so oversized plans stop before any inference. Twelve request slots and 60,000 estimated reserved tokens are ceilings, not permission to retry failed generations. The application default is unchanged; the focused path and Qwen are explicit development options.
