# Trigger development verification

Checked 13 September 2026 (Asia/Singapore). FieldOps has completed a real development task through Trigger. Production deployment, private uploads and live AI remain separate acceptance gates.

## Verified configuration

| Setting | Observed value |
| --- | --- |
| Account and plan | `Chi944`, Free verified in the dashboard |
| Project | FieldOps, `proj_gqdrztfnxotydnuhiaku` |
| Environment | Development |
| CLI authentication | Default profile, successful login |
| SDK, build extension and CLI | `4.5.16`; SDK and build dependency declarations pinned exactly |
| Runtime and registered version | `node-24`, `20260912.1` |
| Development key label | `FieldOps local development` |
| Key scope | Development environment only, full environment access |
| Configured key lifetime | 90 days; expires 12 December 2026 |
| Secret location | Ignored `.env.trigger.local`; no key value is recorded here |

The dashboard showed restricted access presets as upgrade-only, so the created key has full access within Development. It is not limited to the smoke task; keep it private and replace/revoke it in Trigger when needed. No paid upgrade or production key was used. The SDK and build dependency must both use exact `4.5.16` declarations: during setup the CLI rejected `@trigger.dev/build: ^4.5.16`, despite the installed version resolving to `4.5.16`.

The [FieldOps Development dashboard](https://cloud.trigger.dev/orgs/chi944-83c9/projects/fieldops-8d-W/env/dev) showed all three registered tasks:

- `fieldops-health-check`
- `fieldops-process-document`
- `fieldops-reconcile`

Only the synthetic health task was executed for this check. Registering the other tasks does not verify their database access, processing or scheduled cleanup.

## Measured run

`scripts/trigger-smoke.ts` submitted the task and polled its actual status. The dashboard also showed the registered tasks and completed run.

| Evidence | Result |
| --- | --- |
| Run ID | `run_06g9f02hnt6o8ef655fuqn0r01` |
| Status | `COMPLETED` |
| Receipt checked at | `2026-09-12T21:22:50.808Z` (13 September in Singapore) |
| Input | Fixed synthetic CSV inside the task; submitted payload `{}` |
| Parser | `fieldops-parsers-1` |
| Preserved source cells | 18 |
| Checks | Quoted CSV field, cell evidence, decimal line amounts and decimal total |
| Calculated total | USD `251.30` |
| Model / database / private-file calls | 0 / 0 / 0 |
| Local nonsecret receipt | `.fieldops/trigger-dev-smoke.json` |

The task parsed a goods row containing a quoted comma and a service row, verified expected CSV cell locations, and independently recomputed both line amounts and their sum with Decimal. This is an integration smoke check, not an extraction-accuracy benchmark or a production latency/cost measurement.

## Repeat the development check

Use Node.js 24 and install the committed lockfile with `npm ci`. For a fresh checkout, configure `.env.trigger.local` privately with the existing Development key and these nonsecret settings:

```dotenv
TRIGGER_PROJECT_ID=proj_gqdrztfnxotydnuhiaku
FIELDOPS_LOCAL_MODE=false
FIELDOPS_PROCESSING_MODE=parse_only
GROQ_API_KEY=
GROQ_FREE_TIER_CONFIRMED=false
GROQ_ZDR_CONFIRMED=false
```

Add `TRIGGER_SECRET_KEY` through your private editor; its value must be the Development key, not a production key. Do not put it in a command argument, screenshot, source file or dashboard task payload. The file must remain ignored. Keep database, storage and model credentials out of this development-check configuration and avoid inheriting production credentials from the shell. This smoke does not need them.

Check the default CLI account. Login is needed only if the session is absent or expired:

```powershell
npx trigger.dev@4.5.16 whoami --skip-telemetry
# Only if the default profile is not authenticated:
npx trigger.dev@4.5.16 login --skip-telemetry
```

Start the development worker from the FieldOps repository:

```powershell
npx trigger.dev@4.5.16 dev --env-file .env.trigger.local --skip-telemetry
```

Wait for Ready and the three task IDs. Use a second terminal in the same repository to submit or resume the bounded check:

```powershell
npx tsx scripts/trigger-smoke.ts
```

The script requires this project's Development key, stores a receipt before polling, and reuses the saved run ID on subsequent invocations. Its first submission uses an idempotency key with a one-hour lifetime. A rerun with an existing receipt inspects the original run; it does **not** prove freshly edited code executed. To test a new task version, use **Test** on `fieldops-health-check` in the Development dashboard with payload `{}`, then inspect that new run's output. Do not submit a quotation as a payload.

If the run remains pending, keep the worker connected and rerun the script to inspect the same run. If it fails, inspect the fixed synthetic check's error and the connected development worker; do not silently treat a cached successful receipt as a new result. Stop this specific CLI with Ctrl+C after testing. This does not stop the personal web server or unrelated applications.

## Bounds and remaining work

The task is configured for a micro machine, 30-second maximum duration, one execution attempt and queue concurrency one. Development execution runs on the connected local machine; these settings do not establish production performance. Its parser input is fixed and small, with a 10-second abort signal, and it exposes no model or database action. The script polls at most 12 times, about five seconds apart, with a 90-second process deadline; it preserves the run receipt on interruption.

No production task has been deployed by this setup. The smoke does not validate Linux native dependencies, OCR assets, hosted Neon Auth, S3 CORS/signing, quotation-job fences against real storage, production schedules, free compute billing or live AI reliability. A connected development CLI is not an always-on hosted worker. Configure and verify those paths using the [deployment guide](deployment.md).

Stay on Free. Trigger's documented organization billing limits apply to billable production/staging/preview environments, not Development, and are soft delayed limits. This bounded development check must not be represented as a paid-overage hard-stop test. [Billing-limit behavior](https://trigger.dev/docs/billing-limits).

Official references: [manual setup and version alignment](https://trigger.dev/docs/manual-setup), [development CLI](https://trigger.dev/docs/cli-dev-commands), [runtime configuration](https://trigger.dev/docs/config/config-file).
