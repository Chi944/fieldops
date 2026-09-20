# Hosted personal-workspace acceptance

Verified on 13 September 2026 at the canonical [FieldOps deployment](https://fieldops-eight-blue.vercel.app), source `6dab810`, Vercel deployment `dpl_5Ly8SyyW7tWVYR2GaNk84wKqR1Qo`. [Clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/34722616140) passed. This is a real hosted parser/manual workflow, not a live AI benchmark.

## What was exercised

The invited GitHub account signed in through the actual Neon OAuth flow. A new comparison held two self-authored, one-item pasted quotations from fictional Cedar and Harbor suppliers. No private supplier documents were used.

Both uploads persisted in private Neon storage and completed actual production Trigger runs. Each original produced six source excerpts with text offsets. The buyer entered supplier, currency and one item against its original evidence, recorded reasons, and explicitly confirmed manual coverage. Baseline matching proposed an equivalent group, which the buyer approved.

The matrix calculated USD 25.00 and 22.50 with decimal arithmetic. Delivery remained unknown, and the application withheld an overall supplier winner. A pinned revision-12 Excel report downloaded successfully and reopened with all 13 worksheets, two reviewed items, 24 correction entries, 12 source references, assumptions and the resolved review history. The original-items sheet was empty apart from its header because this run used manual entry, not model extraction. The browser report preserved the same values after reload.

| Production document run | State | Provider execution duration | Provider `costInCents` |
| --- | --- | ---: | ---: |
| `run_06g9fesgnamc9jnomqim3bnm01` | COMPLETED | 506 ms | 0.004301 |
| `run_06g9ff0ulcomfltlr5vqqs7101` | COMPLETED | 457 ms | 0.0038845 |

These durations are execution metadata, not end-to-end browser latency. The cost fields describe usage covered by the included Free credit, not a charged invoice or total account bill. Neither run called a model.

## Privacy, persistence and cleanup

Anonymous requests to both original-source routes returned HTTP 401. Authenticated storage HEAD checks found both originals. After sign-out, revisiting the private report showed no comparison; signing back in restored the saved workspace. No session token was copied into the application or a test client.

The synthetic comparison was deleted through the UI. The comparison record was removed and both canonical objects returned HTTP 404. At the immediate post-delete check, two durable cleanup entries remained during the six-minute upload-replay grace period; object deletion and outbox retirement are distinct checks. The private workspace returned to zero comparisons. Ignored local receipts preserve before/after metadata and workbook verification.

## Boundaries

This check covers one invited identity and two pasted originals. Separate-account rejection, cross-user access, every hosted file format, production OCR, interruption and quota exhaustion still need hosted acceptance. Automated SQL, local parser and browser tests cover portions of those behaviors but do not replace provider tests. Browser print/PDF is exercised by local production browser tests; this hosted smoke verified Excel and the report view, not the native print dialog.

Hosted processing remains explicitly parser-only. The separate [local AI smoke](ai-setup-verification.md) completed two tiny extractions and one AI match, but a multi-item PDF probe failed safely. The [evaluation report](evaluation-report.md) retains those limitations. All selected accounts remain on Free/Hobby; [free-service boundaries](free-services.md) explain quota pauses and Neon's temporary free storage beta.

## Additional hosted formats — 20 September 2026

Five self-authored benchmark files were uploaded through the real signed-in browser in a separate disposable comparison. All five production runs completed in parser-only mode with complete manifests. Each original-source endpoint rejected anonymous requests with HTTP401. The scanned PDF rendered both pages in the source-review panel, and its OCR excerpts retained page locations.

| Original | Preserved sources | OCR sources | Production run | Provider execution time |
| --- | ---: | ---: | --- | ---: |
| `industrial-1.pdf` (text PDF, two pages) |40|0|`run_06gbt2f0pfhrreiespk2rcjn01`|929ms|
| `industrial-2.pdf` (scan, two pages) |39|39|`run_06gbt2f3pm30gtluvcijmsm601`|7365ms|
| `event-1.png` |33|33|`run_06gbt2f446ph8theo33lshha01`|3896ms|
| `industrial-3.xlsx` (two sheets) |58|0|`run_06gbt2eutovjt5glt51tam8k01`|789ms|
| `office-2.csv` |27|0|`run_06gbt2euu4dlpe1qqosepjdf01`|487ms|

These are execution durations, not browser end-to-end latency. Summed provider usage was0.114461cents, covered by the Free plan credit; it is not a charged invoice. This check establishes hosted parsing and preserved-source coverage, not item/field accuracy. OCR still produced ambiguous `l`/`I` glyphs in the scanned source, which require review. No AI model was called.

A scoped read-only backup and local restore then preserved all five original hashes/byte counts (538486bytes), comparison revision and197source spans. [Recovery evidence and procedure](cloud-recovery.md). The earlier pasted-text end-to-end comparison/export acceptance remains a separate result. A second hosted OAuth identity, hosted forced interruption and comprehensive live AI measurements remain outside these checks.

## New worker: mixed success and malformed-file recovery

On 20 September, a second disposable comparison received three authored files together. Every run reports worker version `20260920.1` (the deployed version of `6vls4g3j`):

| File | Application outcome | Preserved sources | Trigger run | Execution |
| --- | --- | ---: | --- | ---: |
| `event-1.jpg` | `source_ready`, complete manifest | 33 OCR spans | `run_06gbt8qqbnggsumjsv3l3nov01` | 3,753 ms |
| `office-2.csv` | `source_ready`, complete manifest | 27 cells | `run_06gbt8qlq89lc4ngucsuqjn301` | 508 ms |
| `malformed.pdf` | `failed`, `malformed_file` | 0; no invented partial result | `run_06gbt8qqpcjuoc1s9493ei5n01` | 865 ms |

The interface retained both successful files, displayed a damaged-PDF recovery message, and rendered the JPEG beside its OCR excerpts. A handled application failure leaves the Trigger task completed; its persisted document run correctly remains failed. All three anonymous source requests returned 401. A repeated CSV produced the structured duplicate response without creating a fourth document or job. That check exposed an ineffective UI retry action; its fix and final retest are recorded with the release verification.

The deployed private status panel showed two comparisons, eight original reservations (814,091 bytes), no active/quota-wait jobs and one failed job. It exposed only this owner's counts. The public status endpoint still disables private upload/extraction for anonymous visitors, and the private status endpoint returns 401. The read-only receipt is retained privately in `.fieldops/hosted-production-acceptance.json`; it records provider usage separately from invoice cost. No model call, paid service or change to personal local data occurred.
