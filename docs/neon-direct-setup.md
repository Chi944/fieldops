# Direct Neon project setup

Verified 13 September 2026 (Asia/Singapore). At the user's direction, the active setup now targets a new FieldOps project in the user's direct Neon Free account. This replaces the earlier Vercel-SSO project selection. The operations below targeted only this new project; no unrelated project or supplier data was reused.

| Setting | Verified value |
| --- | --- |
| Project | `jolly-queen-28409793`, FieldOps |
| Organization | `org-restless-hall-96085798`, Free |
| Branch | `br-sweet-sun-ayzs00zw`, `main` |
| Region / database | Ohio, `aws-us-east-2`; PostgreSQL 17, `neondb` |
| CLI | `neon@4.17.3`, repository-local ignored `.fieldops/neon-cli` configuration, analytics disabled |
| Managed Auth | Enabled with `better_auth` on this branch |
| Trusted application origin | `https://fieldops-eight-blue.vercel.app` |
| Object bucket | `quotations`, verified private |
| Storage credential label | `FieldOps private quotation storage` |
| Storage scopes | `storage:read`, `storage:write`; no AI Gateway or function-invocation scope |

The database task applied the active FieldOps migration after managed Auth was enabled, provisioned the restricted runtime and numeric GitHub invitation, and verified its role restrictions. Runtime configuration must use `FIELDOPS_DATABASE_URL`, never the administrative `DATABASE_URL`.

## Auth handoff

The GitHub OAuth application's provider callback is:

```text
https://ep-sparkling-mode-aypv3o53.neonauth.c-5.us-east-2.aws.neon.tech/neondb/auth/callback/github
```

The application return is `https://fieldops-eight-blue.vercel.app/auth/callback`. These are different destinations. The exact production origin was added to managed Auth's trusted domains. A separate random cookie secret was generated locally.

The dedicated GitHub OAuth application is configured on this branch using the replacement credential saved after the earlier unused secret was deleted. Neon returned provider `github`, type `standard` (custom credentials); readback matched the client identifier and masked secret suffix privately. The generic CLI API accepts sensitive JSON through stdin with `--data=-`, avoiding secrets in shell arguments. Application sign-in, invitation enforcement and cross-user/source access still require end-to-end verification. Enabling Auth or applying SQL does not establish those outcomes.

## Verified zero-cost configuration

The project-scoped organization API returned organization `org-restless-hall-96085798`, `plan: free`, `managed_by: console`. The deployment task independently inspected this organization's Billing page: **Free Plan Current**, **$0/month**, 0.5 GB database storage, 100 compute-hours and 10 branches. Neither setup task added payment information, upgraded the plan, enabled paid add-ons or changed billing. The console showed no Payment info section, so absence of a pre-existing payment method was **not** independently established.

Neon's current documentation includes up to 60,000 monthly active Auth users on Free. Object Storage is available on Free and currently has no charge during beta, with a 5 GB/project allowance. The pricing page also states Free requires no credit card. These are current terms, not a promise of perpetual free storage. [Neon pricing](https://neon.com/pricing), [Auth and Object Storage plan terms](https://neon.com/docs/introduction/plans#object-storage).

The storage documentation says pricing will apply when billing begins. Under the user's strict zero-money requirement, keep this organization on Free, do not accept any paid transition, and stop hosted document uploads before using a chargeable storage arrangement; reassess or export/delete the stored data first. No automatic paid transition or upgrade was enabled by this setup. The API does not expose a future beta-transition billing guarantee. [Current storage beta terms and limits](https://neon.com/docs/storage/overview).

Current Free database compute and network-transfer allowances are service limits: exhausting compute or monthly egress suspends the compute until reset or an explicit upgrade. FieldOps must explain that recovery path instead of purchasing capacity. These documented database limits do not prove an unannounced future object-storage billing policy. [Free plan limit behavior](https://neon.com/docs/introduction/plans#what-happens-if-i-exceed-my-free-plan-limits), [Network-transfer allowance behavior](https://neon.com/docs/introduction/network-transfer).

## Storage compatibility check

Bucket visibility was inspected through the project-scoped CLI. The S3 client successfully performed HEAD bucket, wrote the exact CORS configuration and read it back:

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

A tiny in-memory fictional text quotation was then exercised through the application's real storage adapter on a new random object key. At `2026-09-12T22:02:06.138Z`, all six checks passed:

- Browser-style OPTIONS preflight returned the exact allowed origin.
- The signed staging PUT accepted the intended bytes and signed headers.
- Finalization checked the size/hash and preserved identical canonical bytes.
- A signed original GET returned those identical bytes.
- Removing the signature denied anonymous access to the existing original.
- Replaying the staging URL with changed bytes left the canonical original unchanged.

Both synthetic object paths were deleted successfully after the check. No model request, database request or private-file read occurred in this storage smoke. Its result is compatibility evidence for the S3 adapter, not a browser-authenticated application upload test, large-file benchmark or full six-minute deletion-outbox timing test.

## Private configuration and receipts

Only the new project's values were written to these ignored files:

| Local file | Contents |
| --- | --- |
| `.env.neon.auth.local` | Auth base URL, random cookie secret and fixed site origin |
| `.env.neon.storage.local` | Branch storage endpoint, access/secret key, region and bucket |
| `.env.neon.database.local` | Separately prepared database configuration and target identifiers |
| `.fieldops/neon-storage-setup.json` | Nonsecret bucket/CORS setup receipt |
| `.fieldops/neon-storage-smoke.json` | Nonsecret check results and cleanup status |
| `.fieldops/neon-github-setup.json` | Nonsecret provider configuration and credential-readback receipt |

Credential values are absent from this document, chat output and Git. A native CLI warning interrupted initial response handling after creating the named storage credential. The existing credential was then retrieved through the CLI and saved; no duplicate credential was created. No upgrade or paid service was enabled.

The active application/worker environment still needs a controlled merge by the deployment task, followed by production Trigger deployment and authenticated hosted acceptance. This setup task did not edit `.env.cloud.local` or Vercel environment variables. Live AI behavior is tracked separately; these checks provide no AI accuracy claim.

Official references checked for this setup: [Neon CLI](https://neon.com/docs/cli), [managed Auth commands](https://neon.com/docs/cli/neon-auth), [storage endpoint and client setup](https://neon.com/docs/storage/get-started), [scoped credentials](https://neon.com/docs/cli/credentials), [S3 compatibility](https://neon.com/docs/storage/s3-compatibility).
