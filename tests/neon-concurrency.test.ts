import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { emptyQuotation, type Comparison } from "@/lib/domain/types";
import type { DocumentRecord, RunRecord } from "@/lib/server/contracts";

// Opt in explicitly. Every psql call is a different real PostgreSQL connection.
// The sole new disposable container has no network and no published port; it never
// reads a provider URL, uses a credential, or touches an existing container/database.
// PowerShell: $env:FIELDOPS_TEST_DOCKER_POSTGRES='1'; npx vitest run tests/neon-concurrency.test.ts
const enabled = process.env.FIELDOPS_TEST_DOCKER_POSTGRES === "1";
const container = `fieldops-capacity-test-${randomUUID()}`;
const MiB = 1024 * 1024;
let started = false;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;

async function docker(args: string[], input?: string, timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Disposable PostgreSQL test command timed out.")); }, timeout);
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(stdout.trim()); else reject(Object.assign(new Error(stderr || `Docker exited ${code}`), { exitCode: code })); });
    child.stdin.end(input);
  });
}
// The official image starts a temporary socket-only server, then stops it before
// launching its final postmaster. Loopback TCP cannot accept that temporary server
// as ready. --network none still permits loopback inside this isolated container.
// https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh
const query = (sql: string) => docker(["exec", "-i", "-e", "PGCONNECT_TIMEOUT=1", container, "psql", "-X", "-w", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], sql);
async function waitForSleep(application: string) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await query(`select count(*) from pg_stat_activity where application_name=${literal(application)} and wait_event='PgSleep'`) === "1") return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error("The first test transaction never reached the intended concurrency barrier.");
}
function comparison(owner: string): Comparison {
  const now = new Date().toISOString();
  return { id: randomUUID(), workspaceId: owner, name: "Concurrent synthetic", description: "", createdAt: now, updatedAt: now, revision: 0, isDemo: false, quotations: [], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } };
}
function document(c: Comparison, size: number): DocumentRecord {
  const id = randomUUID();
  return { id, comparisonId: c.id, ownerId: c.workspaceId, filename: "synthetic.txt", contentType: "text/plain", contentHash: "a".repeat(64), size, storagePath: `${c.workspaceId}/${id}`, status: "uploading", createdAt: new Date().toISOString(), processingMode: "parse_only" };
}
function run(d: DocumentRecord): RunRecord {
  return { id: randomUUID(), comparisonId: d.comparisonId, documentId: d.id, ownerId: d.ownerId, processingMode: "parse_only", stage: "queued", progress: 0, attempt: 0, fence: randomUUID(), inputRevision: 1, cancelRequested: false, createdAt: d.createdAt, updatedAt: d.createdAt, extractionVersion: 1, expectedHash: d.contentHash };
}
const createSql = (c: Comparison) => `select public.fieldops_create_comparison(${literal(c.workspaceId)},${json(c)});`;
const admitSql = (d: DocumentRecord, revision = 0) => `select public.fieldops_create_upload(${literal(d.ownerId)},${json(d)},null,${json(emptyQuotation(d.id, d.filename))},${revision});`;
const finalizeSql = (d: DocumentRecord) => `select public.fieldops_finalize_upload(${literal(d.ownerId)},${literal(d.id)},${literal(d.contentHash)},${json(run(d))});`;
async function owner() { const id = randomUUID(); await query(`insert into neon_auth."user"(id) values(${literal(id)})`); return id; }
async function seedBytes(owner: string, bytes: number) {
  const c = comparison(owner); let sql = createSql(c), revision = 0;
  while (bytes > 0) { const size = Math.min(bytes, 20 * MiB); sql += admitSql(document(c, size), revision++); bytes -= size; }
  await query(sql);
}

