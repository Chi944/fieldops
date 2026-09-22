# Retained-section audit

Finalized report SHA-256: `652b677a9d01f541f7f55810e1bf40149bb4cd196d90080a27aa898b5dbb4d2a`. Audit code SHA-256: `f15848ad585ae3bbd935d01dfe118be52859f122a2ec37f68df86591e60571bd`. No provider calls or held-out reads.

| Document | Status | Planned | Attempted | Validated | Rejected | Failed targets / all targets |
|---|---|---:|---:|---:|---:|---:|
| industrial-1 | rejected | 4 | unavailable | unavailable | unavailable | unavailable |
| translation-2 | partial | 4 | 4 | 2 | 2 | 22/32 |
| office-2 | partial | 3 | 3 | 1 | 2 | 16/27 |

- Counts describe section validation and partial availability, not proof of semantic extraction correctness.
- Readonly context references are excluded from failed-target denominators. Field-reference resolvability does not prove that the source supports a claim.
- Validated/rejected section counts come from returned quotation metadata and exact static issue-to-chunk checks; fresh journal dispatch/response counts are reported separately and include failures.
- No raw quotations, supplier values or rejected replies are published by this audit.
- No returned output means exact section attribution is unavailable; the audit does not infer it from response counts.

The [sanitized JSON audit](section-audit.json) contains source-array hashes, exact target-set checks, field-reference counts and the deterministic coverage-gate probe.
