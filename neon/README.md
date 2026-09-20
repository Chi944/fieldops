# FieldOps on Neon

The active cloud repository uses Neon PostgreSQL, managed Neon Auth and the separate private object adapter. The historical `supabase/migrations` files remain as implementation history; do not apply them to Neon. No supplier data is copied from another project.

## Database migration

For a fresh installation, use the migration-owner connection from the dedicated FieldOps project to apply `migrations/202609180001_fieldops.sql` once, inside one transaction. It creates 16 application tables and the initial 17 FieldOps functions. It requires the managed `neon_auth` schema to exist already. Never create or replace Neon's managed auth tables.

Then apply `migrations/202609200001_capacity_and_intent_expiry.sql` once in a separate owner transaction. This additive migration does not rewrite the applied baseline. It adds admission/expiry functions and a document-deletion trigger, backfills pending-deletion byte reservations, and fixes the two derived-data owner foreign keys so managed-account deletion can complete while retaining object-cleanup tombstones. There are now 20 FieldOps functions, including internal helpers; PUBLIC cannot execute any of them.

For the existing dedicated project `jolly-queen-28409793`, branch `br-sweet-sun-ayzs00zw`, this additive migration was applied on 20 September 2026 in one owner transaction with SHA-256 `450f22f957684221fe1a4bc455645829782b7f75e707a9302587b69dcc61dc9d`. Do not reapply it there. This database result is separate from publishing the updated web application and worker that call its capacity/expiry helpers. [Current readiness evidence](../docs/production-readiness.md).

Read-only inspection of the dedicated project confirmed that `neon_auth."user".id`, `neon_auth.account."userId"`, and session/user IDs are UUIDs. GitHub identity is `account."providerId" = 'github'` with the immutable `account."accountId"`; email or editable display names do not grant admission.

## Restricted runtime login

After reviewing and applying the migration, provision a unique runtime login as the migration owner. Generate the password privately and use a secret-safe execution path; the following is a template, not a committed credential:

```sql
create role fieldops_runtime login password '<privately-generated-unique-password>'
  nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant fieldops_server to fieldops_runtime;
grant connect on database neondb to fieldops_runtime;
alter role fieldops_runtime set statement_timeout = '20s';
alter role fieldops_runtime set idle_in_transaction_session_timeout = '20s';
```

Set `FIELDOPS_DATABASE_URL` to a TLS connection string for this runtime login on Vercel and the worker. The helper deliberately refuses to fall back to the integration-managed `DATABASE_URL`, which remains the migration credential. Every helper operation submits `SET LOCAL ROLE fieldops_server` and its parameterized query in one Neon HTTP transaction. `SET LOCAL` cannot persist into another pooled request. The database connection and signed object URLs must never reach browser bundles or logs.

`fieldops_server` has no LOGIN, CREATE ROLE, CREATE DATABASE or BYPASSRLS permission. It can read application tables, execute approved mutation functions and remove successfully processed deletion-outbox entries. Direct comparison/document writes and internal snapshot/budget helper execution are denied. Every application table has RLS enabled. No application table/function privileges are granted to PUBLIC or browser roles. Server read policies permit the trusted backend role; user-facing reads bind the owner obtained from the server's validated session, and mutation functions check explicit owner/revision/fence constraints. RLS here is a server-only boundary, not a browser-accessible owner-token API.

Managed auth grants are limited to these columns:

- User: `id`, `name`, `email`, `image`, `banned`, `banExpires`.
- Account: `id`, `userId`, `providerId`, `accountId`.
- Session: `id`, `userId`, `expiresAt`.

Runtime SQL cannot read OAuth tokens, passwords or session token values. Request authorization must validate the SDK session, then recheck session expiry/revocation, user ban state, linked GitHub account and active invitation against the database without caching. Invitation changes are administrative SQL using the migration credential. Neither clients nor the runtime role can edit the allowlist.

Deletion removes quotation access immediately and attempts to remove canonical and staging objects. The outbox remains for at least six minutes (the maximum five-minute upload-ticket lifetime plus a margin), enforced by its runtime DELETE policy. A later cleanup sweep deletes both object paths again before removing the expired tombstone, recovering from a staging-ticket replay after the initial delete.

## Pilot capacity and expiry

| Reservation | Per workspace | Entire dedicated project |
| --- | --- | --- |
| Active comparisons | 20 | 100 |
| Original files, including upload intents and pending deletions | 50 | 200 |
| Original-file bytes | 100 MiB | 250 MiB |

