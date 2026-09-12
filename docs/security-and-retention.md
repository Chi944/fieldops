# Security and retention

FieldOps keeps private originals separate from the fictional sample workspace. The personal launcher provides one trusted buyer with a loopback-bound local server and isolated `.fieldops/personal` storage. Invited cloud workspaces are implemented but Supabase/Auth/Trigger provisioning and hosted acceptance remain outstanding. This is not a claim of audited production security or verified live AI.

## Access boundaries

- Cloud APIs validate the Supabase session with `getUser`, then require an active invitation tied to the provider-controlled numeric GitHub identity. Editable user metadata and email addresses never grant access.
- Every private repository operation scopes records to the authenticated owner. Unauthorized IDs return unavailable/not-found responses. PostgreSQL RLS independently restricts browser reads to invited owners; browser roles cannot invoke mutation RPCs or bypass private storage policy.
- The service-role key exists only in server and worker configuration. It is privileged, so worker/API ownership checks remain necessary even with RLS. Never place it in a `NEXT_PUBLIC_` variable or send it to the browser.
- Mutations check same-origin browser requests. OAuth callbacks use a configured fixed origin and do not accept an arbitrary return URL. Supabase SSR cookies handle the authenticated session.
- Local mode requires explicit configuration and loopback URL/Host values. Next's automatically inserted forwarding headers are accepted only for matching loopback authorities and a single loopback client; remote forwarding and chains are rejected. `npm run personal` binds to `127.0.0.1` on a free port from 3001–3009, never uses port 3000, and does not stop another process to free a port. Ordinary dev/start scripts also bind to loopback. Do not tunnel or publicly bind local mode: headers are not a substitute for the network boundary.
- Personal and sample workspaces have separate views and creation flows. Personal comparisons remain in the local/server repository; only records marked as fictional samples are saved under `fieldops-demo-v1` in browser storage. Sample comparisons do not accept private uploads. Resetting samples preserves personal comparisons.
- Runtime readiness returns flags and recovery reasons, never credentials. Public demo visitors cannot create private uploads through an unconfigured server.

## Private files and source links

Originals use opaque document IDs, SHA-256 integrity checks and owner-prefixed storage paths. The cloud `quotations` bucket is private. Signed upload tokens allow one intended object path without upsert; finalize verifies the uploaded bytes before creating processing work. Tokens must not be logged or shared.

Every source request first checks ownership. Local sources return private, noncacheable responses, with `nosniff` and a sandbox policy. Cloud sources redirect to a signed storage URL valid for **60 seconds** to avoid proxying large files through a web function. Anyone possessing that temporary URL can use it during its validity period; expiry is not an identity check. Do not include signed URLs in logs, exports, analytics or screenshots. Exports keep application/source references rather than temporary signed URLs.

## Document trust and model handling

Quotation contents are untrusted data. Parsing does not execute spreadsheet formulas or embedded document code. The model request frames source material as data, uses structured outputs and exposes no external tools. Returned fields and source IDs are validated; deterministic code handles arithmetic and comparability constraints. Instructions inside a quotation cannot authorize supplier contact, account changes or access to another document.

The current release defaults to `FIELDOPS_PROCESSING_MODE=parse_only`. Cloud upload admission no longer requires a model key: an authenticated owner, configured private storage and worker are sufficient. Each document and run records its selected processing mode; retries cannot promote a parser-only upload to AI processing. Legacy local records and the sixth SQL migration default missing modes to parser-only. Complete source parsing ends in the terminal `source_ready` state; unreadable coverage remains partial. Neither state claims that an AI model extracted quotation fields.

Manual review records the buyer's current assessment and reason. Completion requires readable source coverage, a supplier name and at least one entered item. The buyer is asked to check every original section and relevant commercial term; the application cannot prove that the buyer entered every item correctly. Added items or corrections reopen manual review. Arithmetic discrepancies, unavailable sources and incompatible commercial conditions remain separate checks.

AI remains disabled under the user's instruction. Future activation requires an explicit AI processing mode, a key, free-account confirmation and retention confirmation. Those flags express operator configuration, not proof of provider-account settings. If enabled later, bounded source chunks will be transmitted to the configured provider; review its current terms and retention settings first. The personal launcher independently forces parser-only mode and clears model/cloud credentials from its child environment, including values inherited from the shell; it does not edit the original configuration files. Desktop subscription credentials are never an alternative. Live prompt-injection resistance and semantic source correctness remain unverified until real evaluation.

Processing limits bound document size, page/cell counts, image pixels, item counts, concurrency, duration and retries. These reduce resource risk but are not a full sandbox against every malicious parser input. The private pilot should remain invited and use the documented supported inputs.

## What is retained

