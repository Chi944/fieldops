# Focused task audit: after

Report SHA-256: `afa83b268a55333beb246c23ba6b4601fb2ee1a997c00f99c509abe7e56ea951`. Audit code SHA-256: `224c4ad50fe4b50189f8309aa627bd67de121d799448f78eabc3acec9919240f`. Zero provider calls and held-out reads.

| Document | Result | Planned tasks | Validated | Rejected | Failed targets / all targets |
|---|---|---:|---:|---:|---:|
| industrial-1 | partial | 4 | 3 | 1 | 7/40 |
| translation-2 | partial | 4 | 3 | 1 | 7/32 |
| office-2 | rejected | 4 | unavailable | unavailable | unavailable |

- Task validation and partial availability are not semantic extraction correctness. Resolvable field references do not prove that cited text supports a claim.
- Failed-target counts use the focused planner, excluding repeated read-only context. No legacy character-chunk assumptions are used.
- Returned task counts are checked against metadata and exact static failed-task issue sets. Fresh journal counts are separate and may include cached reuse or operational failures.
- No output means exact task attribution is unavailable. This audit does not decode, repair, replay or accept rejected replies.
- The cost probe uses approved singleton groups solely to test unresolved coverage/evidence blocking; it is not a comparative recommendation or matching-quality benchmark.
- Only sanitized counts and hashes are published. Source arrays, supplier values, source identifiers and model replies remain private.

[Sanitized audit JSON](focused-task-audit-after.json). Original phase reports and private checkpoints were read only.
