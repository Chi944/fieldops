import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyQuotation, type Comparison } from "@/lib/domain/types";
import type { DocumentRecord, RunRecord } from "@/lib/server/contracts";
import { CloudRepository } from "@/lib/server/cloud-repository";
import { storageDelete } from "@/lib/server/neon-storage";

// Repository statements execute against the same actual PostgreSQL migration. Only transport
// and object deletion are substituted; no hosted database or storage calls occur in this suite.
vi.mock("@/lib/server/neon-db", () => ({ sqlQuery: async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows }));
vi.mock("@/lib/server/neon-storage", () => ({ storageDelete: vi.fn(async () => {}), storageRead: vi.fn(), storageWrite: vi.fn() }));

// Runs the actual Neon migration in embedded PostgreSQL. Managed auth tables are stubbed
// from inspected types; this does not claim hosted integration or live AI verification.
let db: PGlite;
const owner1 = "10000000-0000-0000-0000-000000000001", owner2 = "10000000-0000-0000-0000-000000000002";
const now = new Date().toISOString();
function comparison(ownerId = owner1): Comparison { return { id: randomUUID(), workspaceId: ownerId, name: "SQL purchase", description: "", createdAt: now, updatedAt: now, revision: 0, isDemo: false, quotations: [], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } }; }
async function rpc(name: string, args: unknown[]) {
  const result = await db.query<{ result: unknown }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args); return result.rows[0]?.result;
}
async function seed(ownerId = owner1) {
  const c = comparison(ownerId); await rpc("fieldops_create_comparison", [ownerId, c]);
  const d: DocumentRecord = { id: randomUUID(), comparisonId: c.id, ownerId, filename: "quote.txt", contentType: "text/plain", contentHash: "a".repeat(64), size: 100, storagePath: `${ownerId}/${randomUUID()}`, createdAt: now, status: "uploaded", processingMode: "ai" };
  const r: RunRecord = { id: randomUUID(), comparisonId: c.id, documentId: d.id, ownerId, processingMode: "ai", stage: "queued", progress: 0, attempt: 0, fence: randomUUID(), inputRevision: 0, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: d.contentHash };
  await rpc("fieldops_create_upload", [ownerId, d, r, emptyQuotation(d.id, d.filename), 0]); return { c, d, r };
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role fieldops_untrusted;
    create schema neon_auth;
    create table neon_auth."user"(id uuid primary key,name text not null default '',email text not null default '',image text,banned boolean,"banExpires" timestamptz);
    create table neon_auth.account(id uuid primary key default gen_random_uuid(),"userId" uuid,"providerId" text,"accountId" text,"accessToken" text,"password" text);
    create table neon_auth.session(id uuid primary key default gen_random_uuid(),"userId" uuid,"expiresAt" timestamptz,"token" text);
    insert into neon_auth."user"(id) values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
    insert into neon_auth.account("userId","providerId","accountId") values('10000000-0000-0000-0000-000000000001','github','1001'),('10000000-0000-0000-0000-000000000002','github','1002');`);
  const path = join(process.cwd(), "neon", "migrations");
  for (const file of (await readdir(path)).filter((f) => f.endsWith(".sql")).sort()) await db.exec(await readFile(join(path, file), "utf8"));
  await db.exec("insert into public.invited_accounts(github_user_id) values('1001'),('1002')");
}, 60000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); vi.clearAllMocks(); });
afterAll(async () => { await db?.close(); });

describe("Neon migration behavior with inspected managed auth schema stubs", () => {
  it("roundtrips repository parameters and isolates user-facing reads", async () => {
    const repository = new CloudRepository(), first = comparison(owner1), second = comparison(owner2);
    await db.exec("set local role fieldops_server");
    await repository.create(owner1, first); await repository.create(owner2, second);
    await expect(repository.get(owner2, first.id)).rejects.toMatchObject({ code: "not_found" });
    const name = "Synthetic quote '; drop table comparisons; --\nRetain literal supplier wording";
    await repository.save(owner1, { ...first, name }, 0);
    expect((await repository.get(owner1, first.id)).name).toBe(name);
    expect((await repository.list(owner2)).map(row => row.id)).toEqual([second.id]);
    await expect(repository.save(owner1, first, 0)).rejects.toThrow("stale_revision");
  });
  it("repeats object deletion after ticket expiry and retains failed cleanup attempts", async () => {
    const { c, d } = await seed(); const repository = new CloudRepository();
    const remove = vi.mocked(storageDelete);
    remove.mockRejectedValueOnce(new Error("synthetic temporary object failure"));
    await db.exec("set local role fieldops_server");
    await repository.remove(owner1, c.id);
    await expect(repository.get(owner1, c.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await db.query("select id from deletion_outbox")).rows).toHaveLength(1);
    await repository.cleanup();
    expect((await db.query("select id from deletion_outbox")).rows).toHaveLength(1);
    await db.exec("reset role; update deletion_outbox set created_at=now()-interval '6 minutes'; set local role fieldops_server");
    remove.mockRejectedValueOnce(new Error("synthetic delayed object failure"));
    await repository.cleanup();
    expect((await db.query("select id from deletion_outbox")).rows).toHaveLength(1);
    await repository.cleanup();
    expect((await db.query("select id from deletion_outbox")).rows).toHaveLength(0);
    expect(remove).toHaveBeenCalledTimes(4); expect(remove).toHaveBeenLastCalledWith(d.storagePath);
  });
  it("retains the deletion tombstone when a cleanup deadline expires, then completes it on a later sweep", async () => {
    const { c, d } = await seed(); const repository = new CloudRepository();
    await rpc("fieldops_delete_comparison", [owner1, c.id]);
    await db.exec("update deletion_outbox set created_at=now()-interval '6 minutes'; set local role fieldops_server");
    const controller = new AbortController(); const remove = vi.mocked(storageDelete);
    remove.mockImplementationOnce(async (_key, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
    });
    await repository.cleanup({ signal: controller.signal });
    expect((await db.query("select id from deletion_outbox")).rows).toHaveLength(1);
    expect(remove).toHaveBeenCalledTimes(1);
    await repository.cleanup({ signal: controller.signal });
    expect(remove).toHaveBeenCalledTimes(1);
    await repository.cleanup();
    expect((await db.query("select id from deletion_outbox")).rows).toHaveLength(0);
    expect(remove).toHaveBeenLastCalledWith(d.storagePath);
  });
  it("persists source-only intent and fences terminal parsing results without inventing an extraction", async () => {
    const { r, d } = await seed();
    await db.query("update processing_runs set record=jsonb_set(record,'{processingMode}','\"parse_only\"') where id=$1", [r.id]);
    const claimed = await rpc("fieldops_claim_run", [r.id, "parse-fence", new Date(Date.now() + 30000).toISOString()]) as RunRecord;
    expect(claimed.processingMode).toBe("parse_only");
    expect(await rpc("fieldops_save_run", [{ ...claimed, processingMode: "ai" }, claimed.fence])).toBe(false);
    expect(await rpc("fieldops_complete_run", [r.id, claimed.fence, { ...emptyQuotation(d.id, d.filename), extractionVersion: 1, status: "ready" }])).toBe(false);
    expect(await rpc("fieldops_save_run", [{ ...claimed, stage: "source_ready", progress: 100, leaseUntil: undefined }, claimed.fence])).toBe(true);
    expect(await rpc("fieldops_save_run", [{ ...claimed, stage: "parsing" }, claimed.fence])).toBe(false);
    expect(await rpc("fieldops_claim_run", [r.id, "late", new Date(Date.now() + 30000).toISOString()])).toBe(null);
    expect(await rpc("fieldops_renew_lease", [r.id, claimed.fence, new Date(Date.now() + 30000).toISOString()])).toBe(false);
    expect(await rpc("fieldops_pending_runs", [])).toEqual([]);
    expect((await db.query("select * from extraction_versions")).rows).toEqual([]);
  });
  it("pins parsing intent at upload initiation so finalization cannot enable AI", async () => {
    const c = comparison(); await rpc("fieldops_create_comparison", [owner1, c]);
    const d: DocumentRecord = { id: randomUUID(), comparisonId: c.id, ownerId: owner1, filename: "manual.txt", contentType: "text/plain", contentHash: "b".repeat(64), size: 50, storagePath: `${owner1}/${randomUUID()}`, createdAt: now, status: "uploading", processingMode: "parse_only" };
    await rpc("fieldops_create_upload", [owner1, d, null, emptyQuotation(d.id, d.filename), 0]);
    const r: RunRecord = { id: randomUUID(), comparisonId: c.id, documentId: d.id, ownerId: owner1, stage: "queued", processingMode: "ai", progress: 0, attempt: 0, fence: randomUUID(), inputRevision: 1, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: d.contentHash };
    await db.exec("savepoint before_mismatch");
    await expect(rpc("fieldops_finalize_upload", [owner1, d.id, d.contentHash, r])).rejects.toThrow("processing_mode_mismatch");
    await db.exec("rollback to savepoint before_mismatch");
    await rpc("fieldops_finalize_upload", [owner1, d.id, d.contentHash, { ...r, processingMode: "parse_only" }]);
    expect((await db.query<{ record: RunRecord }>("select record from processing_runs where id=$1", [r.id])).rows[0].record.processingMode).toBe("parse_only");
    await rpc("fieldops_finalize_upload", [owner1, d.id, d.contentHash, { ...r, id: randomUUID(), processingMode: "parse_only" }]);
    expect((await db.query("select id from processing_runs where document_id=$1", [d.id])).rows).toHaveLength(1);
  });
  it("retries preserve parsing-only intent and never automatically resume model quota waits", async () => {
    const { r } = await seed();
    await db.query("update processing_runs set record=record||'{\"processingMode\":\"parse_only\",\"stage\":\"waiting_quota\",\"retryAfter\":\"2020-01-01T00:00:00Z\",\"quotaWaits\":20}' where id=$1", [r.id]);
    expect(await rpc("fieldops_pending_runs", [])).toEqual([]);
    expect(await rpc("fieldops_claim_run", [r.id, "quota", new Date(Date.now() + 30000).toISOString()])).toBe(null);
    const retried = await rpc("fieldops_retry_run", [owner1, r.id]) as RunRecord;
    expect(retried.processingMode).toBe("parse_only"); expect(retried.stage).toBe("queued");
    expect(retried.quotaWaits).toBe(0); expect(retried.retryAfter).toBeUndefined();
  });
  it("gives an explicit cloud AI retry a fresh quota-wait allowance while preserving its selected mode", async () => {
    const { r } = await seed();
    const claimed = await rpc("fieldops_claim_run", [r.id, "exhausted-quota-fence", new Date(Date.now() + 30000).toISOString()]) as RunRecord;
    const oldDeadline = new Date(Date.now() + 60000).toISOString();
    expect(await rpc("fieldops_save_run", [{ ...claimed, stage: "waiting_quota", errorCode: "quota", quotaWaits: 20, retryAfter: oldDeadline, leaseUntil: undefined }, claimed.fence])).toBe(true);
    expect(await rpc("fieldops_pending_runs", [])).toEqual([]);
    const retried = await rpc("fieldops_retry_run", [owner1, r.id]) as RunRecord;
    expect(retried).toMatchObject({ processingMode: "ai", stage: "queued", attempt: 0, quotaWaits: 0, cancelRequested: false });
    expect(retried.retryAfter).toBeUndefined(); expect(retried.errorCode).toBeUndefined(); expect(retried.fence).not.toBe(claimed.fence);
    const persisted = (await db.query<{ record: RunRecord }>("select record from processing_runs where id=$1", [r.id])).rows[0].record;
    expect(persisted).toEqual(retried);
    expect((await rpc("fieldops_pending_runs", []) as RunRecord[]).map((run) => run.id)).toContain(r.id);
    const resumed = await rpc("fieldops_claim_run", [r.id, "fresh-retry-fence", new Date(Date.now() + 30000).toISOString()]) as RunRecord;
    expect(resumed).toMatchObject({ processingMode: "ai", stage: "validating", attempt: 1, quotaWaits: 0 });
  });
  it("atomically creates the document, run, snapshot version and free compute reservation", async () => {
    const { c, d, r } = await seed();
    expect((await db.query<{ revision: number }>("select revision from comparisons where id=$1", [c.id])).rows[0].revision).toBe(1);
    expect((await db.query("select id from documents where id=$1", [d.id])).rows).toHaveLength(1);
    expect((await db.query("select id from processing_runs where id=$1", [r.id])).rows).toHaveLength(1);
    expect((await db.query("select version from comparison_versions where comparison_id=$1", [c.id])).rows).toHaveLength(2);
    expect(Number((await db.query<{ reserved_usd: string }>("select reserved_usd from processing_budget")).rows[0].reserved_usd)).toBe(0.13);
  });
  it("refuses stale snapshot replacement", async () => {
    const { c } = await seed();
    await expect(rpc("fieldops_save_comparison", [owner1, { ...c, name: "Outdated" }, 0])).rejects.toThrow("stale_revision");
  });
  it("fences a cancelled attempt and recovers an expired worker without accepting late writes", async () => {
    const { r, d } = await seed();
    const first = await rpc("fieldops_claim_run", [r.id, "old-fence", new Date(Date.now() - 1000).toISOString()]) as RunRecord;
    const second = await rpc("fieldops_claim_run", [r.id, "new-fence", new Date(Date.now() + 30000).toISOString()]) as RunRecord;
    expect(second.attempt).toBe(2);
    expect(await rpc("fieldops_save_run", [{ ...first, stage: "ready" }, "old-fence"])).toBe(false);
    expect(await rpc("fieldops_save_run", [{ ...second, cancelRequested: true, stage: "cancelled" }, "new-fence"])).toBe(true);
    expect(await rpc("fieldops_complete_run", [r.id, "new-fence", { ...emptyQuotation(d.id, d.filename), extractionVersion: 1, status: "ready" }])).toBe(false);
  });
  it("publishes versioned results while preserving source and line-item relations", async () => {
    const { r, d, c } = await seed(); await rpc("fieldops_claim_run", [r.id, "fence", new Date(Date.now() + 30000).toISOString()]);
    const parsed = { documentId: d.id, filename: d.filename, contentHash: d.contentHash, format: "text", sources: [{ id: "source-one", documentId: d.id, kind: "text", text: "Acme Q1" }], manifest: { parserVersion: "test", complete: true, units: [], warnings: [] } };
    await rpc("fieldops_save_parsed", [r.id, "fence", parsed]);
    const quotation = { ...emptyQuotation(d.id, d.filename), extractionVersion: 1, status: "ready", sources: parsed.sources, manifest: parsed.manifest };
    expect(await rpc("fieldops_complete_run", [r.id, "fence", quotation])).toBe(true);
    expect((await db.query("select id from source_spans where document_id=$1", [d.id])).rows).toHaveLength(1);
    expect((await db.query("select id from extraction_versions where document_id=$1", [d.id])).rows).toHaveLength(1);
    expect((await db.query<{ revision: number }>("select revision from comparisons where id=$1", [c.id])).rows[0].revision).toBe(2);
    expect(await rpc("fieldops_complete_run", [r.id, "fence", quotation])).toBe(false);
  });
  it("resumes a persisted quota deadline without increasing the failure attempt count", async () => {
    const { r } = await seed(); const first = await rpc("fieldops_claim_run", [r.id, "first", new Date(Date.now() + 30000).toISOString()]) as RunRecord;
    await rpc("fieldops_save_run", [{ ...first, stage: "waiting_quota", retryAfter: new Date(Date.now() - 1000).toISOString(), leaseUntil: undefined }, first.fence]);
    expect((await rpc("fieldops_pending_runs", []) as RunRecord[]).map((run) => run.id)).toContain(r.id);
    const resumed = await rpc("fieldops_claim_run", [r.id, "after-quota", new Date(Date.now() + 30000).toISOString()]) as RunRecord;
    expect(resumed.attempt).toBe(1); expect(resumed.fence).toBe("after-quota");
  });
  it("refuses another job before the conservative free-budget reservation is exceeded", async () => {
    await seed(); await db.exec("update processing_budget set reserved_usd=3.4");
    await expect(rpc("fieldops_reserve_job", [])).rejects.toThrow("quota");
  });
  it("keeps reservations across a calendar-month boundary", async () => {
    await db.exec("insert into processing_reservations(reserved_usd,created_at) values(3.4,now()-interval '20 days')");
    await expect(rpc("fieldops_reserve_job", [])).rejects.toThrow("quota");
  });
  it("denies browser roles all application tables and owner-parameter functions", async () => {
    const { c } = await seed();
    await db.exec("set local role fieldops_untrusted; savepoint denied");
    await expect(db.query("select snapshot from public.comparisons where id=$1", [c.id])).rejects.toThrow(/permission denied/i);
    await db.exec("rollback to savepoint denied");
    await expect(rpc("fieldops_create_comparison", [owner2, comparison(owner2)])).rejects.toThrow(/permission denied/i);
  });
  it("limits runtime access to approved functions and non-secret auth columns", async () => {
    await seed(); await db.exec("set local role fieldops_server");
    expect((await db.query('select id,name,email,banned,"banExpires" from neon_auth."user"')).rows).toHaveLength(2);
    expect((await db.query('select "userId","providerId","accountId" from neon_auth.account')).rows).toHaveLength(2);
    await db.exec("savepoint denied");
    await expect(db.query('select "accessToken" from neon_auth.account')).rejects.toThrow(/permission denied/i);
    await db.exec("rollback to savepoint denied");
    await expect(db.query('select token from neon_auth.session')).rejects.toThrow(/permission denied/i);
    await db.exec("rollback to savepoint denied");
    await expect(db.query("update public.comparisons set revision=99")).rejects.toThrow(/permission denied/i);
    await db.exec("rollback to savepoint denied");
    await expect(rpc("fieldops_snapshot", [owner1, comparison()])).rejects.toThrow(/permission denied/i);
    await db.exec("rollback to savepoint denied");
    await expect(rpc("fieldops_reserve_job", [])).rejects.toThrow(/permission denied/i);
  });
  it("uses immutable GitHub accounts and current invitation and ban state", async () => {
    expect(await rpc("fieldops_invited", [owner1])).toBe(true);
    await db.exec("update invited_accounts set active=false where github_user_id='1001'");
    expect(await rpc("fieldops_invited", [owner1])).toBe(false);
    await db.exec("update invited_accounts set active=true where github_user_id='1001'");
    await db.query('update neon_auth.account set "providerId"=$1 where "userId"=$2', ["email", owner1]);
    expect(await rpc("fieldops_invited", [owner1])).toBe(false);
    await db.query('update neon_auth.account set "providerId"=$1 where "userId"=$2', ["github", owner1]);
    await db.query('update neon_auth."user" set banned=true where id=$1', [owner1]);
    expect(await rpc("fieldops_invited", [owner1])).toBe(false);
    await db.query('update neon_auth."user" set "banExpires"=now()-make_interval(mins=>1) where id=$1', [owner1]);
    expect(await rpc("fieldops_invited", [owner1])).toBe(true);
  });
  it("binds an explicit owner for mutations and preserves object cleanup after deletion", async () => {
    const { c, d, r } = await seed();
    await rpc("fieldops_claim_run", [r.id, "fence", new Date(Date.now() + 30000).toISOString()]);
    await rpc("fieldops_save_checkpoint", [r.id, "fence", "chunk", { data: "synthetic source" }]);
    await db.exec("set local role fieldops_server; savepoint denied");
    await expect(rpc("fieldops_delete_comparison", [owner2, c.id])).rejects.toThrow("not_found");
    await db.exec("rollback to savepoint denied");
    await rpc("fieldops_delete_comparison", [owner1, c.id]);
    expect((await db.query("select * from ai_checkpoints")).rows).toEqual([]);
    expect((await db.query("select * from comparisons")).rows).toEqual([]);
    expect((await db.query("select storage_path from deletion_outbox")).rows).toEqual([{ storage_path: d.storagePath }]);
    await db.query("delete from deletion_outbox where storage_path=$1", [d.storagePath]);
    expect((await db.query("select * from deletion_outbox")).rows).toHaveLength(1);
    await db.exec("reset role; update deletion_outbox set created_at=now()-interval '6 minutes'; set local role fieldops_server");
    await db.query("delete from deletion_outbox where storage_path=$1", [d.storagePath]);
    expect((await db.query("select * from deletion_outbox")).rows).toEqual([]);
  });
  it("keeps every application table under RLS and removes PUBLIC function execution", async () => {
    const tables = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
    expect(tables.rows.length).toBe(16); expect(tables.rows.every(row => row.relrowsecurity)).toBe(true);
    const permissions = await db.query<{ allowed: boolean }>("select has_function_privilege('fieldops_untrusted',p.oid,'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fieldops_%'");
    expect(permissions.rows.length).toBe(17); expect(permissions.rows.every(row => !row.allowed)).toBe(true);
  });
  it("deletes one source while preserving the other supplier and scrubbing old snapshots", async () => {
    const { c, d } = await seed();
    const d2: DocumentRecord = { ...d, id: randomUUID(), storagePath: `${owner1}/${randomUUID()}` };
    await rpc("fieldops_create_upload", [owner1, d2, null, emptyQuotation(d2.id, d2.filename), 1]);
    await rpc("fieldops_delete_document", [owner1, d.id, 2]);
    expect((await db.query<{ id: string }>("select id from documents where comparison_id=$1", [c.id])).rows.map((r) => r.id)).toEqual([d2.id]);
    const snapshot = (await db.query<{ snapshot: Comparison }>("select snapshot from comparisons where id=$1", [c.id])).rows[0].snapshot;
    expect(snapshot.quotations.map((q) => q.documentId)).toEqual([d2.id]);
    expect((await db.query("select version from comparison_versions where comparison_id=$1", [c.id])).rows).toHaveLength(1);
  });
});
