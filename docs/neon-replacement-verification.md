# Dedicated Neon database verification

This records the replacement FieldOps project selected by the owner. Verification completed at `2026-09-12T21:59:32.712Z` (13 September in Singapore). It is separate from the earlier Vercel-managed Neon setup; no data was copied from that project and its local provisioning receipt was preserved.

| Target | Verified metadata |
| --- | --- |
| Project | `jolly-queen-28409793`, named `fieldops` |
| Organization | `org-restless-hall-96085798` |
| Region / database | `aws-us-east-2` / `neondb` |
| PostgreSQL | 17 |
| Branch | `br-sweet-sun-ayzs00zw`, `main` |
| Migration | [202609180001_fieldops.sql](../neon/migrations/202609180001_fieldops.sql) |
| Migration SHA-256 | `388b7bc96db88e6b74db832ad5e57e04784c8098bd57b4f82f73ee1bdb1484d3` |

The provisioning script checked the exact project, organization, branch endpoint, region and PostgreSQL version before database access. After managed Auth was enabled, a read-only schema inspection confirmed UUID user/account/session IDs, text provider/account IDs and timestamp-with-time-zone expiry columns. The script did not create, replace or edit managed Auth tables or user records.

The application migration, restricted runtime login, membership grants, timeouts and operator-specified GitHub invitation were applied in one transaction. The invitation uses GitHub's numeric account ID `256740968` (`Chi944`). There were no application comparisons at verification time.

| Runtime check | Actual result |
| --- | --- |
| Database login | `fieldops_runtime` |
| Role inside each application transaction | `fieldops_server` |
| Application tables with RLS | 16 of 16 |
| Runtime/server superuser, create-database, create-role, inherit or bypass-RLS attributes | All false |
| Direct comparison INSERT privilege | False; an actual INSERT was denied with SQLSTATE `42501` |
| Managed session-token SELECT privilege | False; an actual token-column query was denied with SQLSTATE `42501` |
| Direct invitation UPDATE privilege | False |
| Internal compute-reservation helper EXECUTE privilege | False |
| Intended active invitation | One matching record |

Owner and runtime connection strings are stored only in ignored `.env.neon.database.local`. `FIELDOPS_DATABASE_URL` is the restricted runtime connection for the application and worker; owner `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are provisioning credentials and must not be substituted for it. No credential value is included in this document. The existing `.env.cloud.local` was not modified by this setup.

The ignored metadata receipt is `.fieldops/neon-provision-jolly-queen-28409793.json`. The adapted `.fieldops/provision-neon.mjs` delegates to a script guarded to this project only; `--inspect` reads schema metadata, `--apply` refuses an existing FieldOps schema/runtime role, and `--verify` records another nonsecret permission-check receipt. These local scripts rely on the existing dedicated CLI configuration and are not application runtime dependencies.

These checks verify the database schema and its role boundary. They do not establish hosted OAuth, cross-user application behavior, private storage/CORS, production worker processing, or AI accuracy. Those require their separate acceptance runs.

Managed account deletion also remains an operational limitation: removing a managed Auth user can cascade application records without creating file-deletion outbox entries. Before deleting an Auth user, remove that user's FieldOps comparisons through the application so their originals enter durable cleanup. No account-deletion UI or automatic account-deletion cleanup is claimed.

Implementation references: [Neon backend roles](../neon/README.md), [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), [official Neon CLI](https://github.com/neondatabase/neonctl).
