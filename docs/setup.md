# Setup and operation

## Prerequisites and modes

Use Node.js 24 and `npm ci` from the repository root. The lockfile pins the installed dependency graph. The `predev` and `prebuild` scripts copy the installed PDF.js browser worker into `public`; no model is called by installation or build.

| Configuration | Mode |
| --- | --- |
| No live credentials, local flag false | Labeled public demo; sample edits use this browser's local storage |
| `FIELDOPS_LOCAL_MODE=true` outside hosted runtimes | Private local workspace with atomic filesystem persistence and a local processing runner |
| Restricted Neon runtime URL, managed Auth endpoint, cookie secret and site origin configured; local flag false | GitHub-authenticated cloud workspace; only invited identities can access private data |

Local mode takes precedence on a local machine, even if cloud variables happen to be present. It is disabled when Vercel, Render or AWS Lambda runtime markers are present. The supplied development and production-start commands bind to `127.0.0.1`. Integration-managed `DATABASE_URL` alone does not enable cloud mode: the application requires its separate `FIELDOPS_DATABASE_URL` and Auth configuration. Configuration readiness is not a hosted health check.

## Local startup

For personal use, prefer `npm run personal:check` followed by `npm run personal`. The [personal guide](personal-use.md) covers its separate data directory, source-review workflow and verified backup/restore commands. The commands below are for ordinary development.

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env.local)) { Copy-Item .env.example .env.local }
npx tsx scripts/process.ts --prepare-ocr
```

Only copy the template if `.env.local` does not already exist; preserve an existing configuration. Edit `.env.local`: set `FIELDOPS_LOCAL_MODE=true` and `FIELDOPS_PROCESSING_MODE=parse_only`; leave `GROQ_API_KEY` empty, `GROQ_FREE_TIER_CONFIRMED=false` and `GROQ_ZDR_CONFIRMED=false`. Choose an unused development port, for example:

```powershell
npm run dev -- --port 3003
```

Open the loopback URL printed by Next. `GET /api/status` must report `mode: "local"`, `canUpload: true`, `canExtract: false`. For a production-mode local check, run `npm run build` followed by `npm start -- --port 3003` on a free port. Do not use the unrelated service on port 3000 or stop another process to free a port. `npm run personal` selects a free port from 3001 through 3009 automatically and uses a separate Next build directory.

The OCR setup command downloads printed-English Tesseract data from `https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz`, validates its format/size and prints its local SHA-256. Runtime parsing reads that local file; it does not fetch language data automatically. The file lives at `.fieldops/tessdata/eng.traineddata.gz`. `FIELDOPS_OCR_DATA_DIR` can override this directory locally; the provided Trigger build bundles only the default location.

## Working without AI

1. Create a comparison in the local workspace and upload one or more originals, or paste quotation text.
2. The real parser saves source spans and its coverage manifest. In `parse_only` mode, complete supported coverage finishes as `source_ready` without attempting AI. A failed or incomplete source retains its original and any successfully parsed sections for recovery.
3. Review the source, add line items manually and correct supplier fields with a reason. Select preserved source spans when they support the manual row. Manual values have `origin: "user"`; no evidence coordinates are invented, and references to other quotations are rejected.
4. Generate labeled identifier/text proposals or group rows manually. Review specifications, scope, units and billing basis before approving groups.
5. Enter required quantities and preferences, inspect missing charges and discrepancies, then export Excel or print the report.

Parsing-only uploads finish in `source_ready` when all supported source sections are readable. Add the supplier name and source-linked lines, inspect terms, then use **Confirm manual review** with a reason after reviewing every source section. The resulting quotation remains version zero with user-origin values; it is never labeled AI extraction. Corrections or new lines reset this confirmation. Failed-file retries preserve their original processing mode and saved parsing. Acknowledging a discrepancy does not correct supplier arithmetic.

Parser coverage and interpretation completion are separate: a source can have a complete parser manifest while its quotation awaits manual review. Missing or unsupported source sections block manual completion and remain visible. Review the quotation status and unresolved issues, not only the count of readable pages. Text and CSV uploads must be UTF-8; unsupported encoding fails explicitly while retaining the exact original bytes.

## Environment reference

All application credentials are server-only. None needs a `NEXT_PUBLIC_` name. Configure Vercel production and Trigger production separately; one platform does not copy secrets to the other.

Trigger **Development** is now connected and its synthetic task has completed successfully. It uses a separate ignored `.env.trigger.local` and development-only key, not the production environment in this table. See [Trigger development setup and measured smoke result](trigger-development.md). This does not enable hosted private uploads or verify live AI.

| Variable | Web deployment | Trigger production | Purpose/default |
| --- | --- | --- | --- |
| `FIELDOPS_LOCAL_MODE` | `false` | `false` | Explicit local-only persistence; never enable publicly |
| `FIELDOPS_PROCESSING_MODE` | `parse_only`, or intentionally `ai` | Same setting | Parser-only default; an admitted document's mode stays pinned on retry |
| `FIELDOPS_DATABASE_URL` | Required for private workspace | Required | TLS URL for restricted `fieldops_runtime`, granted `fieldops_server` |
| `DATABASE_URL` | Integration may provide it; application ignores it | Do not supply | Administrative migration credential; never a runtime fallback |
| `NEON_AUTH_BASE_URL` | Required | Not required | This branch's managed Auth endpoint |
| `NEON_AUTH_COOKIE_SECRET` | Required | Do not supply | Separate random secret, at least 32 characters, for managed Auth cookies |
| `FIELDOPS_SITE_URL` | Required | Not required | Exact HTTPS origin, e.g. `https://fieldops-eight-blue.vercel.app`; also a Neon Auth trusted origin |
| `NEON_STORAGE_ENDPOINT` | Required for uploads/source access | Required | HTTPS branch S3 endpoint containing `.storage.` and ending in `.neon.tech` |
| `NEON_STORAGE_ACCESS_KEY_ID` | Required for storage | Required | Neon branch storage credential `token_id` |
| `NEON_STORAGE_SECRET_ACCESS_KEY` | Required for storage | Required | Neon credential `s3_secret_access_key`; never log it |
| `NEON_STORAGE_REGION` | Required for storage | Required | `us-east-2` for the dedicated Ohio project |
| `NEON_STORAGE_BUCKET` | Optional | Same value | Defaults to private `quotations` |
| `TRIGGER_PROJECT_ID` | Required for cloud uploads | Required; also deployment shell | Dedicated Free project identifier |
| `TRIGGER_SECRET_KEY` | Required for cloud uploads | Must be available | Matching production key, with trigger and cancellation permissions |
| `GROQ_API_KEY` | Required only for AI | Required only for AI | Dedicated Free API key; leave empty until configured |
| `GROQ_MODEL` | Same allowed model | Same allowed model | Default `openai/gpt-oss-120b`; `openai/gpt-oss-20b` is also supported |
| `GROQ_FREE_TIER_CONFIRMED` | `false` until verified | Same value | Operator confirmation that the account is on Free |
| `GROQ_ZDR_CONFIRMED` | `false` until verified | Same value | Operator confirmation that Groq Zero Data Retention is enabled |
| `FIELDOPS_DATA_DIR` | Leave unset | Leave unset | Local-only private directory; ordinary local mode defaults to `.fieldops` |
| `FIELDOPS_OCR_DATA_DIR` | Leave unset | Leave unset | Local-only override; hosted OCR assets use bundled `.fieldops/tessdata` |

