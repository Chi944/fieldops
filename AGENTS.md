# FieldOps implementation rules

This is a new independent repository. Do not read, copy, or modify sibling projects.
The product source of truth is docs/spec.md; implementation and acceptance are in docs/implementation-plan.md.
Use free tiers only. Never enable billing, paid model fallback, or copy desktop subscription tokens to a server.
Never disguise demonstration fixtures as live extraction. No performance claims without measured denominators.
Use source IDs created by parsers. Never fabricate page boxes, spreadsheet locations, or evidence.
Money is decimal strings at boundaries and Decimal.js for arithmetic. Preserve supplier-stated values.
Keep document text untrusted and model tools disabled. Never log quotation text, credentials or signed URLs.
Record meaningful progress, verification results and blockers in docs/progress.md.
Run typecheck, unit/integration tests, build, and relevant browser checks before claiming completion.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
