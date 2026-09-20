# FieldOps measured evaluation

Measured 2026-09-20T11:36:30.702Z. Mode: **baseline**. Run `baseline-all-768b9c5aa64f-8dc06a6ab2cb`.

The [20 September AI reliability review](ai-reliability-2026-09-20.md) is separate: eight returned development responses, no accepted complete quotation, and zero held-out model calls. Hosted AI remains disabled. The historical September baseline is preserved in [archived JSON](../eval/results/baseline-2026-09-13.json).

## Dataset and protocol

24 self-authored originals, 8 unrelated comparison scenarios, 144 logical items and 1106 selected field assertions. Development and held-out splits each have 12 documents. Formats: 8 text_pdf, 4 scan_pdf, 4 xlsx, 4 text, 2 csv, 2 png. Eight robustness cases are separate. Untuned held-out content; offline measurement only.

Dataset SHA-256: `8dc06a6ab2cb3988ac0b23b16898c27d899200d3fcf029bd8428cdd94bf6d0c6`. Configuration SHA-256: `768b9c5aa64ff7029ea4e2e0b1eb3ab514423020d7db33fbe5b81c91f7cd679e`. The report stores per-document timing and errors in [JSON](../eval/results/latest.json).

Runtime: Node v24.19.0, win32/x64. OCR language asset: eng.traineddata.gz; SHA-256 ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468. The configuration fingerprint includes package.json, package-lock.json and this runtime/asset identity.

## Actually measured

| Measurement | Result |
|---|---|
| Baseline equivalent-pair precision, gold rows | 100.0% (102/102) |
| Baseline equivalent-pair recall, gold rows | 87.9% (102/116) |
| False equivalences on annotated hard negatives | 0/28 |
| Candidate cross-supplier item pairs | 864 |
| Parser complete documents | 24/24 |
| Authored item identifiers present in parsed text | 100.0% (144/144) |
| Parsed source locations present | 100.0% (963/963) |
| Reported boxes within page bounds | 100.0% (544/544) |
| Parser median / minimum / maximum | 12 / 0 / 4041 ms |
| Robustness assertions | 8/8 |
| Provider cost for this offline run | USD 0; no provider calls |

All parser manifests completed and all authored item identifiers were present; this is not evidence of perfect extraction.

## AI status

**UNVERIFIED.** No model extraction or semantic matching was run in this offline evaluation. These AI metrics are not measured here. Separate live development probes and their limitations are reported in [live development verification](live-ai-development.md); they do not establish full-dataset AI accuracy.

Arithmetic and correction invariants run separately with `npm test -- tests/domain.test.ts`; do not interpret their assertion count as AI accuracy. The actual fixed package-surplus defect is documented in [failure notes](failure-notes.md).

## Reproduce

`npm run fixtures` regenerates the authored sources and gold; `npm run eval -- --mode baseline` runs local parsers and the identifier/text baseline. Complete OCR setup first with `npx tsx scripts/process.ts --prepare-ocr`.

After the user explicitly sets FIELDOPS_PROCESSING_MODE=ai and configures and confirms the free API key, `npm run eval -- --live --split dev` runs real extraction with persistent request checkpoints. Freeze prompts and configuration before `npm run eval -- --live --split heldout`. The first live held-out run freezes code, dataset and source hashes. A changed configuration requires a fresh held-out set or explicit `--allow-posthoc`, which labels results as regression measurements. No paid fallback is implemented.

## Independent review and limitations

# Independent original-document review

Reviewed on 13 September 2026 by the document-processing implementation agent, independently of the agent that authored the benchmark specifications and gold records. This is **agent review, not human verification**. It checks a stated subset; it does not certify all 24 quotations or measure live AI accuracy.

## Procedure and scope

The reviewer read original content before looking up the corresponding gold values. PDFs were rendered with Poppler at 110 DPI and every rendered page was visually inspected. XLSX cells and merged ranges were read with Python/openpyxl, independently of the application's ExcelJS parser. CSV and text originals were read directly. No OCR output, fixture generator values, or extraction result was used as the source of the manual transcription. No model calls were made, and held-out content was not used to modify extraction or matching prompts.

| Primary original | Original inspection | Logical item rows | Critical checks |
| --- | --- | ---: | ---: |
| `originals/dev/industrial-1.pdf` | Both text PDF pages, rendered visually | 6 | 40 |
| `originals/dev/office-2.csv` | Complete raw CSV, including quoted multiline records | 6 | 40 |
| `originals/dev/event-2.xlsx` | All nonempty cells and merged ranges in Quotation and Continuation | 6 | 40 |
| `originals/heldout/laboratory-2.pdf` | Both scanned pages, rendered visually | 6 | 40 |
| `originals/heldout/facilities-1.pdf` | Both scanned pages, rendered visually | 6 | 40 |

