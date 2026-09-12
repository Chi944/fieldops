# Next release: a private live pilot

Reviewed 13 September 2026 against the current implementation and official provider documentation. This is a recommendation, not a record of new provisioning or deployed changes. AI remains disabled under the user's existing instruction.

Keep **Supabase Free + Trigger.dev Free + the existing Vercel Hobby deployment** for the next release. The next milestone is an invited private workspace that accepts real quotations, parses their sources, supports manual review, and survives failures. AI activation and measured AI reliability are a separate, explicitly gated milestone.

## What works, and what still blocks live operation

The public [FieldOps demonstration](https://fieldops-eight-blue.vercel.app) is deployed. Its sample quotations are labeled fixtures. Actual local parsing, source review, manual entry, matching, corrections, persistence and exports work with AI disabled. The UI refinement passed 95 unit/integration tests, seven local browser workflows and five public browser workflows; see [release verification](release-verification.md) and [acceptance status](acceptance-status.md).

| Gap | Evidence in the current repository | Practical consequence |
| --- | --- | --- |
| Hosted services are unconfigured | [Deployment record](deployment.md): public deployment has no environment variables; Supabase/Auth/Trigger are unconfigured | Visitors cannot save private comparisons or upload their own files |
| Hosted uploads require AI readiness | [Capability checks](../src/lib/server/config.ts), enforced by [upload service](../src/lib/server/service.ts): cloud `canUpload` requires Supabase, an authenticated user, Trigger **and** a configured model | Adding a database and worker alone cannot deliver the useful manual workflow while AI remains disabled |
| Hosted platform behavior is unverified | SQL tests use real PostgreSQL migrations with Supabase platform schemas stubbed; [worker configuration](../trigger.config.ts) has not been deployed | OAuth sessions, signed storage, native OCR dependencies, queue recovery and deletion need tests on the actual services |
| Capacity and operations need a pilot boundary | [Retention policy](security-and-retention.md): unfinished upload intents never expire automatically; [repository](../src/lib/server/cloud-repository.ts) implements deletion retries but no workspace storage allowance | A small number of active users can exhaust free storage through many comparisons or abandoned uploads; failed cleanup needs an operator-visible signal |
| AI results have not been measured | [Evaluation report](evaluation-report.md) measures offline parsing and baseline matching; [AI adapter](../src/lib/ai/groq.ts) has no verified live run | Baseline results cannot be presented as extraction accuracy, semantic matching accuracy or model safety evidence |

Current readiness checks establish configuration presence, not successful access to the provider. Keep operational health separate from whether an environment variable exists. The cloud repository also uses a service-role client, so owner checks and transactional RPC validation remain essential alongside browser-role RLS.

## The next five tasks

### 1. Configure and verify invited private workspaces

Use dedicated Free projects and the [existing setup procedure](deployment.md). Apply all five migrations, configure the private `quotations` bucket, GitHub OAuth callbacks and the server-only keys, then add invited **numeric GitHub IDs** to `invited_accounts`. Keep model credentials unset. A small pilot should use personal workspaces; shared team administration is unnecessary for this milestone.

**Acceptance:** two invited synthetic accounts can each create, edit and reopen comparisons; an uninvited account is denied; user A cannot read user B's comparison, document, job or signed-source endpoint; logout and invitation revocation work. Verify the actual hosted policies and callbacks, not only the embedded SQL tests. No real supplier documents are needed for these checks.

### 2. Ship hosted parsing and manual recovery with AI disabled

Separate upload/persistence/parser capabilities from extraction capability. Add an explicit persisted parsing-only processing mode and a clear successful state such as “Source ready — enter quotation details.” Retain incomplete interpretation as a review issue; a parser completing successfully must not claim AI extraction completed. Avoid automatically retrying an intentionally disabled model.

Deploy the existing Trigger tasks with the pinned native parser dependencies and English OCR asset. Preserve one-file-at-a-time processing, source hashes, duplicate/revision handling, resumable checkpoints and cancellation fences. Use the same source-linked manual entry and audited corrections already available locally.

**Acceptance:** a synthetic PDF, scan, XLSX and pasted quotation each travel through hosted upload, parsing, manual review, matching, matrix and export. A mixed batch retains successful files when another fails. Interrupt, cancel, repeat upload/finalize, retry and edit during processing; no stale result may replace a newer correction. Assert that no model request is made throughout these tests.

### 3. Add storage admission, cleanup and operational recovery

Add persistent per-workspace byte/document allowances and reserve capacity before issuing an upload URL. Set an explicit expiry for abandoned upload intents, reconcile orphaned objects, and release capacity only after verified deletion. Bound comparison/version growth while retaining the audit information promised to the user. Make queued work, oldest lease, failed deletion, remaining reservations and last successful reconciliation visible in an operator diagnostic view without document contents.

Add a tested backup-and-restore procedure for both database records and private objects. Supabase Free does not include automatic backups or point-in-time recovery; exported workbooks do not replace a recoverable application backup. Do not promise an uptime guarantee on a free pilot. [Supabase plan details](https://supabase.com/pricing).

**Acceptance:** exceeding a quota refuses new work while preserving existing comparisons; expired uploads release their objects and reservation; a failed deletion retries successfully; a synthetic workspace can be restored with its source links and correction history intact. Show a useful recovery state when a free service pauses or becomes unavailable.

### 4. Validate real free-tier resource use

Measure actual Trigger compute and parser duration against the existing conservative USD 0.13 job reservation and USD 3.50 calendar/rolling allowance. Include scheduled reconciliation and failed runs. Confirm the account remains Free, with its limit controls enabled, and verify that budget exhaustion stops new admission. Trigger documents delayed billing-limit enforcement, so the application estimate is not an instantaneous provider billing guarantee. [Trigger billing limits](https://trigger.dev/docs/billing-limits).

Before later enabling AI, replace the adapter's process-local daily/minute token counters with a persistent shared reservation ledger used by worker extraction and web matching. Counters currently reset with a process and are not shared across instances. Also move semantic matching into a durable job if measured duration or quota waits exceed the web request budget.

**Acceptance:** concurrent admissions and restarted processes cannot bypass the application allowance; a quota wait resumes saved work; reports distinguish reserved credits, measured runtime and provider-reported usage. This work can be tested with injected quota responses while AI stays disabled.

### 5. Enable AI only in a later authorized, evaluated step

When the user explicitly configures the permitted free provider, verify its actual account plan and retention settings, then run development examples before freezing the prompt/parser/model configuration. Run the held-out set once the configuration is frozen. Publish actual denominators for field accuracy, row detection, matching precision/recall, false comparisons, missed ambiguities, semantic source correctness, latency and usage; compare matching against the existing baseline. Preserve “insufficient information” when the evidence cannot support a comparison.

**Acceptance:** the [reproducible evaluator](evaluation-report.md) produces a dated live report with dataset/configuration hashes and substantive failures. Any material extraction or matching defect has a regression case. Desktop Claude/Codex/Cursor subscriptions are not used as application API credentials. Until then, keep the live adapter disabled and describe the app as a demo plus real parsing/manual comparison.

## Neon versus Supabase for FieldOps

Neon now offers authentication and object storage as well as PostgreSQL. A comparison that calls it database-only is outdated. The relevant question is whether its benefits justify changing this application's implemented private-workspace boundary.

| Consideration | Supabase | Neon | FieldOps implication |
| --- | --- | --- | --- |
| Free database | 500 MB; two active Free projects; projects pause after one inactive week | 0.5 GB/project; 100 CU-hours/project monthly; scale-to-zero; ten branches/project | Both suit a bounded pilot. Neon branching is useful for isolated environments; neither removes capacity planning |
| Authentication | Social OAuth and Auth integrated with PostgreSQL; current application uses Supabase sessions and provider identities | Managed Better Auth in beta, with GitHub OAuth, branch-local auth data and Data API/RLS integration | Neon can support invited users, but session handling and the numeric GitHub allowlist lookup must be reimplemented and verified |
| Private source storage | 1 GB Free storage; access policies use PostgreSQL RLS on `storage.objects` | S3-compatible Object Storage beta; 5 GB Free/project, private buckets and presigned GET/PUT URLs; currently Ohio and Frankfurt | Neon has a larger stated free file allowance, but source signing/deletion and per-user authorization need a new adapter |
| Background work | Current app already implements its durable lifecycle on Trigger | Neon Functions are in beta; their documentation explicitly directs independent lifecycle/cancellation work to a dedicated job system | Changing databases would not remove the need for durable processing |
| Change required now | Configure the existing integration, fix the parsing-only gate and run hosted acceptance | Replace auth/session integration, adapt repository access and service RPCs, rewrite platform-specific identity/storage policies, then repeat hosted acceptance | Keep Supabase to spend the next release on working private comparisons |

Database/plan figures: [Supabase pricing](https://supabase.com/pricing), [Neon pricing](https://neon.com/pricing). Authentication: [Neon Managed Better Auth](https://neon.com/docs/auth/overview), [GitHub OAuth setup](https://neon.com/docs/auth/guides/setup-oauth). Object access: [Supabase storage RLS](https://supabase.com/docs/guides/storage/security/access-control), [Neon Object Storage](https://neon.com/docs/storage/overview), [presigned requests](https://neon.com/docs/storage/objects). Worker lifecycle: [Neon Functions runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits).

Neon's beta storage has operational qualifications: lifecycle and object-versioning configurations are stored but not enforced, and storage-credential `expires_at` is not currently enforced. Presigned URL expiry is a separate supported mechanism. An implementation must keep credentials on the server, enforce user ownership before signing an object URL, and implement cleanup itself. [Storage limitations](https://neon.com/docs/storage/s3-compatibility), [credential behavior](https://neon.com/docs/storage/authentication).

Both choices can start at USD 0 within their Free allowances. Neon states that Free requires no credit card and suspends compute when applicable limits are reached; Object Storage and Functions are currently free during beta with usage limits. Do not treat beta pricing as a permanent paid-service guarantee. Supabase Pro starts at USD 25/month; Neon Launch is metered without a monthly minimum. Those paid plans are outside the current constraint. [Neon pricing](https://neon.com/pricing), [Supabase pricing](https://supabase.com/pricing).

Moving now would have no known live supplier data to transfer, but still requires changing the Supabase-specific `auth.users`/`auth.identities` references, session cookies, service-role RPC calls and storage policies in [migrations](../supabase/migrations), [request authorization](../src/lib/server/context.ts) and [cloud repository](../src/lib/server/cloud-repository.ts). The shared domain, calculations, parsers, UI and much of the job lifecycle can remain. A hybrid Neon database plus Supabase Auth/Storage adds another integration without resolving the present blockers.

Reconsider Neon if branch-isolated test environments or a demonstrated Supabase capacity limitation becomes more valuable than the migration effort. For the current release, better hosted verification and a usable manual workflow provide the more direct improvement.

## Scope after the private pilot

Prioritize a review screen for accepting/diffing later extraction versions, broader editing of complex commercial rules, and evidence-backed improvements found by actual AI evaluation. Shared teams, DOCX, handwriting, broad multilingual OCR, graduated tiers, automatic bundle/tax allocation and ERP/email integrations remain later work. Adding them before hosted recovery and isolation are verified would widen the unverified surface without completing the central quotation workflow.
