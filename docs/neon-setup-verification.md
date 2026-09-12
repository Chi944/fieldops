# Neon setup verification

Checked 13 September 2026 (Asia/Singapore). These are database setup results, not hosted quotation or AI acceptance.

- A new dedicated `fieldops` project was provisioned on Neon Free through the existing Vercel marketplace integration. Project `still-queen-31894018`, Ohio; Vercel resource `store_vMmNBnqwZhtJROp9`. No previous project or supplier data was reused.
- Managed Auth was enabled at provisioning. The browser is now authenticated in the `des` Free organization, which does not contain the dedicated FieldOps project. Access to the correct resource is being resolved through its Vercel integration; target-project GitHub Auth and object storage are not configured yet. This supersedes the earlier blanket email-verification/sign-in blocker.
- Applied `neon/migrations/202609180001_fieldops.sql` atomically. Applied-file SHA-256: `388b7bc96db88e6b74db832ad5e57e04784c8098bd57b4f82f73ee1bdb1484d3`.
- Created a unique `fieldops_runtime` login with no superuser, database-creation, role-creation or RLS-bypass privilege. Its only application membership is `fieldops_server`; queries explicitly select that role inside a transaction.
- Inserted the independently confirmed GitHub numeric identity for owner `Chi944` into the operator-managed allowlist. No auth user/session was fabricated and no quotation was inserted.
- A real Neon HTTP query with the runtime credential returned `current_user=fieldops_server`, direct comparison INSERT permission **false**, managed session-token SELECT permission **false**, **zero comparisons**, and **one intended active invitation**.
- Set `FIELDOPS_DATABASE_URL` as a sensitive Vercel Production environment variable using stdin. The integration's migration-owner `DATABASE_URL` is never used by application code. Secret values remain in ignored local configuration and provider settings, not this repository.

Trigger's dedicated Free project and default-profile CLI sign-in are now verified independently. All three tasks appear in Development, and the synthetic `fieldops-health-check` completed as `run_06g9f02hnt6o8ef655fuqn0r01`: 18 source cells, USD `251.30`, zero database/model/private-file calls. This verifies local development task execution through Trigger, not Neon integration or production processing. See [Trigger verification and reproduction](trigger-development.md).

Remaining gates: access to the exact dedicated Neon project's console, GitHub OAuth application/provider/trusted-domain configuration, private bucket and scoped storage credential/CORS, Trigger production credentials/environment/task deployment, Groq Free/ZDR/key setup, and synthetic hosted acceptance across advertised formats. Groq browser sign-in now works, but its required account settings and key are not verified. No model call has been made. Public demo and local manual-review functionality do not depend on these gates.

The managed Neon Auth and Object Storage products are beta. Restricted permissions were checked on the actual database; SDK callbacks, S3 compatibility and the deployed Linux quotation worker still require their own live smoke checks. See [setup instructions](deployment.md) and [role design](../neon/README.md).
