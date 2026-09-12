# Free-tier deployment

The public fixture demonstration can be deployed independently of private processing. The private cloud path is implemented but requires configuration and hosted verification. AI stays disabled until its key and account confirmations are explicitly configured. This document does not assert that a hosted private pilot or live model has been verified.

## Public portfolio demonstration

1. Create a **new** Git repository and a **new** Vercel project for FieldOps; do not attach or modify an existing project.
2. Select the Next.js framework preset and Node.js 24. Install with `npm ci`, build with `npm run build`, and use the repository root as the project root.
3. Keep the project on Vercel Hobby. Leave all Supabase, Trigger and Groq credentials unset, and leave `FIELDOPS_LOCAL_MODE` unset or false. No local data directory or private documents belong in the deployment.
4. Deploy the repository and verify `/api/status` reports `mode: "demo"`, `canPersist: false`, `canUpload: false`, `canExtract: false`.
5. Check the labeled sample, source review, grouped matrix, workbook download, print report, keyboard navigation and narrow-screen layout on the actual URL.

Vercel Hobby is for personal, noncommercial use. Free-plan limits can interrupt service; do not purchase capacity for this release. [Vercel Hobby documentation](https://vercel.com/docs/plans/hobby).

No cloud worker or database is needed for this demonstration. Sample changes are stored in the visitor's browser. The deployment must describe them as fixtures rather than live extraction.

## Optional private pilot: configure later

Use dedicated Supabase Free and Trigger.dev Free projects only. If onboarding requires a purchase, a paid upgrade or an unwanted billing commitment, stop that setup and retain the public demo plus local workspace. Do not substitute a paid model, an existing desktop subscription token or an always-on paid worker.

### 1. Supabase database and private storage

Create a free project and apply every SQL file in `supabase/migrations` in filename order using the project's SQL Editor, or an established Supabase migration workflow:

1. `202609130001_fieldops.sql`
2. `202609130002_checkpoints.sql`
3. `202609130003_quota_resume.sql`
4. `202609130004_document_deletion.sql`
5. `202609130005_rolling_budget.sql`

These create the personal-workspace tables, invitation checks, RLS, transactional RPCs, version records, private `quotations` bucket, checkpoint storage and deletion/budget records. Do not make the bucket public or grant browser roles service-function execution. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and server-only `SUPABASE_SERVICE_ROLE_KEY` in the web deployment.

Supabase Free currently includes 500 MB database storage and 1 GB file storage, with inactivity pausing and additional quota limits. Capacity exhaustion is a recovery condition, not permission to upgrade. Check current limits before inviting users. [Supabase pricing](https://supabase.com/pricing), [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).

### 2. GitHub OAuth and numeric invitations

Create a GitHub OAuth application dedicated to FieldOps. Set its authorization callback URL to the exact Supabase callback displayed in the GitHub provider settings, normally `https://<project-ref>.supabase.co/auth/v1/callback`. Configure the GitHub client ID/secret in Supabase Auth. Set the Supabase site URL to the final FieldOps origin and allow its exact `/auth/callback` redirect. Set `FIELDOPS_SITE_URL` to that same origin on Vercel. [Official GitHub OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-github).

Populate `public.invited_accounts` with the invited person's **numeric GitHub user ID represented as text**, not a mutable username, email, Supabase UUID or user-editable profile field:

```sql
-- Replace the example values after independently confirming the intended GitHub identity.
insert into public.invited_accounts (github_user_id, label, active)
values ('REPLACE_WITH_NUMERIC_GITHUB_ID', 'Pilot buyer', true);
```

Replace the placeholder before running the SQL; it does not identify a real invited account. The API and database use provider-controlled GitHub identity data. Set `active=false` to revoke private access. Logging in without an invitation may create an Auth identity but does not grant workspace or storage access. This first release has personal workspaces, not collaborative team membership.

### 3. Trigger task deployment

This step is unnecessary while demonstrating fixtures or working locally. When the private pilot is ready, create a dedicated **Free** Trigger project, configure its plan spending limit, and select the option to cancel active runs on exhaustion where available. The free plan currently includes $5 monthly credits and production task deployments. Its billing-limit enforcement is delayed; it is not an instantaneous hard budget switch. Keep the organization on Free and never enable paid overages. [Trigger pricing](https://trigger.dev/pricing), [billing-limit behavior](https://trigger.dev/docs/billing-limits).

Set `TRIGGER_PROJECT_ID` in the deployment shell/configuration and the matching production `TRIGGER_SECRET_KEY` in the web deployment. In the Trigger production environment, configure the Supabase URL, anonymous key and service-role key required by the shared server configuration, plus `FIELDOPS_LOCAL_MODE=false`. Do not upload `.env.local` or `.fieldops/state.json`.

Prepare the OCR asset and deploy the pinned task CLI:

```powershell
npx tsx scripts/process.ts --prepare-ocr
npx trigger.dev@4.5.16 deploy
```

`trigger.config.ts` externalizes native/parser dependencies and bundles only `.fieldops/tessdata/**` as additional data. Worker environment variables must be configured in Trigger; deployment does not automatically copy local secrets. Confirm the deployed Node runtime supports the pinned PDF.js/native packages with a synthetic file before allowing private uploads. [Trigger deployment documentation](https://trigger.dev/docs/deployment/overview).

The document task uses one concurrent worker, a ten-minute active runtime limit and persisted application retries. A micro task runs every 15 minutes to retry pending dispatches and deletion work. The database reserves USD 0.13 of estimated compute credit per new job or explicit retry and rejects reservations beyond USD 3.50 across the stricter of the calendar month and rolling 31 days. That permits at most 26 reservations within the window and leaves part of the $5 free credit for scheduling and overhead. Failures and deletions do not refund reservations. These are conservative application estimates, not measured provider billing or a provider hard-stop guarantee.

### 4. AI remains disabled

Leave `GROQ_API_KEY` empty and both confirmation flags false in the web and worker environments. Hosted uploads deliberately remain unavailable until authentication, storage, worker and model readiness checks all pass. Local real parsing and manual entry remain usable.

A future explicit configuration step must confirm the actual Groq Free Plan and retention setting, set the allowed model, and evaluate real model responses before making performance claims. The boolean environment flags record the operator's confirmation; they cannot verify provider-account settings. There is no subscription-token bridge or paid fallback.

## Hosted acceptance before private documents

Use synthetic fixtures for these checks:

- Invited sign-in works; uninvited, logged-out and second-user requests cannot read another workspace, run or source.
- A file uploads directly to the private bucket, finalizes once, reaches the worker and preserves actual source locations. The web server does not proxy a 20 MiB file through a Vercel request body.
- Repeated finalize/dispatch, cancellation, worker interruption and a stale correction do not duplicate work or overwrite newer edits.
- Quota exhaustion produces a visible blocked state and does not trigger a paid fallback.
- Document deletion removes app access immediately, retains other quotations and eventually clears its storage object through the deletion outbox.
- Source access redirects to an owner-checked 60-second URL; public unauthenticated storage access fails.

The direct-upload and source-redirect design accommodates Vercel's 4.5 MB function request/response payload limit. [Vercel function limits](https://vercel.com/docs/functions/limitations).

If a free platform is paused, exhausted or unavailable, show the labeled demo and restore local processing. Do not expose local mode as an internet-accessible substitute.

Official documentation and free-tier figures were checked on 2026-09-13; recheck them during deployment because provider plans can change.
