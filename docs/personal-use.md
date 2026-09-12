# Personal FieldOps on this computer

Run `npm run personal` from this FieldOps repository. It starts a private local workspace with real file parsing and manual comparison. AI is off by default; `--ai` explicitly enables the configured Groq Free integration. Local storage needs no Neon or Trigger account.

## First launch

Install Node.js 24 and the repository dependencies once:

```powershell
npm ci
npm run personal:check
npm run personal
```

Open the **Personal workspace ready** URL printed in the terminal. The launcher binds only to `127.0.0.1` and picks an available port from **3001–3009**. It never uses port 3000 and never stops a process occupying a port. To request a particular free port:

```powershell
npm run personal -- --port=3001
```

Keep the terminal open while working; use **Ctrl+C** to stop that session. First page visits compile the app because the launcher uses Next.js development mode. Its build output is isolated by port in `.fieldops/personal-next-PORT`. The workspace lock prevents two sessions from opening the same data directory.

Your comparisons, correction history, processing records and original files are stored in **`.fieldops/personal`**, separate from `.fieldops/e2e-storage` and other test data. The directory is gitignored. A custom restored workspace can be selected with `--data=PATH`; the launcher does not automatically import the earlier `.fieldops/state.json` workspace.

`personal:check` reports runtime/dependency readiness, local data readability, an available loopback port and whether the English OCR asset is installed. It does not start a server, print credentials, call AI or hash private documents. The launcher checks the running `/api/status` endpoint and requires local persistence/uploads and the requested AI mode before printing its ready message.

## Enable automatic interpretation

Create the gitignored `.env.ai.local` in the repository with these server-only settings. The FieldOps computer has a dedicated key configured; do not replace or print it.

```dotenv
GROQ_API_KEY=YOUR_DEDICATED_FREE_KEY
GROQ_MODEL=openai/gpt-oss-120b
GROQ_FREE_TIER_CONFIRMED=true
GROQ_ZDR_CONFIRMED=true
```

Set the confirmation flags only after checking Free Plan and **Inference APIs ZDR** in Groq. The current dedicated FieldOps key expires on 12 December 2026. Configuration evidence and limitations are in [AI setup](ai-setup-verification.md).

```powershell
npm run personal:check -- --ai
npm run personal -- --ai
```

Stop the existing session for the same data directory before relaunching with AI. The option changes future upload processing; it does not reprocess your saved quotations automatically. Pinned parser-only jobs remain parser-only on retry. AI receives parsed text and source identifiers; PDFs, spreadsheets and OCR images remain local. Review every extraction and proposed match. Free quotas can pause work, and incomplete results require recovery rather than acceptance as complete.

## Use real quotations without AI

Create a comparison and upload text PDFs, images/scans, XLSX/CSV or pasted text. The parser preserves available source locations. When processing reaches **Source ready**, open review. Enter the supplier name and currency, add the quoted line items, select the source records supporting each item, and record corrections with a reason. Check every page or sheet, then use **Confirm manual review** to acknowledge that the entered rows cover the original. Missing prices and conflicting terms remain visible after confirmation. Match comparable offers, approve groups, set required quantities and export the workbook or print report. Later corrections reopen the manual-review acknowledgment.

Source parsing does not identify supplier fields using a model. A parser-only result still needs manual interpretation and completeness review. Missing or conflicting information remains visible; manual entry should not turn an unsupported comparison into a confident recommendation. Sample workspaces remain explicitly labeled fictional.

For scanned documents, install the English printed-text OCR asset once:

```powershell
npx tsx scripts/process.ts --prepare-ocr
```

This setup command downloads language data; it does not upload a quotation. Subsequent OCR runs locally using `.fieldops/tessdata/eng.traineddata.gz`. It is optional for text PDFs, spreadsheets and pasted text. Limits remain 20 MiB/file, five quotations/comparison, ten PDF pages, five worksheets, 20,000 populated spreadsheet cells, 100 items, 100,000 text characters and 20 megapixels/image. Handwriting and universal layout support are not claimed.

