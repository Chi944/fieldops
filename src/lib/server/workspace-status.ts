import { authorize } from "./context";
import { capabilities } from "./config";
import { CloudRepository } from "./cloud-repository";
import { sqlQuery } from "./neon-db";
import { json } from "./errors";
import type { WorkspaceStatus } from "@/lib/domain/workspace-status";

/** Invited, on-demand diagnostics. Never return other owners' usage or provider secrets. */
export async function workspaceStatus(request: Request) {
  const { ownerId, repository } = await authorize(request);
  const available = capabilities(true);
  let capacity: WorkspaceStatus["capacity"] = null;
  let sharedCapacityAvailable: boolean | null = null;
  let uploadIntentTtlHours: number | null = null;
  let jobs: WorkspaceStatus["jobs"] = { active: 0, waitingQuota: 0, failed: 0 };
  if (repository.mode === "cloud") {
    const current = await (repository as CloudRepository).capacity(ownerId);
    capacity = current.workspace;
    sharedCapacityAvailable = current.project.comparisons < current.project.limits.comparisons
      && current.project.documents < current.project.limits.documents
      && current.project.bytes < current.project.limits.bytes;
    uploadIntentTtlHours = current.uploadIntentTtlHours;
    const rows = await sqlQuery<{ active: number; waitingQuota: number; failed: number }>(`
      select count(*) filter (where r.record->>'stage' in ('queued','validating','parsing','extracting','reconciling'))::int as active,
        count(*) filter (where r.record->>'stage'='waiting_quota')::int as "waitingQuota",
        count(*) filter (where r.record->>'stage'='failed')::int as failed
      from public.processing_runs r join public.comparisons c on c.id=r.comparison_id
      where r.owner_id=$1 and c.owner_id=$1 and c.deleted_at is null
    `, [ownerId]);
    jobs = rows[0] ?? jobs;
  } else {
    for (const comparison of await repository.list(ownerId)) {
      for (const run of await repository.runs(ownerId, comparison.id)) {
        if (["queued", "validating", "parsing", "extracting", "reconciling"].includes(run.stage)) jobs.active++;
        else if (run.stage === "waiting_quota") jobs.waitingQuota++;
        else if (run.stage === "failed") jobs.failed++;
      }
    }
  }
  const result: WorkspaceStatus = {
    checkedAt: new Date().toISOString(), mode: repository.mode,
    processing: available.canExtract ? "ai" : "parse_only", uploadsAvailable: available.canUpload,
    capacity, sharedCapacityAvailable, uploadIntentTtlHours, jobs,
  };
  return json(result);
}
