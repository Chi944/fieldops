import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { LocalRepository } from "../src/lib/server/local-repository";
import { emptyQuotation, field, type Comparison } from "../src/lib/domain/types";
import type { DocumentRecord, RunRecord } from "../src/lib/server/contracts";
import { acquireSession, availablePort, createBackup, incompleteMarker, personalAIEnvironment, personalDirectory, privateChildEnvironment, projectRoot, restoreBackup, verifyBackup } from "../scripts/personal-tools";

let temporary: string;
beforeEach(async () => { temporary = await mkdtemp(join(tmpdir(), "fieldops-personal-test-")); });
afterEach(async () => { const checked = resolve(temporary); if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("fieldops-personal-test-")) throw new Error("Refusing test cleanup outside its temporary directory."); await rm(checked, { recursive: true, force: true }); });

async function fixture() {
  const source = join(temporary, "synthetic-workspace"), repository = new LocalRepository(source), now = new Date().toISOString();
  const comparison: Comparison = { id: randomUUID(), workspaceId: "local-workspace", name: "Synthetic recovery test", description: "Self-created test data", createdAt: now, updatedAt: now, revision: 0, isDemo: false, quotations: [], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } };
  const bytes = Buffer.from("Synthetic supplier\nDesk service, 2 hours, USD 40 per hour\n");
  const id = randomUUID();
  const document: DocumentRecord = { id, comparisonId: comparison.id, ownerId: "local-user", filename: "synthetic.txt", contentType: "text/plain", contentHash: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, storagePath: `local-user/${id}`, createdAt: now, status: "uploaded" };
  const quotation = emptyQuotation(id, document.filename); quotation.status = "partial"; quotation.supplier.name = field("Synthetic supplier", []);
  const run: RunRecord = { id: randomUUID(), documentId: id, comparisonId: comparison.id, ownerId: "local-user", processingMode: "parse_only", stage: "parsing", progress: 35, attempt: 1, fence: randomUUID(), inputRevision: 0, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: document.contentHash };
  await repository.create("local-user", comparison); await repository.writeObject(document, bytes); await repository.createUpload("local-user", document, run, quotation, 0);
  await repository.saveParsed(run, { documentId: id, filename: document.filename, format: "text", contentHash: document.contentHash, originalText: bytes.toString(), sources: [{ id: `${id}:text:1`, documentId: id, kind: "text", start: 0, end: 18, text: "Synthetic supplier" }], manifest: { parserVersion: "synthetic-test-1", complete: true, units: [], warnings: [] } });
  await repository.saveCheckpoint(run, "synthetic-checkpoint", { testValue: true });
  run.stage = "failed"; run.errorCode = "ai_unavailable";
  expect(await repository.saveRun(run, run.fence)).toBe(true);
  const saved = await repository.get("local-user", comparison.id);
  const correctionId = randomUUID(); saved.corrections.push({ id: correctionId, quotationId: id, path: "supplier.name", before: field("Synthetic supplier", []), after: { ...field("Reviewed synthetic supplier", []), origin: "user" }, reason: "Synthetic preservation test", author: "local-user", createdAt: now, baseVersion: 1, operation: "edit" });
  await repository.save("local-user", saved, 1);
  // Unreferenced files and credentials must never enter the backup.
  await writeFile(join(source, ".env.local"), "SYNTHETIC_SECRET=DO_NOT_COPY");
  await writeFile(join(source, "unreferenced.txt"), "not part of saved state");
  return { source, repository, comparison, document, bytes, run, correctionId };
}

