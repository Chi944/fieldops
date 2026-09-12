# FieldOps product requirements

Status: agreed first-release specification. Captured 2026-09-13. Changes require an explicit entry in `docs/progress.md`.

**Accepted amendment:** The owner subsequently instructed “Do not use supabase use neon only.” The active cloud implementation uses Neon PostgreSQL, Neon managed Auth and Neon private Object Storage. Supabase references in the original plan describe the superseded choice. Free-only operation, private invited access, evidence preservation and all reliability requirements remain binding. The owner also requested AI configuration; activation still requires verified Groq Free/ZDR settings and a configured key. Account access is a deployment gate, not permission for paid fallback.

## Purpose and audience

FieldOps helps buyers compare supplier quotations across unrelated industries and layouts. It is a flagship portfolio project demonstrating full-stack engineering, applied AI, a polished user experience, and honestly measured reliability. Target a focused first release in roughly ten working days. Build a new independent repository; do not reuse or modify existing projects.

Central workflow: **create comparison → upload quotations → extract supplier details and line items → review source evidence and uncertainties → match comparable items → compare prices/commercial terms → export a decision-ready report**.

Support physical goods, services, and mixed quotations. “Any supplier” means flexible interpretation and an extensible data model, not universal document support or guaranteed interpretation. Unsupported or ambiguous inputs must explain the problem and provide recovery.

## Binding operating constraints

- Free hosting tiers and genuinely free model usage only. No purchases, paid trials, automatic upgrades, billing enablement, or paid model fallback.
- The public deployment is a noncommercial portfolio demonstration. Anyone may explore clearly labelled self-authored sample quotations. Only allowlisted authenticated accounts may upload real quotations.
- Use Groq Free `openai/gpt-oss-120b`, configurable behind a provider adapter. Confirm free account settings and Zero Data Retention before private uploads. Model text comes from parsers/OCR; this model does not inspect images.
- Existing Claude/Codex/Cursor subscriptions may be used for development; no desktop subscription credentials are copied into the hosted application. A subscription inference bridge is deferred.
- Never contact suppliers, purchase services, or publish private documents. Only synthetic or explicitly permissioned data may be public.
- If credentials or free provisioning are unavailable, continue local implementation. Ship a truthful labelled fixture demo and clearly identify unverified live functionality; never claim a mock extraction is live.
- No elaborate agent framework, vector database or unrelated features. Keep the implementation lean and coordinated.

## Connected screens and behaviour

### 1. Workspace

Create, rename, revisit and delete comparisons. Show individual processing status and unresolved review counts. Preserve comparisons across sessions for authenticated users and local work. Make empty states useful. Deletion removes access immediately and tracks pending cleanup until successful.

### 2. Upload and processing

Upload multiple quotations from different suppliers and paste quotation text. Show real file-transfer progress and meaningful processing stages. Support cancel, failed-file retry, exact duplicate detection and intentional quotation revisions. Successful files remain usable if another fails. Never truncate a document silently. Show quota waiting, unavailable processing and recoverable failures explicitly. Do not simulate AI progress for saved demonstration fixtures.

### 3. Extraction review

Display interpreted data next to its original source. Selecting a field reveals the relevant page, image region, sheet/cell or text excerpt when technically available. Keep all originals accessible. Prioritise ambiguous, incomplete and materially consequential fields. Distinguish supplier-stated facts, application calculations and user corrections by both text and visual treatment. Corrections preserve original interpretations, author, time and reason. Allow missing rows/values to be recovered manually without inventing evidence.

### 4. Item matching

Propose groups using identifiers, descriptions, specifications, units and commercial context. A similar description or exact identifier alone is not proof of equivalence. Let the buyer approve/reject proposals, split groups and regroup source lines. Distinguish equivalent items, alternatives and non-comparable items. Keep unmatched items visible. Source price lines remain indivisible; do not allocate a bundle price across invented children. Prevent double counting. Approval is tied to source/requirement versions and becomes stale when relevant data changes.

