# Offline rejection audit

Report SHA-256: `5d3f3032525bf5f7496eab371c9d84c9cf35b3ecb9686403644e196ef239e2fd`. Audit code SHA-256: `e9428b6963b187df3ca9e5771aa447ed906879200e28d66cf10cbdbacca27c91`. No model calls, accepted outputs, checkpoint writes or held-out reads.

9 saved rejection records matched 11 reconstructed requests.

| Outcome | Records |
|---|---:|
| wire_schema_invalid | 4 |
| wire_schema_valid_cause_unavailable | 5 |

- Saved raw bodies are checked against the reconstructed recorded wire schema; this does not accept, repair or replay an extraction.
- A locally wire-valid response can still fail state, normalization, source-evidence or business validation; its specific cause is unavailable here.
- Domain-stage records are already expanded and are not misvalidated as raw wire responses. Their recorded error category is retained; detailed cause is unavailable.
- Provider schema rejection means the provider rejected generated output; request-schema rejection documents are counted separately from the finalized report.
- Issue messages, received values, source aliases, citations and arbitrary unknown-key names are never published. Known structural names and bounded indices are allowed.
- Diagnostics are limited to 100 issues per record, four nested union levels, 24 path components and 30 unknown-key names per issue; they are not exhaustive.
- Records include cached rejections if present and need not equal fresh provider attempts. This audit does not remeasure usage or extraction accuracy.

[Sanitized diagnostic JSON](rejection-audit.json).
