# A real failure fixed during implementation

The first package-pricing test requested 20 individual units from a supplier selling boxes of 12. The application correctly proposed two boxes and a cost of 48.00, but displayed surplus as `3.999999999999999999999999999999999999996` instead of `4`.

The implementation divided demand by package size to obtain a repeating decimal (`20 / 12`), subtracted that rounded fraction from the accepted two boxes, and multiplied back by 12. Using a precise decimal library does not make repeating fractions exact after finite-precision division.

The fix calculates delivered contents first (`2 × 12 = 24`), then subtracts the original demand (`24 − 20 = 4`). This preserves the buyer's required quantity and avoids using an intermediate package fraction to calculate surplus. The original failing test now passes and also verifies explicit acceptance, monetary amount, and rejection of an insufficient or fractional pack order.

Evidence: `tests/domain.test.ts`, the test named “requires acceptance for whole packs and reports the surplus”. The initial test run had 20 passes and this one failure; after the fix, all 21 domain tests passed. These are arithmetic assertions, not AI reliability results. No live model inference was involved.

## Numeric evidence could erase a decimal separator

An independent injected-response regression during live-AI hardening found a second arithmetic-adjacent failure: the evidence checker accepted an extracted tier threshold of `1000` against a source containing only `10.00`. It removed punctuation as a possible thousands separator without checking the grouping pattern. This was a deterministic validation bug demonstrated with synthetic responses, not an observed correct model extraction.

The checker now removes separators only in valid three-digit grouping patterns, retains decimal precision, and checks every tier minimum/maximum/price and discount value against its cited text. Unsupported commercial basis or discount-inclusion wording remains an unresolved evidence issue that blocks recommendations. The values remain available for buyer review. `tests/ai-commercial-evidence.test.ts` covers the original failure, US/EU/space-grouped values, zero, invented prices/discounts, and comparison blocking. Numeric occurrence is necessary evidence; it does not by itself prove the model mapped a number to the right field.

## Complete-document AI extraction remains an open failure

After successful one-item application smokes, a selected two-page development quotation still failed. The first two extraction chunks validated and were retained; the third returned provider `json_validate_failed` with malformed JSON. One retry reused the successful chunks and rejected the last chunk again. No complete quotation was accepted, so its end-to-end selected-field score is 0/46 and item recall 0/6. The two rejected responses omitted token usage; their cost must not be inferred from zero placeholder counts.

This failure is **not fixed**. Source parsing and manual review remain the recovery path, and hosted AI stays disabled. The [live development report](live-ai-development.md) preserves the result, the small successful smokes, and the distinction between checkpointed chunks and complete quotations. It is a release limitation, not a success story.
