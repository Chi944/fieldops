# Private pilot and remaining release gates

The current implementation uses **Neon only**, with Vercel Hobby, Neon Free and Trigger Free. Its hosted parser/manual-review workflow now works through GitHub sign-in, private source storage, production processing, comparison and export. Hosted processing remains parser-only with no production Groq key; Groq Free is enabled separately for the local AI workspace. Neon Object Storage is free during beta. [Deployment instructions](deployment.md), [free-service boundaries](free-services.md) and [release verification](release-verification.md) contain current evidence.

## Available now

The fictional public workspace supports the connected review, matching, matrix and export workflow. In the actual hosted private workspace, an invited GitHub account created a new synthetic comparison and two pasted originals completed production Trigger parsing. The buyer entered supplier/currency/items against selected source evidence, explicitly confirmed source coverage, approved a baseline match and compared USD 25.00 with USD 22.50. Unknown delivery costs stayed visible and no overall winner was presented. A 13-sheet Excel report was downloaded and reopened at pinned revision 12; anonymous original requests returned 401.

This run used main commit `6dab810`, Vercel READY deployment `dpl_5Ly8SyyW7tWVYR2GaNk84wKqR1Qo`, and passed [Linux CI run 34722616140](https://github.com/Chi944/fieldops/actions/runs/34722616140). The homepage-verifier fix has passed actual Chrome GitHub sign-in. The two hosted pasted-text document runs establish more than the earlier synthetic health check, but do not establish hosted PDF/scan/image/spreadsheet support or two-user isolation.

The local personal workspace supports persistent source review, manual entry/corrections, exports, backups and non-overwriting restore. It defaults to parser-only; explicit `--ai` checks Free/ZDR settings. A separate local AI run on port 3003 extracted two tiny synthetic quotations, proposed an approved match and preserved an original price of 1.10 after correction to 1.05, with the resulting 0.10 line discrepancy visible. Its workbook exported at revision 7. This is a small working AI example; the full multiformat evaluation is incomplete and the held-out split remains untouched.

## Next acceptance work

| Milestone | Required evidence |
| --- | --- |
| Hosted persistence and isolation | Reload, sign-out/re-entry and deletion of the synthetic comparison passed; both originals return storage 404. Add an uninvited identity and two authenticated users to prove cross-user comparison/API/source denial. One successful invited identity and anonymous 401 responses do not complete that matrix. |
| Hosted processing | Exercise uploaded text files, text PDFs, scanned PDFs, images, XLSX and CSV through production worker, evidence review and export. Preserve successful files during another failure; verify duplicate/revision, forced interruption, cancel/retry and stale edits. Hosted pasted text has passed. |
| Live AI reliability | Keep the observed provider rejections. Finish multiformat development probes beyond the two tiny local successes, freeze schema/prompt/model/parser configuration, then run the untouched held-out split. Compare AI matching with the baseline using actual field/row/match/ambiguity/source/latency/usage denominators. Hosted AI remains disabled until separately configured and verified. |
| Free capacity | Verify actual usage against conservative reservations. Pause when free allowances end; never upgrade or enable paid fallback. Neon storage is currently free during beta, so stop cloud admission if continued use would require payment. |

## Further engineering work

Add per-workspace byte/document admission and expiry of abandoned upload intents. Preserve capacity reservations through failed deletions, and provide a small operator view for delayed jobs, cleanup failures and remaining allowance without exposing document text. Existing foreground cleanup is bounded and durable; managed Auth account deletion still requires comparison cleanup first because direct account cascades do not create file-deletion records.

Verify a hosted backup and restore procedure covering database records and originals together. An Excel export is a decision report, not a full application backup. Keep the public fixture workspace independent of cloud uptime.

The model's local minute/day counter is an extra guard, not global usage accounting. Before broader multi-user AI access, add persistent token admission shared across web and worker. Provider Free quotas remain authoritative. Preserve failed-output journals privately and avoid treating accepted schema shape as proof of correct interpretation.

## Later scope

DOCX, handwriting, broad multilingual OCR, graduated pricing, automatic bundle allocation, weighted scoring, live FX, shared teams and procurement integrations remain deferred. Expand only after permissioned examples and independent measurements establish useful support boundaries. No supplier outreach, autonomous purchase or paid service is part of this release.
