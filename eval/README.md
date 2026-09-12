# FieldOps authored evaluation dataset

The 24 fictional quotations contain 144 logical line items across eight scenarios. Each split has 12 originals: four text PDFs, two scanned PDFs, one PNG, two XLSX workbooks, one CSV, and two text inputs. XLSX files include merged headings and continuation sheets; CSV includes quoted multiline cells; PDFs repeat quotation headers across pages. Scanned documents are clean, computer-generated printed English and do not represent all real scan quality.

The development scenarios are industrial supplies, office IT, event production, and translation. The held-out scenarios are laboratory consumables, commercial kitchen equipment, equipment installation, and facilities maintenance. Splits share no quotation content. Generic field terminology and the renderer implementation are shared; this limitation must accompany results.

`specifications.ts` contains source values, intended equivalence labels, explicit conflicts and selected field assertions. `gold.json` records source file hashes, original normalized supplier interpretations, source locations and labels. Original supplier discrepancies are intentional and are preserved in both document and gold. Missing terms and ambiguous dates are scored separately from stated values.

The baseline is exact normalized identifiers or token similarity with deterministic compatibility vetoes. It runs on gold-normalized rows, so its result isolates matching and does not measure extraction. It cannot establish equivalence automatically in the product. Eight robustness cases are excluded from ordinary extraction denominators; their scope and artificial degradation are recorded individually.

Run `npm run fixtures` to recreate originals and gold, then independently check the rendered documents before changing a review record. Run `npm run eval -- --mode baseline` for real parser measurements and offline matching. The source hashes are checked before evaluation. No offline path calls a model or presents fixtures as extracted output.

The user has asked to leave live integration disabled until they configure a Groq Free Plan key. Only after configuration and authorization, `npm run eval -- --live --split dev` runs actual extraction; `--live --split heldout` freezes model/prompt/parser/rules and dataset hashes. Requests and document results resume only under the same hashes. Changed held-out configuration needs a fresh dataset or explicit `--allow-posthoc`, reported as regression rather than untouched held-out performance. Live response cache files are gitignored under `eval/runs/private`.

Offline results do not establish field extraction accuracy, live matching quality, semantic source correctness, model prompt-injection resistance, or production costs. The independent gold-review record identifies exactly what was checked and by whom.

All quotation contents and document layouts were authored for this project and are released as CC0 evaluation fixtures. Supplier names, addresses, products and prices are fictional. No user uploads or third-party quotations are included.
