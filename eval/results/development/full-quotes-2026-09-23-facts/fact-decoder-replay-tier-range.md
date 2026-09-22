# Offline fact-decoder replay

Variant: `tier-range`. Revalidate the same original saved responses after the root-alias correction and the same-item complete tier-range evidence guard.

Finalized source report SHA-256: `5d3f3032525bf5f7496eab371c9d84c9cf35b3ecb9686403644e196ef239e2fd`. Replay code SHA-256: `ef22202d288a6cd6b451c8217ba2c6351cba82df9b2e908d63a22854c28e7369`. Provider calls: 0.

| Document | Original live result | Offline replay | Validated / planned sections |
|---|---|---|---:|
| industrial-1 | rejected | partial | 2/4 |
| translation-2 | partial | partial | 3/4 |
| office-2 | rejected | partial | 1/3 |

- Post-hoc decoding of the same development responses, not a new model generation, independent evaluation or held-out result.
- Only fact-transport.ts and index.ts may differ for this explicit tier-range variant; the default root-alias variant still prohibits index.ts drift. Exact original request hashes still bind model, prompt, schema and source records. No rejected value, syntax, citation or quotation is repaired by this tool.
- Accepted expanded checkpoints and eligible stop-finished local rejections pass current domain validation. Provider-schema rejection and truncation with recorded invalid_output/evidence retain their original failed-section behavior without decoding. Missing/unattributable responses and operational failures stop that document. None are revived or replaced.
- All three documents and expected annotations remain in metric denominators. Unavailable replay documents earn no extraction credit; partial output is scored as partial availability.
- Private quotation usage/timestamps describe replayed response metadata and local reconstruction. There is no fresh provider latency, token usage or cost measurement; historical usage remains separately labelled.
- Source-reference resolution and location agreement do not prove semantic entailment. Strict readiness v4 intentionally leaves unverified charge absence unresolved.
- No original checkpoint, journal, report or quotation is overwritten. Replayed quotations remain private; public output contains only fixed identifiers, hashes, aggregate metrics and static audit diagnostics.

[Immutable sanitized replay report](fact-decoder-replay-tier-range.json).
