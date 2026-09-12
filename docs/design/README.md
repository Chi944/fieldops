# FieldOps design refinement — September 2026

This pass implements the user's request for a generated screen reference and a more precise UI. It retains the working React application and the personal/sample storage boundary.

## Reference and provenance

- Generated once with the built-in `image_gen` tool using the `imagegen` skill. No CLI/API fallback or paid external media service was used.
- Reference: [fieldops-workspace-reference-v1.png](fieldops-workspace-reference-v1.png).
- This image is a design concept. Its names, issue counts and dates are illustrative, not benchmark results or extracted supplier facts. The application renders its own actual comparison records.
- Original output: `C:/Users/User/.codex/generated_images/01a09694-d401-76c2-ab5d-6211d18f1aa9/exec-2e5729ec-7606-4229-b57d-2cd336e7f517.png`. The project copy is retained here.
- The initial local search did not find installed Impeccable or Designwithintent skills: searched skill filenames and SKILL/plugin manifests under `C:/Users/User/.codex/skills`, `C:/Users/User/.agents/skills` and `C:/Users/User/.codex/plugins/cache`, plus available tool names/descriptions. The initial visual pass used installed `example-skills:frontend-design` guidance. A subsequent search located both official public projects; their published instructions were read and applied in the manual review documented below. No installation or purchase was needed to read that guidance.

## Design plan and implementation

Palette: paper `#f6f7f3`, ink `#172e2a`, evergreen navigation `#143e39`, teal actions `#17665d`, neutral rules `#dce4de`, restrained amber review `#916421`. DM Sans carries headings, controls and document values; IBM Plex Mono remains for monetary amounts.

The focal point is the buyer's next review action. A live queue replaces decorative document photography in the latest-comparison panel. Every queue entry comes from an unresolved issue or pending match and links to the relevant quotation or matching screen. Empty personal workspaces show the actual three-step workflow. No new confidence values, rankings, model claims or synthetic private records were added.

```text
Evergreen navigation | Workspace title / Create
                     | Latest comparison | Actual review queue
                     | Storage boundary
                     | Workspace totals
                     | Search and review filter
                     | Comparison / Suppliers / Next step / Updated
```

Plan critique: the generated reference includes illustrative summary numbers and generic status labels. These were replaced by actual application state. Existing privacy disclosures remain visible despite their absence from the reference's upper sections. The decorative photograph was removed from the working workspace hero; the generated screen is documentation, not a flattened application background.

Implementation:
- Quieter frame, readable sidebar comparison names, consistent control weights.
- Shared data row alignment and an unobtrusive latest-comparison indicator.
- Distinct field labels/values, a contained scrolling source pane, and two-column item fields when the resizable data pane narrows.
- Matrix minimum width scales with supplier count, while the first item column remains sticky. Prices, unit bases, descriptions and evidence retain their semantic labels.
- CSS refinements are screen-only; report print styling remains separate.

## Inspection and checks

Before/after desktop captures use a fresh browser context that only opens fictional demo records on the existing local server. Private API mutations are blocked by the capture script. Mobile captures use 390 × 844; desktop captures use 1440 × 1000. All three screens reported document width equal to viewport width; the supplier matrix scrolls inside its own container.

- [Workspace before](fieldops-workspace-before.png) / [after](fieldops-workspace-after.png)
- [Review before](fieldops-review-before.png) / [after](fieldops-review-after.png)
- [Matrix before](fieldops-matrix-before.png) / [after](fieldops-matrix-after.png)
- [Workspace mobile](fieldops-workspace-mobile-after.png)
- [Review mobile](fieldops-review-mobile-after.png)
- [Matrix mobile](fieldops-matrix-mobile-after.png)

TypeScript and scoped ESLint passed after the initial implementation. Six targeted browser checks passed in 27.4 seconds against the existing local server, using fictional samples only: workspace search and evidence navigation; the new actual issue queue plus delayed loading, empty workspace and 390px matrix bounds; correction/approval invalidation and Excel/PDF export; split/regroup actions; automated workspace/source WCAG A/AA checks; and mobile keyboard/modal behavior. No private quotation was uploaded or modified, and the personal server remained running.

Reviewed uncertainty/error states include the actual amount discrepancy, unstated delivery, no attached source reference, stale/unmatched offers, and no search matches. The server-side file-failure pipeline was outside this visual pass. The generated concept guided proportions and hierarchy; no claim of a literal pixel-diff match is made because the shipped interface uses real data and responsive layouts.

## Official guidance review

This was an independent agent review of six existing after-captures (workspace, source review and comparison matrix at both sizes above), plus `workspace.tsx`, `fieldops.tsx`, `review.tsx`, `comparison.tsx` and the existing styles. It used the buyer workflow and constraints already recorded in [the product specification](../spec.md). No new browser session, private document access, model inference or source edit was part of this review. These observations describe the captured state; they are not a new usability study or a pixel-diff score.