describe("personal backup and restore", () => {
  it("round-trips originals, correction history, parsed evidence, jobs and checkpoints through the real repository", async () => {
    const data = await fixture(), backup = join(temporary, "backup"), restored = join(temporary, "restored");
    const originalState = await readFile(join(data.source, "state.json"));
    const manifest = await createBackup(data.source, backup); expect(manifest.documents).toBe(1); expect(manifest.comparisons).toBe(1);
    expect((await readdir(backup)).sort()).toEqual(["manifest.json", "objects", "state.json"]);
    await verifyBackup(backup); await restoreBackup(backup, restored);
    expect(await readFile(join(restored, "state.json"))).toEqual(originalState);
    const repository = new LocalRepository(restored);
    expect((await repository.get("local-user", data.comparison.id)).corrections[0].id).toBe(data.correctionId);
    expect(await repository.readObject(data.document)).toEqual(new Uint8Array(data.bytes));
    expect((await repository.getParsed(data.document.id))?.sources[0].text).toBe("Synthetic supplier");
    expect(await repository.getCheckpoint(data.document.id, "synthetic-checkpoint")).toEqual({ testValue: true });
    expect((await repository.run("local-user", data.run.id)).errorCode).toBe("ai_unavailable");
    expect(await readFile(join(data.source, "state.json"))).toEqual(originalState);
    await expect(repository.get("different-user", data.comparison.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses existing destinations and detects changed originals before publishing a restore", async () => {
    const { source, document } = await fixture(), backup = join(temporary, "backup"); await createBackup(source, backup);
    await expect(createBackup(source, backup)).rejects.toThrow("already exists");
    await expect(restoreBackup(backup, source)).rejects.toThrow("already exists");
    await writeFile(join(backup, "objects", document.storagePath), "modified bytes");
    const target = join(temporary, "must-not-exist"); await expect(restoreBackup(backup, target)).rejects.toThrow("integrity");
    await expect(readFile(join(target, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects path traversal and does not copy files outside the manifest's allowed paths", async () => {
    const { source } = await fixture(), backup = join(temporary, "backup"); await createBackup(source, backup);
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8")); manifest.files[1].path = "../outside.txt"; await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
    await expect(restoreBackup(backup, join(temporary, "restored"))).rejects.toThrow("invalid or duplicate");
    await expect(createBackup(source, join(source, "nested-backup"))).rejects.toThrow("separate");
  });

  it("fails safely when an original is missing and leaves an incomplete marker", async () => {
    const { source, document } = await fixture(); await rm(join(source, "objects", document.storagePath));
    const backup = join(temporary, "incomplete-backup"); await expect(createBackup(source, backup)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(backup, incompleteMarker), "utf8")).toContain("Incomplete");
    await expect(verifyBackup(backup)).rejects.toThrow("incomplete");
  });

  it("blocks backup while a personal session owns the workspace and releases its own locks", async () => {
    const { source } = await fixture(); const release = await acquireSession(source, 3001);
    try { await expect(createBackup(source, join(temporary, "backup"))).rejects.toThrow("in use"); } finally { await release(); }
    await createBackup(source, join(temporary, "backup"));
    expect(await readdir(source)).not.toContain("state.lock"); expect(await readdir(source)).not.toContain("personal-session.lock");
  });

  it("rejects symlinked object directories instead of reading an external original", async () => {
    const { source, document, bytes } = await fixture(); const backup = join(temporary, "backup"); await createBackup(source, backup);
    const ownerDirectory = join(backup, "objects", "local-user"); await rm(ownerDirectory, { recursive: true });
    const external = join(temporary, "external"); await mkdir(external); await writeFile(join(external, document.id), bytes);
    await symlink(external, ownerDirectory, process.platform === "win32" ? "junction" : "dir");
    await expect(verifyBackup(backup)).rejects.toThrow("symbolic links");
  });
});

describe("personal launcher boundaries", () => {
  it("imports only explicit AI settings while retaining local storage and cleared cloud credentials", () => {
    const base = privateChildEnvironment(join(temporary, "personal"), { NODE_ENV: "test" });
    const env = personalAIEnvironment(base, 'GROQ_API_KEY="synthetic-only"\nGROQ_FREE_TIER_CONFIRMED=true\nGROQ_ZDR_CONFIRMED=true\nFIELDOPS_DATABASE_URL=must-not-import\nFIELDOPS_LOCAL_MODE=false\nTRIGGER_SECRET_KEY=must-not-import');
    expect(env).toMatchObject({ GROQ_API_KEY: "synthetic-only", FIELDOPS_PROCESSING_MODE: "ai", FIELDOPS_LOCAL_MODE: "true", FIELDOPS_DATABASE_URL: "", TRIGGER_SECRET_KEY: "", GROQ_MODEL: "openai/gpt-oss-120b" });
    expect(env.FIELDOPS_DATA_DIR).toBe(base.FIELDOPS_DATA_DIR);
  });
  it("refuses incomplete AI confirmation and unsupported models without exposing the key", () => {
    const base = privateChildEnvironment(join(temporary, "personal"), { NODE_ENV: "test" });
    for (const settings of ['GROQ_API_KEY=synthetic-only', 'GROQ_API_KEY=synthetic-only\nGROQ_FREE_TIER_CONFIRMED=true\nGROQ_ZDR_CONFIRMED=false', 'GROQ_API_KEY=synthetic-only\nGROQ_FREE_TIER_CONFIRMED=true\nGROQ_ZDR_CONFIRMED=true\nGROQ_MODEL=unsupported']) {
      expect(() => personalAIEnvironment(base, settings)).toThrow();
      try { personalAIEnvironment(base, settings); } catch (error) { expect(String(error)).not.toContain("synthetic-only"); }
    }
  });
  it("forces local storage and disabled AI despite inherited model/cloud settings", () => {
    const env = privateChildEnvironment(join(temporary, "personal"), { NODE_ENV: "production", GROQ_API_KEY: "synthetic-key", GROQ_FREE_TIER_CONFIRMED: "true", GROQ_ZDR_CONFIRMED: "true", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", DATABASE_URL: "synthetic-admin", FIELDOPS_DATABASE_URL: "synthetic-runtime", NEON_AUTH_COOKIE_SECRET: "synthetic-cookie", NEON_STORAGE_SECRET_ACCESS_KEY: "synthetic-storage", VERCEL: "1", FIELDOPS_DATA_DIR: ".fieldops/e2e-storage" });
    expect(env.FIELDOPS_LOCAL_MODE).toBe("true"); expect(env.FIELDOPS_DATA_DIR).toBe(join(temporary, "personal"));
    expect(env.GROQ_API_KEY).toBe(""); expect(env.GROQ_FREE_TIER_CONFIRMED).toBe("false"); expect(env.GROQ_ZDR_CONFIRMED).toBe("false"); expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(""); expect(env.VERCEL).toBe("");
    expect(env.DATABASE_URL).toBe(""); expect(env.FIELDOPS_DATABASE_URL).toBe(""); expect(env.NEON_AUTH_COOKIE_SECRET).toBe(""); expect(env.NEON_STORAGE_SECRET_ACCESS_KEY).toBe("");
    expect(personalDirectory).toBe(join(projectRoot, ".fieldops", "personal"));
  });
  it("refuses port 3000 and ports outside the dedicated loopback range without probing them", async () => {
    for (const port of [3000, 80, 3010, -1, NaN]) await expect(availablePort(port)).rejects.toThrow("3001 to 3009");
  });
});
