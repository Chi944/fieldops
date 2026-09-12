# First-release verification

Verified on 13 September 2026. This release delivers the public fixture demonstration and a real local upload, source review, manual recovery, matching, comparison and export workflow. The configured cloud pilot and live AI evaluation remain separate, unverified gates.

## Delivered

- [Public application](https://fieldops-eight-blue.vercel.app) and [reliability page](https://fieldops-eight-blue.vercel.app/reliability).
- [Independent source repository](https://github.com/Chi944/fieldops), complete [requirements](spec.md), [implementation plan](implementation-plan.md) and [acceptance status](acceptance-status.md).
- [Local setup](setup.md), five Supabase migrations, [deployment instructions](deployment.md), [architecture](architecture.md), [retention behavior](security-and-retention.md), [case study](case-study.md) and [three-minute demonstration script](demo-script.md).

## Checks and evidence

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
