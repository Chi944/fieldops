import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyQuotation, type Comparison } from "@/lib/domain/types";
import type { DocumentRecord, RunRecord } from "@/lib/server/contracts";

// Executes the actual migrations in embedded PostgreSQL. Auth/storage schemas below stand in
// for Supabase platform-owned schemas; this does not claim a hosted Supabase integration run.
let db: PGlite;
const owner1 = "10000000-0000-0000-0000-000000000001", owner2 = "10000000-0000-0000-0000-000000000002";
const now = new Date().toISOString();
function comparison(ownerId = owner1): Comparison { return { id: randomUUID(), workspaceId: ownerId, name: "SQL purchase", description: "", createdAt: now, updatedAt: now, revision: 0, isDemo: false, quotations: [], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } }; }
async function rpc(name: string, args: unknown[]) {
  const result = await db.query<{ result: unknown }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args); return result.rows[0]?.result;
}
async function seed(ownerId = owner1) {
  const c = comparison(ownerId); await rpc("fieldops_create_comparison", [ownerId, c]);
  const d: DocumentRecord = { id: randomUUID(), comparisonId: c.id, ownerId, filename: "quote.txt", contentType: "text/plain", contentHash: "a".repeat(64), size: 100, storagePath: `${ownerId}/${randomUUID()}`, createdAt: now, status: "uploaded" };
  const r: RunRecord = { id: randomUUID(), comparisonId: c.id, documentId: d.id, ownerId, stage: "queued", progress: 0, attempt: 0, fence: randomUUID(), inputRevision: 0, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: d.contentHash };
  await rpc("fieldops_create_upload", [ownerId, d, r, emptyQuotation(d.id, d.filename), 0]); return { c, d, r };
}
async function actAs(owner: string) { await db.exec("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]); }
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create table auth.identities(user_id uuid,provider text,identity_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security; grant select on storage.objects to authenticated;
    insert into auth.users values('${owner1}'),('${owner2}');
    insert into auth.identities values('${owner1}','github','{"sub":"1001"}'),('${owner2}','github','{"provider_id":"1002"}');`);
  const path = join(process.cwd(), "supabase", "migrations");
  for (const file of (await readdir(path)).filter((f) => f.endsWith(".sql")).sort()) await db.exec(await readFile(join(path, file), "utf8"));
  await db.exec("insert into public.invited_accounts(github_user_id) values('1001'),('1002')");
}, 60000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

describe("actual migration behavior in PostgreSQL with Supabase schema stubs", () => {
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
  it("RLS hides another user's comparison, documents, run and original storage object", async () => {
    const first = await seed(owner1), second = await seed(owner2);
    await db.query("insert into storage.objects(bucket_id,name) values('quotations',$1),('quotations',$2)", [first.d.storagePath, second.d.storagePath]);
    await actAs(owner1);
    expect((await db.query<{ id: string }>("select id from comparisons")).rows.map((r) => r.id)).toEqual([first.c.id]);
    expect((await db.query<{ id: string }>("select id from documents")).rows.map((r) => r.id)).toEqual([first.d.id]);
    expect((await db.query<{ id: string }>("select id from processing_runs")).rows.map((r) => r.id)).toEqual([first.r.id]);
    expect((await db.query<{ name: string }>("select name from storage.objects")).rows.map((r) => r.name)).toEqual([first.d.storagePath]);
  });
  it("does not allow an authenticated client to invoke service-only owner-parameter RPCs", async () => {
    await actAs(owner1); await expect(rpc("fieldops_create_comparison", [owner2, comparison(owner2)])).rejects.toThrow(/permission denied/i);
  });
  it("revoking the immutable GitHub invitation immediately removes read access", async () => {
    await seed(); await db.exec("update invited_accounts set active=false where github_user_id='1001'"); await actAs(owner1);
    expect((await db.query("select id from comparisons")).rows).toEqual([]); expect(await rpc("fieldops_invited", [])).toBe(false);
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
  it("deletion revokes reads before durable object cleanup and removes checkpoint contents", async () => {
    const { c, d, r } = await seed(); await rpc("fieldops_claim_run", [r.id, "fence", new Date(Date.now() + 30000).toISOString()]);
    await rpc("fieldops_save_checkpoint", [r.id, "fence", "chunk-one", { data: "private extraction" }]);
    await db.query("insert into storage.objects(bucket_id,name) values('quotations',$1)", [d.storagePath]);
    await rpc("fieldops_delete_comparison", [owner1, c.id]);
    expect((await db.query("select * from ai_checkpoints")).rows).toEqual([]); expect((await db.query("select * from deletion_outbox")).rows).toHaveLength(1);
    await actAs(owner1); expect((await db.query("select * from storage.objects")).rows).toEqual([]);
  });
  it("refuses another job before the conservative free-budget reservation is exceeded", async () => {
    await seed(); await db.exec("update processing_budget set reserved_usd=3.4");
    await expect(rpc("fieldops_reserve_job", [])).rejects.toThrow("quota");
  });
  it("keeps reservations across a calendar-month boundary", async () => {
    await db.exec("insert into processing_reservations(reserved_usd,created_at) values(3.4,now()-interval '20 days')");
    await expect(rpc("fieldops_reserve_job", [])).rejects.toThrow("quota");
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
