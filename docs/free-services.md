# Free-service operating limits

Reviewed against public provider documentation on 2026-09-13. These are capacity estimates, not measured bills or a promise of uninterrupted free hosting. Keep every provider on its Free plan; quota exhaustion must pause processing or leave manual review available. Never enable a paid plan, paid fallback, automatic top-up, or subscription-token bridge to make a failed job continue.

## Trigger compute allowance

Current published rates are USD 0.0000850/second for `medium-1x`, USD 0.0000169/second for `micro`, and USD 0.000025 for each managed run that starts. Free includes USD 5/month; continuing beyond that allowance requires an upgrade. Development runs are uncharged. [Trigger pricing](https://trigger.dev/pricing).

| Workload | Conservative calculation | USD |
| --- | --- | ---: |
| One document platform execution | 600 seconds × medium-1x rate + invocation | 0.051025 |
| Two ordinary document executions | Two maximum-length executions | 0.102050 |
| SQL reservation per new job or explicit retry | Preserved after failure or deletion | 0.130000 |
| Maximum admitted reservations | 26 × 0.13; the 27th would exceed 3.50 | 3.380000 |
| One production reconciliation schedule for 31 days | 2,976 runs × (20 seconds × micro rate + invocation) | 1.080288 |
| Reservations plus reconciliation | Full reserved workload and maximum scheduled durations | 4.460288 |
| Remaining included credit in this estimate | 5.00 − 4.460288 | 0.539712 |

The SQL function takes an advisory transaction lock and uses the greater of calendar-month and rolling-31-day reservations, preventing a month-boundary admission burst. Both first admission and explicit retry reserve credit. The document queue has concurrency one, a 600-second platform limit, and one platform attempt; application failure recovery permits two processing attempts. Quota waitpoints preserve completed chunks. `maxDuration` caps active execution rather than durable wait time. [Maximum duration](https://trigger.dev/docs/runs/max-duration).

The reconciliation cron is explicitly restricted to `PRODUCTION`, runs every 15 minutes on `micro`, and has a 20-second maximum with no platform retry. It admits dispatches before spending at most five seconds on optional object cleanup. A plain cron string would also apply to preview deployments, which would invalidate the single-schedule estimate. Do not add an imperative duplicate schedule. [Scheduled tasks](https://trigger.dev/docs/tasks/scheduled).

This estimate assumes **FieldOps is the only workload consuming this Trigger organization's credit**. Verify that operational fact before using the number as available capacity. Reservations do not read provider usage and do not include other projects, manual dashboard replays, synthetic health runs, historical usage after a database replacement, or failures before a database claim is recorded. A new database does not reset the provider's billing cycle. Keep existing reservations when migrating an active installation, or reduce new admissions by previously consumed credit.

The public pricing, CLI deployment, GitHub integration and Vercel integration pages reviewed do not state a separate build-fee rate. No zero build cost or unlimited deployment allowance has been verified. Check the actual deployment screen and usage ledger before repeated builds; stop if a paid option is required. The USD 0.539712 remainder is unallocated headroom, not a verified build quota. [Deployment](https://trigger.dev/docs/deployment/overview), [GitHub integration](https://trigger.dev/docs/github-integration), [Vercel integration](https://trigger.dev/docs/vercel-integration).

Use the provider's plan limit and cancellation setting as an additional guard. Trigger documents that limits apply organization-wide, are evaluated with a delay, and are **soft limits**. Alerts alone do not stop work. SQL admission is a conservative application allowance, not an invoice cap; staying on the provider's Free plan is essential to the no-paid-services policy. [Billing limits](https://trigger.dev/docs/billing-limits).

## Deployment and CI

Before deploying the worker from any fresh checkout, run:

```sh
npm ci
npx tsx scripts/process.ts --prepare-ocr
npx trigger.dev@4.5.16 deploy
```

The OCR command downloads English language data during setup. Runtime parsing uses the bundled asset. `.fieldops/tessdata` is intentionally ignored by Git and copied by Trigger's `additionalFiles` extension, so an automatic build must run the same preparation command before packaging. A successful TypeScript build alone does not prove that scanned quotations can be read. Automatic Trigger Git deployments should remain disabled until their pre-build asset step is configured and tested.

The verification workflow uses Node 24, the package lock, OCR setup, type checking, lint, unit/integration tests, a Next production build, and browser tests against that production build. It has no model credentials and disables the free-plan/data-policy gates. It does not provision providers or deploy Trigger tasks. Hosted Linux OCR, authentication, storage, worker scheduling and provider usage still require separate synthetic deployment checks. Keep provider secrets out of pull-request jobs and artifact uploads.

## Neon capacity and beta dependency

The published Neon Free allowance includes 100 CU-hours/month per project, 0.5 GB database storage and 60,000 monthly active Auth users. These are provider limits, not proof that FieldOps has that much unused capacity. Source evidence, correction history and checkpoints occupy database storage even when original files live in object storage. [Neon pricing](https://neon.com/pricing).

Neon Object Storage is currently a beta service available to try free. Its beta availability is not a permanent free storage contract. Recheck its current terms before expanding use; keep export/backup recovery available and stop cloud admission if continued storage requires payment. The application does not use Neon's AI Gateway or Functions. [Neon backend beta announcement](https://neon.com/blog/neon-backend-is-beta).

The hosted browser stops polling once processing reaches a terminal state and while the tab is hidden. It refreshes on focus or explicit actions, and pauses quota waits until their recorded retry time. This prevents an idle comparison from holding compute awake indefinitely. The production reconciliation schedule still wakes the database every 15 minutes. Assuming a fixed 0.25 CU and five-minute idle timeout, those wakes alone could use roughly 62 CU-hours over 31 days; this is an estimate, not actual usage. Watch the remaining Free allowance before expanding the pilot.

The storage beta has no automatic pricing-change detector in FieldOps. If its free access ends, disable cloud upload admission, export and remove retained cloud originals before any paid retention applies, and use the local workspace. Do not treat an upgrade prompt as permission to continue. No paid image-generation call, custom-domain purchase, card addition or provider upgrade is required for the current application.
