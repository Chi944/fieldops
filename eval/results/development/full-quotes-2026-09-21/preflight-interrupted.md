# Interrupted harness preflight

This run is **excluded from the paired comparison**. It was stopped while waiting to begin the next document after a pacing defect was identified. Its private directory, lock, journal and response checkpoints remain unchanged.

There were two returned responses for `industrial-1`, with **5,152 input and 2,393 output tokens** reported; neither response had unavailable token usage. Returned-response time totaled **8,168 ms**. One intermediate request checkpoint was validated, then the next response was rejected. No complete document output or complete three-document cohort was produced. Full-cohort field accuracy is unavailable.

Three dispatch reservations consumed six possible attempt slots and 41,430 estimated tokens. One immediate quota failure occurred because the runner waited from its reservation timestamp while SDK initialization and actual dispatch happened later. The corrected runner waits from response/failure settlement. A regression test covers that startup delay. This was a harness fix; extraction code was unchanged before the separate v2 baseline.

The journal records 171,208 ms of requested waits, including the wait interrupted by the operator. That is not an actual elapsed-wait measurement. Reservation counts are not actual HTTP-attempt counts, and no provider invoice was measured. Held-out model calls: zero.

See the [sanitized metadata](preflight-interrupted.json) and the independent [v2 before report](../full-quotes-2026-09-21-v2/live-before.json). Neither this preflight nor its single successful chunk replaces the paired cohort denominator.
