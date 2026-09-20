# Production worker verification

## 20 September 2026 hardening deployment

Deployment [`6vls4g3j`](https://cloud.trigger.dev/projects/v3/proj_gqdrztfnxotydnuhiaku/deployments/6vls4g3j), version **`20260920.1`**, completed with the pinned 4.5.16 SDK/build/CLI, Node 24 and prepared English OCR asset. It includes bounded abandoned-upload expiry and cleanup. Runtime configuration remains parser-only, with no production model key or paid fallback.

A fresh [health run](https://cloud.trigger.dev/projects/v3/proj_gqdrztfnxotydnuhiaku/runs/run_06gbt890tc6imhaumm8e9krj01) completed on that version at `2026-09-20T11:43:57.619Z`: 18 CSV source cells, exact USD 251.30 total, zero model/database calls and zero private files. Provider execution was 93 ms and reported `costInCents: 0.0001569375`, covered by Free credit; this is usage metadata, not an invoice measurement. The private receipt is `.fieldops/trigger-hardening-health.json` and uses a new idempotency key distinct from the historical smoke below.

The production maintenance schedule also executed on `20260920.1` at 11:45 and 12:00 UTC, both completed (600 ms and 645 ms). The latter run is `run_06gbtc1389r5bkd5qorh44b601`. These verify the new scheduled handler actually runs; no real upload was deliberately aged by 24 hours, so abandoned-intent expiry races remain established by the real PostgreSQL tests rather than this empty-queue smoke. The read-only SDK receipt is `.fieldops/reconcile-hardening-check.json`.

The five-format hosted check and subsequent new-worker failure/recovery checks are recorded in [hosted acceptance](hosted-acceptance.md). The following section preserves the original worker's verification.

## 13 September 2026 initial deployment

The dedicated Trigger Free project `proj_gqdrztfnxotydnuhiaku` deployed successfully on 13 September 2026 using SDK/build/CLI4.5.16 and node24. Deployment `ewdnylwz`, version `20260912.1`, was built for linux/amd64. The CLI bundled the prepared English OCR asset; a build alone does not establish OCR execution.

The exact manual deployment used:

```powershell
npx tsx scripts/process.ts --prepare-ocr
npx trigger.dev@4.5.16 deploy --env prod --env-file .env.trigger.production.local --external-id fieldops-neon-parser-pilot-20260913-v1 --skip-update-check --skip-telemetry
```

The ignored environment file holds a production-only credential named **FieldOps production**, with a90-day lifetime ending12December2026. Runtime environment variables were uploaded separately as secrets through the SDK: restricted Neon database, private storage and parser-only processing. No migration-owner, GitHub OAuth or Groq key was included. All task imports use `@trigger.dev/sdk`.

## Actual synthetic smoke

[Production run](https://cloud.trigger.dev/projects/v3/proj_gqdrztfnxotydnuhiaku/runs/run_06g9fccf6cj1rqdajck7oosu01) completed at `2026-09-12T22:16:43.717Z`. The fixed synthetic CSV produced18sourcecells, two independently calculated line amounts and the exact USD251.30 total. Its output reports0modelcalls,0databasecalls and0privatefilesread. The provider reported96ms duration and `costInCents:0.000162`; this is a provider run-usage field covered by Free credit, not evidence of an invoice charge or a complete monthly bill.

This verifies deployed Linux task execution with CSV and Decimal. Two subsequent actual hosted pasted-text document jobs also completed in 506 ms and 457 ms of provider execution time. Their private originals were reviewed, matched, compared, exported and deleted through the application. [Hosted acceptance](hosted-acceptance.md) records the runs and limits. Production OCR, interruption and quota recovery remain separate checks. The health receipt lives in ignored `.fieldops/trigger-production-smoke.json`; rerunning its script reads the saved run instead of claiming a new execution.

The organization remains Free, with included-plan billing limit and active-run cancellation enabled. Only Production receives the recurring reconciliation schedule. [Cost assumptions and zero-spend boundaries](free-services.md) record the conservative application reservation and provider soft-cap limits. A paid plan, top-up or fallback is never authorized.
