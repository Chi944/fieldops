# FieldOps demonstration script

Use the **Studio equipment & installation** demonstration comparison. Its suppliers and quotations are fictional; it does not require a model key. Reset the demo first if previous edits remain. The core walkthrough takes approximately three minutes.

| Time | Action | Suggested narration |
|---|---|---|
| 0:00 | Open the workspace, then the studio comparison. | “FieldOps helps a buyer compare supplier quotations while keeping the original evidence and uncertainty visible. This is a clearly labelled fictional demo.” |
| 0:20 | Open extraction review for Meridian Works and select the cable price/amount. | “The source says four cable kits at 26 each, but the supplier wrote 116 as the line amount. Independent arithmetic gives 104. FieldOps keeps the discrepancy visible instead of rewriting the quotation.” |
| 0:45 | Select a normal field to show its source. Optionally correct the Northstar task-light description to “LED task light, 4000 K”, using the specification as evidence. | “A correction records the previous interpretation, the author and the reason. Affected matching approvals become stale and need review again.” |
| 1:10 | Open matching; show the installation group. | “Two offers have a fixed installation scope. The third is estimated hourly labour with different exclusions. Similar wording does not make those prices equivalent.” |
| 1:30 | Return to the matrix and show acoustic panels. | “We need ten panels. Northstar sells six per pack, so two packs supply twelve. The demo reviewer explicitly accepted the two spare panels. Quantities, package contents and order constraints determine the calculation.” |
| 1:55 | Show cost and lead-time explanations, then Meridian's missing delivery cost. | “The lowest comparable item cost is a specific criterion, not an overall supplier winner. Meridian's shorter stated lead time does not establish a delivery date, and missing shipping is not zero.” |
| 2:20 | Open export and download the Excel workbook or use print/save PDF. | “The report carries the original supplier values, source references, assumptions, corrections and unresolved issues with the comparison date.” |
| 2:45 | Show the evaluation report. | “The offline benchmark contains 24 authored documents and 144 items. The simple baseline achieved 102 correct equivalent pairs from 102 proposed, and found 102 of 116 true pairs. Live AI metrics remain unverified until the provider key is configured and the evaluation actually runs.” |

After the optional correction, review and reapprove the affected light group before presenting it as an eligible cost comparison. Do not resolve the cable discrepancy simply to make the comparison look clean; the source still contains it.

For a longer technical discussion, show `tests/domain.test.ts` and the package-surplus failure in [failure notes](failure-notes.md), then explain the separation between source parsing, validated interpretation, human review and deterministic arithmetic. A useful second example is **Facilities maintenance**, where filter specifications differ and recurring service costs need an explicit horizon. **Community event production** demonstrates separate original currencies.

If demonstrating real uploads before model configuration, describe the actual parser/manual-review behavior visible in the application. Never call saved sample extraction a live model result. Cloud authentication, deployment and model integration should be demonstrated only after those services have actually been configured and verified.
