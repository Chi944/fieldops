# Security and retention

FieldOps keeps private originals separate from the public sample workspace. The security model is personal, invited workspaces in cloud mode and one trusted buyer on a loopback-bound local server. It is not a claim of audited production security.

## Access boundaries

- Cloud APIs validate the Supabase session with `getUser`, then require an active invitation tied to the provider-controlled numeric GitHub identity. Editable user metadata and email addresses never grant access.
- Every private repository operation scopes records to the authenticated owner. Unauthorized IDs return unavailable/not-found responses. PostgreSQL RLS independently restricts browser reads to invited owners; browser roles cannot invoke mutation RPCs or bypass private storage policy.
- The service-role key exists only in server and worker configuration. It is privileged, so worker/API ownership checks remain necessary even with RLS. Never place it in a `NEXT_PUBLIC_` variable or send it to the browser.
- Mutations check same-origin browser requests. OAuth callbacks use a configured fixed origin and do not accept an arbitrary return URL. Supabase SSR cookies handle the authenticated session.
- Local mode requires explicit configuration and loopback URL/Host values. Next's automatically inserted forwarding headers are accepted only for matching loopback authorities and a single loopback client; remote forwarding and chains are rejected. Both start scripts bind to `127.0.0.1`. Do not tunnel or publicly bind local mode: headers are not a substitute for the network boundary.
- Runtime readiness returns flags and recovery reasons, never credentials. Public demo visitors cannot create private uploads through an unconfigured server.

## Private files and source links

Originals use opaque document IDs, SHA-256 integrity checks and owner-prefixed storage paths. The cloud `quotations` bucket is private. Signed upload tokens allow one intended object path without upsert; finalize verifies the uploaded bytes before creating processing work. Tokens must not be logged or shared.

Every source request first checks ownership. Local sources return private, noncacheable responses, with `nosniff` and a sandbox policy. Cloud sources redirect to a signed storage URL valid for **60 seconds** to avoid proxying large files through a web function. Anyone possessing that temporary URL can use it during its validity period; expiry is not an identity check. Do not include signed URLs in logs, exports, analytics or screenshots. Exports keep application/source references rather than temporary signed URLs.

## Document trust and model handling

Quotation contents are untrusted data. Parsing does not execute spreadsheet formulas or embedded document code. The model request frames source material as data, uses structured outputs and exposes no external tools. Returned fields and source IDs are validated; deterministic code handles arithmetic and comparability constraints. Instructions inside a quotation cannot authorize supplier contact, account changes or access to another document.

The current release keeps AI disabled until the key, free-account confirmation and retention confirmation are configured. Those flags express operator configuration, not proof of the provider's account settings. If enabled later, bounded source chunks will be transmitted to the configured provider for interpretation; review that provider's current terms and retention settings first. Desktop subscription credentials are never an alternative. Live prompt-injection resistance and semantic source correctness remain unverified until real evaluation.

Processing limits bound document size, page/cell counts, image pixels, item counts, concurrency, duration and retries. These reduce resource risk but are not a full sandbox against every malicious parser input. The private pilot should remain invited and use the documented supported inputs.

## What is retained

| Data | Current retention behavior |
| --- | --- |
| Public synthetic originals/fixtures | Kept in the repository/deployment as demo assets; contain no real supplier documents |
| Demo edits | This browser's `localStorage` under `fieldops-demo-v1`; clear site data to remove the browser copy |
| Local originals, parsed source spans, runs, extraction versions, corrections and checkpoints | Persist in `.fieldops` or `FIELDOPS_DATA_DIR` until the user deletes the document/comparison |
| Cloud equivalents | Persist in private storage and PostgreSQL until document/comparison deletion |
| Failed or cancelled work | Original and completed parse/chunks remain for review or retry; cancellation does not delete files |
| Unfinished cloud upload intent | Retained until explicit deletion; there is no automatic expiry cleanup in this first release |
| Downloaded workbook / saved PDF | Stored by the buyer outside FieldOps; deleting a comparison cannot recall downloads |
| Compute budget reservations | Minimal amount/time records persist after deletion so deleting work cannot bypass the free budget |

There is **no automatic age-based purge** of private originals, parsing results or checkpoints in this release. No scheduled seven-day or 24-hour cleanup is claimed. Browser exports are generated on demand and not archived by the server.

## Deletion and backups

Deleting a document removes its active application record, parsed evidence, jobs, checkpoints, extraction records and related correction data. Other quotations remain. Groups referencing deleted rows are updated and require review. Cloud comparison snapshots containing a deleted source are removed to avoid retaining the original text through history. Deleting a comparison removes all its related private application data.

Object removal is placed in a persisted deletion outbox and attempted immediately. Failed removals are retried by the local runner or cloud reconciliation task. App access is revoked as soon as the database/file transaction commits; a previously issued source URL can remain usable until its 60-second expiry if storage deletion is delayed. The cleanup task must be operational to guarantee eventual retry.

Deletion is not a secure-erase guarantee for operating-system snapshots, manually copied local backups, exported reports or provider-managed backups/logs. Apply the hosting providers' retention policies to those copies. Local data is stored with restrictive creation modes where the OS supports them; Windows directory ACLs still determine actual access. Keep `.fieldops` and `.env.local` out of shared folders and version control.

To back up a local workspace, stop the application and copy the private data directory to protected storage. To restore it, stop the server and restore the whole directory consistently, then start it and reopen the workspace. Do not edit `state.json` or delete its lock while a server is running. A corrupt state file fails closed rather than resetting saved data silently.

## Operations and verification

Application logs contain event names, opaque run IDs, stage/error codes and attempt counts. They intentionally omit quotation text, model prompts, credentials and signed URLs. Provider SDKs/platform logs have their own policies; do not enable verbose debugging with private data without reviewing what it records.

Automated tests exercise cross-owner access, invitation revocation, service-RPC restrictions, cancellation fences, stale edits, delete/outbox behavior and integrity checks. SQL tests execute the real migrations in embedded PostgreSQL with Supabase-owned schemas stubbed. They complement, rather than replace, the hosted tests in [deployment instructions](deployment.md). Report exposed credentials or cross-user access as release-blocking failures; rotate affected keys before restoring private access.
