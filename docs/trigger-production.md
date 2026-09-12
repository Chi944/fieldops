# Production worker verification

The dedicated Trigger Free project `proj_gqdrztfnxotydnuhiaku` deployed successfully on 13 September 2026 using SDK/build/CLI4.5.16 and node24. Deployment `ewdnylwz`, version `20260912.1`, was built for linux/amd64. The CLI bundled the prepared English OCR asset; a build alone does not establish OCR execution.

The exact manual deployment used:

```powershell
npx tsx scripts/process.ts --prepare-ocr
npx trigger.dev@4.5.16 deploy --env prod --env-file .env.trigger.production.local --external-id fieldops-neon-parser-pilot-20260913-v1 --skip-update-check --skip-telemetry
```

The ignored environment file holds a production-only credential named **FieldOps production**, with a90-day lifetime ending12December2026. Runtime environment variables were uploaded separately as secrets through the SDK: restricted Neon database, private storage and parser-only processing. No migration-owner, GitHub OAuth or Groq key was included. All task imports use `@trigger.dev/sdk`.

## Actual synthetic smoke

[Production run](https://cloud.trigger.dev/projects/v3/proj_gqdrztfnxotydnuhiaku/runs/run_06g9fccf6cj1rqdajck7oosu01) completed at `2026-09-12T22:16:43.717Z`. The fixed synthetic CSV produced18sourcecells, two independently calculated line amounts and the exact USD251.30 total. Its output reports0modelcalls,0databasecalls and0privatefilesread. The provider reported96ms duration and `costInCents:0.000162`; this is a provider run-usage field covered by Free credit, not evidence of an invoice charge or a complete monthly bill.

This verifies deployed Linux task execution with CSV and Decimal. Actual private document jobs, OCR, interruption and cleanup require separate application smoke tests. The health receipt lives in ignored `.fieldops/trigger-production-smoke.json`; rerunning its script reads the saved run instead of claiming a new execution.

The organization remains Free, with included-plan billing limit and active-run cancellation enabled. Only Production receives the recurring reconciliation schedule. [Cost assumptions and zero-spend boundaries](free-services.md) record the conservative application reservation and provider soft-cap limits. A paid plan, top-up or fallback is never authorized.
