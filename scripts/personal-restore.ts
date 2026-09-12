import { join, resolve } from "node:path";
import { backupName, parseFlags, projectRoot, reportFailure, restoreBackup, stringFlag, verifyBackup } from "./personal-tools";

async function main() {
  const flags = parseFlags(process.argv.slice(2), ["input", "destination", "verify", "help"]);
  if (flags.help || !flags.input) { console.log("npm run personal:restore -- --input=BACKUP-DIRECTORY [--verify] [--destination=.fieldops/NEW-NAME]\nVerifies every saved hash. Restore always creates a new directory; an existing destination is refused. --verify checks the backup without writing anything."); if (!flags.help) process.exitCode = 1; return; }
  const input = resolve(stringFlag(flags, "input"));
  if (flags.verify) { const { manifest } = await verifyBackup(input); console.log(`Backup integrity passed: ${manifest.comparisons} comparisons and ${manifest.documents} originals. No files restored.`); return; }
  const destination = resolve(stringFlag(flags, "destination", join(projectRoot, ".fieldops", backupName("personal-restored"))));
  const manifest = await restoreBackup(input, destination);
  console.log(`Restored ${manifest.comparisons} comparisons and ${manifest.documents} originals to a new directory:\n${destination}\nLaunch with npm run personal -- --data="${destination}"\nAI stays disabled. Your existing personal workspace was not changed.`);
}
main().catch(reportFailure);
