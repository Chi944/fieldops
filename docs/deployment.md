# Free-tier deployment

FieldOps uses Vercel Hobby for the web application, Neon Free for PostgreSQL, managed Auth and private object storage, Trigger.dev Free for durable processing, and an explicitly configured Groq Free account for AI. The fixture demonstration and local manual workspace remain usable without these services. Hosted private processing and live model quality require separate acceptance checks.

## Current setup state

The dedicated Vercel Hobby project is connected to [Chi944/fieldops](https://github.com/Chi944/fieldops), with production branch `main` and Git deployments enabled. Its canonical address is [fieldops-eight-blue.vercel.app](https://fieldops-eight-blue.vercel.app). The connection was checked through Vercel's project API on 13 September 2026; it previously had no Git link. Pushing application changes to `main` now starts a Vercel deployment. GitHub Actions verifies code separately; a Git connection alone does not wait for that workflow to pass.

The active Neon Free project is `jolly-queen-28409793`, branch `br-sweet-sun-ayzs00zw`, in the owner's directly authenticated account. It replaces the inaccessible Vercel-marketplace project `still-queen-31894018`. No comparisons or private documents were copied. The restricted database login, 16 RLS tables and numeric GitHub invitation passed live permission checks. Managed Auth, private storage and exact-origin CORS are configured; actual synthetic signed upload/download, unsigned-access denial and cleanup passed. See [database verification](neon-replacement-verification.md) and [Auth/storage verification](neon-direct-setup.md).

New database, Auth, storage and production Trigger settings are saved as sensitive Vercel production variables. Only the restricted database and storage settings go to Trigger; migration-owner and OAuth secrets do not. Hosted processing is parser-only while live model reliability is evaluated. Actual invited GitHub sign-in, two pasted synthetic originals through production processing, source-linked manual review, matching, comparison and Excel export passed. Sign-out hides private comparisons; signing back in restores saved work. See the [hosted acceptance record](hosted-acceptance.md) for the exact scope and remaining gates.

Trigger Free and CLI authentication are verified, all three tasks are registered in Development, and its synthetic health task passed. The organization uses the included-plan billing limit with cancellation of active runs enabled. Application reservations retain headroom below the included credit; provider caps are soft and are not the sole safeguard. Groq's dedicated FieldOps project is on Free with inference Zero Data Retention enabled. Tiny synthetic live extractions passed; larger development probes exposed structured-output failures, which remain recorded. The held-out benchmark has not been run.

Every service must stay on its Free/Hobby plan. No payment details, upgrade, paid fallback or new paid service is authorized. Neon object storage is free **during the current beta**, not a permanent free-storage promise. Stop using that cloud storage if free access ends; local originals/manual review and the fixture demo remain available. Consult [release verification](release-verification.md) for revision-specific checks.

## Public fixture demonstration

Use the existing dedicated FieldOps project, Next.js preset, Node.js 24, `npm ci` and `npm run build`. For a separate fixture-only deployment, leave custom Neon runtime/Auth/storage, Trigger and Groq configuration unset and `FIELDOPS_LOCAL_MODE=false`. `/api/status` must report `mode: "demo"`, `canPersist: false`, `canUpload: false`, and `canExtract: false`. Samples are labeled fictional and changes stay in the visitor's browser.

Vercel Hobby permits personal, noncommercial use. Stay on Free/Hobby plans throughout; capacity exhaustion is a visible recovery condition, not permission to buy an upgrade. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Neon pricing](https://neon.com/pricing).

## 1. Neon database and restricted runtime

For a fresh installation, use a dedicated Neon project and branch with managed Auth already enabled. Apply `neon/migrations/202609180001_fieldops.sql` once, inside one transaction, using the migration-owner connection. It creates FieldOps tables, RLS, invitations, transactional mutation functions, source/job/version records, budget reservations and deletion records. Do not recreate or replace managed `neon_auth` tables. Historical migrations for the previous backend are not the active deployment path.

Follow [Neon database setup](../neon/README.md) to create the restricted `fieldops_runtime` login and grant it `fieldops_server`. Set `FIELDOPS_DATABASE_URL` to that login's TLS connection string in **Vercel production and Trigger production**. The runtime must not own tables or have superuser, role-creation or RLS-bypass privileges. The integration's `DATABASE_URL` remains a migration credential; application code deliberately never falls back to it. Keep migration credentials out of the worker environment and browser bundles.

Every database operation sets the restricted role inside the same transaction as its parameterized query. Runtime reads are trusted-server reads with explicit owner scopes; this is not a public browser Data API. Mutation functions enforce owner, revision and job fences. See [security boundaries](security-and-retention.md).

Neon Free has finite database, compute, object-storage and transfer allowances. Confirm the actual project's plan and limits before admission. A database pause or exhausted allowance must not cause a paid upgrade or provider switch. Managed Auth and object storage are evolving services: verify branch endpoints and current beta restrictions. [Neon Auth](https://neon.com/docs/auth/overview), [Neon object storage](https://neon.com/docs/storage/overview).

## 2. Managed Auth, GitHub and invitations

Open the dedicated project in the directly authenticated Neon account and verify its project/branch IDs. Use the Neon CLI configuration for this account; the abandoned marketplace activation flow is not required. Create a GitHub OAuth application dedicated to FieldOps, then configure its client ID and secret in this branch's Neon Auth GitHub provider settings. Do not configure a different organization's project merely because its console is accessible. There are two different callbacks:

| Setting | Exact destination |
| --- | --- |
| GitHub OAuth application's authorization callback | `${NEON_AUTH_BASE_URL}/callback/github`, using the actual branch Auth base URL without duplicating a trailing slash |
| FieldOps return after managed sign-in | `https://fieldops-eight-blue.vercel.app/auth/callback` |
| Neon Auth trusted origin | `https://fieldops-eight-blue.vercel.app` |
| Vercel `FIELDOPS_SITE_URL` | `https://fieldops-eight-blue.vercel.app` |

Set `NEON_AUTH_BASE_URL` to the branch Auth endpoint and generate a separate random `NEON_AUTH_COOKIE_SECRET` of at least 32 characters. Configure both on Vercel only. Keep the GitHub client secret in Neon provider configuration, not frontend code. Add another trusted origin only if that exact preview/custom domain needs private access; do not allow every preview hostname. FieldOps uses `/auth/login`, managed `/api/auth/*` handlers and `/auth/callback` to complete the session handoff. [GitHub provider setup](https://neon.com/docs/auth/guides/setup-oauth), [trusted domains](https://neon.com/docs/auth/guides/configure-domains), [Next.js server SDK](https://neon.com/docs/auth/reference/nextjs-server).

Use administrative SQL to invite the intended person's immutable **numeric GitHub user ID as text**:

```sql
-- Replace the placeholder with the independently verified GitHub numeric ID.
insert into public.invited_accounts (github_user_id, label, active)
values ('REPLACE_WITH_NUMERIC_GITHUB_ID', 'Personal buyer', true);
```

Do not use email, username, a Neon UUID or editable profile metadata. The server validates the SDK session, then checks the current managed session, linked GitHub account, ban status and active invitation against PostgreSQL on every private request. Set `active=false` to revoke access. Signing into Neon Auth without an invitation does not grant FieldOps data access. This release has personal workspaces, not shared team membership.

## 3. Private Neon object storage

Create a **private** `quotations` bucket on the same dedicated Neon branch. Generate a branch storage credential with the documented read/write scope, then configure these on Vercel and Trigger:

- `NEON_STORAGE_ENDPOINT`: the HTTPS branch S3 endpoint containing `.storage.` and ending in `.neon.tech`.
- `NEON_STORAGE_ACCESS_KEY_ID`: the credential's `token_id`.
- `NEON_STORAGE_SECRET_ACCESS_KEY`: its `s3_secret_access_key`, returned when the credential is created.
- `NEON_STORAGE_REGION=us-east-2` for this Ohio project.
- `NEON_STORAGE_BUCKET=quotations`.

These are Neon credentials used with the S3-compatible SDK; an AWS account is unnecessary. Keep them server-only and revoke leaked credentials explicitly. Do not rely on credential expiry, object lifecycle rules or versioning unless the current Neon service documents and verifies their enforcement. Use Neon's bucket access controls, not unsupported S3 ACL settings. [Storage credentials](https://neon.com/docs/storage/authentication), [private buckets](https://neon.com/docs/storage/buckets), [S3 compatibility](https://neon.com/docs/storage/s3-compatibility).

Configure bucket CORS for the exact application origin. This S3 configuration supports direct uploads and source reads; the provider handles preflight OPTIONS automatically:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://fieldops-eight-blue.vercel.app"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "range"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }]
}
```

An authenticated upload reserves its owner, size, SHA-256 and processing mode. The browser PUTs exact bytes to a five-minute signed **staging** URL using the returned method and headers; the browser supplies the signed Content-Length. Finalize checks HEAD size, bounds the downloaded stream, validates its hash and saves the canonical original using server credentials. The browser never receives a PUT URL for that canonical path. The adapter does not claim Neon enforces conditional `If-None-Match` writes. Verify signed headers, CORS and replay behavior against actual storage before admitting private files.

Original links require ownership and redirect to a 60-second signed GET URL. Direct upload/download avoids Vercel's 4.5 MB function payload limit. [Signed object access](https://neon.com/docs/storage/objects), [Vercel function limits](https://vercel.com/docs/functions/limitations).

## 4. Trigger development check and production worker

The dedicated project is `proj_gqdrztfnxotydnuhiaku`, the default in `trigger.config.ts`; `TRIGGER_PROJECT_ID` can explicitly override it. The npm registry check found SDK, build extension and CLI version **4.5.16** to be current. SDK and build extension are both pinned exactly to `4.5.16`: the CLI rejected a caret build-extension declaration even though it resolved to the same installed version. Keep these declarations and CLI version aligned. The config explicitly remains in `tsconfig.json`'s include list and `.trigger/` is gitignored. [Official manual setup](https://trigger.dev/docs/manual-setup).

Development setup is verified under account `Chi944` on Free. The default-profile CLI registered all three tasks with `node-24`, version `20260912.1`. The development-only key named **FieldOps local development** is stored in ignored `.env.trigger.local`; no production key was substituted. Its configured expiry is 12 December 2026. See [the development guide](trigger-development.md) for its access scope, exact verified run and repeatable checks.

For a fresh checkout, sign in using the default CLI profile and configure the project's **development** `TRIGGER_SECRET_KEY` in `.env.trigger.local`, with `TRIGGER_PROJECT_ID=proj_gqdrztfnxotydnuhiaku`, `FIELDOPS_PROCESSING_MODE=parse_only` and false Groq confirmation flags. Keep database, storage and model credentials out of this smoke-test environment. Never paste the key into a terminal argument or task payload.

```powershell
npx trigger.dev@4.5.16 login --skip-telemetry
npx trigger.dev@4.5.16 whoami --skip-telemetry
npx trigger.dev@4.5.16 dev --env-file .env.trigger.local --skip-telemetry
```

Keep that process running, then run `npx tsx scripts/trigger-smoke.ts` from a second terminal. The script submits or resumes its saved development run. For a fresh execution after code changes, use the Development dashboard to test `fieldops-health-check` with payload `{}`; an existing receipt makes the script inspect its previous run. The task uses `task()`, is configured for micro/30 seconds/one attempt/concurrency one, and checks a fixed in-memory CSV plus Decimal arithmetic. The actual run `run_06g9f02hnt6o8ef655fuqn0r01` reached **COMPLETED**, with 18 source cells, a USD `251.30` total, and zero model/database/private-file calls. Its nonsecret receipt is `.fieldops/trigger-dev-smoke.json`. No real quotation belongs in the payload. [CLI development mode](https://trigger.dev/docs/cli-dev-commands).

This development check does not deploy tasks or verify Linux OCR, production scheduling, Neon access or live AI. The quotation and reconciliation tasks remain present and retain their existing guards. Test only the synthetic health check until their required production configuration is complete. Stop this specific development CLI with Ctrl+C when finished.

For production later, keep the dedicated project on **Free**. Set its organization billing limit to the plan limit and enable cancellation of in-progress runs on exhaustion. Free currently includes $5 monthly credits and production deployments. Billing enforcement is delayed; it is not an instantaneous hard cap, and the documented billing-limit control does not cover the development environment. Do not upgrade, enable paid overages or share the budget with unrelated tasks. [Trigger pricing](https://trigger.dev/pricing), [billing limits](https://trigger.dev/docs/billing-limits).

Set `TRIGGER_PROJECT_ID` in the deployment shell and both hosted runtimes. Configure the corresponding production `TRIGGER_SECRET_KEY` in Vercel and ensure it is available to the Trigger worker. It must support task triggering and run cancellation; a trigger-only key cannot cancel. Use the narrowest suitable preset available on Free. [API-key permissions](https://trigger.dev/docs/apikeys).

Configure the worker's database, storage and processing variables using the [environment matrix](setup.md#environment-reference). Worker secrets must be entered in Trigger production separately; deployment does not copy `.env.local`, `.env.cloud.local` or Vercel secrets automatically. Do not add the migration-owner database URL, Auth cookie secret or GitHub client secret to the worker. Start with `FIELDOPS_PROCESSING_MODE=parse_only` and `FIELDOPS_LOCAL_MODE=false` in both runtimes. [Worker environment variables](https://trigger.dev/docs/deploy-environment-variables).

After development acceptance and production configuration, prepare OCR data and inspect the pinned deployment before publishing tasks. These are later production steps, not part of the development smoke run:

```powershell
npx tsx scripts/process.ts --prepare-ocr
npx trigger.dev@4.5.16 whoami --skip-telemetry
# Only if the dedicated Free account is not connected:
npx trigger.dev@4.5.16 login --skip-telemetry
npx trigger.dev@4.5.16 deploy --dry-run --skip-telemetry
npx trigger.dev@4.5.16 deploy
```

`trigger.config.ts` selects `node-24`, supported by the installed SDK 4.5.16 and PDF.js version. Do not replace it with the older unversioned `node` runtime. The application targets Node 24 as well. [Runtime configuration](https://trigger.dev/docs/config/config-file).

The worker externalizes PDF.js, `@napi-rs/canvas`, Sharp, Tesseract.js and ExcelJS. Its only additional data glob is `.fieldops/tessdata/**`; verify `eng.traineddata.gz` is present. Inspect dry-run dependencies for matching versions, security overrides and Linux native optional dependencies. Windows import tests do not verify the deployed Linux image. Do not copy Windows binaries or private `.fieldops/personal` data into the worker. Leave local path overrides unset. [Additional files](https://trigger.dev/docs/config/extensions/additionalFiles), [Sharp installation](https://sharp.pixelplumbing.com/install/), [Trigger deployment](https://trigger.dev/docs/deployment/overview).

The document queue has concurrency one and a ten-minute active runtime limit. Application records persist retries, leases and quota checkpoints; the platform task itself has one attempt. A micro reconciliation task runs every 15 minutes to recover dispatches and sweep at most 50 pending object deletions. Check that both tasks are deployed and the schedule is active.

The database reserves USD 0.13 of estimated compute credit per new job or explicit retry. It rejects reservations beyond USD 3.50 across the stricter of the calendar month and rolling 31 days: at most 26 reservations, with free-credit headroom for schedules and overhead. Failure or deletion does not refund reservations. These are application estimates, not measured provider billing or a hard-stop guarantee.

## 5. Activate the free AI integration deliberately

First verify parser-only processing on synthetic originals. A readable upload should reach `source_ready` and support manual entry, evidence review, matching and export. Incomplete source coverage must remain visible. Admission pins the processing mode; finalization and retry cannot promote an existing parser-only source to AI.

Then sign into Groq, confirm the actual account is on its Free Plan, enable Zero Data Retention in Data Controls, and create a dedicated API key. Configure `FIELDOPS_PROCESSING_MODE=ai`, `GROQ_API_KEY`, an allowed `GROQ_MODEL`, `GROQ_FREE_TIER_CONFIRMED=true` and `GROQ_ZDR_CONFIRMED=true` in **both Vercel and Trigger production**. Allowed models are `openai/gpt-oss-120b` (default) and `openai/gpt-oss-20b`. Do not set confirmation flags before checking the account. They record operator confirmation; they cannot verify provider settings. [Groq data controls](https://console.groq.com/docs/your-data), [rate limits](https://console.groq.com/docs/rate-limits).

Use a newly uploaded synthetic quotation to verify structured extraction, source references, quota waits and recovery. A configured key or `canExtract: true` is not proof of a successful model request or accuracy. Publish measured model results only after running the held-out evaluation. If Free service is unavailable, keep manual review available; there is no paid fallback or bridge from Claude, Codex or Cursor desktop subscriptions. The personal launcher independently forces local parser-only mode.

## Hosted acceptance before private documents

Use synthetic documents and controlled test identities for these checks:

- Invited sign-in works. Uninvited, revoked, banned, logged-out and second-user requests cannot read another workspace, run or source.
- Direct upload CORS and signed headers work; wrong sizes and hashes fail; retrying a matching unfinished upload resumes its intent. Concurrent files preserve each successful result.
- Finalization, dispatch retries, cancellation, interruption and stale corrections do not duplicate work or overwrite newer edits. Source-ready terminal records remain fenced.
- The deployed Linux worker parses a text PDF, scanned PDF/image and XLSX with actual source locations, and reports incomplete coverage honestly.
- Free quota and compute exhaustion remain visible and never cause a paid fallback.
- Original access requires ownership and uses a 60-second signed GET; unauthenticated bucket access fails.
- Deletion revokes application access immediately. Its outbox deletes canonical and staging objects, retains a tombstone for at least six minutes, then repeats physical deletion before clearing it. Verify a staging-ticket replay during that interval is removed by a later successful sweep.
- If AI is enabled, verify real responses and held-out source/matching accuracy before claiming live reliability.

Six minutes is the minimum tombstone age, not a cleanup deadline. A paused, exhausted or unconfigured worker delays sweeps. Abandoned upload expiry, overall storage admission limits and hosted backup/restore are still follow-up work. See [retention details](security-and-retention.md). Keep private processing disabled if these acceptance checks fail; the labeled demo and loopback personal workspace remain the recovery path.