### 5. Comparison

Provide a clear side-by-side matrix with sticky item and supplier headers. Let the buyer set required quantities, service billing horizons and relevant requirements/preferences. Keep **As quoted** and **Requested scenario** distinct. Highlight material price differences, missing terms, exclusions, scope/specification conflicts and incomplete coverage. Link explanations to evidence. Preserve originals and show exactly what totals include. Do not create a favourable ranking from missing data.

### 6. Export

Export Excel with summary, matrix, original line items, commercial terms, assumptions, review issues and source index. Provide a print-friendly report suitable for browser PDF export, repeating matrix headers where possible. Export one pinned comparison snapshot with source/extraction/correction versions, comparison timestamp, assumptions, unresolved issues, source references and included-cost labels. Use stable authenticated source references, not expiring signed URLs. Formula-like supplier text must remain inert text.

## Document support and boundaries

First-release formats: text PDFs; legible printed scanned PDFs; PNG/JPEG; XLSX; UTF-8 CSV; pasted quotation text. English printed OCR initially. Handle multi-page tables, repeated headers, continuation rows, merged spreadsheet cells and multiple tables as far as the chosen parsers support. Detect multi-quotation files and request separation when they cannot be interpreted safely.

Default caps: five quotations per comparison; 20 MB per file; ten pages per PDF; five worksheets; 20,000 populated spreadsheet cells; 100 extracted items per quotation; 100,000 pasted characters; 20 million image pixels. Detect excessive archive expansion before fully parsing spreadsheets. Exceeded caps are explicit unsupported conditions, never partial extraction presented as complete.

Detect protected/encrypted documents, corrupt files, empty or unreadable scans, MIME/signature mismatches, unsupported formats and incomplete extraction. Recovery choices include uploading an unlocked or clearer copy, splitting documents, clarifying number/date/delimiter context, pasting text, and correcting/adding rows.

Parser outputs create immutable evidence before model extraction. Every source reference belongs to the same document revision. Preserve dimensions and transforms for page/region highlights. Never fabricate coordinates, exact OCR text or citations. Use page-only references when finer evidence is unavailable. Record coverage for every expected page/sheet/text section. A finished job is separate from extraction completeness and review completion. Coverage and arithmetic checks cannot prove universal semantic completeness; retain residual uncertainty.

PDF.js provides text/geometry and rendering. Tesseract operates on rendered images, with structured OCR output enabled. Scan detection must not mistake a digital footer/header for a readable quotation body. XLSX preserves sheet/cell addresses, merged masters, formatting context, formulas and cached results. Do not execute formulas or external links; absent caches need review. CSV records may span physical lines, so keep logical-record and raw-source metadata.

## Shared schema and provenance

Use a relational shared core plus typed source-linked optional attributes. Keep useful sector-specific information under its original label rather than forcing it into an incorrect category.

Capture where present:

- Supplier name, contact, email, telephone and address.
- Quotation identifier, date, validity, revision and superseded quotation relationships.
- Original currency and number/date formatting context.
- Goods/service description, identifier, specifications and additional attributes.
- Quoted quantity, unit, package contents/unit, minimum order and order increment.
- Unit price, stated line amount, all-unit quantity price tiers and discounts.
- Taxes, shipping, setup fees, recurring fees and other charges.
- Availability, lead time, delivery, payment, warranty, exclusions and notes.
- Service scope, billing basis, duration, milestones, deliverables and recurring versus one-time charges.

`FieldValue<T>` must distinguish value, not stated, not applicable and ambiguous. Numeric zero is a value. Preserve raw supplier wording, candidate interpretations when available, source IDs and origin (supplier, calculated, user). Calculations retain input paths and formula version. User corrections are append-only overlays; they do not erase extraction history.