### Sources and execution scope

- **Impeccable**: official [website](https://impeccable.style/) and [skill v4.3.1](https://github.com/pbakaus/impeccable/blob/cb56ed6c19a07329a9fa0cd4e657bee040156593/.vibe/skills/impeccable/SKILL.md). Read the [Operate reference](https://github.com/pbakaus/impeccable/blob/cb56ed6c19a07329a9fa0cd4e657bee040156593/.vibe/skills/impeccable/reference/operate.md) and [critique reference](https://github.com/pbakaus/impeccable/blob/cb56ed6c19a07329a9fa0cd4e657bee040156593/.vibe/skills/impeccable/reference/critique.md). Applied its product-interface emphasis on task clarity, restrained visual hierarchy, consistent patterns and reduced navigation memory demands. Its launcher instruction is `Run <skill-base-dir>/scripts/impeccable context once per session`. That executable was absent, so its documented direct-context fallback was used. The full critique command, detector, automated scores and trend storage were **not run**. The launcher can download a binary on first use; that complete workflow cannot be described as verified offline here. It is development tooling and need not be shipped in the application. The skill requires its craft-floor reference before UI edits; this reviewer made no UI edits.
- **Design with Intent**: official [website](https://designwithintent.ai/), [foundation v1.6.0](https://github.com/ghaida/intent/blob/b89a519eb570fe7ec61de1eb51f553af0306b515/skills/intent/SKILL.md), [evaluation skill](https://github.com/ghaida/intent/blob/b89a519eb570fe7ec61de1eb51f553af0306b515/skills/evaluate/SKILL.md) and [information architecture reference](https://github.com/ghaida/intent/blob/b89a519eb570fe7ec61de1eb51f553af0306b515/skills/intent/references/information-architecture.md) were read. Applied task walkthroughs, visible orientation, explicit label meaning, and findings that identify location, user impact and a concrete remedy. These public Markdown instructions can be applied manually without an executable or account. No slash-command invocation or numeric heuristic score is claimed. Observed screenshot facts are separated from expected user impact; interaction outcomes require browser checks, and user effectiveness requires real participant research.

The links above pin the official repositories at the revisions inspected. The requested Designwithintent source is Ghaida's Intent skill system, not the similarly named historical Design with Intent pattern-card collection.

### Findings passed to implementation

| Priority | Captured evidence and likely impact | Concrete change and verification |
| --- | --- | --- |
| Before release | At 390px, the comparison route's active **Comparison** link is outside the visible step strip. Buyers must horizontally search to establish their current step. | Scroll the active link into the strip on route changes without moving the page vertically. Assert its bounding box is inside the navigation viewport on mobile, including keyboard navigation. |
| Before release | Opening Review without a quotation query selects Northstar, which has no open issues, while Meridian holds the two flagged issues. The workspace hero already targets Meridian correctly. The generic Review tab and matrix review link have the confusing default. | With no explicit quotation selection, choose the first quotation with unresolved review work. Preserve explicit quotation links and the buyer's subsequent selection. Verify generic and explicit routes separately. |
| Small clarification | The step strip substitutes an issue count for a step ordinal in the same position. A bare **2** can mean either step two or two issues. | Keep step numbering separate and label the badge **2 issues** (with singular handling). Verify its visible text and accessible name. |
| Mobile refinement | In the 390 x 844 matrix capture, the table begins near the bottom of the viewport; no quoted price is initially visible. Heading, summary and warning blocks consume most of the first view. | Tighten mobile spacing and arrange summary controls more compactly. Preserve sample/privacy disclosure and material comparison warnings; verify the table and first comparable amount become reachable sooner without clipping content or creating document-level horizontal overflow. |
| Capture cleanup | A black Next.js development indicator overlaps the lower-left corner of the saved captures. This is a capture artifact rather than a product styling defect. | Produce final portfolio captures from a production build and inspect them after the functional fixes. |

Preserve the current strengths: useful issue-linked workspace actions, original-file access, explicit **reflowed source excerpts** labelling, monetary alignment, visible unit/package bases, and restrained colour tied to comparison meaning. In particular, reducing mobile spacing must not hide incomplete cost information or turn a reflowed excerpt into a purported facsimile of a supplier document.

The independent review did not test screen readers, contrast ratios, latency, keyboard completion or supplier-decision accuracy. Earlier automated checks remain reported in the preceding section with their original scope. The subsequent implementation and verification are recorded separately below.

### Verified production follow-up

The implementing UI agent read the official Impeccable skill and its Operate, polish and craft-floor references, plus Intent's foundation and evaluation skills, before applying the four interface fixes. It used the same documented context fallback; no Impeccable executable or detector ran.

The follow-up ran against the rebuilt local production application on port 3002. All **9 of 9 browser tests passed in 27.0 seconds**. TypeScript, scoped TypeScript ESLint and whitespace checks also passed. The correction test now selects Northstar explicitly rather than relying on the previous first-supplier default.

| Finding | Verified result |
| --- | --- |
| Mobile orientation | The active workflow link scrolls horizontally into view. A reduced-motion test also confirms this does not move the window vertically. |
| Review prioritization | Review without a quotation query opens Meridian's unresolved work. An explicit quotation query retains its requested supplier. |
| Ambiguous badge | The step remains **02**, with a separate **2 issues** badge. |
| Mobile matrix density | At 390 x 844, the first price begins at approximately y=751px and is visible in the initial viewport. In the desktop capture it begins near y=638px. Source, sample and material cost disclosures remain present. |
| Capture artifact | Six fresh production captures contain no Next.js development portal. Capture checks found no page errors and document width equalled viewport width on all six screens. |

The implementing agent visually inspected all six captures. Use these for the current portfolio presentation; the older development captures remain as historical evidence of the review findings.

| Screen | Desktop, 1440 x 1000 | Mobile, 390 x 844 |
| --- | --- | --- |
| Workspace | [Production capture](fieldops-workspace-desktop-production.png) | [Production capture](fieldops-workspace-mobile-production.png) |
| Source review | [Production capture](fieldops-review-desktop-production.png) | [Production capture](fieldops-review-mobile-production.png) |
| Comparison matrix | [Production capture](fieldops-matrix-desktop-production.png) | [Production capture](fieldops-matrix-mobile-production.png) |

These are local production-build checks with fictional sample records. They do not establish hosted authentication or processing reliability, participant task success, full screen-reader compatibility, a literal match to the generated concept, or an automated Impeccable score.

## Exact generation prompt

```text
Use case: ui-mockup.
Asset type: one high-fidelity desktop web application design reference for FieldOps, an evidence-led supplier quotation comparison workspace. This image is a visual design concept, not an extraction or accuracy claim.
Create a single complete polished desktop application screen at approximately 1536x1024, flat straight-on screen capture, no laptop mockup, no external margins or browser window frame.
Professional design direction: warm off-white paper #f6f7f3, very dark evergreen sidebar #143e39, ink #172e2a, restrained teal #17665d, subtle neutral borders #dce4de, amber only for unresolved review. Clear DM Sans-like typography with strong hierarchy; clean actual business software, readable medium-size text, immaculate alignment and purposeful whitespace. No gradients, no purple, no glass, no confetti, no fake charts, no invented AI confidence, no oversized marketing headline.
Layout: full-height left sidebar width 230px, top wordmark 'FieldOps.' in ivory with small geometric document icon; workspace selector 'Sample workspace' and small line 'Fictional quotations'; solid pale button '+ New comparison'; selected Overview navigation; three comparison navigation links 'Studio equipment & installation', 'Facilities maintenance', 'Event services'; understated bottom 'Every number, a source.' and user 'Demo reviewer'.
Main area top compact breadcrumb 'Workspace', small top-right label 'Fictional sample'. Main content starts 38px from edge. Header title 'Your quotation workspace' at 30px, supporting line 'Keep the evidence behind every decision.' and right primary '+ New comparison'.
Main hero is useful software content, about 245px high, wide split panel with restrained rounded8px corners. Left side label 'Continue your latest comparison' and large two-line heading 'Studio equipment & installation', supporting line 'Three suppliers. Equipment, installation and commercial terms.', teal button 'Continue review'. Right side is a white inset real review queue, title 'Needs your review' with thin rule, three short rows with tiny amber dot and line icon: 'Cable specification differs', 'Delivery cost not stated', 'Quoted amount needs checking'; footer 'Review source evidence'. Keep this crisp and calm, no decorative art.
Below hero: a single horizontal slim subtle summary strip, '3 Comparisons', '9 Quotations', 'Review queue' as actual navigation summary not enormous KPI cards.
Then section 'Your comparisons', right small search field 'Search comparisons'; compact All comparisons/Needs review tabs. A beautifully typeset table with headings Comparison, Suppliers, Next step, Updated. Three rows with small folder icons, the actual above comparison names and short descriptive secondary text; supplier initials grouped in subtly tinted squares; quiet amber status 'Review issues' for studio and green 'Review complete' for another; right aligned dates. Active row very subtle teal inset line.
At very bottom understated line 'Fictional examples. Sample edits stay in this browser.' and 'See reliability evidence'.
Style: exceptional professional procurement desktop UI, consistent 8px spacing grid, well-resolved typography and hairline dividers, restrained radii, zero drop-shadow clutter. Choose visual discipline over excess decoration. Every element should plausibly be implementable with HTML/CSS.
```
