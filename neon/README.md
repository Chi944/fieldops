# FieldOps on Neon

The active cloud repository uses Neon PostgreSQL, managed Neon Auth and the separate private object adapter. The historical `supabase/migrations` files remain as implementation history; do not apply them to Neon. No supplier data is copied from another project.

## Database migration

Use the migration-owner connection from the dedicated FieldOps project to apply `migrations/202609180001_fieldops.sql` once, inside one transaction. It creates 16 application tables and the latest versions of the 17 FieldOps functions. It requires the managed `neon_auth` schema to exist already. Never create or replace Neon's managed auth tables.

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

## Verification

`npm test -- tests/neon-sql.test.ts` executes the actual migration using embedded PostgreSQL with only the managed auth tables stubbed from inspected types. It checks job modes, fencing, repeated finalization, retries, conservative compute reservations, stale snapshots, source deletion, invitation/ban checks and role privileges. Hosted migration, runtime credential, auth redirects, object storage and worker deployment require separate verification. This test does not call a model or establish live AI accuracy.

Driver API reference: [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver). Managed auth reference: [Neon Auth](https://neon.com/docs/auth/overview).
