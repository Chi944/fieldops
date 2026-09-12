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