The launcher clears inherited model, database, storage, Auth and Trigger credentials. A key in your shell or `.env.local` cannot silently enable AI. With `--ai`, it imports only the dedicated model settings from `.env.ai.local`; database and storage remain local. Credentials in other environment files are not changed. Keep this single-user mode on the loopback interface; do not put a tunnel or public proxy in front of it.

## Back up the workspace

Stop your personal session with Ctrl+C first, then run:

```powershell
npm run personal:backup
```

The command prints the new directory it created under `.fieldops/backups`. To choose a name or a private external drive:

```powershell
npm run personal:backup -- --output=".fieldops/backups/before-import"
```

For a custom data directory, add `--data="YOUR-DATA-DIRECTORY"`. Existing backup destinations are refused. The source and backup directories must be separate, with neither containing the other.

A backup contains `state.json`, every original referenced by its uploaded-document records, and `manifest.json` with each file's byte length and SHA-256 hash. It preserves parsed evidence, corrections, extraction history, checkpoints and job records stored in that state. Environment files, build caches, OCR assets, unrelated loose files and browser-only demo edits are excluded. The command acquires the repository's state lock while copying and verifies originals against their recorded hashes. A running personal session or unfinished upload blocks backup.

Backups contain private document text and originals. They are **not encrypted or signed**. Hashes detect corruption and unexpected changes; they do not establish authenticity against someone who can rewrite both the files and manifest. Keep complete backup directories on private storage; a second copy on a private external drive protects against loss of the computer. The tool never uploads them. Windows folder permissions continue to govern local access.

## Verify or restore

Replace `BACKUP-DIRECTORY` with the directory printed by the backup command. First, check every stored hash without writing files:

```powershell
npm run personal:restore -- --input="BACKUP-DIRECTORY" --verify
```

Restore to a **new** directory:

```powershell
npm run personal:restore -- --input="BACKUP-DIRECTORY" --destination=".fieldops/personal-restored"
npm run personal -- --data=".fieldops/personal-restored"
```

Omit `--destination` to generate a new timestamped restore directory. Restore never replaces, merges or deletes your current workspace. It checks manifest paths, rejects symbolic-link traversal, verifies every file before copying, and verifies copied bytes again. A `restored-backup.json` receipt records when restoration occurred. Saved unfinished jobs can be resumed by the ordinary local worker after launch; AI jobs require an explicitly enabled AI session.

If backup or restore fails after creating its new directory, `.fieldops-incomplete` remains there. That directory cannot be launched or restored using these tools. Preserve it for inspection, correct the reported problem, and retry with a new destination. A missing/corrupted original must be recovered before a complete backup can be created. Do not remove an incomplete marker to bypass verification.

Deleting a quotation inside FieldOps does not erase older backups or exported workbooks. Those copies have their own retention, controlled by you. These tools never delete a backup automatically.

## Recovery and verification

| Situation | Recovery |
| --- | --- |
| Requested port is occupied | Omit `--port` or choose another port in 3001–3009; no unrelated process needs to be stopped |
| Personal session already running | Reuse its printed URL or stop that session before launching or backing up |
| Development build lock is occupied | Stop your other personal FieldOps session and retry; the launcher does not kill a discovered process |
| OCR data missing | Install the asset with the setup command above; text documents remain usable |
| Workspace busy/unreadable lock | Stop FieldOps and retry; a lock belonging to a confirmed dead process can be recovered, while unreadable/live locks are retained |
| Damaged original or failed manifest check | Use a previously verified backup; the tool will not silently omit the damaged original |
| Node/dependencies unavailable | Install Node 24, run `npm ci`, then run `personal:check` again |

`tests/personal-tools.test.ts` uses temporary synthetic workspaces and the real local repository to check restore preservation, private access isolation, corruption detection, no overwrite, path/symlink rejection, incomplete markers, lock behavior and launcher boundaries. It does not read or modify your private quotations. The tool format is versioned; future state-format changes require explicit migration support.
