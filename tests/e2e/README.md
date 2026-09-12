# Browser acceptance checks

Install the project's development dependencies, then install the test browser once:

```sh
npx playwright install chromium
npm run test:e2e
```

By default Playwright starts an isolated local server on `127.0.0.1:3002`, writes test-owned local files to `.fieldops/e2e-storage`, and explicitly disables the Groq key and free-plan flags. Stop another Next development process in this same checkout first, because Next shares a development-build lock. The local recovery test requires `canExtract: false` and never requests model inference.

To reuse an already running local server, set `FIELDOPS_TEST_BASE_URL`, for example in PowerShell:

```powershell
$env:FIELDOPS_TEST_BASE_URL='http://127.0.0.1:3001'
npm run test:e2e
```

The public demo tests override capability discovery with the documented public-demo configuration. They use the application's actual bundled fixtures, state updates and export implementation; there is no mocked extraction response. The real local upload test does not override capabilities or API responses. It creates a synthetic pasted quotation, verifies the saved source, adds a manually reviewed row, confirms no invented source ID, and deletes its own comparison in cleanup.

Tests cover create/rename/delete, sample upload, source highlight, correction history, invalidated approvals, reapproval, reject/split/regroup, persistent browser edits, the comparison matrix, a downloaded Excel workbook, and browser print/PDF rendering. A source-preview integration test uploads the actual self-authored `industrial-1.pdf` and `event-1.png`, verifies byte-identical private downloads, nonempty rendered canvases, PDF page navigation, and preserved manual source/tax associations with visible evidence-region overlays. Keyboard checks cover mobile navigation and dialog focus restoration. Axe scans WCAG A/AA rules on the workspace, source review, comparison, and an open mobile correction dialog. Automated scans do not establish full accessibility compliance or replace assistive-technology testing.

Screenshots, a rendered decision PDF, axe JSON attachments and failure traces are written to ignored `test-results/` and `playwright-report/`. `tests/export.test.ts` separately reloads generated workbooks and checks preserved originals, correction history, literal formula-like text, sources, missing states, price rules and FX assumptions.

These tests do not establish deployed Supabase/Trigger integration, real authentication-provider behaviour, production OCR capacity, or live AI quality. Those need configured hosted services and the separately controlled live evaluation protocol.

Last verified on 13 September 2026 against the local Next development server with AI disabled: **6/6 browser tests passed** in 43.6 seconds; axe reported zero violations in the four tested states. Separate parser, workbook and demo-source suites passed **24/24 tests** (18 parser/adapter, four workbook, two source invariants). The browser run fixed and retested insufficient text contrast, an unfocusable source scroll area, lost dialog return focus, loopback request normalization, and the source-only quotation's incomplete state. These are scoped local test results, not deployed reliability or model-quality measurements.

The subsequent UI refinement was verified against the local **production build** with AI disabled: **7/7 browser tests passed in 27.7 seconds**. The added `refinements.spec.ts` checks Ctrl/Cmd+K search (and no unmodified character shortcut), clear/filter recovery, accessible next-step labels, deep links to the quotation with issues, actual discrepancy evidence, missing-source behavior, correction evidence, unmatched filters and keeping keyboard focus visible on mobile. All existing upload, export, keyboard and axe checks passed again. Current UI screenshots in `docs/images/*-v2.png` come from this production-build run using only fictional sample data.