describe.runIf(enabled)("real PostgreSQL17 independent-session capacity races", () => {
  beforeAll(async () => {
    await docker(["run", "--detach", "--rm", "--network", "none", "--name", container, "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"], undefined, 90000);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if (await query("select 1") === "1") { ready = true; break; } }
      catch (error) {
        // psql exit2 is connection failure. SQL errors (exit3), Docker errors and
        // command timeouts fail immediately instead of being hidden by a retry.
        if ((error as { exitCode?: number }).exitCode !== 2) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Disposable PostgreSQL did not start.");
    expect(await query("select host(inet_server_addr())")).toBe("127.0.0.1");
    await query(`create schema neon_auth;
      create table neon_auth."user"(id uuid primary key,name text,email text,image text,banned boolean,"banExpires" timestamptz);
      create table neon_auth.account(id uuid,"userId" uuid,"providerId" text,"accountId" text);
      create table neon_auth.session(id uuid,"userId" uuid,"expiresAt" timestamptz);`);
    const directory = join(process.cwd(), "neon", "migrations");
    for (const filename of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) await query(`begin; ${await readFile(join(directory, filename), "utf8")} commit;`);
    const version = await query("show server_version");
    expect(version).toMatch(/^17\./);
    console.info(`Disposable PostgreSQL version: ${version}`);
  }, 120000);
  beforeEach(async () => {
    await query('truncate public.workspaces,public.deletion_outbox,public.processing_budget,public.processing_reservations cascade; delete from neon_auth."user";');
  });
  afterAll(async () => {
    if (started) await docker(["rm", "--force", container]);
  }, 30000);

  it("admits exactly one of two concurrent uploads into the last workspace bytes", async () => {
    const id = await owner(); await seedBytes(id, 100 * MiB - 100);
    const first = comparison(id), second = comparison(id); await query(createSql(first) + createSql(second));
    const a = document(first, 100), b = document(second, 100);
    const pending = query(`set application_name='fieldops-first'; begin; ${admitSql(a)} select pg_sleep(2); commit;`);
    await waitForSleep("fieldops-first");
    const rejected = expect(query(admitSql(b))).rejects.toThrow("workspace_storage_limit");
    await Promise.all([pending, rejected]);
    const usage = JSON.parse(await query(`select public.fieldops_capacity(${literal(id)})`));
    expect(usage.workspace).toMatchObject({ documents: 6, bytes: 100 * MiB });
    expect(await query(`select count(*) from documents where id=${literal(b.id)}`)).toBe("0");
    expect(await query("select count(*) from processing_reservations")).toBe("0");
  });

  it("serializes different owners at the last shared-project bytes", async () => {
    const ids = await Promise.all([owner(), owner(), owner(), owner()]);
    await seedBytes(ids[0], 100 * MiB); await seedBytes(ids[1], 100 * MiB); await seedBytes(ids[2], 50 * MiB - 100);
    const first = comparison(ids[2]), second = comparison(ids[3]); await query(createSql(first) + createSql(second));
    const a = document(first, 100), b = document(second, 100);
    const pending = query(`set application_name='fieldops-project'; begin; ${admitSql(a)} select pg_sleep(2); commit;`);
    await waitForSleep("fieldops-project");
    await Promise.all([pending, expect(query(admitSql(b))).rejects.toThrow("project_capacity")]);
    const usage = JSON.parse(await query(`select public.fieldops_capacity(${literal(ids[3])})`));
    expect(usage.project.bytes).toBe(250 * MiB); expect(usage.workspace.documents).toBe(0);
    expect(await query(`select count(*) from documents where id=${literal(b.id)}`)).toBe("0");
  });

  it("preserves a finalized source while expiry skips its active comparison lock", async () => {
    const id = await owner(), c = comparison(id), d = document(c, 100); await query(createSql(c) + admitSql(d));
    const abandoned = document(c, 100); await query(admitSql(abandoned, 1));
    await query(`update documents set created_at=now()-interval '25 hours' where id=${literal(abandoned.id)}`);
    const pending = query(`set application_name='fieldops-finalize'; begin; ${finalizeSql(d)} update documents set created_at=now()-interval '25 hours' where id=${literal(d.id)}; select pg_sleep(2); commit;`);
    await waitForSleep("fieldops-finalize");
    expect(await query("select public.fieldops_expire_uploads()" )).toBe("0");
    await pending;
    expect(await query("select public.fieldops_expire_uploads()" )).toBe("1");
    expect(await query("select public.fieldops_expire_uploads()" )).toBe("0");
    expect(await query(`select record->>'status' from documents where id=${literal(d.id)}`)).toBe("uploaded");
    expect(await query("select count(*) from processing_runs")).toBe("1");
    expect(await query("select count(*) from deletion_outbox")).toBe("1");
  });

  it("fences finalization that was waiting while expiry deletes its tracked source", async () => {
    const id = await owner(), c = comparison(id), d = document(c, 100); await query(createSql(c) + admitSql(d));
    await query(`update documents set created_at=now()-interval '25 hours' where id=${literal(d.id)}`);
    const pending = query("set application_name='fieldops-expire'; begin; select public.fieldops_expire_uploads(); select pg_sleep(2); commit;");
    await waitForSleep("fieldops-expire");
    await Promise.all([pending, expect(query(finalizeSql(d))).rejects.toThrow("not_found")]);
    expect(await query("select count(*) from documents")).toBe("0");
    expect(await query("select count(*) from processing_runs")).toBe("0");
    expect(await query("select count(*) from processing_reservations")).toBe("0");
    expect(await query("select count(*) from deletion_outbox where size_bytes=100 and created_at>now()-interval '1 minute'")).toBe("1");
  });

  it("expires 25 of 30 intents without skipping siblings after revision changes", async () => {
    const id = await owner(); let sql = "";
    for (let batch = 0; batch < 6; batch++) {
      const c = comparison(id); sql += createSql(c);
      for (let revision = 0; revision < 5; revision++) sql += admitSql(document(c, 100), revision);
    }
    await query(sql + "update documents set created_at=now()-interval '25 hours';");
    expect(await query("select public.fieldops_expire_uploads()" )).toBe("25");
    expect(await query("select count(*) from documents")).toBe("5");
    expect(await query("select public.fieldops_expire_uploads()" )).toBe("5");
    expect(await query("select count(*) from deletion_outbox where size_bytes=100")).toBe("30");
  });

  it("cascades managed-user data while retaining private-object and compute reservations", async () => {
    const id = await owner(), c = comparison(id), d = document(c, 100); await query(createSql(c) + admitSql(d) + finalizeSql(d));
    // Actual managed-owner FKs, including the two redundant derived-data references.
    await query(`insert into parsed_documents(document_id,owner_id,record) values(${literal(d.id)},${literal(id)},'{}');
      insert into extraction_versions(id,document_id,owner_id,version,quotation) values(${literal(d.id)},${literal(d.id)},${literal(id)},1,'{}');
      insert into quotation_items(id,extraction_id,owner_id,kind,fields) values('synthetic-item',${literal(d.id)},${literal(id)},'goods','{}');
      delete from neon_auth."user" where id=${literal(id)};`);
    for (const table of ["documents", "comparisons", "parsed_documents", "extraction_versions", "quotation_items", "processing_runs"]) expect(await query(`select count(*) from public.${table}`)).toBe("0");
    expect(await query("select count(*) from deletion_outbox where size_bytes=100")).toBe("1");
    expect(await query("select count(*) from processing_reservations")).toBe("1");
  });
});
