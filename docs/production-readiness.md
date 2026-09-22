# Production readiness — private pilot

FieldOps is a deployed, invited personal-workspace pilot. The supported path is **upload → source review/manual entry → approved matching → comparison → Excel or print report**. The public sample workspace remains independent of private cloud services. Broad automatic AI extraction is not ready for production: complete-document development probes still reject missing or unsupported output, and held-out AI accuracy is not established. Keep hosted `FIELDOPS_PROCESSING_MODE=parse_only` until a frozen candidate passes the documented release gates.

The [22 September development follow-up](ai-development-study-2026-09-22.md) preserves this boundary. It tests stricter source completeness and versioned request contracts, with separate schema-failure diagnostics and fixed-denominator field/evidence gates. Experimental transport acceptance and passing software tests do not authorize production AI.

The [23 September release study](release-study-2026-09-23.md) preserves the original complete-cohort generation and two separate saved-response replays. The latest offline replay retains three partial quotations, 47/129 correct critical fields and 7/18 identifier-aligned expected items, compared with 6/129 and 1/18 in the original live run. Complete extraction and readiness remain 0/3; all 10 retained comparison rows are blocked. Source arrays are preserved and 117/117 field references resolve, which does not establish semantic evidence correctness. No new model calls or held-out validation occurred. The parser/manual pilot remains the supported release; software and deployment checks are recorded separately in [progress](progress.md).

## Evidence from 20 September 2026

| Area | Evidence and boundary |
| --- | --- |
| Free-only accounts | Groq console showed Free $0 and Inference APIs ZDR enabled; Neon CLI returned the dedicated organization plan `free`; Trigger displayed Free Plan; Vercel displayed Hobby. No purchases, billing changes, new keys or paid fallback were introduced. Neon now includes 5 GB of object storage per Free project; finite provider allowances still apply. [Current Neon announcement](https://neon.com/blog/neon-backend-is-ga). |
| Hosted parser breadth | Five self-authored files uploaded through the actual browser to private Neon storage and production Trigger: text PDF, scanned PDF, PNG, XLSX and CSV. All completed with full parser manifests, 197 preserved source spans in total, and anonymous source requests returned 401. This is parser coverage, not extraction accuracy. |
| Atomic capacity | Applied `202609200001_capacity_and_intent_expiry.sql` to the dedicated project/branch in one owner transaction; SHA-256 `450f22f957684221fe1a4bc455645829782b7f75e707a9302587b69dcc61dc9d`. Six independent PostgreSQL-session tests verify admission races, finalization/expiry and bounded cleanup. |
| Access boundary | Real route handlers exercise fresh session/invitation checks and scoped repository SQL against the shipped migrations, including cross-owner original signing and mutation denial. External SDK/database transports are substituted; this does not claim two real hosted identities were tested. |
| Request limits | JSON bodies are limited while reading to 2 MiB of UTF-8 bytes, with a 15-second deadline and interrupted/invalid-body errors. Oversized streams are cancelled. |
| Recovery | A read-only hosted backup of the five synthetic originals restored to a new local directory with all hashes, byte counts, source IDs and comparison revision preserved. No personal workspace or server was overwritten. [Recovery procedure](cloud-recovery.md). |
| Operations | Private Workspace status shows reserved original capacity, pending cleanup, configured processing mode and job counts on demand. It exposes no other owners' counts, and does not continuously poll or claim to probe service health. |

The first five-format check used the previous worker. The new worker `20260920.1` (`6vls4g3j`) then passed its health task, JPEG OCR and CSV parsing while preserving successful files around a malformed-PDF failure. On the updated web release, an exact duplicate was rejected without adding work; the explicit separate-copy action created one new processed quotation while preserving the original. The live status panel reported the owned counts and failed job correctly.

Source **`6999678`** passed [clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/35509209155) and deployed automatically through the connected Git repository to Vercel **READY** `dpl_8JwpzMGMy7CjQZYBpuDcGD1qzYyH`. Local verification passed **299 tests across 35 files**, typecheck, lint, production build and **10 browser workflows in 34.2 seconds**. The runtime audit had zero findings. The canonical deployment passed **6/6 applicable public browser checks in 34.1 seconds**; four real-upload/local-only cases were intentionally excluded from that public run and were tested locally or in the separate signed-in acceptance checks. [Detailed release evidence](release-verification.md).

The synthetic acceptance data was then removed and verified: all nine originals and their staging keys returned 404, deletion tombstones retired after the actual replay period, and reserved original capacity returned to zero. Compute reservations were preserved. The new maintenance schedule also completed on its deployed worker version. No private personal data was used or removed; the separate synthetic recovery backup remains private.

## Operating the pilot

1. Keep Vercel on Hobby, the dedicated Neon organization on Free and Trigger/Groq on Free. Do not add paid fallback or payment details to fix a quota pause. Follow [free-service boundaries](free-services.md).
2. Use the Git-linked `Chi944/fieldops` repository for the web deployment. Apply new numbered Neon migrations in order, inside an owner transaction, after local SQL tests. Use only the restricted runtime connection in the app and worker. [Setup and deployment](deployment.md).
3. Deploy Trigger separately after preparing the OCR language asset. Check the production health task and an actual synthetic upload on the new worker. A successful web deploy does not update the worker.
4. Use Workspace status to inspect your counts and queue. For failures, open the affected comparison's Quotations step. Retry only after resolving its stated cause; successful sources and corrections remain saved. Cancellation stops publication but does not delete the original.
5. Monitor the dedicated Neon database's own storage and compute allowance. The new byte caps cover originals, **not** the full history/derived JSON/index footprint. Set `FIELDOPS_UPLOADS_ENABLED=false` in Vercel and redeploy to pause new cloud upload/finalization/retry admission; verify the signed-in status panel shows uploads unavailable. Existing jobs and signed tickets are unaffected. Delete unused comparisons while writes still work and allow cleanup to finish. Physical space may not shrink immediately. Do not solve capacity by upgrading.
6. Back up settled work before upgrades with `npm run cloud:backup -- --owner=AUTH-USER-UUID --env-file=.env.fieldops.production.local --to=.fieldops/backups/NEW-NAME`. Verify and restore into a new local directory periodically. Backup copies contain unencrypted quotation data and have independent retention; an Excel workbook is not an application backup.
7. Revoke a buyer through the persisted GitHub invitation. Every private request checks current invitation and managed-session state. Never expose runtime credentials, copy browser sessions into scripts, or enable unrestricted local mode on Vercel.

## Remaining broad-release gates

- Freeze a viable model/prompt/schema/parser candidate; complete the held-out extraction/matching/ambiguity/evidence benchmark with actual latency and usage. Retain unsuccessful probes and report missing provider usage as unknown.
- Exercise two separate hosted identities and uninvited access through the real OAuth service. Automated two-user SQL tests are valuable, but not a substitute for that hosted check.
- Add bounded history retention and database-growth admission that still permits deletion and recovery. Add persistent global token admission before broader concurrent AI access; current local counters are supplementary to the Free provider quota.
- Verify broader permissioned quotation layouts, multilingual/OCR limits and the documented recovery paths. Universal document interpretation is not claimed.

Do not describe the overall system as an unrestricted, production-ready AI service while these gates remain open. The personal parser/manual workflow has a narrower, demonstrable support boundary.