The 40 checks per quotation comprise supplier name, quotation number, original currency, date, item count; identifier, quantity, unit, unit price and stated amount for each of six items; stated subtotal, stated total, shipping amount/state, tax amount, and stated lead time. Numeric equality used decimal arithmetic, allowing only formatting differences such as `24` versus `24.00`. This is a separate review count, not the benchmark field-accuracy denominator.

**Result: 200/200 critical checks agree with the gold records after the metadata corrections below.** The following transcriptions retain the original quote currency. Laboratory monetary commas are normalized to decimal points here only for readability.

| Original | Supplier / reference | Currency | Stated subtotal | Shipping | Tax | Stated total | Lead time from confirmed order |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| industrial-1 | Alder Industrial supplies / INDUSTRIAL-1-26 | SGD | 539.50 | 25.00 | 50.81 | 615.31 | 3 business days |
| office-2 | Beacon Office IT / OFFICE-2-26 | SGD | 1899.00 | Not stated; delivery excluded | 170.91 | 2069.91 | 5 business days |
| event-2 | Beacon Event production / EVENT-2-26 | SGD | 1146.80 | Not stated; delivery excluded | 103.21 | 1250.01 | 5 business days |
| laboratory-2 | Beacon Laboratory consumables / LABORATORY-2-26 | EUR | 348.46 | Not stated; delivery excluded | 31.36 | 379.82 | 5 business days |
| facilities-1 | Alder Facilities maintenance / FACILITIES-1-26 | SGD | 1351.00 | 25.00 | 123.84 | 1499.84 | 3 business days |

All five originals state **10 September 2026**, payment **30 days from invoice**, and validity **30 September 2026**. These written dates support ISO normalization, but the raw excerpt must remain the supplier's written form.

| Item identifier | Quantity | Unit | Unit price | Stated line amount |
| --- | ---: | --- | ---: | ---: |
| INDUSTRIAL-1 | 200 | each | 0.18 | 36.00 |
| INDUSTRIAL-2 | 3 | pack | 24.00 | 72.00 |
| INDUSTRIAL-3 | 5 | l | 12.50 | 62.50 |
| INDUSTRIAL-4 | 2 | each | 34.50 | 69.00 |
| INDUSTRIAL-5 | 2 | hour | 80.00 | 160.00 |
| INDUSTRIAL-6 | 1 | project | 140.00 | 140.00 |
| OFFICE-1 | 4 | each | 206.80 | 827.20 |
| OFFICE-2 | 10 | each | 11.28 | 112.80 |
| OFFICE-3 | 4 | each | 42.30 | 169.20 |
| OFFICE-4 | 100 | m | 1.13 | 113.00 |
| OFFICE-5 | 4 | device | 84.60 | 338.40 |
| OFFICE-6 | 6 | hour | 56.40 | 338.40 |
| EVENT-1 | 1 | system | 282.00 | 282.00 |
| EVENT-2 | 1 | project | 169.20 | 169.20 |
| EVENT-3 | 6 | hour | 47.00 | 282.00 |
| EVENT-4 | 40 | each | 0.47 | 18.80 |
| EVENT-5 | 1 | kit | 131.60 | 131.60 |
| EVENT-6 | 1 | project | 263.20 | 263.20 |
| LABORATORY-1 | 60 | each | 0.71 | 42.60 |
| LABORATORY-2 | 100 | each | 0.08 | 8.00 |
| LABORATORY-3 | 3 | each | 16.92 | 50.76 |
| LABORATORY-4 | 120 | each | 0.14 | 16.80 |
| LABORATORY-5 | 1 | shelf | 89.30 | 89.30 |
| LABORATORY-6 | 1 | project | 141.00 | 141.00 |
| FACILITIES-1 | 1 | site | 680.00 | 680.00 |
| FACILITIES-2 | 3 | pack | 48.00 | 144.00 |
| FACILITIES-3 | 2 | hour | 85.00 | 170.00 |
| FACILITIES-4 | 60 | each | 0.45 | 27.00 |
| FACILITIES-5 | 1 | project | 140.00 | 140.00 |
| FACILITIES-6 | 1 | project | 190.00 | 190.00 |

## Material interpretation checks

- **Industrial packaging:** the gloves explicitly contain 10 pairs per pack, with whole packs only. Three packs therefore contain 30 pairs. The lubricant MOQ is five litres. Inspection is hourly and excludes repairs; calibration is a fixed project for two instruments and certificates.
- **Office CSV:** physical newlines inside quoted records are not additional items. Cable prices have an all-units tier of 11.28 for quantities 1–199 and 10.15 at 200 or more; the keyboard MOQ is four. Workstation setup is a fixed project, while remote support is hourly and excludes hardware. Unknown delivery must not become zero.
- **Event spreadsheet:** data rows 3, 5 and 7 on each sheet are six items. Merged rows 4, 6 and 8 contain specifications or scope, not another six items. The audio operator is hourly with a six-hour minimum; the recording deliverable excludes editing.
- **Laboratory scan:** decimal comma is explicitly stated, including amounts such as `42,60`. Tips are filtered sterile 200-microlitre tips with an all-units price of 0.08 for 1–199 and 0.07 from 200. Bench-roll MOQ is three. Cold storage is monthly at one shelf, minus 20°C, with monitoring included. Inventory audit is a fixed project with CSV inventory and no sample handling.
- **Facilities scan:** cleaning is monthly for 120 square metres twice weekly, including consumables. The HVAC filters contain two each per pack and require whole packs; specification is MERV 13, 20 × 20 inches. Maintenance is hourly, minimum two hours, with parts excluded. Safety inspection excludes certification.

