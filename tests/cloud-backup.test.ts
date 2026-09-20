import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createCloudBackup, snapshotSQL, type CloudBackupSnapshot, type CloudBackupTransport } from "../scripts/cloud-backup";
import { incompleteMarker, restoreBackup, verifyBackup } from "../scripts/personal-tools";
import { LocalRepository } from "@/lib/server/local-repository";
import { emptyItem, emptyQuotation, field, type Comparison } from "@/lib/domain/types";
import type { DocumentRecord, RunRecord } from "@/lib/server/contracts";

let temporary: string;
const owner = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
beforeEach(async () => { temporary = await mkdtemp(join(tmpdir(), "fieldops-cloud-backup-test-")); });
afterEach(async () => {
  const checked = resolve(temporary);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("fieldops-cloud-backup-test-")) throw new Error("Refusing cleanup outside the synthetic test directory.");
  await rm(checked, { recursive: true, force: true });
});
function fixture() {
  const now = new Date().toISOString(), id = randomUUID(), comparisonId = randomUUID();
  const bytes = Buffer.from("Synthetic desk service\nQuantity 2 hours. USD 40 per hour.\n");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const document: DocumentRecord = { id, comparisonId, ownerId: owner, storagePath: `${owner}/${id}`, filename: "synthetic.txt", contentType: "text/plain", size: bytes.length, contentHash: hash, createdAt: now, status: "uploaded", processingMode: "parse_only" };
  const source = { id: `${id}:text:1`, documentId: id, kind: "text" as const, text: bytes.toString(), start: 0, end: bytes.length };
  const q = emptyQuotation(id, document.filename); q.sources = [source]; q.status = "ready"; q.extractionVersion = 1;
  q.supplier.name = field("Synthetic desk service", [source.id]);
  const item = emptyItem(randomUUID()); item.description = field("Desk service", [source.id]); item.quantity = field("2", [source.id]); item.unitPrice = field("40", [source.id]); item.unit = field("hour", [source.id]); item.currency = field("USD", [source.id]); q.items = [item];
  const c: Comparison = { id: comparisonId, workspaceId: owner, name: "Synthetic cloud recovery", description: "", createdAt: now, updatedAt: now, revision: 3, isDemo: false, quotations: [q], groups: [], exchangeRates: [], preferences: { priority: "cost", notes: "" },
    corrections: [{ id: randomUUID(), quotationId: q.id, path: `items.${item.id}.quantity`, before: field("1", [source.id]), after: { ...field("2", [source.id]), origin: "user" }, author: owner, createdAt: now, reason: "Synthetic verified quantity", baseVersion: 2, operation: "edit" }] };
  const run: RunRecord = { id: randomUUID(), comparisonId, documentId: id, ownerId: owner, stage: "source_ready", processingMode: "parse_only", attempt: 1, progress: 100, fence: randomUUID(), inputRevision: 1, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: hash, taskRunId: "synthetic-cloud-task", dispatchedAt: now };
  const snapshot: CloudBackupSnapshot = { workspaceExists: true, comparisons: [c], documents: [document], runs: [run], extractions: [{ id: randomUUID(), documentId: id, version: 1, quotation: structuredClone(q), createdAt: now }],
    parsed: [{ documentId: id, record: { documentId: id, filename: document.filename, format: "text", contentHash: hash, originalText: bytes.toString(), sources: [source], manifest: { parserVersion: "synthetic-backup-test", complete: true, units: [], warnings: [] } } }],
    checkpoints: [{ documentId: id, key: "synthetic-checkpoint", result: { validated: true } }], comparisonVersions: [{ comparisonId, version: 3, snapshot: structuredClone(c), createdAt: now }] };
  const transport: CloudBackupTransport = { capture: vi.fn(async () => snapshot), readOriginal: vi.fn(async () => new Uint8Array(bytes)) };
  return { snapshot, transport, bytes, document, c, run, source };
}

