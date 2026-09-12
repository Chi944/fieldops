# FieldOps: comparing supplier quotations without hiding uncertainty

FieldOps is a procurement workspace for turning differently structured supplier quotations into a comparison a buyer can defend. The difficult part is deciding what can legitimately be compared: a box and an individual unit, an hourly estimate and a fixed scope, or a low item price with unknown delivery costs.

The project was built from a new repository as a focused full-stack and applied-AI portfolio project. Its first release centers on source review, item matching, deterministic calculation, and export. It supports fictional demonstration workspaces and a real processing implementation; the free model account and inference ZDR are configured, with small real synthetic successes and larger development failures measured separately. The [public demonstration](https://fieldops-eight-blue.vercel.app) is deployed on Vercel Hobby. The [release record](release-verification.md) documents passing local and public browser checks; the hosted pasted-text/manual workflow also passed. Broad live AI performance remains unverified.

## Product and engineering decisions

The comparison matrix and source pane share the same underlying evidence references. A field retains its original supplier interpretation, source locations, state and origin. Missing, ambiguous, not-applicable and zero values have different meanings. A user correction appends an audit entry and invalidates affected approvals; it does not erase what the parser originally interpreted.

The implementation uses TypeScript and React/Next.js, Neon PostgreSQL with managed Auth and private object storage, and persistent background-processing state. The owner selected Neon after the initial Supabase plan; the migration retained the revision/job contracts and added restricted database-role and object-ticket tests. A local mode supports development without cloud credentials. Text/PDF, spreadsheet and OCR parsers preserve actual text spans, page geometry and sheet/cell locations when available. Structured model output is validated, source IDs are checked, and incomplete coverage remains a visible failure or review state. The model receives document contents as untrusted data and has no external-action tools.

AI and arithmetic have separate responsibilities. AI may interpret fields and propose semantic groups. Decimal application code calculates prices, quantity tiers and taxes where their bases are explicit. Package pricing requires stated contents; extra quantities needed to satisfy whole packages or MOQ require buyer acceptance. Conflicting specifications or hourly-versus-fixed billing cannot become a priced equivalence merely because a client sends an approved flag.

Recommendations expose their criterion. Cost highlights require comparable reviewed values. The lead-time comparison accepts explicit compatible duration ranges and start conditions; overlapping ranges, missing terms and mixed business/calendar bases return insufficient information. Requirement summaries report reviewed coverage and a checklist, not an invented semantic suitability score.

The first release deliberately excludes weighted scoring, agent orchestration, automatic allocation of bundle prices, inferred exchange rates, and claims of universal document understanding. These cuts keep the buyer workflow complete and make its failure modes reviewable.

## Measured evidence

The reproducible dataset has 24 self-authored quotation documents, 144 logical items, eight unrelated comparison scenarios, and separate development and held-out splits. Each split contains text PDFs, scanned PDFs, a PNG, XLSX, CSV and pasted text. Eight robustness cases exercise specific unsupported, malformed, duplicate, revised, oversized and misleading inputs separately.

The initial offline run measured baseline equivalent-pair precision of **102/102** and recall of **102/116**. It found **zero false equivalences among 28 annotated difficult negative pairs**. All 24 parser manifests completed; all 144 authored item identifiers were present in parser output. These are parser and matching-baseline results on synthetic inputs with explicit identifiers. They are not field-extraction accuracy or proof that citations are semantically correct.

The recall loss is informative: a third supplier's incompatible alternative makes the entire candidate group require review, which also withholds a valid pair within that group. This conservative behavior loses automatic coverage while preserving the review path. The report publishes the denominator and the limitation instead of converting it into an unsupported success claim.

Small real Groq extraction probes now provide measured latency and token usage; multi-item development probes also exposed provider-rejected structures. These limited results do not establish broad field accuracy, AI matching or live prompt-injection resistance. The live evaluator preserves rejected outputs privately, counts failed documents, records exact configuration/source hashes and keeps held-out data separate. See the [measured report](evaluation-report.md) and the [independent gold review](../eval/gold-review.md) for current results and the exact review scope.

## A substantive failure and its fix

A test requested 20 units from a supplier selling boxes of 12. Two boxes cost 48.00, but the first implementation displayed surplus as `3.999999999999999999999999999999999999996`.

The code used a precise decimal library, yet it divided demand by package size first. `20 / 12` is a repeating decimal. Subtracting that finite-precision fraction from two boxes and multiplying back introduced residue into an otherwise exact answer.

The fix calculates delivered contents first: `2 × 12 = 24`, then subtracts original demand: `24 − 20 = 4`. The regression test also asserts the monetary result, explicit buyer acceptance, and rejection of fractional or insufficient pack orders. This was an observed failing test followed by a passing correction, not a hypothetical failure or a model benchmark claim. [Failure notes](failure-notes.md) record the details.

Independent review found another class of problem: some gold fields had correct normalized values but unsuitable raw evidence, including an ISO date used as raw text where the source spelled out the month. The corrected fixtures retain the normalized date and the actual source wording separately. This illustrates why checking that a source ID exists is only one part of evidence reliability.

## An observed hosted integration failure

The first real GitHub sign-in created a valid Neon session and matched the numeric invitation, yet the browser remained a guest. Neon returned its one-time verifier to the homepage. The original proxy only matched API/auth paths, so the handoff never became an application session. The fix handles the verifier on the homepage while keeping ordinary demo visits public; tests exercise the installed SDK and actual Next matcher. Actual hosted retesting passed sign-in, the complete two-quotation manual workflow, sign-out and restored access after a fresh sign-in. [Hosted evidence](hosted-acceptance.md) records the exact boundaries.

A separate review found that deleting a comparison could wait behind a long global file-cleanup queue after its database deletion had already committed. Foreground cleanup now has a three-second abort deadline and leaves failed object removals in the durable outbox, preserving successful deletion acknowledgment.

## Remaining work

The next release should collect permissioned, less regular quotations; independently verify a larger hold-out set; run real extraction and same-input AI-versus-baseline matching; and investigate the most consequential measured failures. More varied scan degradation, multilingual interpretation, graduated tiers and bundle equivalence need explicit support boundaries and additional evidence before expanding claims.

The current value of the project is a connected, inspectable workflow and an honest measurement boundary: buyers can see the quotation, the interpretation, the calculation, and the unresolved question behind each decision.
