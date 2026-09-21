# Complete quotation development comparison

This is a small adaptive development study, separate from the public offline benchmark and any held-out evaluation. Its initial pair is fixed before model changes: `industrial-1` (text PDF, mixed goods/services), `translation-2` (text, services), and `office-2` (CSV, mixed goods/services). All three originals are supplied in full: 18 authored line items. No successful section replaces a complete quotation.

The runner reads only `eval/development/gold.json` and exact allowlisted paths in `eval/originals/dev`. The development manifest was copied once by filtering the existing generated manifest; no originals were regenerated and no held-out content was emitted. Runtime loading of the combined gold, held-out gold/originals or shared robustness cases is prohibited. Expected values are used for scoring only; model input consists of parsed source records. This study makes extraction calls only, with no extra AI matching task.

Run from a clean local shell. The optional environment file must be the dedicated ignored `.env.ai.local`; only the model key, model selection, processing mode and confirmed Free/ZDR flags are copied into this process. Inherited cloud credentials, Vercel context, production mode and Node preload configuration cause refusal. `GROQ_BASE_URL` is also rejected in the shell or file because the SDK would otherwise permit redirecting requests and credentials. The runner neither loads production environment files nor imports deployment clients. Free/ZDR confirmation must reflect the actual account before a live run. Do not print credentials or pass them as shell arguments.

The published experiment names are historical, immutable results. Do not rerun their commands, remove their outputs or clear their checkpoints. For a new reproduction, choose an unused worktree directory and unused experiment name. Start from a committed study revision containing this runner and the candidate being evaluated; uncommitted changes are not copied into a worktree.

The original before implementation is the five files under `src/lib/ai` at commit `660382b2ab826787b68e6810a0bf2dae467d9f21`. All five committed file hashes were checked against the published v2 before report and match. Restore only those AI modules inside the new isolated worktree, retaining the current guarded evaluator, dev-only gold and dependencies. This repeats the original AI implementation under the current harness; it is not a byte-for-byte replay of the historical runtime or a guarantee of identical provider output. Every rerun records its own full fingerprint.

```powershell
# Run from the FieldOps repository; select fresh names before proceeding.
$studyCandidateRef = git rev-parse HEAD
$studyWorktreePath = Join-Path (Split-Path -Parent (Get-Location).Path) 'fieldops-study-20260922-a'
$studyRunName = 'study-rerun-2026-09-22-a'
if (Test-Path -LiteralPath $studyWorktreePath) { throw 'Choose a new study worktree directory.' }
git -c core.autocrlf=false worktree add --detach $studyWorktreePath $studyCandidateRef
Set-Location -LiteralPath $studyWorktreePath
if (Test-Path -LiteralPath "eval/results/development/$studyRunName") { throw 'Choose an unused experiment name.' }

# Restore the original AI implementation only in this isolated worktree.
git -c core.autocrlf=false restore --source 660382b -- src/lib/ai
npm ci
npx tsx scripts/process.ts --prepare-ocr

# Parser-only measurement; no model credentials needed.
npm run eval:dev -- --name $studyRunName --phase before --mode baseline
```

Prepare the dedicated ignored `.env.ai.local` in this worktree with AI-only settings, including `GROQ_MODEL=openai/gpt-oss-120b`, and recheck Free/ZDR before an explicitly authorized live reproduction. Do not copy cloud or production environment files. Use one quota owner; leave existing applications and their data directories alone. Then run the following steps sequentially, waiting for each phase to finish before changing any fingerprinted file:

```powershell
# Actual original-implementation before run under the fixed per-phase limits.
npm run eval:dev -- --name $studyRunName --phase before --live --env-file .env.ai.local

# Restore only the candidate AI modules from the committed starting revision.
git -c core.autocrlf=false restore --source $studyCandidateRef -- src/lib/ai
npm run eval:dev -- --name $studyRunName --phase after --live --env-file .env.ai.local

# No inference: compare finalized results; keep both phase reports.
npx tsx scripts/compare-development.ts --name $studyRunName
```