describe("hosted workspace recovery backup", () => {
  it("restores captured originals, evidence, revisions, corrections, extraction history and checkpoints into an isolated local workspace", async () => {
    const f = fixture(), backup = join(temporary, "backup"), restored = join(temporary, "restored");
    const before = structuredClone(f.snapshot);
    const manifest = await createCloudBackup(owner, backup, f.transport); expect(manifest).toMatchObject({ comparisons: 1, documents: 1 });
    expect(f.transport.capture).toHaveBeenCalledTimes(2); expect(f.transport.readOriginal).toHaveBeenCalledExactlyOnceWith(f.document);
    expect(f.snapshot).toEqual(before); // Rebinding never mutates the captured cloud records.
    const verified = await verifyBackup(backup); expect(verified.state.deletionOutbox).toEqual([]);
    expect(Object.values(verified.state.extractions)[0].quotation.items).toEqual(f.snapshot.extractions[0].quotation.items);
    expect(verified.state.cloudRecoveryArchive).toMatchObject({ ownerId: owner, comparisonVersions: f.snapshot.comparisonVersions });
    await restoreBackup(backup, restored); const repository = new LocalRepository(restored);
    const local = await repository.get("local-user", f.c.id);
    expect(local).toMatchObject({ workspaceId: "local-workspace", revision: 3, corrections: f.c.corrections });
    expect(local.quotations[0].sources).toEqual([f.source]); expect(local.quotations[0].sourceUrl).toBe(`/api/documents/${f.document.id}/source`);
    const document = await repository.document("local-user", f.document.id); expect(document.storagePath).toBe(`local-user/${f.document.id}`);
    expect(await repository.readObject(document)).toEqual(new Uint8Array(f.bytes));
    expect((await repository.getParsed(document.id))?.sources).toEqual([f.source]);
    expect(await repository.getCheckpoint(document.id, "synthetic-checkpoint")).toEqual({ validated: true });
    expect((await repository.run("local-user", f.run.id)).taskRunId).toBeUndefined(); expect(await repository.pendingRuns()).toEqual([]);
    await expect(repository.get(owner, f.c.id)).rejects.toMatchObject({ code: "not_found" });
    local.name = "Recovered local edit"; await repository.save("local-user", local, 3);
    expect((await repository.get("local-user", f.c.id)).revision).toBe(4);
    await expect(restoreBackup(backup, restored)).rejects.toThrow("already exists");
  });

  it("refuses unfinished, active and quota-waiting work before reading private originals or creating a backup", async () => {
    for (const stage of ["uploading", "queued", "parsing", "waiting_quota"] as const) {
      const f = fixture(), destination = join(temporary, stage);
      if (stage === "uploading") f.snapshot.documents[0].status = "uploading"; else f.snapshot.runs[0].stage = stage;
      await expect(createCloudBackup(owner, destination, f.transport)).rejects.toThrow(/unfinished|active|quota/);
      expect(f.transport.readOriginal).not.toHaveBeenCalled(); await expect(readFile(join(destination, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("removes recovered historical source text from active state on source or comparison deletion while preserving the separate backup", async () => {
    for (const operation of ["document", "comparison"] as const) {
      const f = fixture(), backup = join(temporary, `${operation}-backup`), restored = join(temporary, `${operation}-restored`);
      await createCloudBackup(owner, backup, f.transport); const originalBackupState = await readFile(join(backup, "state.json"));
      await restoreBackup(backup, restored); const repository = new LocalRepository(restored);
      if (operation === "document") await repository.removeDocument("local-user", f.document.id, f.c.revision);
      else await repository.remove("local-user", f.c.id);
      const active = await readFile(join(restored, "state.json"), "utf8");
      expect(active).not.toContain(f.source.id); expect(active).not.toContain("Synthetic verified quantity");
      expect(JSON.parse(active).cloudRecoveryArchive).toBeUndefined();
      await expect(repository.document("local-user", f.document.id)).rejects.toMatchObject({ code: "not_found" });
      expect(await readFile(join(backup, "state.json"))).toEqual(originalBackupState);
      expect((await verifyBackup(backup)).manifest.documents).toBe(1);
    }
  });

  it("leaves an unrestorable incomplete backup when originals are corrupt or source records change during copying", async () => {
    for (const failure of ["hash", "changed", "missing"]) {
      const f = fixture(), destination = join(temporary, failure);
      if (failure === "hash") f.transport.readOriginal = async () => Buffer.from("Corrupt synthetic bytes");
      if (failure === "missing") f.transport.readOriginal = async () => { throw new Error("Synthetic missing object"); };
      if (failure === "changed") f.transport.readOriginal = async () => { f.snapshot.comparisons[0].revision++; return f.bytes; };
      await expect(createCloudBackup(owner, destination, f.transport)).rejects.toThrow();
      expect(await readFile(join(destination, incompleteMarker), "utf8")).toContain("Incomplete");
      await expect(verifyBackup(destination)).rejects.toThrow("incomplete");
    }
  });

  it("rejects cross-owner or invalid source records and never overwrites an existing destination", async () => {
    const absent = fixture(); absent.snapshot.workspaceExists = false;
    await expect(createCloudBackup(owner, join(temporary, "absent"), absent.transport)).rejects.toThrow("No hosted workspace");
    expect(absent.transport.readOriginal).not.toHaveBeenCalled();
    const f = fixture(); f.snapshot.documents[0].ownerId = other;
    await expect(createCloudBackup(owner, join(temporary, "foreign"), f.transport)).rejects.toThrow("owner");
    expect(f.transport.readOriginal).not.toHaveBeenCalled();
    const valid = fixture(), destination = join(temporary, "existing");
    await createCloudBackup(owner, destination, valid.transport); const before = await readFile(join(destination, "state.json"));
    await expect(createCloudBackup(owner, destination, valid.transport)).rejects.toThrow("already exists");
    expect(await readFile(join(destination, "state.json"))).toEqual(before);
    await writeFile(join(destination, "objects", "local-user", valid.document.id), "tampered");
    await expect(restoreBackup(destination, join(temporary, "bad-restore"))).rejects.toThrow("integrity");
  });

  it("captures one owner's real SQL snapshot under the restricted runtime role without Auth secrets or another workspace", async () => {
    const f = fixture(), db = new PGlite({ extensions: { pgcrypto } });
    try {
      await db.exec(`create schema neon_auth;
        create table neon_auth."user"(id uuid primary key,name text,email text,image text,banned boolean,"banExpires" timestamptz);
        create table neon_auth.account(id uuid primary key,"userId" uuid,"providerId" text,"accountId" text,"accessToken" text,password text);
        create table neon_auth.session(id uuid primary key,"userId" uuid,"expiresAt" timestamptz,token text);`);
      const directory = join(process.cwd(), "neon", "migrations");
      for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(join(directory, file), "utf8"));
      await db.query('insert into neon_auth."user"(id) values($1),($2)', [owner, other]);
      const otherComparison = { ...f.c, id: randomUUID(), workspaceId: other, name: "OTHER OWNER MUST NOT APPEAR", quotations: [], corrections: [] };
      for (const c of [f.c, otherComparison]) await db.query("select public.fieldops_create_comparison($1,$2)", [c.workspaceId, c]);
      await db.query("insert into documents(id,comparison_id,owner_id,content_hash,storage_path,record) values($1,$2,$3,$4,$5,$6)", [f.document.id, f.c.id, owner, f.document.contentHash, f.document.storagePath, f.document]);
      await db.query("insert into processing_runs(id,document_id,comparison_id,owner_id,record) values($1,$2,$3,$4,$5)", [f.run.id, f.document.id, f.c.id, owner, f.run]);
      await db.query("insert into parsed_documents(document_id,owner_id,record) values($1,$2,$3)", [f.document.id, owner, f.snapshot.parsed[0].record]);
      const e = f.snapshot.extractions[0]; await db.query("insert into extraction_versions(id,document_id,owner_id,version,quotation) values($1,$2,$3,$4,$5)", [e.id, e.documentId, owner, e.version, e.quotation]);
      const a = f.snapshot.checkpoints[0]; await db.query("insert into ai_checkpoints(document_id,owner_id,key,result) values($1,$2,$3,$4)", [a.documentId, owner, a.key, a.result]);
      await db.exec("set role fieldops_server");
      const captured = (await db.query<{ snapshot: CloudBackupSnapshot }>(snapshotSQL, [owner])).rows[0].snapshot;
      expect(captured.comparisons).toEqual([f.c]); expect(captured.documents).toEqual([f.document]); expect(captured.runs).toEqual([f.run]);
      expect(captured.parsed).toEqual(f.snapshot.parsed); expect(captured.checkpoints).toEqual(f.snapshot.checkpoints);
      expect(captured.extractions[0]).toMatchObject({ id: e.id, quotation: e.quotation }); expect(captured.comparisonVersions).toHaveLength(1);
      expect(JSON.stringify(captured)).not.toContain("OTHER OWNER MUST NOT APPEAR");
      await createCloudBackup(owner, join(temporary, "sql-backup"), { capture: async () => (await db.query<{ snapshot: CloudBackupSnapshot }>(snapshotSQL, [owner])).rows[0].snapshot, readOriginal: async () => f.bytes });
      expect((await verifyBackup(join(temporary, "sql-backup"))).manifest.documents).toBe(1);
    } finally { await db.close(); }
  }, 60000);
});
