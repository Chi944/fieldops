# FieldOps progress

## 2026-09-13 — foundation

- Created independent repository at `C:\Users\User\Documents\Projects\active\fieldops`; no sibling project source used.
- Saved complete requirements in `docs/spec.md` and agreed implementation plan in `docs/implementation-plan.md`.
- Started tracked build/verification goal. Shared domain contracts and pinned application/tooling scaffold written.
- Parallel work: deterministic comparison/demo fixtures; document parsers/free AI adapter; persistence/auth/API/jobs. Root integrates UI, evaluation and documentation.
- Environment: Windows PowerShell, Node 24.19, npm 11.19, working Docker.
- Current external status: no Groq free-tier/ZDR configuration verified; no new Supabase, Trigger or Vercel deployment provisioned. No paid calls or purchases.
- Verification pending; no performance claims made.

## Vertical slice, parser breadth and offline verification

- Six connected screens implemented with browser-local demonstration data and persistent local/API workspace support.
- Genuine PDF, OCR, image, spreadsheet, CSV and pasted-text parsing implemented; strict free Groq adapter remains disabled per explicit user instruction. Manual recovery preserves sources without claiming AI extraction.
- Append-only correction audit, source regions, item grouping, approved-equivalence calculations, packs/MOQ/tiers, currency separation, Excel and print reports implemented.
- Local persistent jobs, private cloud repository, RLS migrations, OAuth allowlist, safe retries/cancellation/deletion and free-quota admission implemented.
- First integrated unit/integration run: 76/76 tests passing. PostgreSQL/RLS tested with PGlite platform stubs; hosted Supabase still unverified.
- Benchmark: 24 self-authored documents, 144 logical items, eight scenarios. Baseline equivalence precision102/102 and recall102/116; these are not AI metrics. See evaluation report for exact denominators and limitations.
- Independent agent review checked a subset of five originals/30rows/200 core expected values and five match judgments. No human verification claimed.
- Observed failures fixed: decimal pack surplus residue; unknown box contents treated as equivalent; demo raw-evidence mismatches; local Next forwarding headers rejected by isolation guard.
- Build and browser/export/accessibility checks underway; no release-completion claim yet.
- Existing Vercel login verified as Hobby. New FieldOps deployment will contain public fictional samples only. No existing project will be reused; private AI/cloud provisioning remains disabled.

## 2026-09-13 — public release verification

