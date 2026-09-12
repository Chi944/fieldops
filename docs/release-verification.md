# First-release verification

Verified on 13 September 2026. This release delivers the public fixture demonstration and a real local upload, source review, manual recovery, matching, comparison and export workflow. The configured cloud pilot and live AI evaluation remain separate, unverified gates.

## Delivered

- [Public application](https://fieldops-eight-blue.vercel.app) and [reliability page](https://fieldops-eight-blue.vercel.app/reliability).
- [Independent source repository](https://github.com/Chi944/fieldops), complete [requirements](spec.md), [implementation plan](implementation-plan.md) and [acceptance status](acceptance-status.md).
- [Local setup](setup.md), six Supabase migrations, [deployment instructions](deployment.md), [architecture](architecture.md), [retention behavior](security-and-retention.md), [case study](case-study.md) and [three-minute demonstration script](demo-script.md).

## Personal-use milestone verification

The isolated personal launcher, source-only processing and manual review milestone passed TypeScript, ESLint, the production build and **all eight browser workflows in 24.8 seconds** against the local production server. The personal test uploads two real synthetic originals, confirms byte-identical private downloads, records supplier/currency/item corrections with source IDs, explicitly confirms manual coverage, approves an equivalent group, compares 25.00 and 22.50 quoted line costs, and preserves the unknown-delivery restriction. It reloads the Excel workbook, invokes printing, renders a Chromium PDF and verifies saved state after navigation/reload. Private records never enter demo browser storage; test-owned comparisons are removed in cleanup.

**120 unit/integration tests across 13 files** passed. New coverage includes parser-only AI exclusion, durable mode pinning and terminal fences, manual-review acknowledgment and invalidation, bounded Windows lock contention, and backup/restore corruption, isolation and no-overwrite behavior. The runtime dependency audit reports zero findings. SQL tests execute all six migrations in embedded PostgreSQL with platform schemas stubbed; they do not certify hosted Supabase.

The offline evaluation was rerun as `baseline-all-ff504a533a5a-8dc06a6ab2cb`: 24/24 complete parser manifests, 144/144 authored identifiers, 963/963 source locations, 544/544 bounded regions, 8/8 robustness assertions, baseline pair precision 102/102 and recall 102/116. There were no model calls. AI remains disabled, and hosted private acceptance is pending configuration. Clean Linux CI and public refresh evidence will be recorded after publication.

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

The current offline run is `baseline-all-f2a9c86ad905-8dc06a6ab2cb`. [The report](evaluation-report.md) includes the full configuration and dataset hashes, Node runtime, OCR language-asset digest, per-file latency and all denominators. Historical offline reports remain under `eval/runs/baseline`. The fingerprint includes the dependency manifest and lockfile so parser upgrades cannot reuse a live evaluation checkpoint under the old identity.

All 144 authored identifiers were present in parsed text, 963/963 parser locators were present and 544/544 reported boxes were in bounds. Those are structural parser measurements, not AI field accuracy or proof of semantic citation correctness. Baseline matching uses gold-normalized rows, not model-extracted rows. The independent agent review covered five primary originals and selected match pairs; no human gold verification is claimed.

## Precisely outstanding

| Gate | Required configuration or verification |
| --- | --- |
| Live extraction and semantic matching | The user explicitly requested integration stay disabled. `GROQ_API_KEY`, `GROQ_FREE_TIER_CONFIRMED=true` and `GROQ_ZDR_CONFIRMED=true` remain unconfigured. No key belongs in chat or Git. Actual free-plan and retention settings must be confirmed by the operator before enabling the adapter |
| Private cloud persistence/authentication | A new Supabase Free project, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`, migrations, dedicated GitHub OAuth setup and numeric-ID invitation records |
| Hosted durable processing | A new Trigger Free production project, `TRIGGER_PROJECT_ID`, `TRIGGER_SECRET_KEY`, worker environment and OCR asset deployment; synthetic hosted dispatch, cancellation, retry, quota and deletion checks |
| Live reliability claims | Development model run, frozen configuration and held-out live evaluation with measured field/line/matching/source/ambiguity/latency/usage denominators. Current AI metrics are explicitly UNVERIFIED |

No automatic paid fallback, purchases, existing-project reuse, supplier contact or private-document publication occurred. The deployed fixture demo and local parser/manual workflow remain usable independently of these gates.
