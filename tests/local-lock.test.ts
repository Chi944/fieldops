import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "@/lib/server/local-repository";
import type { Comparison } from "@/lib/domain/types";

const failures = vi.hoisted(() => ({ codes: [] as string[], attempts: 0, prematureDeletes: 0, acquired: false, onAttempt: undefined as (() => void) | undefined }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).endsWith("state.lock") && args[1] === "wx") {
        failures.attempts++;
        failures.onAttempt?.();
        const code = failures.codes.shift();
        if (code) throw Object.assign(new Error(`Injected Windows ${code} lock acquisition failure`), { code });
        const handle = await fs.open(...args); failures.acquired = true; return handle;
      }
      return fs.open(...args);
    },
    unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (String(args[0]).endsWith("state.lock") && !failures.acquired) failures.prematureDeletes++;
      return fs.unlink(...args);
    },
  };
});

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fieldops-lock-"));
  failures.codes = []; failures.attempts = 0; failures.prematureDeletes = 0; failures.acquired = false; failures.onAttempt = undefined;
});
afterEach(async () => {
  vi.useRealTimers();
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("fieldops-lock-")) throw new Error("Unexpected lock-test cleanup target");
  await rm(target, { recursive: true, force: true });
});
function comparison(): Comparison {
  const now = new Date().toISOString();
  return { id: randomUUID(), workspaceId: "local-workspace", name: "Concurrent personal upload", description: "", createdAt: now, updatedAt: now, revision: 0, isDemo: false, quotations: [], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } };
}

describe("Windows local lock acquisition", () => {
  it("retries transient access/busy failures before acquiring its own lock and commits atomically", async () => {
    failures.codes = ["EPERM", "EACCES", "EBUSY"];
    const repository = new LocalRepository(directory); const created = comparison();
    await repository.create("local-user", created);
    expect(failures.attempts).toBe(4); expect(failures.prematureDeletes).toBe(0);
    expect(await new LocalRepository(directory).get("local-user", created.id)).toEqual(created);
    await expect(readFile(join(directory, "state.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("stops after the bounded acquisition budget without removing a lock it never acquired", async () => {
    failures.codes = Array.from({ length: 250 }, () => "EPERM");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const firstAttempt = new Promise<void>(done => { failures.onAttempt = done; });
    const rejected = expect(new LocalRepository(directory).create("local-user", comparison())).rejects.toMatchObject({ status: 503, code: "storage_busy" });
    // Wait for real mkdir/open I/O to reach the first injected failure, then advance
    // the actual 200 backoffs without depending on OS scheduling under suite load.
    await firstAttempt; await vi.runAllTimersAsync(); await rejected;
    expect(failures.attempts).toBe(200); expect(failures.acquired).toBe(false); expect(failures.prematureDeletes).toBe(0);
    await expect(readFile(join(directory, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