Primary entities: workspaces/memberships/comparisons; immutable documents and quotation revisions; source spans/extraction versions; line items/charges/terms; corrections/issues/match groups; processing runs; export snapshots. Comparison snapshots pin requirements, quantities, data versions, approvals, exchange rates and calculation version.

Money and numeric values cross API boundaries as decimal strings. Monetary arithmetic uses Decimal.js, and relational monetary storage uses PostgreSQL numeric. Validate structured model responses again in server code; syntactic schema conformance is not factual correctness.

## Deterministic comparison rules

Use AI for extraction, semantic matching, ambiguity detection and evidence-grounded prose. Use code for arithmetic, conversions, constraints, eligibility, numeric facts and winner selection.

1. Preserve original supplier values, currency and units. Independently check line amounts and totals; keep every discrepancy visible, including possible rounding differences.
2. Convert units only with known dimensions and factors. Convert package prices only with explicit contents. Do not equate hour/project, month/year without a valid explicit scenario, or incompatible service scope/specifications.
3. Separate required, quoted and proposed order quantities. Apply explicit MOQ and order increments. Show surplus from buying whole packs/minimums; require buyer acceptance before the resulting order is ranked.
4. Support explicit all-unit price tiers. Determine the tier using accepted order quantity in the tier's supplier unit. Gaps, overlapping/conflicting boundaries, ambiguous bases and graduated/marginal tiers block repricing.
5. Support explicit percent/fixed discounts on known bases; never discount an already-net price again. A changed/partial basket cannot inherit an order discount without explicit eligibility. Do not invent allocations of order discounts across lines.
6. Include shipping, setup, recurring and other fees only when applicability is known. Apply fixed fees once. Keep supplier-stated totals separate from scenario totals.
7. Distinguish tax included, excluded and unstated. Calculate/remove tax only with an explicit rate and base. Unknown tax is not zero. Incompatible tax bases cannot share a cheapest highlight.
8. Use supplier rounding rules when explicit; otherwise disclose the application's projection rounding rule. Never modify stated values to make them reconcile.
9. Require matching service billing bases and reviewed scope. Recurring scenarios require an integer count of stated billing periods; no inferred working hours or contract proration.
10. Separate currencies by default. Optional user-entered FX records from/to direction, decimal rate, date and source, alongside originals. Never fetch or invent an exchange rate.
11. Match groups can be split/regrouped; original supplier price lines remain indivisible and cannot contribute twice to one basket. Bundled alternatives may remain non-comparable.
12. Rank complete baskets only for the same approved requirements, accepted quantities, comparable currency and cost basis. Label partial common-item subtotals and coverage; do not turn them into an overall winner. A total with unknown delivery is not complete landed cost.

## Decision support

Support lowest comparable quoted cost; earliest comparable explicitly stated lead time; fit to user-entered requirements; missing terms and supplier clarification questions. Recommendations state their criteria and cite evidence. Allow insufficient information and not directly comparable. Code computes facts and criteria; AI prose may only explain supplied facts with validated references. Fall back to deterministic explanations when AI fails. No weighted scoring in v1; any future scoring must expose weights and missing-data treatment.

## Security, jobs and operations