- Published the dedicated [FieldOps repository](https://github.com/Chi944/fieldops) and the [public demonstration](https://fieldops-eight-blue.vercel.app). Next.js production build and Vercel deployment passed.
- Integrated checks passed: **94 unit/integration tests across nine files**, **6/6 local browser tests in 24.9 seconds**, and **4/4 public production browser tests in 23.9 seconds**. Browser coverage includes the connected sample workflow, correction/reapproval history, matching edits, downloaded workbook, print rendering, automated accessibility checks and mobile keyboard/dialog use. Local-only tests also exercise real text/PDF/image parsing, preserved originals and manual recovery with AI disabled.
- [GitHub Linux CI](https://github.com/Chi944/fieldops/actions/runs/34711908349) is green at commit `3d97e58`. Results describe the tested revision; subsequent dependency changes need their own validation.
- Verified the hosted `/api/status` reports `canUpload: false`, `canPersist: false`, and `canExtract: false`. Vercel has no project environment variables configured and runs on the verified Hobby plan. The public deployment presents fictional fixtures, with visitor edits stored in that browser.
- The saved offline baseline report retains **24 authored originals**, **102/102 equivalent-pair precision** and **102/116 recall**, measured on gold-normalized rows. It is not AI field extraction or semantic-matching performance. See [evaluation report](evaluation-report.md) for source/parser denominators, timing, hashes and limitations.
- Live AI remains disabled per the user's instruction. Hosted Supabase, OAuth and Trigger are unconfigured; private-cloud and real model acceptance remain unverified. No inference or alternative-provider calls were made.
- Dependency-advisory remediation is in progress. Final audit status and post-update reruns will be recorded after installation completes. Evaluator configuration hashes now include both dependency manifest and lockfile, Node version/platform/architecture and the installed English OCR language-asset SHA-256 (or an explicit missing marker). This prevents processing-environment changes from reusing older live checkpoints or run IDs. New reports include runtime/asset identity; the next baseline rerun remains offline.
- Updated [acceptance status](acceptance-status.md) with verified release evidence, explicit unverified boundaries and deferred features.

## Dependency-update release verification

- Updated Sharp to 0.35.4 and csv-parse to 7.0.2; applied scoped compatible OpenTelemetry, ws and ExcelJS uuid overrides. Runtime audit now reports zero findings. Two development-tool entries remain for one unused Prisma/deepmerge issue; see [dependency review](dependency-review.md). CI now runs the runtime audit.
- Post-update checks pass: TypeScript, ESLint, production build, **95/95 unit/integration tests** across nine files and **6/6 local browser tests** in 43.6 seconds. Added a literal prototype-like CSV header regression. Actual Trigger imports and ExcelJS conditional-formatting round trip also pass without network calls.
- Reran the offline benchmark against final dependencies: `baseline-all-f2a9c86ad905-8dc06a6ab2cb`, 24/24 complete parser manifests, 144/144 authored identifiers, 963/963 source locators and 544/544 bounded regions; baseline pair precision 102/102 and recall 102/116; eight robustness assertions pass. Package text line endings follow the repository LF convention so the committed bytes match the evaluation fingerprint. Historical reports are retained.
- Final CI/deployment refresh follows this source commit. Live AI and hosted private-cloud checks remain unverified; the user asked to leave the integration disabled.

## Final deployment and handoff

- Source revision `165415c` passed [clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/34712631590): dependency installation/audit, OCR setup, TypeScript, lint, 95 tests, production build and all six browser workflows.
- Vercel deployment `dpl_4ccf1VtXgN5qVFaN1osiUGws7haT` is READY at the canonical public URL. All four public browser workflows passed again on this updated deployment in 22.2 seconds. Its published evaluation JSON matches `baseline-all-f2a9c86ad905-8dc06a6ab2cb`; status still disables persistence, uploads and AI.
- Saved the final [release record](release-verification.md), exact external configuration gates, setup/deployment docs, architecture, case study and demonstration script. Local Markdown links resolve. No private data or secrets were published.
- The agreed credential-free fallback is delivered and verified: public labeled demo plus real local parsing/manual review through matching, comparison and both exports. Live model evaluation and hosted private processing remain explicitly deferred until the user configures the documented free services.

## UI refinement and private-pilot assessment

- Refined the workspace with evergreen navigation, a compact resume panel, real next-step links, a review filter and accessible search. Added one generated decorative still life, served as a 36 KB WebP; exact prompt and provenance are in [image assets](image-assets.md). The generator exposes no model selector, so no named image-model version is claimed.
- Improved the source review queue, next-issue navigation, correction evidence, unmatched-offer filtering and source links. The matrix has a keyboard-focusable bounded scroll area and clearer price/issue hierarchy. Print rules remain separate.
- Independent review caught mobile navigation scrolling the focused field out of view, visible next-step labels missing from accessible names, and an unmodified character shortcut. Fixed all three and added browser regression assertions. Final local production build, TypeScript and lint pass; **95/95 unit/integration tests and 7/7 browser tests pass**, with the final browser run taking 27.7 seconds.
- Recorded [the next release](next-release.md): configure and test dedicated hosted Supabase/Auth/Storage/Trigger, separate parser-only cloud uploads from AI readiness, add storage admission/cleanup/operational recovery, validate shared resource limits, and evaluate live AI only after the user configures it. Keep Supabase for this release; Neon Auth and Storage are now beta alternatives but migrating would require reworking and retesting the implemented access boundary.
- Public refresh and clean Linux verification follow this source commit. No model extraction was enabled, provider project provisioned, private document published or existing project modified.

## UI deployment verified

- UI source `486ef98` passed [clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/34714827733), including runtime audit, OCR setup, type/lint checks, 95 unit/integration tests, build and all seven browser workflows.
- Vercel deployment `dpl_EtS4ErNWBDNyJjm53EgjqBVxgZe2` is READY at [FieldOps](https://fieldops-eight-blue.vercel.app). Five public browser tests passed in 25.9 seconds. Captured fresh public sample screenshots for the README and release record.
- Verified the deployed image matches its recorded SHA-256 and public capabilities still disable uploads, private persistence and AI. No credentials or hosted private services were added. The remaining operational work is documented precisely in [next release](next-release.md).

## Personal-use milestone in progress

- Added an explicit parsing-only processing mode on upload intents and durable runs. Hosted upload admission no longer requires a model; user authentication, private storage and the background worker are still required. Legacy records default to parsing only. Terminal source-ready results cannot be promoted to AI by retry or overwritten by late progress/source writes.
- Source review now distinguishes a readable original from a fully reviewed quotation. Manual completion requires a supplier, line items, complete source coverage and an explicit buyer acknowledgment. Edits invalidate that acknowledgment. Fixed an observed stale no-items notice that remained after manual entry.
- Added a personal launcher and readiness check with isolated `.fieldops/personal` data and `.fieldops/personal-next` build output. It binds only to an available loopback port from 3001–3009 and forces model/cloud credentials off in the child process. Added manifest-verified backup and non-overwriting restore tools, with synthetic tests.
- Personal comparisons and sample workspaces now have separate navigation. Browser acceptance, interruption and backup verification are in progress; no new completion claim yet.
- Supabase access is available and the discovered organization is Free, but a new FieldOps project has not been created. The organization choice required by the provisioning tool was requested. This repository has no Supabase, Trigger, OAuth callback or Groq credentials configured. Local use proceeds independently; AI remains disabled.
- Created the new SQL migration through Supabase CLI 2.117.0. Its generated timestamp preceded the existing future-dated migrations, so its version was advanced to follow their prerequisites. Tests execute the actual ordered SQL in embedded PostgreSQL; hosted provider acceptance remains separate.

## Personal milestone verification underway

- All 119 unit/integration tests across 13 files pass, including the six actual migrations in embedded PostgreSQL, parser-only mode isolation, late-result fences, concurrent Windows uploads, manual review, and backup/restore preservation. Browser acceptance and final production build are being completed separately.
- The final offline run `baseline-all-ff504a533a5a-8dc06a6ab2cb` measured 24/24 complete parser manifests, 144/144 authored identifiers, 963/963 source locations, 544/544 bounded regions and 8/8 robustness assertions. Baseline pair precision remains 102/102 and recall 102/116 on gold rows. No model requests were made; AI metrics remain unverified. An earlier run is retained; the final run fingerprints LF-normalized committed evaluator bytes.
- Fixed an actual Windows lock-acquisition failure observed during simultaneous uploads: transient access-denied/busy results now use the existing bounded retry budget, without deleting an unreadable or live lock. Dedicated injected-error tests cover eventual acquisition and bounded failure.

- Final integration passes TypeScript, lint, production build, **120/120 unit/integration tests across 13 files**, runtime dependency audit (zero findings), and **8/8 browser workflows in 24.8 seconds** against the production server. The personal case uses two actual synthetic quotations through source-linked manual review, completion acknowledgment, matching, matrix, Excel round-trip, print/PDF and reload persistence.
- Independent final review found a cloud retry inconsistency: SQL retained an old quota deadline and exhausted wait count on explicit retry. Fixed it to match the local repository, preserving the processing mode. All 16 actual-SQL tests pass, including the new recovery regression. Hosted execution remains unverified.

## Personal workspace launched and public refresh verified

- Source milestone `c1ccf44` is pushed to the dedicated repository. Vercel deployment `dpl_HJ6hcdhd78FskbKguCyhZLnvrbkC` is READY at the canonical public URL. All **5/5 public browser checks pass in 22.8 seconds**. Hosted status still reports demo mode, parser-only, and no persistence/uploads/extraction; there are no Vercel environment variables.
- Started `npm run personal` successfully on this computer at `http://127.0.0.1:3001`. The actual listener binds only to 127.0.0.1. API status confirms local persistence/uploads, parser-only mode and disabled extraction. The initial personal comparison count is zero; no test fixtures or sample quotations were copied into private data. Visually checked the personal onboarding page and opened the app panel. Port 3000 was not used or stopped.
- Personal source/state stays under ignored `.fieldops/personal`; only repository code, synthetic evaluation results and documentation were published. Restored Next-generated local type/config housekeeping to the committed production defaults after startup and rechecked the live local status. The personal session remains running for the user.

- [Clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/34716991201) completed successfully at `c1ccf44`, including all eight browser workflows in 1.0 minute. Personal local use is verified and available. Supabase organization selection, a dedicated project, OAuth configuration and Trigger credentials remain required before hosted private acceptance; no new provider project or billing was enabled. Live AI stays disabled under the user instruction.

## Current milestone — Neon migration, Trigger development and visual refinement

- Followed the user's Neon-only direction: the active cloud implementation now uses Neon PostgreSQL, managed Auth and private S3-compatible storage. Created only the dedicated FieldOps Free project, applied its migration in one transaction, provisioned a restricted runtime login and inserted the confirmed numeric GitHub invitation. Live database checks deny direct comparison insertion and managed session-token reads. Historical backend files remain as regression history, not active deployment instructions.
- Completed the generated-reference UI refinement and subsequent independent review fixes: visible mobile workflow orientation, issue-first source selection, explicit issue labels and a more compact mobile matrix. Saved six fresh desktop/mobile captures from the local production build, with only fictional samples. README now points to these current captures and labels their provenance.
- Latest local verification: **172 unit/integration tests pass**, **9/9 browser workflows pass in 27.0 seconds**, TypeScript/ESLint/production build pass, and the runtime dependency audit reports **zero findings**. These results do not assert final clean Linux CI or a refreshed public deployment; both remain pending for the current source milestone.
- Connected the dedicated Trigger Free project `proj_gqdrztfnxotydnuhiaku` using the default CLI profile and a named Development-only key stored in ignored local configuration. Pinned SDK/build/CLI to 4.5.16, registered all three tasks on `node-24`, and completed synthetic run `run_06g9f02hnt6o8ef655fuqn0r01`: 18 preserved source cells, USD `251.30`, and zero database/model/private-file calls. Added reproducible [development instructions](trigger-development.md). No production worker was deployed by this check.
- Groq browser access now works in the Personal/Default Project view; Free Plan, ZDR and API-key configuration have not been verified. Neon browser access currently opens the `des` Free organization, which does not contain the dedicated FieldOps resource. The exact resource's Vercel integration is being used to resolve access; no unrelated organization/project is substituted. Older blanket sign-in blockers are superseded by these narrower target-configuration gates.
- Hosted GitHub authentication, private object storage/CORS, production Trigger deployment and live AI acceptance remain incomplete. No supplier document was published, no model request was made and no paid service was purchased. Local personal parsing/manual comparison continues independently.

## Direct-account cloud setup and live reliability work

- Connected Vercel project `prj_E3g3MNRejByI5oe4BHBKgViFusaN` to `Chi944/fieldops`; API verification confirms GitHub, production `main`, and Git deployments enabled. Future main pushes now deploy automatically. Publication of these working-tree changes is still pending.
- Created `jolly-queen-28409793` in the requested directly authenticated Neon account, Free plan, with main branch `br-sweet-sun-ayzs00zw`. This supersedes the blocked marketplace activation flow. Applied the exact migration, restricted roles and intended invitation; 16/16 tables have RLS and actual prohibited runtime operations were denied. No existing comparison data was migrated.
- Configured managed Auth and private Neon storage. A real synthetic storage check passed exact-origin CORS, signed staging upload, hash/size finalization, signed download, unsigned denial and cleanup. New restricted runtime/storage/Auth settings are sensitive Vercel Production variables; the worker received only required runtime/storage settings. Hosted OAuth and worker smoke acceptance are in progress.
- Created the dedicated GitHub OAuth app. After user account confirmation, the first unused OAuth secret appeared in a diagnostic; immediately generated a replacement, saved it privately, deleted the first secret, and verified only the replacement remains. No active credential is committed.
- Verified Groq Free and inference ZDR, created a dedicated FieldOps key, and ran actual tiny synthetic extractions. A separate local AI workspace on port3003 keeps personal port3001 data untouched. Multi-item development probes revealed provider schema failures, which are retained privately and counted; held-out data remains unrun. Invalid responses no longer poison accepted checkpoints, and original/corrected values survive retry.
- Added explicit personal `--ai` activation with validation and per-port build isolation; default personal mode stays parser-only. Added rejected-response diagnostics without document text in operational logs. Fixed abandoned pasted-source ownership and bounded cleanup so maintenance cannot starve queued processing.
- Latest checks at this point: **201/201 unit/integration tests**, TypeScript/lint/build pass, **9/9 production browser workflows in30.8s**. CI now starts the production bundle after building it. Final source checks and clean hosted publication follow the remaining configuration changes.
- All services remain Free/Hobby, with no payment details or paid fallback added. Trigger uses the included-plan limit and active-run cancellation; reservations retain maintenance headroom. Neon storage is currently free during beta, so permanent free storage is not claimed.

- Published source `57101e4` after **204/204 tests**, type/lint/build and nine production browser workflows passed. The Git push automatically created Vercel production deployment `dpl_AXptvX5Bvs9N9F5hRivTeUKnEyK7`, READY at the canonical URL. Clean Linux CI run34722275577 is queued.
- Trigger production deployment `ewdnylwz`/`20260912.1` succeeded on Linux/node24. Synthetic production health run `run_06g9fccf6cj1rqdajck7oosu01` completed with18sources and USD251.30. Hosted application remains parser-only; no production Groq key installed.
- Actual GitHub OAuth created a valid invited Neon session, but the provider returned its verifier to the homepage outside the original proxy matcher. This observed hosted integration failure is being fixed and regression-tested before private-workspace acceptance. No account bypass or manual session-token injection is used.
