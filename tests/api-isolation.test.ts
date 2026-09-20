import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { emptyQuotation, type Comparison } from "@/lib/domain/types";
import type { DocumentRecord, RunRecord } from "@/lib/server/contracts";
import * as comparisons from "@/app/api/comparisons/route";
import * as comparison from "@/app/api/comparisons/[id]/route";
import * as source from "@/app/api/documents/[id]/source/route";
import * as document from "@/app/api/documents/[id]/route";
import * as finalize from "@/app/api/documents/[id]/finalize/route";
import * as run from "@/app/api/runs/[id]/route";
import * as cancel from "@/app/api/runs/[id]/cancel/route";
import * as initiate from "@/app/api/comparisons/[id]/uploads/initiate/route";
import * as upload from "@/app/api/comparisons/[id]/uploads/route";
import * as retry from "@/app/api/runs/[id]/retry/route";
import * as correction from "@/app/api/comparisons/[id]/corrections/route";
import * as items from "@/app/api/comparisons/[id]/items/route";
import * as status from "@/app/api/status/route";
import * as workspaceStatus from "@/app/api/workspace/status/route";
import { storageSourceUrl, storageUploadIntent, storageFinalizeUpload, storageDelete } from "@/lib/server/neon-storage";

// Run real route handlers, authorization, parameterized DB adapter and repository
// against the shipped SQL. Substitute only the verified SDK-session boundary,
// HTTP database transport, and S3. No hosted credentials, model or provider calls.
const sdk = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: () => ({ getSession: sdk.getSession }) }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => ({
  query: (text: string, params: unknown[] = []) => ({ text, params }),
  transaction: async (queries: { text: string; params: unknown[] }[]) => {
    // Each hosted HTTP transaction is independent. A savepoint lets this test
    // preserve that error/rollback behavior inside its disposable fixture.
    await db.exec("savepoint http_request");
    try {
      const results = [];
      for (const query of queries) results.push((await db.query(query.text, query.params)).rows);
      await db.exec("release savepoint http_request"); return results;
    } catch (error) { await db.exec("rollback to savepoint http_request; release savepoint http_request"); throw error; }
  },
}) }));
vi.mock("@/lib/server/neon-storage", () => ({
  storageSourceUrl: vi.fn(async () => "https://synthetic-storage.example/private?ticket=synthetic"),
  storageUploadIntent: vi.fn(async () => ({ signedUrl: "https://synthetic-storage.example/upload", method: "PUT", headers: {} })),
  storageFinalizeUpload: vi.fn(), storageDiscardUpload: vi.fn(),
  storageRead: vi.fn(), storageWrite: vi.fn(), storageDelete: vi.fn(async () => {}),
}));

