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
