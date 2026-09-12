# First-release verification

Verified on 13 September 2026. This release delivers the public fixture demonstration and a real local upload, source review, manual recovery, matching, comparison and export workflow. Cloud-provider setup and genuine synthetic AI measurements are now underway; hosted end-to-end and held-out acceptance remain separate gates.

## Delivered

- [Public application](https://fieldops-eight-blue.vercel.app) and [reliability page](https://fieldops-eight-blue.vercel.app/reliability).
- [Independent source repository](https://github.com/Chi944/fieldops), complete [requirements](spec.md), [implementation plan](implementation-plan.md) and [acceptance status](acceptance-status.md).
- [Local setup](setup.md), [active Neon migration and restricted role](../neon/README.md), [deployment instructions](deployment.md), [architecture](architecture.md), [retention behavior](security-and-retention.md), [case study](case-study.md) and [three-minute demonstration script](demo-script.md). Earlier migration files remain as regression history.

## Current milestone: cloud integration and measured AI recovery

Current source publication and clean Linux CI are pending. Earlier deployment IDs below refer to historical revisions. The rebuilt local production app passed **9/9 browser workflows in30.8seconds**, and **204/204 unit/integration tests** passed across24files at06:15Singapore time. TypeScript, ESLint and production build passed. The production-only schedule regression is included. Subsequent AI changes will require another run.

Vercel is now actually Git-connected to `Chi944/fieldops`, production branch `main`, with automatic deployments enabled. The active direct-account Neon Free project is `jolly-queen-28409793`; its migration, restricted roles, managed Auth and private storage are configured. Real signed storage, CORS, hash, replay and cleanup checks passed. See [database evidence](neon-replacement-verification.md) and [Auth/storage evidence](neon-direct-setup.md). Production settings are saved server-side, initially parser-only. Hosted OAuth and quotation-worker acceptance are still in progress.

Groq Free and inference ZDR are verified on a dedicated project, and real tiny synthetic extractions succeeded. Larger development cases have exposed rejected structured outputs; their failures remain part of the measurement. The held-out split remains unused. The existing personal workspace stays isolated and parser-only; the opt-in AI smoke uses synthetic data on a separate port. See [AI configuration](ai-setup-verification.md).

Trigger Development run `run_06g9f02hnt6o8ef655fuqn0r01` completed the fixed synthetic check with18cells, USD251.30 and no model/database/private-file calls. Production deployment is a separate check. [Free-service boundaries](free-services.md) record included-credit limits and the temporary nature of Neon's free storage beta.

The six current design captures use fictional samples from the local production build. They demonstrate the workspace review queue, source review and matrix at desktop/mobile sizes; [design provenance](design/README.md) distinguishes the generated reference from actual implementation captures.

The entries below preserve earlier revision-specific results. Their provider-configuration, AI-disabled and deployment statements describe those historical checks.

## Personal-use milestone verification

The isolated personal launcher, source-only processing and manual review milestone passed TypeScript, ESLint, the production build and **all eight browser workflows in 24.8 seconds** against the local production server. The personal test uploads two real synthetic originals, confirms byte-identical private downloads, records supplier/currency/item corrections with source IDs, explicitly confirms manual coverage, approves an equivalent group, compares 25.00 and 22.50 quoted line costs, and preserves the unknown-delivery restriction. It reloads the Excel workbook, invokes printing, renders a Chromium PDF and verifies saved state after navigation/reload. Private records never enter demo browser storage; test-owned comparisons are removed in cleanup.

**120 unit/integration tests across 13 files** passed. New coverage includes parser-only AI exclusion, durable mode pinning and terminal fences, manual-review acknowledgment and invalidation, bounded Windows lock contention, and backup/restore corruption, isolation and no-overwrite behavior. The runtime dependency audit reports zero findings. SQL tests execute all six migrations in embedded PostgreSQL with platform schemas stubbed; they do not certify hosted Supabase.

The offline evaluation was rerun as `baseline-all-ff504a533a5a-8dc06a6ab2cb`: 24/24 complete parser manifests, 144/144 authored identifiers, 963/963 source locations, 544/544 bounded regions, 8/8 robustness assertions, baseline pair precision 102/102 and recall 102/116. There were no model calls. AI remains disabled, and hosted private acceptance is pending configuration. Source revision `c1ccf44` is published. Vercel deployment `dpl_HJ6hcdhd78FskbKguCyhZLnvrbkC` is READY; **5/5 public browser checks pass in 22.8 seconds**. The public status still disables persistence, uploads and extraction, and no Vercel environment variables are configured. The personal launcher was separately started on this computer at `127.0.0.1:3001`; its actual listener and API confirm loopback-only local persistence/uploads with AI disabled. Its empty personal workspace was visually inspected. [Clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/34716991201) passed at `c1ccf44`, including install/audit, OCR setup, type/lint checks, all unit/integration tests, production build and all eight browser workflows (1.0 minute). A documentation-only follow-up records this evidence.

## UI refinement verification

Source revision **`486ef98`** passed [clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/34714827733): runtime dependency audit, OCR setup, TypeScript, lint, **95 unit/integration tests**, production build and **all seven browser workflows**. The local production-build browser run passed 7/7 in 27.7 seconds. The new test covers review guidance, visible source evidence, accessible next-step labels, search/filter recovery, unmatched offers and mobile focus visibility.

Vercel deployment `dpl_EtS4ErNWBDNyJjm53EgjqBVxgZe2` is READY at the canonical public URL. **5/5 public browser tests passed in 25.9 seconds**, including the new guidance test and the existing export, matching, keyboard and axe checks. The two real-upload tests remain local-only. The published decorative WebP is 36,228 bytes and matches the source hash recorded in [image provenance](image-assets.md). Public `/api/status` still reports demo mode with persistence, uploads and extraction disabled.

The updated [workspace](images/workspace-v2.png), [review](images/review-v2.png) and [comparison](images/comparison-v2.png) screenshots use only fictional samples and were captured from that public deployment. A documentation-only follow-up records these results. The [private-pilot plan](next-release.md) identifies the remaining hosted and AI gates; this UI release does not change their unverified status. Parser/model/calculation code and the offline evaluation fingerprint are unchanged, so the existing measured report remains applicable within its stated limits.

## Original release checks and evidence

| Check | Result and boundary |
| --- | --- |
| `npm run typecheck` and `npm run lint` | Pass on the final implementation and dependency updates |
| `npm test` | 95/95 tests across nine files, including actual filesystem persistence, embedded PostgreSQL migrations/RLS, deterministic money/matching rules, parsers, injected model responses, workbook round trips and source invariants |
| `npm run build` | Next.js production build passes locally; hosted build evidence is linked below |
| `npm run test:e2e` | 6/6 passed in 43.6 seconds. Local browser workflows exercise fixture review through both exports, matching edits, real local text/PDF/PNG upload and manual recovery, source canvases, keyboard navigation and axe checks |
| Public browser acceptance | 4/4 passed in 22.2 seconds against the updated deployment URL; private local upload tests are deliberately excluded |
| `npm run eval -- --mode baseline` | 24/24 parser manifests complete; baseline gold-item pair precision 102/102 and recall 102/116; eight separate robustness assertions pass. No model calls |
| `npm audit --omit=dev` | Zero reported runtime dependency findings after targeted updates. Full development audit has two entries for one unused Prisma build dependency issue; see [dependency review](dependency-review.md) |
| SDK compatibility smoke | Trigger SDK/build imports and ExcelJS conditional-formatting write/reload pass without dispatching tasks or contacting a provider |
| Hosted capability boundary | `/api/status` returns demo mode and `canPersist`, `canUpload`, `canExtract` all false; no Vercel project environment variables, Hobby plan verified |

The dependency-update source revision is **`165415c`**. [Clean Linux CI](https://github.com/Chi944/fieldops/actions/runs/34712631590) passed every check, including all six browser workflows. Vercel deployment `dpl_4ccf1VtXgN5qVFaN1osiUGws7haT` is READY and serves the canonical public URL; the public report run ID was verified as `baseline-all-f2a9c86ad905-8dc06a6ab2cb`. A subsequent documentation-only commit records these completed checks without changing application code. Local browser artifacts include screenshots, axe output, downloaded workbooks and a rendered report PDF in ignored `test-results/` and `playwright-report/`. CI retains browser artifacts for seven days. These checks do not establish every accessibility requirement or every possible quotation layout.

## Reproducible measurement

The original dependency-update offline run was `baseline-all-f2a9c86ad905-8dc06a6ab2cb`. Consult [the current report](evaluation-report.md) for the latest run ID, configuration and dataset hashes, Node runtime, OCR language-asset digest, per-file latency and denominators. Historical offline reports remain under `eval/runs/baseline`. The fingerprint includes the dependency manifest and lockfile so parser upgrades cannot reuse a live evaluation checkpoint under the old identity. The current milestone's test results do not constitute a fresh AI benchmark.

All 144 authored identifiers were present in parsed text, 963/963 parser locators were present and 544/544 reported boxes were in bounds. Those are structural parser measurements, not AI field accuracy or proof of semantic citation correctness. Baseline matching uses gold-normalized rows, not model-extracted rows. The independent agent review covered five primary originals and selected match pairs; no human gold verification is claimed.

## Precisely outstanding

| Gate | Required configuration or verification |
| --- | --- |
| Live extraction and semantic matching | Groq browser access now works, but the actual Free Plan, ZDR setting and dedicated API key remain unverified. Explicit AI mode and both account confirmations are required in web/worker configuration before synthetic live acceptance. No key belongs in chat or Git |
| Private cloud persistence/authentication | The dedicated Neon Free database, migration, restricted runtime and numeric invitation exist. Resolve access to that exact project, configure its GitHub provider/callback/trusted origin, private bucket, storage credential and CORS, then verify hosted ownership/session/source behavior |
| Hosted durable processing | The existing Trigger Free project and Development smoke are verified. Production still needs its own key/environment, OCR asset and Linux task deployment; then synthetic dispatch, cancellation, retry, quota and deletion checks |
| Live reliability claims | Development model run, frozen configuration and held-out live evaluation with measured field/line/matching/source/ambiguity/latency/usage denominators. Current AI metrics are explicitly UNVERIFIED |

No automatic paid fallback, purchases, existing-project reuse, supplier contact or private-document publication occurred. The deployed fixture demo and local parser/manual workflow remain usable independently of these gates.