let db: PGlite;
const origin = "https://fieldops.example";
const owners = [1, 2, 3].map(i => `10000000-0000-4000-8000-00000000000${i}`);
const sessions = [1, 2, 3].map(i => `20000000-0000-4000-8000-00000000000${i}`);
function signedIn(index = 0) {
  sdk.getSession.mockResolvedValue({ data: { user: { id: owners[index], name: "Untrusted cached name", role: "admin" }, session: { id: sessions[index] } }, error: null });
}
function request(path: string, method = "GET", payload?: unknown, headers?: HeadersInit) {
  return new Request(`${origin}${path}`, { method, headers: { ...(method !== "GET" ? { origin, "content-type": "application/json" } : {}), ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
async function rpc(name: string, args: unknown[]) {
  return (await db.query<{ result: unknown }>(`select public.fieldops_${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0]?.result;
}
async function admin(text: string, params: unknown[] = []) {
  await db.exec("reset role");
  try { return await db.query(text, params); } finally { await db.exec("set local role fieldops_server"); }
}
async function create(index = 0) {
  signedIn(index);
  const response = await comparisons.POST(request("/api/comparisons", "POST", { name: `Buyer ${index + 1} private comparison`, ownerId: owners[1 - index], workspaceId: owners[1 - index] }));
  expect(response.status).toBe(201);
  return (await response.json()).comparison as Comparison;
}
async function seedSource(c: Comparison) {
  const now = new Date().toISOString(), id = randomUUID();
  const d: DocumentRecord = { id, comparisonId: c.id, ownerId: c.workspaceId, filename: "synthetic-private.txt", contentType: "text/plain", contentHash: "c".repeat(64), size: 100, storagePath: `${c.workspaceId}/${id}`, createdAt: now, status: "uploaded", processingMode: "parse_only" };
  const r: RunRecord = { id: randomUUID(), comparisonId: c.id, documentId: d.id, ownerId: c.workspaceId, stage: "source_ready", processingMode: "parse_only", progress: 100, attempt: 1, fence: randomUUID(), inputRevision: c.revision, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: d.contentHash };
  const q = emptyQuotation(d.id, d.filename);
  await rpc("create_upload", [c.workspaceId, d, r, q, c.revision]);
  return { d, r, q };
}
async function error(response: Response, httpStatus: number, code: string) {
  expect(response.status).toBe(httpStatus); expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create schema neon_auth;
    create table neon_auth."user"(id uuid primary key,name text not null default '',email text not null default '',image text,banned boolean,"banExpires" timestamptz);
    create table neon_auth.account(id uuid primary key default gen_random_uuid(),"userId" uuid,"providerId" text,"accountId" text,"accessToken" text,"password" text);
    create table neon_auth.session(id uuid primary key default gen_random_uuid(),"userId" uuid,"expiresAt" timestamptz,"token" text);`);
  const migrationDirectory = join(process.cwd(), "neon", "migrations");
  for (const file of (await readdir(migrationDirectory)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(join(migrationDirectory, file), "utf8"));
  for (const [index, owner] of owners.entries()) {
    await db.query('insert into neon_auth."user"(id,name) values($1,$2)', [owner, `Persisted buyer ${index + 1}`]);
    await db.query('insert into neon_auth.account("userId","providerId","accountId") values($1,\'github\',$2)', [owner, `100${index + 1}`]);
    await db.query('insert into neon_auth.session(id,"userId","expiresAt") values($1,$2,now()+interval \'1 hour\')', [sessions[index], owner]);
  }
  await db.exec("insert into public.invited_accounts(github_user_id) values('1001'),('1002')");
}, 60000);
beforeEach(async () => {
  vi.stubEnv("FIELDOPS_UPLOADS_ENABLED", "true");
  for (const [key, value] of Object.entries({ FIELDOPS_LOCAL_MODE: "false", FIELDOPS_PROCESSING_MODE: "parse_only", FIELDOPS_DATABASE_URL: "postgresql://synthetic.invalid/fixture", FIELDOPS_SITE_URL: origin,
    NEON_AUTH_BASE_URL: "https://synthetic.neon.tech/auth", NEON_AUTH_COOKIE_SECRET: "synthetic-test-secret-at-least-32-characters", NEON_STORAGE_ENDPOINT: "https://synthetic-storage.example", NEON_STORAGE_ACCESS_KEY_ID: "synthetic", NEON_STORAGE_SECRET_ACCESS_KEY: "synthetic", NEON_STORAGE_REGION: "us-east-2", TRIGGER_SECRET_KEY: "synthetic", TRIGGER_PROJECT_ID: "synthetic", GROQ_FREE_TIER_CONFIRMED: "false", GROQ_ZDR_CONFIRMED: "false" })) vi.stubEnv(key, value);
  await db.exec("begin; set local role fieldops_server"); signedIn();
});
afterEach(async () => { await db.exec("rollback"); vi.clearAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await db?.close(); });

describe("private API route isolation against PostgreSQL", () => {
  it("pauses every cloud upload admission route without blocking saved reads, evidence or corrections", async () => {
    const c = await create(), { d, r, q } = await seedSource(c);
    const reservations = (await db.query("select * from processing_reservations")).rows;
    vi.stubEnv("FIELDOPS_UPLOADS_ENABLED", "false");
    const capabilities = await status.GET(request("/api/status"));
    expect(await capabilities.json()).toMatchObject({ canPersist: true, canUpload: false, canExtract: false });
    for (const call of [
      () => upload.POST(request("/api/comparisons/x/uploads", "POST", { text: "Synthetic paused upload" }), context(c.id)),
      () => initiate.POST(request("/api/comparisons/x/uploads/initiate", "POST", { filename: "synthetic.txt", size: 30, sha256: "b".repeat(64) }), context(c.id)),
      () => finalize.POST(request("/api/documents/x/finalize", "POST"), context(d.id)),
      () => retry.POST(request("/api/runs/x/retry", "POST"), context(r.id)),
    ]) {
      const response = await call(); expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "processing_unavailable", message: expect.stringContaining("temporarily paused") } });
    }
    expect(storageUploadIntent).not.toHaveBeenCalled(); expect(storageFinalizeUpload).not.toHaveBeenCalled();
    expect((await db.query("select * from processing_reservations")).rows).toEqual(reservations);
    expect((await db.query("select id from documents")).rows).toHaveLength(1);
    const read = await comparison.GET(request("/api/comparisons/x"), context(c.id));
    expect(read.status).toBe(200); expect((await read.json()).comparison.revision).toBe(1);
    expect((await source.GET(request("/api/documents/x/source"), context(d.id))).status).toBe(302);
    const corrected = await correction.POST(request("/api/comparisons/x/corrections", "POST", { baseRevision: 1, quotationId: q.id, path: "supplier.name", after: { state: "value", value: "Synthetic reviewed supplier" }, reason: "Synthetic paused-operation check" }), context(c.id));
    expect(corrected.status).toBe(200);
    expect((await corrected.json()).comparison).toMatchObject({ revision: 2, corrections: [expect.objectContaining({ author: owners[0] })] });
  });
  it("shows only the signed-in workspace capacity and job counts", async () => {
    const first = await create(0), second = await create(1);
    await seedSource(first); await seedSource(second);
    signedIn(0);
    const response = await workspaceStatus.GET(request(`/api/workspace/status?ownerId=${owners[1]}`));
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.capacity).toMatchObject({ comparisons: 1, documents: 1, bytes: 100, pendingDeletionDocuments: 0 });
    expect(value.jobs).toEqual({ active: 0, waitingQuota: 0, failed: 0 });
    expect(value).not.toHaveProperty("project");
    expect(JSON.stringify(value)).not.toContain(owners[1]);
    sdk.getSession.mockResolvedValue({ data: null, error: null });
    await error(await workspaceStatus.GET(request("/api/workspace/status")), 401, "sign_in_required");
    signedIn(2);
    await error(await workspaceStatus.GET(request("/api/workspace/status")), 403, "invite_required");
  });
  it("requires a signed session and an active persisted GitHub invitation before private reads or mutations", async () => {
    sdk.getSession.mockResolvedValue({ data: null, error: null });
    await error(await comparisons.GET(request("/api/comparisons")), 401, "sign_in_required");
    await error(await comparisons.POST(request("/api/comparisons", "POST", { name: "Spoofed", ownerId: owners[0] })), 401, "sign_in_required");
    await error(await source.GET(request("/api/documents/source"), context(randomUUID())), 401, "sign_in_required");
    signedIn(2);
    await error(await comparisons.GET(request("/api/comparisons")), 403, "invite_required");
    await error(await comparisons.POST(request("/api/comparisons", "POST", { name: "Uninvited" })), 403, "invite_required");
    expect((await db.query("select id from comparisons")).rows).toEqual([]);
    expect(storageSourceUrl).not.toHaveBeenCalled(); expect(storageUploadIntent).not.toHaveBeenCalled();
  });

  it("keeps two owners' lists and persisted snapshots separate and ignores client-supplied ownership", async () => {
    const first = await create(0), second = await create(1);
    expect(first.workspaceId).toBe(owners[0]); expect(second.workspaceId).toBe(owners[1]);
    for (const [index, own, other] of [[0, first, second], [1, second, first]] as const) {
      signedIn(index);
      const list = await comparisons.GET(request("/api/comparisons"));
      expect(list.headers.get("cache-control")).toBe("no-store");
      expect((await list.json()).comparisons.map((c: Comparison) => c.id)).toEqual([own.id]);
      await error(await comparison.GET(request(`/api/comparisons/${other.id}`), context(other.id)), 404, "not_found");
      const read = await comparison.GET(request(`/api/comparisons/${own.id}`), context(own.id));
      expect((await read.json()).comparison.name).toBe(own.name);
    }
  });

  it("blocks cross-owner edits, deletion, corrections, upload tickets, finalization, run access and source signing", async () => {
    const first = await create(0), { d, r, q } = await seedSource(first); signedIn(1);
    const checks: [() => Promise<Response>, string][] = [
      [() => comparison.PATCH(request("/api/comparisons/x", "PATCH", { baseRevision: 1, name: "Stolen" }), context(first.id)), "patch"],
      [() => comparison.DELETE(request("/api/comparisons/x", "DELETE"), context(first.id)), "delete comparison"],
      [() => correction.POST(request("/api/comparisons/x/corrections", "POST", { baseRevision: 1, quotationId: q.id, path: "supplier.name", after: { state: "value", value: "Stolen" }, reason: "Synthetic test" }), context(first.id)), "correction"],
      [() => initiate.POST(request("/api/comparisons/x/uploads/initiate", "POST", { filename: "quote.txt", size: 100, sha256: "a".repeat(64) }), context(first.id)), "upload"],
      [() => source.GET(request("/api/documents/x/source"), context(d.id)), "source"],
      [() => document.DELETE(request("/api/documents/x", "DELETE", { baseRevision: 1 }), context(d.id)), "delete source"],
      [() => finalize.POST(request("/api/documents/x/finalize", "POST"), context(d.id)), "finalize"],
      [() => run.GET(request("/api/runs/x"), context(r.id)), "run"],
      [() => cancel.POST(request("/api/runs/x/cancel", "POST"), context(r.id)), "cancel"],
    ];
    for (const [handler, label] of checks) { const response = await handler(); expect(response.status, label).toBe(404); expect((await response.json()).error.code).toBe("not_found"); }
    expect(storageSourceUrl).not.toHaveBeenCalled(); expect(storageUploadIntent).not.toHaveBeenCalled(); expect(storageFinalizeUpload).not.toHaveBeenCalled(); expect(storageDelete).not.toHaveBeenCalled();
    signedIn(); const read = await comparison.GET(request("/api/comparisons/x"), context(first.id));
    expect((await read.json()).comparison).toMatchObject({ name: first.name, revision: 1 });
  });

  it("rechecks revocation, expiry, provider identity and bans even while the SDK returns its cached session", async () => {
    expect((await comparisons.GET(request("/api/comparisons"))).status).toBe(200);
    await admin("update invited_accounts set active=false where github_user_id='1001'");
    await error(await comparisons.GET(request("/api/comparisons")), 403, "invite_required");
    await admin("update invited_accounts set active=true where github_user_id='1001'");
    await admin('update neon_auth.account set "providerId"=\'google\' where "userId"=$1', [owners[0]]);
    await error(await comparisons.GET(request("/api/comparisons")), 403, "invite_required");
    await admin('update neon_auth.account set "providerId"=\'github\' where "userId"=$1', [owners[0]]);
    await admin('update neon_auth."user" set banned=true where id=$1', [owners[0]]);
    await error(await comparisons.GET(request("/api/comparisons")), 401, "sign_in_required");
    await admin('update neon_auth."user" set banned=false where id=$1', [owners[0]]);
    await admin('update neon_auth.session set "expiresAt"=now()-interval \'1 second\' where id=$1', [sessions[0]]);
    await error(await comparisons.GET(request("/api/comparisons")), 401, "sign_in_required");
    // Session ID and user ID must match, not merely exist independently.
    sdk.getSession.mockResolvedValue({ data: { user: { id: owners[0] }, session: { id: sessions[1] } }, error: null });
    await error(await comparisons.GET(request("/api/comparisons")), 401, "sign_in_required");
  });

  it("rejects stale and malformed mutations without losing the current revision", async () => {
    const c = await create();
    expect((await comparison.PATCH(request("/api/comparisons/x", "PATCH", { baseRevision: 0, name: "Current edit" }), context(c.id))).status).toBe(200);
    await error(await comparison.PATCH(request("/api/comparisons/x", "PATCH", { baseRevision: 0, name: "Outdated edit" }), context(c.id)), 409, "stale_revision");
    await error(await comparison.PATCH(new Request(`${origin}/api/comparisons/x`, { method: "PATCH", headers: { origin }, body: "{broken" }), context(c.id)), 400, "invalid_json");
    await error(await comparison.GET(request("/api/comparisons/not-an-id"), context("not-an-id")), 400, "invalid_input");
    const { d, q } = await seedSource({ ...c, revision: 1 });
    await error(await items.POST(request("/api/comparisons/x/items", "POST", { baseRevision: 2, quotationId: q.id, reason: "Synthetic check", item: { description: "Manual line", quantity: "1", unit: "ea", unitPrice: "2", currency: "USD", kind: "goods", sourceIds: ["foreign-source"] } }), context(c.id)), 400, "invalid_source");
    await error(await document.DELETE(request("/api/documents/x", "DELETE", { baseRevision: 0 }), context(d.id)), 409, "stale_revision");
    const read = await comparison.GET(request("/api/comparisons/x"), context(c.id));
    expect((await read.json()).comparison).toMatchObject({ name: "Current edit", revision: 2 });
  });

  it("rejects cross-origin writes before session lookup and keeps owned source redirects private", async () => {
    const c = await create(), { d, r } = await seedSource(c); sdk.getSession.mockClear();
    for (const headers of [{ origin: "https://attacker.example" }, { origin, "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      await error(await comparison.PATCH(request("/api/comparisons/x", "PATCH", { baseRevision: 1, name: "CSRF" }, headers), context(c.id)), 403, "cross_origin");
    }
    expect(sdk.getSession).not.toHaveBeenCalled();
    const response = await source.GET(request("/api/documents/x/source"), context(d.id));
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("https://synthetic-storage.example/private?ticket=synthetic");
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(storageSourceUrl).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerId: owners[0], id: d.id }));
    const capabilities = await status.GET(request("/api/status"));
    expect(await capabilities.json()).toMatchObject({ mode: "cloud", authenticated: true, user: { id: owners[0], name: "Persisted buyer 1" } });
    expect((await comparison.DELETE(request("/api/comparisons/x", "DELETE"), context(c.id))).status).toBe(204);
    await error(await source.GET(request("/api/documents/x/source"), context(d.id)), 404, "not_found");
    await error(await run.GET(request("/api/runs/x"), context(r.id)), 404, "not_found");
    expect(storageSourceUrl).toHaveBeenCalledTimes(1);
  });
});