An explicitly authorized later candidate can instead use a new name and reference an existing original baseline, without rerunning or copying that baseline. For example, after preparing and testing that candidate in its isolated worktree:

```powershell
$studyNextName = 'study-candidate-2026-09-22-b'
if (Test-Path -LiteralPath "eval/results/development/$studyNextName") { throw 'Choose an unused candidate name.' }
npm run eval:dev -- --name $studyNextName --phase after --live --env-file .env.ai.local --baseline-name $studyRunName
npx tsx scripts/compare-development.ts --name $studyNextName
```

The historical name `full-quotes-2026-09-21-grounded` identifies the coverage-handling candidate only. Its scope is to retain known coverage omissions as visible partial extraction; the raw-value contract was not changed. The label does not imply improved grounding, corrected supplier values, complete extraction or better accuracy. Assess those claims only from the recorded output states and metric denominators.

The final availability candidate uses the explicit development-only option `--chunk-failure-policy retain_valid_chunks_v1`. The application default and historical reports without this field mean `reject_document`. Record the selected policy in every new configuration; do not infer it from a run name. Retaining validated chunks keeps rejected chunks excluded and failed target sources visible as unresolved coverage errors. It measures partial availability, not repaired model output or complete extraction. Historical field scoring stays unchanged: the report separately counts matching missing-state defaults with no source evidence, which are not verified absence after a failed section.

For an explicitly authorized reproduction of this policy, use another unused experiment name and the existing original baseline:

```powershell
$studyAvailabilityName = 'study-availability-2026-09-22-c'
npx tsx scripts/preflight-development.ts --name $studyAvailabilityName
npm run eval:dev -- --name $studyAvailabilityName --phase after --live --env-file .env.ai.local --baseline-name $studyRunName --chunk-failure-policy retain_valid_chunks_v1
npx tsx scripts/compare-development.ts --name $studyAvailabilityName
# Local, no-model audit; requires this run's ignored retained outputs/journal.
npx tsx scripts/audit-development-sections.ts --name $studyAvailabilityName
```

The offline preflight supplies an explicitly labelled schema-invalid test response for every request, captures the actual complete source-chunk traversal and estimates reservations; it makes zero provider calls and accepts no model output. It requires the retention-capable candidate code, not the restored original implementation. Review its fit against the same phase limits before live execution. It does not verify account quota, model schema acceptance or extraction accuracy.

`--baseline-name` is allowed only for a live after phase and a different existing experiment name. It resolves that experiment's fixed `live-before.json` path, verifies the original ordered cohort, source/gold hashes, model and budgets, and saves an immutable `baseline-reference.json` containing the original report SHA-256, configuration and measurement date. The new report references that baseline; it does not claim a fresh before run. Comparison verifies the original bytes and reference again. Earlier candidate reports, including failed candidates, remain separate and unchanged. A baseline reference is not authorization for another live call; the later candidate must have its own explicit experiment decision.

Each phase defaults to 24 reserved transport-attempt slots, 170,000 estimated reserved tokens and at most 600,000 ms of total waiting. One application dispatch reserves two slots and twice its compact wire input estimate plus output cap, covering the adapter's single possible transient retry. Therefore at most 12 dispatches are admitted. There is no semantic-failure retry. The next dispatch waits until 60 seconds after the preceding response or failure settles; an interrupted dispatch falls back to its persisted reservation. Pacing only from reservation was insufficient because SDK loading and dispatch happen later. Each wait is at most 60 seconds. A provider daily quota or exhausted local budget ends the phase. These are conservative reservations using the application's token heuristic, not a tokenizer guarantee, actual HTTP-attempt measurement or provider invoice. Known returned usage is also checked before further dispatch.

