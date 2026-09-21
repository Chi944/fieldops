# Offline rejection audit

Report SHA-256: `652b677a9d01f541f7f55810e1bf40149bb4cd196d90080a27aa898b5dbb4d2a`. Audit code SHA-256: `7cc68a5d2b26c1b99378661b70818b1ecb0c5521fe23a6e3df48f642d5d1deb7`. No model calls, accepted outputs, checkpoint writes or held-out reads.

8 saved rejection records matched 11 reconstructed requests.

| Outcome | Records |
|---|---:|
| wire_schema_invalid | 8 |

- Saved raw bodies are checked against the reconstructed partitioned wire schema; this does not accept, repair or replay an extraction.
- A locally wire-valid response can still fail state, normalization, source-evidence or business validation; its specific cause is unavailable here.
- Domain-stage records are already expanded and are not misvalidated as raw wire responses. Their recorded error category is retained; detailed cause is unavailable.
- Provider schema rejection means the provider rejected generated output; request-schema rejection documents are counted separately from the finalized report.
- Issue messages, received values, source aliases, citations and arbitrary unknown-key names are never published. Known structural names and bounded indices are allowed.
- Diagnostics are limited to 100 issues per record, four nested union levels, 24 path components and 30 unknown-key names per issue; they are not exhaustive.
- Records include cached rejections if present and need not equal fresh provider attempts. This audit does not remeasure usage or extraction accuracy.

[Sanitized diagnostic JSON](rejection-audit.json).
