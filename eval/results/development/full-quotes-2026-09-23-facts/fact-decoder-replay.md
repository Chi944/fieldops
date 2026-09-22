# Offline fact-decoder replay

Finalized source report SHA-256: `5d3f3032525bf5f7496eab371c9d84c9cf35b3ecb9686403644e196ef239e2fd`. Replay code SHA-256: `3b205ee84c79bd1e9dedc351f64b1d82ce5250316de369de4ec0605218aece5c`. Provider calls: 0.

| Document | Original live result | Offline replay | Validated / planned sections |
|---|---|---|---:|
| industrial-1 | rejected | partial | 2/4 |
| translation-2 | partial | partial | 3/4 |
| office-2 | rejected | unavailable_or_rejected | 0/3 |

- Post-hoc decoding of the same development responses, not a new model generation, independent evaluation or held-out result.
- Only the fact-decoder source may differ. Exact original request hashes still bind model, prompt, schema and source records. No rejected value, syntax, citation or quotation is repaired by this tool.
- Accepted expanded checkpoints and eligible stop-finished local rejections pass current domain validation. Provider-schema rejection and truncation with recorded invalid_output/evidence retain their original failed-section behavior without decoding. Missing/unattributable responses and operational failures stop that document. None are revived or replaced.
- All three documents and expected annotations remain in metric denominators. Unavailable replay documents earn no extraction credit; partial output is scored as partial availability.
- Private quotation usage/timestamps describe replayed response metadata and local reconstruction. There is no fresh provider latency, token usage or cost measurement; historical usage remains separately labelled.
- Source-reference resolution and location agreement do not prove semantic entailment. Strict readiness v4 intentionally leaves unverified charge absence unresolved.
- No original checkpoint, journal, report or quotation is overwritten. Replayed quotations remain private; public output contains only fixed identifiers, hashes, aggregate metrics and static audit diagnostics.

[Immutable sanitized replay report](fact-decoder-replay.json).
