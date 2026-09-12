# A real failure fixed during implementation

The first package-pricing test requested 20 individual units from a supplier selling boxes of 12. The application correctly proposed two boxes and a cost of 48.00, but displayed surplus as `3.999999999999999999999999999999999999996` instead of `4`.

The implementation divided demand by package size to obtain a repeating decimal (`20 / 12`), subtracted that rounded fraction from the accepted two boxes, and multiplied back by 12. Using a precise decimal library does not make repeating fractions exact after finite-precision division.

The fix calculates delivered contents first (`2 × 12 = 24`), then subtracts the original demand (`24 − 20 = 4`). This preserves the buyer's required quantity and avoids using an intermediate package fraction to calculate surplus. The original failing test now passes and also verifies explicit acceptance, monetary amount, and rejection of an insufficient or fractional pack order.

Evidence: `tests/domain.test.ts`, the test named “requires acceptance for whole packs and reports the surplus”. The initial test run had 20 passes and this one failure; after the fix, all 21 domain tests passed. These are arithmetic assertions, not AI reliability results. No live model inference was involved.