- GitHub OAuth and operator-managed allowlist for real uploads. Use application authorization plus database/storage RLS for every workspace-owned object. Privileged workers independently validate object ownership. Credentials remain server-only; originals stay private.
- Persistent job state and intent before dispatch; stable idempotency keys and an outbox reconciliation path. Checkpoint completed stages/pages/chunks. Preserve successes across retries.
- One document job at a time initially; bounded parser/model/task timeouts; at most two execution attempts. Retry only transient failures with bounded backoff. Persist quota waiting and honour Retry-After rather than blocking a worker indefinitely.
- Reserve estimated tokens and worst-case compute before accepting jobs; reconcile actual usage. Keep free quota headroom for maintenance. Never automatically enable billing or use a paid fallback. Explain exhausted quotas.
- Store cancellation and tombstones durably. Fence result commits against active attempt/input revision. A cancelled/deleted/superseded run cannot publish late output. New extraction is a candidate version; it cannot erase corrections.
- Internal APIs validate inputs and require expected revisions for writes. Return conflict on stale edits. Never trust browser-supplied owner IDs or source paths.
- Document text is untrusted data. It cannot alter prompts/application policy, invoke tools, request network access, access other files or execute formulas/code. Escape previews/exports. No external model tools.
- Operational logs contain IDs, durations, counts and sanitised error codes, never quotation text, contact details, prompts, credentials or signed URLs. Task payloads contain IDs.
- Original files and reviewed records persist until deletion within explicit quotas. Derived previews expire after seven days; export cache after 24 hours. Immediately revoke access on deletion; retry cleanup until confirmed. Document provider backup/log retention separately and do not claim instant removal from provider backups.
- Local development mode must be explicitly enabled and loopback-only; never expose unauthenticated local APIs in deployment.

## Evaluation and tests

Create 24 self-authored documents in eight scenarios of three suppliers each, covering goods/services/mixed quotations and unrelated sectors. Development: industrial supplies, office IT, event production, translation. Held out: laboratory consumables, kitchen equipment, installation, facilities maintenance. Each split contains text PDFs, scans, an image, XLSX, CSV and pasted text. Include differing units/currencies/number formats, tiers/packages/MOQ, ambiguous dates, missing terms, incompatible specs, multiple tables and continuation rows.

Eight separate robustness cases: exact duplicate; intentional revision; protected PDF; corrupt file; unreadable scan; unsupported/MIME-mismatch; excessive size; malicious document instructions. Do not blend malformed inputs into ordinary extraction denominators.

Independently check gold critical values, matches, ambiguities and evidence against rendered sources. Independently verify arithmetic. Disclose synthetic authorship and absence of human checking where applicable. Freeze model, parser, prompt/schema configuration and commit before held-out inference. If held-out results inform fixes, preserve the original and label further runs regression, not untouched holdout.

Report actual counts/denominators for field accuracy (critical and overall), missing-state classification, item precision/recall, equivalent-pair precision/recall, false equivalence, missed ambiguities/false alerts, arithmetic correctness, source resolution and source support. Report stage/end-to-end latency, quota waiting, input/output tokens, retries, actual cost and limitations. Separate raw AI quality from after-review outcomes. Never inflate accuracy with numerous absent optional fields. Small-sample p95 is unstable and must not be oversold.

Compare AI matching to normalised identifier plus token-similarity baseline with identical compatibility safeguards, both on gold-normalised and extracted items. Targets (not claims): 95% equivalence precision and 90% critical-field accuracy/item recall. Narrow supported scope when measurement warrants it.

Required tests: decimal conversions/tier/MOQ/pack interactions, discounts, taxes, service periods, partial baskets and eligibility; source validity/completeness; interrupted and repeated jobs; duplicate/revision handling; cancellation/late writes; concurrent corrections; quota exhaustion; private file access and deletion; cross-user isolation; Excel and print correctness; formula-like text; keyboard workflow/contrast. Live smoke test each advertised format when credentials are available. Explicitly distinguish simulated transport tests, parser tests, fixture mode and live inference.

## Deliverables and completion

Working application and deployment instructions; labelled demo with realistic sample originals; database migrations/configuration docs; passing meaningful tests; reproducible resumable evaluation script and actual measured report; architecture diagram; portfolio case study explaining decisions/limitations and a substantive observed failure fixed; short demonstration script. Record progress in the repository. Do not mark the tracked goal complete while required work remains or because a free-service credential is missing.

Deferred: DOCX, handwriting, broad multilingual OCR, legacy XLS, image-only spreadsheet tables, formula reconstruction, graduated pricing, automatic bundle allocation, inferred commercial assumptions, weighted scoring, live FX, enterprise collaboration and integrations.