Set the GitHub client ID/secret in the Neon Auth provider, not either application runtime. Its provider callback is `${NEON_AUTH_BASE_URL}/callback/github`; the application's return is `${FIELDOPS_SITE_URL}/auth/callback`. The active migration and restricted role setup are in [neon/README.md](../neon/README.md). [Deployment instructions](deployment.md) cover trusted origins, storage CORS, free budgets and account setup.

The AI mode, key, free-tier confirmation and retention confirmation must all be present, and the model must be allowed. Flags record a checked account setting; they do not prove provider state or model accuracy. Until activation succeeds, manual review remains available with configured storage and processing. The personal launcher defaults to parser-only; `npm run personal -- --ai` loads only model settings from `.env.ai.local`. See [personal AI instructions](personal-use.md#enable-automatic-interpretation). Desktop Claude, Codex or Cursor subscriptions are not application API credentials. There is no paid fallback.

## Limits and recovery

| Limit or failure | Behavior and recovery |
| --- | --- |
| Five quotations per comparison; 20 MiB per file | Create another comparison or split a large source |
| Ten PDF pages; five worksheets; 20,000 populated cells; 100 line items; 100,000 text characters; 20 million image pixels | Parsing reports supported coverage and limit warnings/errors; reduce the input and review the manifest |
| Unsupported extension, malformed file or password-protected PDF | The file fails explicitly; export an unlocked PDF/XLSX/CSV or paste the relevant text |
| Missing OCR data or unreadable scan | Install OCR data; otherwise rescan more clearly or paste text. Printed English is the supported OCR target |
| Incomplete extraction or ambiguous values | Review flagged fields and coverage before treating the result as complete |
| Duplicate SHA-256 within a comparison | Open the existing quotation or intentionally upload a separate revision; revision metadata preserves the relationship |
| Interrupted process | Keep the original. Restart the server and open the workspace; expired leases become eligible for processing again |
| Transient processing failure | At most two execution attempts before manual retry is required; completed parsing/chunks are reused |
| Free model quota | Persist `waiting_quota` with the next retry time and resume automatically, up to 20 quota waits. Quota waits do not consume execution-failure attempts |
| Ten-minute processing timeout | Split the source into smaller files and retry |
| Stale comparison revision (`409 stale_revision`) | Reload the latest comparison before resubmitting the edit; a stale write is never silently accepted |
| Cloud compute reservation exhausted | New jobs fail with `429 quota`. Wait for the rolling free budget to release; do not enable paid billing |

The local runner processes one document at a time, checks for work every five seconds and renews a 30-second lease. It starts when the workspace/status/run API is requested. It is durable across restarts through saved jobs, but it cannot execute while the local server is stopped. Originals persist after cancellation and failure.

## API contracts

All private routes check the session/invitation or the explicit local boundary. Mutations reject cross-origin browser requests. JSON request bodies are limited to 2 MiB. Errors use `{ "error": { "code", "message", "details"? } }`; API responses are not cacheable.

| Method and route | Body / result |
| --- | --- |
| `GET /api/status` | Mode, readiness flags, reasons and limits; no secrets |
| `GET /api/comparisons` | `{ comparisons }` |
| `POST /api/comparisons` | `{ name, description? }` → `{ comparison }` |
| `GET /api/comparisons/:id` | `{ comparison, runs }`, including persisted source review data |
| `PATCH /api/comparisons/:id` | `{ baseRevision, name?, description?, groups?, exchangeRates?, preferences? }` → `{ comparison }` |
| `DELETE /api/comparisons/:id` | Deletes comparison, related data and original objects; `204` |
| `POST /api/comparisons/:id/corrections` | `{ baseRevision, quotationId, path, after: { state, value }, reason }` |
| `POST /api/comparisons/:id/items` | `{ baseRevision, quotationId, item: { description, quantity, unit, unitPrice, currency, kind, billingBasis?, scope?, sourceIds?, taxBasis?, taxRate? }, reason }`; selected evidence must belong to this quotation |
| `POST /api/comparisons/:id/issues` | `{ baseRevision, quotationId, issueId, reason }`; acknowledges and retains issue |
| `POST /api/comparisons/:id/matches/propose` | `{ baseRevision, mode: "baseline" \| "ai" }` → `{ comparison, method }`; AI mode fails explicitly when disabled |
| `POST /api/comparisons/:id/uploads` | Local: multipart `file` plus optional `allowDuplicate`, `supersedesId`, `processingMode`. Pasted text: JSON `{ text, filename?, allowDuplicate?, supersedesId?, processingMode? }`. Returns `202 { run, documentId, comparison }` |
| `POST /api/comparisons/:id/uploads/initiate` | Cloud: `{ filename, size, sha256, allowDuplicate?, supersedesId?, processingMode? }` returns `{ documentId, uploadUrl, method: "PUT", headers, expiresIn, expiresAt, contentType, resumed? }` |
| `POST /api/documents/:id/finalize` | Cloud: verifies uploaded bytes against reserved hash/size and queues a run; idempotent for an already finalized upload |
| `GET /api/documents/:id/source` | Owner-checked original; local bytes or a 60-second private cloud URL redirect |
| `DELETE /api/documents/:id` | `{ baseRevision }` → comparison retaining other quotations |
| `GET /api/runs/:id` | `{ run }` for polling |
| `POST /api/runs/:id/cancel` | Cancels the run and fences later results; retains original |
| `POST /api/runs/:id/retry` | Safely retries a failed, cancelled or quota-blocked run with a new execution fence |

Monetary and quantity fields use decimal strings, such as `"12.50"`. `kind` is `goods`, `service`, `mixed` or `unknown`. `taxBasis` is `inclusive`, `exclusive` or `not_stated`; `taxRate` is a decimal percentage from zero through 100 and remains missing unless supplied. Correction paths address existing field wrappers, for example `supplier.name` or `items.<item-id>.unitPrice`, plus the explicitly supported item `kind` and `taxBasis` enums. Manual-row audit entries carry `operation: "add_item"` so exports can distinguish original rows from later additions. Comparison mutations return a new revision; send that revision with the next edit.

Cloud files use direct storage uploads to avoid Vercel's request-body limit: initiate, PUT exact bytes to the staging URL with the returned headers, then finalize. The browser supplies Content-Length from the file; do not set it manually. The five-minute URL is a temporary bearer credential. A matching unfinished retry resumes its intent and receives a fresh ticket; completed duplicates still require an explicit revision/separate-upload choice. Poll the returned document/run rather than creating intents. A hash or size mismatch requires deleting the unfinished upload and selecting the correct file again. Finalization can be repeated after an uncertain response without creating another run.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run fixtures
npm run eval -- --mode baseline
```

The evaluation writes `eval/results/latest.json` and `docs/evaluation-report.md`. Regenerating fixtures rewrites only authored benchmark assets; it is unnecessary for ordinary application use. Read the report's limitations before citing measurements. Running the actual hosted OAuth/storage/Trigger acceptance checks remains a separate deployment step.

For browser acceptance, install Chromium once and run Playwright:

```powershell
npx playwright install chromium
npm run test:e2e
```

The default configuration starts an isolated local server on port 3002 with AI disabled and data under `.fieldops/e2e-storage`. Ordinary Next development commands share the default build directory; do not start competing instances there. The personal launcher uses `.fieldops/personal-next` and separate private data, so tests must not be pointed at its live workspace. To reuse an already running **local test server**, set `FIELDOPS_TEST_BASE_URL` to that test server's loopback URL; do not target a private production workspace. Browser tests create synthetic comparisons, exercise exports and retain failure traces in gitignored test output directories.