| Data | Current retention behavior |
| --- | --- |
| Public synthetic originals/fixtures | Kept in the repository/deployment as demo assets; contain no real supplier documents |
| Demo edits | Fictional sample records only in this browser's `localStorage` under `fieldops-demo-v1`; clear site data to remove the browser copy |
| Local originals, parsed source spans, runs, extraction versions, corrections and checkpoints | The personal launcher uses `.fieldops/personal`, separate from test data; `--data` can select a restored/custom directory. Ordinary local mode still uses `.fieldops` or `FIELDOPS_DATA_DIR`. Records persist until document/comparison deletion |
| Current manual-review acknowledgement | Stored with the quotation's review issues; later changes reopen the acknowledgement, and deletion removes it with the quotation |
| Cloud equivalents | When configured, persist in private storage and PostgreSQL until document/comparison deletion |
| Failed or cancelled work | Original and completed parse/chunks remain for review or retry; cancellation does not delete files |
| Unfinished cloud upload intent | Retained until explicit deletion; there is no automatic expiry cleanup in this first release |
| Downloaded workbook / saved PDF | Stored by the buyer outside FieldOps; deleting a comparison cannot recall downloads |
| Personal backup directories | State and referenced originals remain in the chosen private destination until the buyer removes that backup; app deletion does not remove older copies |
| Compute budget reservations | Minimal amount/time records persist after deletion so deleting work cannot bypass the free budget |

There is **no automatic age-based purge** of private originals, parsing results, checkpoints or backups in this release. No scheduled seven-day or 24-hour cleanup is claimed. Browser exports are generated on demand and not archived by the server. Per-workspace storage admission limits and automatic abandoned-upload/orphan cleanup remain follow-up work; existing per-file and job limits do not provide those controls.

## Deletion and backups

Deleting a document removes its active application record, parsed evidence, jobs, checkpoints, extraction records and related correction data. Other quotations remain. Groups referencing deleted rows are updated and require review. Cloud comparison snapshots containing a deleted source are removed to avoid retaining the original text through history. Deleting a comparison removes all its related private application data.

Object removal is placed in a persisted deletion outbox and attempted immediately. Failed removals are retried by the local runner or cloud reconciliation task. App access is revoked as soon as the database/file transaction commits; a previously issued source URL can remain usable until its 60-second expiry if storage deletion is delayed. The cleanup task must be operational to guarantee eventual retry.

Deletion is not a secure-erase guarantee for operating-system snapshots, manually copied local backups, exported reports or provider-managed backups/logs. Apply the hosting providers' retention policies to those copies. Local data is stored with restrictive creation modes where the OS supports them; Windows directory ACLs still determine actual access. Keep `.fieldops` and `.env.local` out of shared folders and version control.

For personal backups, stop the session and run `npm run personal:backup`. The tool takes the local state lock, copies saved state and its referenced originals into a new directory, and checks original hashes and sizes. It excludes environment files, credentials, caches, OCR assets, browser-only samples and unreferenced loose files. A running personal session or unfinished upload blocks backup.

Use `npm run personal:restore -- --input="BACKUP-DIRECTORY" --verify` to verify every file without restoring. Restore without `--verify` creates a new directory and refuses existing destinations; it validates manifest paths, rejects symlink traversal and rechecks copied bytes. Failed operations retain `.fieldops-incomplete`, which these tools and the launcher reject. Backups are not encrypted or signed: SHA-256 detects corruption but cannot authenticate a backup against someone who can rewrite its files and manifest. See [personal backup/restore instructions](personal-use.md) for commands and recovery. Hosted database/object backup and restore still require a separate verified procedure.

Do not edit `state.json` or delete its lock while a server is running. A corrupt state file fails closed rather than resetting saved data silently. Retain backup copies on private storage and manage their retention separately from application deletion.

## Operations and verification

Application logs contain event names, opaque run IDs, stage/error codes and attempt counts. They intentionally omit quotation text, model prompts, credentials and signed URLs. Provider SDKs/platform logs have their own policies; do not enable verbose debugging with private data without reviewing what it records.

Automated tests exercise cross-owner access, invitation revocation, service-RPC restrictions, cancellation fences, stale edits, delete/outbox behavior, pinned processing mode and terminal source readiness. Synthetic personal-tool tests cover backup/restore preservation, corruption detection, path/symlink rejection, lock behavior and refusal to overwrite existing data. SQL tests execute all six real migrations in embedded PostgreSQL with Supabase-owned schemas stubbed. They complement, rather than replace, the hosted tests in [deployment instructions](deployment.md). Supabase/Auth/Trigger behavior and live AI remain unverified on hosted services. Report exposed credentials or cross-user access as release-blocking failures; rotate affected keys before restoring private access.