Request reservations are appended and flushed before dispatch. Unknown or failed usage is not refunded. One process holds the phase lock. Validated chunks remain reusable after interruption under exactly the same code/model/runtime/source/gold hashes and limits. After a crash, first verify that the owning process is stopped; only then remove that phase's `run.lock` and rerun its original command. Do not delete its plan, journal or checkpoints to obtain a fresh budget. A malformed journal fails closed.

Reports are exclusively created at `eval/results/development/<name>/<baseline|live>-<before|after>.json` with a companion Markdown file. A finalized phase cannot be replaced. The after phase requires a finalized before report with the same ordered cohort, source/gold hashes, mode and budgets. Code, model, package lock, runtime and OCR asset identity are recorded separately, and drift during execution is exposed. Private accepted/rejected response bodies and checkpoints stay under ignored `eval/runs/private/development`; they do not belong in operational logs. Existing `latest` files and public benchmark reports are not rewritten.

Report complete, partial, rejected, parser-failed and unattempted documents separately against the requested cohort. Ready status is not accuracy: per-field, critical-field, row, annotated review-signal and source metrics retain explicit numerators and denominators. Partial accepted outputs can contribute field metrics; rejected attempted documents earn zero credit. Unattempted documents are separately counted, and zero precision/reference denominators mean unavailable. Returned usage without token data is counted separately, never presented as zero-cost certainty. Parser timing, document extraction elapsed time and returned-response time are different measurements. Journal failure/rejection counters describe different processing stages and can overlap; use document completion counts for the number of rejected quotations.

This extraction runner does not measure matching quality, arithmetic correctness, production isolation or general supplier-format coverage. The published study includes a separate read-only production-isolation receipt. The runner's held-out reads and model calls remain zero; the ordinary offline regression suite separately inspects split metadata in the combined manifest. Preserve the immutable before failure report even if the after phase improves. Any later experiment needs a new name and an explicit scope/budget decision; changing an experiment label alone does not authorize additional model use.

## Typed-contract follow-up

The [22 September follow-up](ai-development-study-2026-09-22.md) records both `typed_fields_v1` and the subsequent `typed_fields_v2` experiment. Version 1 was rejected by the provider's union-schema implementation. Version 2 separates numeric/text collections to avoid those unions. The default remains `legacy_v5`; application callers do not enable either candidate. Both modes retain narrow excerpts, section-specific fields and precise decimal strings checked by the existing domain validators. The source-completeness safety guard applies to the default transport as well. Use the selected flag consistently in offline request capture and live evaluation:

```powershell
# Choose an unused name and obtain the original baseline as described above.
$typedStudyName = 'typed-study-rerun-2026-09-23-a'
npx tsx scripts/preflight-development.ts --name $typedStudyName --extraction-transport typed_fields_v2
npm run eval:dev -- --name $typedStudyName --phase after --live --env-file .env.ai.local --baseline-name $studyRunName --chunk-failure-policy retain_valid_chunks_v1 --extraction-transport typed_fields_v2
npx tsx scripts/compare-development.ts --name $typedStudyName
# Offline, requires the finalized run and its ignored rejection/accepted journals.
npx tsx scripts/audit-development-sections.ts --name $typedStudyName
npx tsx scripts/audit-development-rejections.ts --name $typedStudyName
```

New reports include a separate selected-annotation readiness gate with fixed critical-field/item denominators, counting rejected and unattempted documents as failures. Historical field metrics remain unchanged. An application-ready quotation or identifier-only item recall is not sufficient to pass this gate. Inspect all material unannotated terms independently before making a broader reliability claim. No held-out fixture or gold value is supplied to extraction.

Critical non-value states must agree as well: a source-linked invented shipping price still fails. Missing charge containers are not backfilled to satisfy expected states. A matching `not_stated` means absence of assertion, not independently verified absence; source-linked non-value counts are diagnostics separate from gate eligibility. Request-schema diagnostics contain only validated structural metadata, never provider messages, generations or quotation text. Earlier schema diagnostics made additional, explicitly recorded requests; the new error classification records the cause on the original failed request.
