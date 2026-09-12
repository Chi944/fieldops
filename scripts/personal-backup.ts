import { join, resolve } from "node:path";
import { backupName, createBackup, parseFlags, personalDirectory, projectRoot, reportFailure, stringFlag } from "./personal-tools";

async function main() {
  const flags = parseFlags(process.argv.slice(2), ["data", "output", "help"]);
  if (flags.help) { console.log("npm run personal:backup -- [--data=.fieldops/personal] [--output=.fieldops/backups/NEW-NAME]\nStop your personal FieldOps session first. Copies saved state and referenced private originals into a new, integrity-checked directory. No upload, encryption, or overwrite."); return; }
  const source = resolve(stringFlag(flags, "data", personalDirectory));
  const destination = resolve(stringFlag(flags, "output", join(projectRoot, ".fieldops", "backups", backupName())));
  const manifest = await createBackup(source, destination);
  console.log(`Backup verified: ${manifest.comparisons} comparisons, ${manifest.documents} originals.\nSaved to ${destination}\nThis directory contains private quotation data. Keep it in private storage; the backup is not encrypted.`);
}
main().catch(reportFailure);
