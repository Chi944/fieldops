# Offline focused field contract audit

Source study: groq-focused-v2-2026-09-23. Candidate: groq-focused-contract-v2-2026-09-23. No model calls, accepted outputs, checkpoint writes or held-out reads.

6 historical rejections remain rejected; 15 expanded accepted checkpoints have no saved original wire for candidate validation.

The unchanged plan covers 3 complete originals, 18 expected items and 99 source records. Estimated single-attempt reservations: v1 58648, candidate 63339; neither is measured inference consumption.

- This is a contract audit, not accuracy replay or fresh generation. Every historical rejection remains rejected, including parseable provider-rejected replies.
- Accepted checkpoints contain expanded data, so their original wire compliance with the candidate cannot be measured. No expanded object is reverse-engineered into a model reply.
- Unchanged known optional field fragments are checked against actual candidate schema nodes. A schema shape change does not prove the provider will generate a valid response or fill missing billing facts.
- Fixed named properties remove repeated entries in the old fields array; they do not prove a provider cannot emit duplicate JSON property names. Required state objects still permit truthful not_stated/ambiguous values.
- Billing diagnostics use original finalized outputs and fixed annotations, not model kind; the quota-aborted office checkpoint is not promoted to a quotation. No source or missing value is invented.
- Planning estimates are local heuristics, not token usage, billing or available provider quota. Original usage remains historical, with unknowns and full allocations retained.
- Sanitized schema diagnostics are bounded to100 issues per record. Raw values, messages, quotations and source identifiers are not published. No production settings or original artifacts are changed.

[Sanitized audit](focused-contract-audit.json).
