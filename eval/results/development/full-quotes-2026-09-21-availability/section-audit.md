# Retained-section audit

Finalized report SHA-256: `6d4913962f41f4fb8f40228f95e42726fb71f916ab9cbf89138e13932934eae7`. Audit code SHA-256: `20aef09292ad0aa32aab9e19691986aa3f298a6efdecb5fe65c05f27aabd8d25`. No provider calls or held-out reads.

| Document | Status | Planned | Attempted | Validated | Rejected | Failed targets / all targets |
|---|---|---:|---:|---:|---:|---:|
| industrial-1 | partial | 4 | 4 | 2 | 2 | 21/40 |
| translation-2 | partial | 4 | 4 | 2 | 2 | 13/32 |
| office-2 | rejected | 3 | unavailable | unavailable | unavailable | unavailable |

- Counts describe section validation and partial availability, not proof of semantic extraction correctness.
- Readonly context references are excluded from failed-target denominators. Field-reference resolvability does not prove that the source supports a claim.
- Validated/rejected section counts come from returned quotation metadata and exact static issue-to-chunk checks; fresh journal dispatch/response counts are reported separately and include failures.
- No raw quotations, supplier values or rejected replies are published by this audit.
- No returned output means exact section attribution is unavailable; the audit does not infer it from response counts.

The [sanitized JSON audit](section-audit.json) contains source-array hashes, exact target-set checks, field-reference counts and the deterministic coverage-gate probe.