## Targeted matching review

Three companion originals were inspected for these five selected pair judgments: both rendered pages of `originals/dev/industrial-2.pdf`, cells and merged continuation descriptions in `originals/dev/industrial-3.xlsx`, and the complete raw `originals/heldout/facilities-2.txt`. These companions are **not** included in the 200 core-field checks. In total, eight PDF pages were visually inspected across four PDF originals.

| Selected pair | Original-based judgment | Gold agreement |
| --- | --- | --- |
| industrial-1 / industrial-2, INDUSTRIAL-2 gloves | Same size-L, powder-free specification; explicit 10 pairs per pack allows pack/pair normalization. Three packs correspond to 30 pairs. | Both use `industrial:2` |
| industrial-1 / industrial-2, INDUSTRIAL-5 inspection | Both hourly, visual inspection and written checklist, repairs excluded. | Both use `industrial:5` |
| facilities-1 / facilities-2, FACILITIES-2 filters | Same stated specification; two each per pack permits comparison of contents. SGD versus EUR still prevents a common-currency price winner without user-supplied FX. | Both use `facilities:2`; currency remains separate |
| industrial-1 / industrial-3, INDUSTRIAL-4 filter | Cedar explicitly adds “alternate lower specification” but gives no exact changed specification. This is a possible alternative requiring clarification; equivalence is unsupported. | Cedar key is null, specification ambiguity recorded |
| industrial-1 / industrial-3, INDUSTRIAL-6 calibration | Cedar additionally excludes a final report or revision deliverable. Scope conflict must remain visible. | Cedar key is null, scope ambiguity recorded |

The companion industrial-2 scan also contains a deliberate discrepancy: 200 bolts at 0.17 independently calculate to **34.00**, while its line states **36.00**. Gold correctly preserves 36.00 and records the amount ambiguity. This check must not silently alter the supplier's stated amount.

## Findings corrected during review

Critical numeric and item-count values had no discrepancies. Provenance metadata did need correction:

1. Gold locale fields previously asserted geographic locales (`en-SG` / `de-DE`) without literal source support. They now record explicit decimal and date-format context with header references. Decimal comma alone does not establish a country.
2. Gold validity `raw` previously repeated normalized ISO dates. It now retains `30 September 2026` from the original while the normalized value remains `2026-09-30`.
3. Package order increments now cite `whole packs only`, rather than a coincidental numeric `1` in the same excerpt.
4. The fixture author also aligned tax-rate references with the totals text containing 9%, and charge-currency references with the header. These provenance repairs were generated without altering original document content.

The separate demo audit checks all **60 source spans across nine sample quotations** for exact `originalText.slice(start, end)` equality, unique IDs and document ownership. It also checks that every supplier-stated value's raw excerpt exists in its cited source. That test exposed 19 absent raw excerpts: nine format-context fields, nine validity dates, and one package increment. The demo metadata was corrected; `tests/source-invariants.test.ts` now passes both invariants. These tests establish source consistency, not model extraction accuracy or complete semantic correctness of every demo value.

## Remaining limitations

The other 19 primary benchmark originals did not receive this complete 40-check review. Three of them received only the targeted companion checks described above. No independent human reviewed the gold set. This review does not establish real-model extraction accuracy, matching precision/recall, cost, or latency. The synthetic layouts and finite comparison cases remain narrower than real supplier documents. The vague alternate-specification fixture is deliberately insufficient evidence for equivalence; it does not support inferring a specific lower MERV rating.


- Small synthetic English-only dataset; authored layout and content diversity do not establish general supplier-format coverage.
- Baseline matching uses gold-normalized rows and explicit identifiers. It does not include extraction error and favors the identifier baseline.
- Parser identifier coverage measures presence of authored item IDs, not detected rows or semantic field extraction accuracy.
- Source-location presence and geometric bounds do not prove that every reference supports a semantic assertion.
- Raw live field scoring uses exact identifiers for row alignment, canonical strings for text, and separately reports intentionally annotated missing states.
- Robustness hash checks do not by themselves test the browser upload flow, durable retries, cross-user access or live prompt-injection resistance.
- The unreadable fixture is an artificial blank raster. Production degraded scans require a broader permissioned dataset.
- No human gold verification or production latency distribution is implied. Inspect the separate review record and per-file measurements.
