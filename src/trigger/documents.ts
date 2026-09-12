import { schemaTask, schedules, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { CloudRepository } from "@/lib/server/cloud-repository";
import { executeRun, reconcileCloudJobs } from "@/lib/server/jobs";
import { sqlQuery } from "@/lib/server/neon-db";
import type { RunRecord } from "@/lib/server/contracts";

export const processDocument = schemaTask({
  id: "fieldops-process-document",
  schema: z.object({ runId: z.string().uuid() }),
  queue: { name: "fieldops-documents", concurrencyLimit: 1 },
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async ({ runId }) => {
    const repository = new CloudRepository();
    // Quota waitpoints consume no compute while suspended. They do not spend a failure attempt.
    for (let continuation = 0; continuation < 22; continuation++) {
      await executeRun(repository, runId);
      const rows = await sqlQuery<{ record: RunRecord }>("select record from public.processing_runs where id=$1", [runId]);
      const next = rows[0]?.record;
      if (next?.stage === "queued" && next.attempt < 2) await wait.for({ seconds: 6 });
      else if (next?.stage === "waiting_quota" && next.retryAfter) await wait.for({ seconds: Math.max(1, Math.ceil((Date.parse(next.retryAfter) - Date.now()) / 1000) + 1) });
      else break;
    }
    return { runId };
  },
});
export const reconcile = schedules.task({
  id: "fieldops-reconcile",
  // A preview deployment must not add recurring spend or reconcile production data.
  cron: { pattern: "*/15 * * * *", environments: ["PRODUCTION"] },
  machine: "micro",
  maxDuration: 20,
  retry: { maxAttempts: 1 },
  run: async () => { await reconcileCloudJobs(); return { reconciled: true }; },
});