A transaction-level advisory lock serializes every comparison/upload admission across workspaces. An intent reserves the full declared file size before a signed upload is issued. Repeating a stale admission cannot add a second reservation; an intentional new quotation revision is a separate original and consumes capacity. File-size and five-quotation comparison limits also apply. Jobs retain their independent compute reservations after failure or deletion.

Only unfinished `uploading` intents expire after 24 hours. Finalization checks the database creation timestamp and rejects an expired intent before reserving compute. Maintenance removes at most 25 old intents in a transaction, scrubs their quotation snapshots and queues private-object cleanup. It locks and rechecks status to preserve concurrently finalized files. Completed sources never expire through this sweep. Their six-minute deletion grace begins when the intent is actually removed, even if its original creation was days earlier.

Deleting a source releases comparison slots immediately, but its original-file count and bytes remain reserved until the final successful object deletion after the grace period. Provider failures keep the reservation and tombstone for a later sweep. Comparison and managed-account cascades use the same document trigger. Legacy tombstones without surviving size metadata conservatively reserve 20 MiB each until cleanup succeeds.

The server helper `CloudRepository.capacity(ownerId)` wraps `select public.fieldops_capacity($1)` and returns typed workspace/project counts, byte totals, pending-deletion usage and limits. The private workspace-status endpoint exposes only the authenticated workspace values and a shared-capacity availability boolean; it must never disclose other owners' counts.

The private Workspace status panel requests this data only when opened or refreshed. It reports configured processing availability and queue counts without continuously polling or claiming to test provider health. Verify it against the updated deployed web version; an applied database migration alone does not prove the panel is published.

**Database-size limitation:** these are original-file admission limits, not a hard bound on Neon database usage or provider charges. Parsed text, source spans, extraction versions, checkpoints, indexes and full comparison-history snapshots occupy additional database space. Editing stores further snapshots; unlimited history is not promised. Provider-reported database usage and storage availability must still be monitored. A `pg_database_size()` threshold alone would not establish the provider's logical quota, and a blanket write rejection could prevent the deletion transaction itself from saving its scrubbed snapshot.

If database space approaches the Free allowance, pause new admission and remove unused comparisons through FieldOps so their database records cascade and originals enter durable cleanup. PostgreSQL may reuse deleted space without immediately reducing physical database size; provider metrics need separate verification. If the database is already unable to accept these deletion transactions, an operator must recover space using the dedicated project's maintenance connection and preserve object tombstones before resuming. Do not upgrade a plan as a recovery step. Bounded historical/diagnostic retention and a separately tested database-growth guard remain release work.

## Verification

`npm test -- tests/neon-sql.test.ts` executes the actual migration using embedded PostgreSQL with only the managed auth tables stubbed from inspected types. It checks job modes, fencing, repeated finalization, retries, conservative compute reservations, stale snapshots, source deletion, invitation/ban checks and role privileges. Hosted migration, runtime credential, auth redirects, object storage and worker deployment require separate verification. This test does not call a model or establish live AI accuracy.

`tests/neon-concurrency.test.ts` adds opt-in independent-session tests using a fresh disposable official PostgreSQL 17 container. It has no published port or network, does not read provider credentials and removes only its own uniquely named container. With Docker running, execute in PowerShell:

```powershell
$env:FIELDOPS_TEST_DOCKER_POSTGRES = '1'
npx vitest run tests/neon-concurrency.test.ts
Remove-Item Env:FIELDOPS_TEST_DOCKER_POSTGRES
```

The six real-PostgreSQL checks cover simultaneous workspace/project byte admission, finalize/expiry contention in both orders, bounded sibling expiry and account deletion with parsed/item foreign keys. Fast embedded tests additionally cover comparison/document caps, duplicate reservations, failed cleanup, stale revisions, preserved completed results and unchanged compute reservations. These are local database tests, not hosted provider verification.

Separate hosted checks on 20 September covered one text PDF, scanned PDF, PNG, XLSX and CSV through production parsing, and a scoped read-only backup/new-local-directory restore of all five originals. They preserved 197 source spans and 538,486 original bytes. See [format acceptance](../docs/hosted-acceptance.md#additional-hosted-formats--20-september-2026) and [recovery evidence](../docs/cloud-recovery.md). These checks used the previously deployed parser worker, made no model calls, and do not establish hosted two-user isolation, cloud restore or field-extraction accuracy.

Driver API reference: [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver). Managed auth reference: [Neon Auth](https://neon.com/docs/auth/overview).
