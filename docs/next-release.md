# Next release: a private live pilot

**Current decision:** The owner chose Neon only and requested hosted AI configuration. The dedicated Neon Free database is initialized and its restricted runtime connection is configured on Vercel. Managed Auth, Object Storage and Trigger are implemented but still require account setup and hosted acceptance. Groq activation awaits actual Free/ZDR confirmation and a key; it is no longer deferred by preference. The provider comparison below is retained as historical research, not current deployment guidance. See [current deployment instructions](deployment.md).

Use **Neon Free + Trigger.dev Free + the existing Vercel Hobby deployment** for the hosted pilot. Personal use is available locally without any cloud account: run `npm run personal`, upload real quotations, review their sources and enter the comparison details manually. Hosted acceptance and measured AI reliability remain separate milestones.

## What works, and what still blocks live operation

The public [FieldOps demonstration](https://fieldops-eight-blue.vercel.app) is deployed with labeled fixtures. The personal launcher uses isolated `.fieldops/personal` storage and a safe loopback port from 3001–3009. Personal comparisons and fictional samples have separate workspace views; only sample edits enter browser storage. Actual local parsing, source review, manual entry, matching, corrections, persistence and exports work with AI disabled. Hash-verified backup/restore tools preserve saved state and originals without overwriting an existing destination. See [personal-use instructions](personal-use.md).

The personal milestone's current unit/integration run passed **120 tests**. This does not establish hosted behavior or AI accuracy. Browser and deployment evidence is recorded separately in [release verification](release-verification.md) and [acceptance status](acceptance-status.md).

| Area | Current implementation and evidence | Remaining work |
| --- | --- | --- |
| Hosted services are unconfigured | [Deployment record](deployment.md): public deployment has no environment variables; Supabase/Auth/Trigger are unconfigured | Visitors cannot save private comparisons or upload their own files |
| Parser-only hosted admission is implemented | [Capability checks](../src/lib/server/config.ts) and [upload service](../src/lib/server/service.ts) permit authenticated uploads with Supabase and Trigger while AI is off; each upload/run keeps its selected processing mode | Configure the services and verify this flow on the actual hosted platforms |
| Source readiness and manual attestation are implemented | The [shared worker](../src/lib/server/jobs.ts) finishes complete parser-only work as `source_ready`; [manual review](../src/lib/server/service.ts) requires readable source coverage, supplier name and items, with later edits reopening review | Verify the hosted round trip; manual attestation is the buyer's assessment, not a claim of model extraction |
| Hosted platform behavior is unverified | SQL tests use real PostgreSQL migrations with Supabase platform schemas stubbed; [worker configuration](../trigger.config.ts) has not been deployed | OAuth sessions, signed storage, native OCR dependencies, queue recovery and deletion need tests on the actual services |
| Capacity and operations need a pilot boundary | [Retention policy](security-and-retention.md): unfinished upload intents never expire automatically; [repository](../src/lib/server/cloud-repository.ts) implements deletion retries but no workspace storage allowance | A small number of active users can exhaust free storage through many comparisons or abandoned uploads; failed cleanup needs an operator-visible signal |
| AI results have not been measured | [Evaluation report](evaluation-report.md) measures offline parsing and baseline matching; [AI adapter](../src/lib/ai/groq.ts) has no verified live run | Baseline results cannot be presented as extraction accuracy, semantic matching accuracy or model safety evidence |

Current readiness checks establish configuration presence, not successful access to the provider. Keep operational health separate from whether an environment variable exists. The cloud repository also uses a service-role client, so owner checks and transactional RPC validation remain essential alongside browser-role RLS.

## The next five tasks

### 1. Configure and verify invited private workspaces

Use dedicated Free projects and the [existing setup procedure](deployment.md). Apply all **six** migrations in filename order, including `20260913000600_personal_processing.sql`, configure the private `quotations` bucket, GitHub OAuth callbacks and the server-only keys, then add invited **numeric GitHub IDs** to `invited_accounts`. Keep model credentials unset and `FIELDOPS_PROCESSING_MODE=parse_only`. A small pilot should use personal workspaces; shared team administration is unnecessary for this milestone.

**Acceptance:** two invited synthetic accounts can each create, edit and reopen comparisons; an uninvited account is denied; user A cannot read user B's comparison, document, job or signed-source endpoint; logout and invitation revocation work. Verify the actual hosted policies and callbacks, not only the embedded SQL tests. No real supplier documents are needed for these checks.

### 2. Complete hosted parser-only acceptance

**Implementation complete:** upload and extraction capabilities are separate; document/run processing mode is persisted and cannot be promoted by retry; legacy uploads default to parser-only. Complete parsing ends in `source_ready` without calling an AI model. Unreadable sections remain partial. Source-linked manual entry and corrections are available, and the buyer must record a manual-review acknowledgement before the quotation becomes ready. Later corrections or added items reopen that review. Readiness does not remove missing prices, source requirements or commercial incompatibilities.

**Still required:** deploy the existing Trigger tasks with the pinned native parser dependencies and English OCR asset. Verify one-file-at-a-time processing, source hashes, duplicate/revision handling, resumable checkpoints and cancellation fences on the hosted services. The six migrations include `source_ready` terminal guards and pinned-mode checks; embedded SQL tests do not prove hosted deployment behavior.

**Acceptance:** a synthetic PDF, scan, XLSX and pasted quotation each travel through hosted upload, parsing, manual review, matching, matrix and export. A mixed batch retains successful files when another fails. Interrupt, cancel, repeat upload/finalize, retry and edit during processing; no stale result may replace a newer correction. Assert that no model request is made throughout these tests.

### 3. Add storage admission, cleanup and operational recovery

Add persistent per-workspace byte/document allowances and reserve capacity before issuing an upload URL. Set an explicit expiry for abandoned upload intents, reconcile orphaned objects, and release capacity only after verified deletion. Bound comparison/version growth while retaining the audit information promised to the user. Make queued work, oldest lease, failed deletion, remaining reservations and last successful reconciliation visible in an operator diagnostic view without document contents.

Local backup and restore are implemented and tested with synthetic originals, correction history, parsed evidence, jobs and checkpoints; see [personal-use instructions](personal-use.md). A separate hosted backup-and-restore procedure for PostgreSQL records and private objects still needs implementation and verification. Supabase Free does not include automatic backups or point-in-time recovery; exported workbooks do not replace a recoverable application backup. Do not promise an uptime guarantee on a free pilot. [Supabase plan details](https://supabase.com/pricing).

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
| Change required now | Configure the existing parser-only integration and run hosted acceptance | Replace auth/session integration, adapt repository access and service RPCs, rewrite platform-specific identity/storage policies, then repeat hosted acceptance | Keep Supabase to spend the next release on hosted private comparisons |

Database/plan figures: [Supabase pricing](https://supabase.com/pricing), [Neon pricing](https://neon.com/pricing). Authentication: [Neon Managed Better Auth](https://neon.com/docs/auth/overview), [GitHub OAuth setup](https://neon.com/docs/auth/guides/setup-oauth). Object access: [Supabase storage RLS](https://supabase.com/docs/guides/storage/security/access-control), [Neon Object Storage](https://neon.com/docs/storage/overview), [presigned requests](https://neon.com/docs/storage/objects). Worker lifecycle: [Neon Functions runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits).

Neon's beta storage has operational qualifications: lifecycle and object-versioning configurations are stored but not enforced, and storage-credential `expires_at` is not currently enforced. Presigned URL expiry is a separate supported mechanism. An implementation must keep credentials on the server, enforce user ownership before signing an object URL, and implement cleanup itself. [Storage limitations](https://neon.com/docs/storage/s3-compatibility), [credential behavior](https://neon.com/docs/storage/authentication).

Both choices can start at USD 0 within their Free allowances. Neon states that Free requires no credit card and suspends compute when applicable limits are reached; Object Storage and Functions are currently free during beta with usage limits. Do not treat beta pricing as a permanent paid-service guarantee. Supabase Pro starts at USD 25/month; Neon Launch is metered without a monthly minimum. Those paid plans are outside the current constraint. [Neon pricing](https://neon.com/pricing), [Supabase pricing](https://supabase.com/pricing).

Moving now would have no known live supplier data to transfer, but still requires changing the Supabase-specific `auth.users`/`auth.identities` references, session cookies, service-role RPC calls and storage policies in [migrations](../supabase/migrations), [request authorization](../src/lib/server/context.ts) and [cloud repository](../src/lib/server/cloud-repository.ts). The shared domain, calculations, parsers, UI and much of the job lifecycle can remain. A hybrid Neon database plus Supabase Auth/Storage adds another integration without resolving the present blockers.

Reconsider Neon if branch-isolated test environments or a demonstrated Supabase capacity limitation becomes more valuable than the migration effort. The manual workflow is now implemented; hosted verification provides the more direct next improvement.

## Scope after the private pilot

Prioritize a review screen for accepting/diffing later extraction versions, broader editing of complex commercial rules, and evidence-backed improvements found by actual AI evaluation. Shared teams, DOCX, handwriting, broad multilingual OCR, graduated tiers, automatic bundle/tax allocation and ERP/email integrations remain later work. Adding them before hosted recovery and isolation are verified would widen the unverified surface without completing the central quotation workflow.
