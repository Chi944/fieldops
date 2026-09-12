import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";

// Capture task registration without contacting Trigger or executing a worker.
vi.mock("@trigger.dev/sdk", () => ({
  defineConfig: (config: unknown) => config,
  schemaTask: (task: unknown) => task,
  schedules: { task: (task: unknown) => task },
  wait: { for: vi.fn() },
}));
vi.mock("@/lib/server/jobs", () => ({ executeRun: vi.fn(), reconcileCloudJobs: vi.fn() }));
vi.mock("@/lib/server/cloud-repository", () => ({ CloudRepository: class {} }));
vi.mock("@/lib/server/neon-db", () => ({ sqlQuery: vi.fn() }));

import config from "../trigger.config";
import { processDocument, reconcile } from "@/trigger/documents";

type RegisteredTask = { maxDuration: number; retry: { maxAttempts: number }; queue?: { concurrencyLimit: number }; machine?: string; cron?: { pattern: string; environments: string[] } };
const document = processDocument as unknown as RegisteredTask;
const maintenance = reconcile as unknown as RegisteredTask;

describe("production processing allowance against published Trigger rates", () => {
  it("registers one production-only maintenance schedule and bounds document concurrency and task attempts", () => {
    expect(maintenance.cron).toEqual({ pattern: "*/15 * * * *", environments: ["PRODUCTION"] });
    expect(maintenance.machine).toBe("micro");
    expect(maintenance.maxDuration).toBeLessThanOrEqual(20);
    expect(maintenance.retry.maxAttempts).toBe(1);
    expect(config.machine).toBe("medium-1x");
    expect(document.maxDuration).toBeLessThanOrEqual(600);
    expect(document.queue?.concurrencyLimit).toBe(1);
    expect(document.retry.maxAttempts).toBe(1);
  });

  it("keeps two ordinary document executions per reservation plus the full-month schedule below the free credit", () => {
    const sql = readFileSync(new URL("../neon/migrations/202609180001_fieldops.sql", import.meta.url), "utf8");
    const admission = sql.match(/greatest\(used,rolling_used\)\+([\d.]+)>([\d.]+)/);
    expect(admission).not.toBeNull();
    const reservation = new Decimal(admission![1]), admissionLimit = new Decimal(admission![2]);
    // Published https://trigger.dev/pricing, checked 2026-09-13. This is an
    // estimate for this workload, not an assertion about provider invoices.
    const invocation = new Decimal("0.000025");
    const ordinaryExecutionAllowance = new Decimal("0.0000850").mul(document.maxDuration).plus(invocation).mul(2);
    expect(reservation.gte(ordinaryExecutionAllowance)).toBe(true);
    const maintenanceAllowance = new Decimal("0.0000169").mul(maintenance.maxDuration).plus(invocation).mul(31 * 24 * 4);
    const admitted = admissionLimit.div(reservation).floor();
    expect(admitted.toNumber()).toBe(26);
    const estimatedTotal = admitted.mul(reservation).plus(maintenanceAllowance);
    expect(estimatedTotal.toFixed(6)).toBe("4.460288");
    expect(new Decimal(5).minus(estimatedTotal).gte("0.50")).toBe(true);
  });
});
