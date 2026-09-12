import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tasks, runs } from "@trigger.dev/sdk";
import type { healthCheck } from "../src/trigger/health-check";

async function main() {
  process.loadEnvFile(".env.trigger.local");
  if (process.env.TRIGGER_PROJECT_ID !== "proj_gqdrztfnxotydnuhiaku" || !/^tr_dev_/.test(process.env.TRIGGER_SECRET_KEY ?? "")) throw new Error("Configure the FieldOps development key first.");
  const path = ".fieldops/trigger-dev-smoke.json";
  let previous: { runId: string } | undefined;
  try { previous = JSON.parse(await readFile(path, "utf8")); } catch { /* First run has no receipt. */ }
  const runId = previous?.runId ?? (await tasks.trigger<typeof healthCheck>("fieldops-health-check", undefined, { idempotencyKey: "fieldops-development-setup-v1", idempotencyKeyTTL: "1h" })).id;
  await mkdir(".fieldops", { recursive: true });
  await writeFile(path, JSON.stringify({ project: process.env.TRIGGER_PROJECT_ID, environment: "development", runId, status: "submitted" }, null, 2));
  console.log(JSON.stringify({ task: "fieldops-health-check", runId, environment: "development" }));
  for (let attempt = 0; attempt < 12; attempt++) {
    const run = await runs.retrieve<typeof healthCheck>(runId, { retry: { maxAttempts: 1 } });
    if (run.isCompleted) {
      const result = { project: process.env.TRIGGER_PROJECT_ID, environment: "development", runId, status: run.status, checkedAt: new Date().toISOString(), output: run.output };
      await writeFile(path, JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      if (run.status !== "COMPLETED" || run.output?.ok !== true || run.output.calculatedTotal !== "251.30" || run.output.modelCalls !== 0 || run.output.privateFilesRead !== 0) process.exitCode = 1;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  console.log(JSON.stringify({ runId, status: "still_pending", recovery: "Keep the dev worker running and rerun this command to inspect the same run." }));
  process.exitCode = 1;
}
const deadline = setTimeout(() => { console.error("Development smoke deadline reached; the saved receipt can be resumed."); process.exit(1); }, 90_000);
main().catch(() => { console.error("Development smoke failed. Check the configured development key, worker connection and saved run receipt; no credential details were logged."); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
