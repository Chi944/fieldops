import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { LocalRepository } from "@/lib/server/local-repository";
import { configuration, checkRequestBoundary } from "@/lib/server/config";
import { createComparison, upload, addItem, correctField, proposeGroups, source, acknowledgeIssue } from "@/lib/server/service";
import { stopLocalRunner, hydrateComparison, executeRun } from "@/lib/server/jobs";
import { emptyQuotation, field, type Comparison, type ProcessingMode } from "@/lib/domain/types";
import { parseDocument } from "@/lib/processing";
import type { DocumentRecord, RunRecord } from "@/lib/server/contracts";

let directory: string; let repository: LocalRepository;
const request = (data?: unknown) => new Request("http://127.0.0.1:3000/api/test", { method: data ? "POST" : "GET", ...(data ? { body: JSON.stringify(data), headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" } } : {}) });
function comparison(owner = "local-user"): Comparison { const now = new Date().toISOString(); return { id: randomUUID(), workspaceId: owner === "local-user" ? "local-workspace" : owner, name: "Test comparison", description: "", createdAt: now, updatedAt: now, revision: 0, isDemo: false, quotations: [], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } }; }
async function seeded(owner = "local-user", processingMode: ProcessingMode = "ai") {
  const c = comparison(owner); await repository.create(owner, c); const bytes = new TextEncoder().encode("Acme Supplies\nQuotation Q-1\nPaper | 2 each | USD 12.50");
  const d: DocumentRecord = { id: randomUUID(), comparisonId: c.id, ownerId: owner, processingMode, filename: "quote.txt", contentType: "text/plain", contentHash: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength, storagePath: "", createdAt: c.createdAt, status: "uploaded" }; d.storagePath = `${owner}/${d.id}`;
  const run: RunRecord = { id: randomUUID(), comparisonId: c.id, documentId: d.id, ownerId: owner, processingMode, stage: "queued", progress: 0, attempt: 0, fence: randomUUID(), inputRevision: 0, cancelRequested: false, createdAt: c.createdAt, updatedAt: c.createdAt, extractionVersion: 1, expectedHash: d.contentHash };
  await repository.writeObject(d, bytes); await repository.createUpload(owner, d, run, emptyQuotation(d.id, d.filename), 0); return { c, d, run };
}
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "fieldops-server-")); repository = new LocalRepository(directory); vi.stubEnv("FIELDOPS_LOCAL_MODE", "true"); vi.stubEnv("FIELDOPS_DATA_DIR", directory); vi.stubEnv("GROQ_API_KEY", ""); vi.stubEnv("VERCEL", ""); vi.stubEnv("RENDER", ""); });
afterEach(async () => { stopLocalRunner(directory); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("private local persistence and durable processing", () => {
  it("enforces atomic optimistic concurrency and survives a new repository instance", async () => {
    const c = comparison(); await repository.create("local-user", c);
    const results = await Promise.allSettled([repository.save("local-user", { ...c, name: "First" }, 0), repository.save("local-user", { ...c, name: "Second" }, 0)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const loaded = await new LocalRepository(directory).get("local-user", c.id); expect(loaded.revision).toBe(1); expect(["First", "Second"]).toContain(loaded.name);
  });
  it("hides another owner's comparison, runs and original bytes", async () => {
    const { c, d, run } = await seeded("owner-one");
    await expect(repository.get("owner-two", c.id)).rejects.toMatchObject({ status: 404 });
    await expect(repository.document("owner-two", d.id)).rejects.toMatchObject({ status: 404 });
    await expect(repository.run("owner-two", run.id)).rejects.toMatchObject({ status: 404 });
    await expect(repository.remove("owner-two", c.id)).rejects.toMatchObject({ status: 404 });
    expect(await repository.list("owner-two")).toEqual([]); expect((await repository.readObject(d)).byteLength).toBe(d.size);
  });
  it("rejects a late result after cancellation and issues a new fence for an explicit retry", async () => {
    const { d, run } = await seeded(); const claimed = (await repository.claimRun(run.id, "old-fence", new Date(Date.now() + 30000).toISOString()))!;
    await repository.saveRun({ ...claimed, cancelRequested: true, stage: "cancelled" }, claimed.fence);
    const result = { ...emptyQuotation(d.id, d.filename), extractionVersion: 1, status: "ready" as const };
    expect(await repository.complete(claimed, result)).toBe(false);
    const retried = await repository.retryRun("local-user", run.id); expect(retried.fence).not.toBe(claimed.fence); expect(retried.cancelRequested).toBe(false);
    expect(await repository.complete(claimed, result)).toBe(false);
    expect(await repository.saveRun({ ...claimed, stage: "ready" }, claimed.fence)).toBe(false);
  });
  it("recovers an expired lease and prevents the interrupted worker overwriting its replacement", async () => {
    const { d, run } = await seeded(); const first = (await repository.claimRun(run.id, "first", new Date(Date.now() - 1000).toISOString()))!;
    expect((await repository.pendingRuns()).map((r) => r.id)).toContain(run.id);
    const next = (await repository.claimRun(run.id, "second", new Date(Date.now() + 30000).toISOString()))!; expect(next.attempt).toBe(2);
    expect(await repository.complete(first, { ...emptyQuotation(d.id, d.filename), extractionVersion: 1, status: "ready" })).toBe(false);
    expect(await repository.renewLease(run.id, "first", new Date().toISOString())).toBe(false);
  });
  it("resumes a due quota wait without consuming an execution-failure attempt", async () => {
    const { run } = await seeded(); const first = (await repository.claimRun(run.id, "first", new Date(Date.now() + 30000).toISOString()))!;
    await repository.saveRun({ ...first, stage: "waiting_quota", retryAfter: new Date(Date.now() - 1000).toISOString(), leaseUntil: undefined, quotaWaits: 1 }, first.fence);
    expect((await repository.pendingRuns()).map((r) => r.id)).toContain(run.id);
    const resumed = (await repository.claimRun(run.id, "after-quota", new Date(Date.now() + 30000).toISOString()))!;
    expect(resumed.attempt).toBe(1); expect(resumed.fence).toBe("after-quota"); expect(resumed.retryAfter).toBeUndefined();
  });
  it("deletes originals, parses and pending work, and rejects publication after deletion", async () => {
    const { c, d, run } = await seeded(); const claimed = (await repository.claimRun(run.id, "working", new Date(Date.now() + 30000).toISOString()))!;
    await repository.saveParsed(claimed, { documentId: d.id, filename: d.filename, format: "text", contentHash: d.contentHash, sources: [], manifest: { parserVersion: "test", complete: true, units: [], warnings: [] } });
    await repository.saveCheckpoint(claimed, "key", { sensitive: "private" }); await repository.remove("local-user", c.id);
    await expect(repository.document("local-user", d.id)).rejects.toMatchObject({ status: 404 });
    await expect(readFile(join(directory, "objects", d.storagePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await repository.getParsed(d.id)).toBeNull(); expect(await repository.getCheckpoint(d.id, "key")).toBeNull();
    expect(await repository.complete(claimed, emptyQuotation(d.id, d.filename))).toBe(false);
  });
  it("preserves a user correction when a new extraction completes", async () => {
    const { c, d, run } = await seeded(); const saved = await repository.get("local-user", c.id);
    saved.quotations[0].supplier.name = { ...field("User supplier"), origin: "user" };
    saved.corrections.push({ id: randomUUID(), quotationId: d.id, path: "supplier.name", before: field("Original"), after: saved.quotations[0].supplier.name, author: "local-user", createdAt: c.createdAt, reason: "Source checked", baseVersion: 1 });
    await repository.save("local-user", saved, 1);
    const claimed = (await repository.claimRun(run.id, "new", new Date(Date.now() + 30000).toISOString()))!;
    expect(await repository.complete(claimed, { ...emptyQuotation(d.id, d.filename), extractionVersion: 1, status: "ready" })).toBe(true);
    expect((await repository.get("local-user", c.id)).quotations[0].supplier.name.value).toBe("User supplier");
    expect((await repository.run("local-user", run.id)).stage).toBe("partial");
  });
});

describe("real upload and manual review with AI disabled", () => {
  it("requires source review and manual fields before completion, then invalidates the acknowledgment after edits or added lines", async () => {
    const { c, d, run } = await seeded("local-user", "parse_only"); await executeRun(repository, run.id);
    let current = (await hydrateComparison(repository, await repository.get("local-user", c.id))).comparison;
    const acknowledge = () => acknowledgeIssue(request({ baseRevision: current.revision, quotationId: d.id, issueId: `${d.id}:manual-review`, reason: "Reviewed every original source section and entered all relevant quotation details" }), c.id);
    await expect(acknowledge()).rejects.toMatchObject({ status: 422, code: "manual_review_incomplete" });
    current = (await (await correctField(request({ baseRevision: current.revision, quotationId: d.id, path: "supplier.name", after: { state: "value", value: "Acme Supplies" }, reason: "Read supplier header" }), c.id)).json()).comparison;
    await expect(acknowledge()).rejects.toMatchObject({ code: "manual_review_incomplete" });
    const evidence = current.quotations[0].sources.find((span) => span.text.includes("Paper"))!.id;
    const line = { description: "Paper", quantity: "2", unit: "each", unitPrice: "12.50", currency: "USD", kind: "goods", sourceIds: [evidence] };
    current = (await (await addItem(request({ baseRevision: current.revision, quotationId: d.id, item: line, reason: "Read the original price line" }), c.id)).json()).comparison;
    expect(current.quotations[0].issues.find((issue) => issue.id === `${d.id}:manual-review`)?.resolved).toBe(false);
    current = (await (await acknowledge()).json()).comparison;
    expect(current.quotations[0].status).toBe("ready"); expect(current.quotations[0].extractionVersion).toBe(0);
    expect(current.quotations[0].issues.filter((issue) => issue.code === "incomplete_extraction" && !issue.resolved)).toEqual([]);
    const firstItem = current.quotations[0].items[0];
    current = (await (await correctField(request({ baseRevision: current.revision, quotationId: d.id, path: `items.${firstItem.id}.unitPrice`, after: { state: "value", value: "12.75" }, reason: "Updated the buyer interpretation after reading the original again" }), c.id)).json()).comparison;
    expect(current.quotations[0].status).toBe("source_ready");
    const invalidated = current.quotations[0].issues.find((issue) => issue.id === `${d.id}:manual-review`);
    expect(invalidated?.resolved).toBe(false); expect(invalidated?.resolution).toBeUndefined();
    expect(current.corrections.at(-1)).toMatchObject({ before: { value: "12.50" }, after: { value: "12.75", origin: "user" } });
    current = (await (await acknowledge()).json()).comparison; expect(current.quotations[0].status).toBe("ready");
    current = (await (await addItem(request({ baseRevision: current.revision, quotationId: d.id, item: line, reason: "Added another manually entered source line for review" }), c.id)).json()).comparison;
    const reloaded = (await hydrateComparison(repository, await repository.get("local-user", c.id))).comparison;
    expect(reloaded.quotations[0].items).toHaveLength(2); expect(reloaded.quotations[0].status).toBe("source_ready");
    expect(reloaded.quotations[0].issues.find((issue) => issue.id === `${d.id}:manual-review`)?.resolved).toBe(false);
  });
  it("rejects manual completion when a source section remains unreadable despite populated fields", async () => {
    const { c, d, run } = await seeded("local-user", "parse_only");
    const parsed = await parseDocument({ documentId: d.id, filename: d.filename, bytes: await repository.readObject(d) });
    parsed.manifest.complete = false; parsed.manifest.units.push({ id: "page:2", label: "Page 2", status: "failed", sourceCount: 0, message: "Unreadable scan" });
    const claimed = (await repository.claimRun(run.id, "partial-source", new Date(Date.now() - 1000).toISOString()))!;
    await repository.saveParsed(claimed, parsed); await executeRun(repository, run.id);
    let current = (await hydrateComparison(repository, await repository.get("local-user", c.id))).comparison;
    current = (await (await correctField(request({ baseRevision: current.revision, quotationId: d.id, path: "supplier.name", after: { state: "value", value: "Acme Supplies" }, reason: "Read supplier header" }), c.id)).json()).comparison;
    current = (await (await addItem(request({ baseRevision: current.revision, quotationId: d.id, item: { description: "Paper", quantity: "2", unit: "each", unitPrice: "12.50", currency: "USD", kind: "goods", sourceIds: [parsed.sources[2].id] }, reason: "Read the preserved price line" }), c.id)).json()).comparison;
    await expect(acknowledgeIssue(request({ baseRevision: current.revision, quotationId: d.id, issueId: `${d.id}:manual-review`, reason: "Tried to complete a partly unreadable source" }), c.id)).rejects.toMatchObject({ status: 422, code: "manual_review_incomplete" });
    const reloaded = (await hydrateComparison(repository, await repository.get("local-user", c.id))).comparison;
    expect(reloaded.quotations[0].status).toBe("partial"); expect(reloaded.quotations[0].issues.find((issue) => issue.id === `${d.id}:parser-coverage`)?.resolved).toBe(false);
  });
  it("rejects non-UTF8 uploaded text without silently replacing source bytes", async () => {
    const c = comparison(); await repository.create("local-user", c); const bytes = new Uint8Array([0xff, 0xfe, 0x51, 0x00]);
    const form = new FormData(); form.set("file", new File([bytes], "legacy-encoded.txt", { type: "text/plain" }));
    const uploaded = await upload(new Request("http://127.0.0.1:3000/api/test", { method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: form }), c.id);
    const payload = await uploaded.json() as { run: RunRecord; documentId: string };
    let run = await repository.run("local-user", payload.run.id);
    for (let n = 0; n < 100 && run.stage !== "failed"; n++) { await new Promise((done) => setTimeout(done, 20)); run = await repository.run("local-user", run.id); }
    expect(run.errorCode).toBe("unsupported_format"); expect(await repository.getParsed(payload.documentId)).toBeNull();
    const original = await source(request(), payload.documentId); expect(new Uint8Array(await original.arrayBuffer())).toEqual(bytes);
  });
  it("admits and processes three simultaneous uploads without dropping files", async () => {
    const c = comparison(); await repository.create("local-user", c);
    const files = ["Office paper quote", "Software service quote", "Laboratory equipment quote"];
    const responses = await Promise.all(files.map((text) => upload(request({ text: `${text}\nQuantity 2 each USD 12.50`, filename: `${text}.txt` }), c.id)));
    expect(responses.every((response) => response.status === 202)).toBe(true);
    const saved = await repository.get("local-user", c.id); expect(saved.quotations).toHaveLength(3); expect(new Set(saved.quotations.map((quote) => quote.id)).size).toBe(3);
    const runs = await repository.runs("local-user", c.id); expect(runs).toHaveLength(3);
    for (let n = 0; n < 100; n++) { if ((await repository.runs("local-user", c.id)).every((entry) => ["failed", "cancelled", "source_ready", "ready", "partial"].includes(entry.stage))) break; await new Promise((done) => setTimeout(done, 50)); }
    expect((await repository.runs("local-user", c.id)).every((entry) => entry.stage === "source_ready" && entry.processingMode === "parse_only" && !entry.errorCode)).toBe(true);
  });
  it("links manual entries to selected source spans and rejects another quotation's evidence", async () => {
    const target = await seeded(); const other = await seeded();
    for (const { d, run } of [target, other]) {
      const claimed = (await repository.claimRun(run.id, randomUUID(), new Date(Date.now() + 30000).toISOString()))!;
      await repository.saveParsed(claimed, { documentId: d.id, filename: d.filename, format: "text", contentHash: d.contentHash, sources: [{ id: `${d.id}:line1`, documentId: d.id, kind: "text", text: "Paper 2 each USD 12.50" }], manifest: { parserVersion: "test", complete: true, units: [], warnings: [] } });
    }
    const current = await repository.get("local-user", target.c.id);
    const input = { baseRevision: current.revision, quotationId: target.d.id, item: { description: "Paper", quantity: "2", unit: "each", unitPrice: "12.50", currency: "USD", kind: "goods", taxBasis: "exclusive", taxRate: "9", sourceIds: [`${other.d.id}:line1`] }, reason: "Read the selected source line" };
    await expect(addItem(request(input), target.c.id)).rejects.toMatchObject({ code: "invalid_source", status: 400 });
    expect((await repository.get("local-user", target.c.id)).revision).toBe(current.revision);
    input.item.sourceIds = [`${target.d.id}:line1`];
    const added = await addItem(request(input), target.c.id); const saved = (await added.json()).comparison as Comparison;
    expect(saved.quotations[0].items[0].sourceIds).toEqual(input.item.sourceIds);
    expect(saved.quotations[0].items[0].unitPrice).toMatchObject({ origin: "user", sourceIds: input.item.sourceIds });
    expect(saved.quotations[0].items[0]).toMatchObject({ taxBasis: "exclusive", taxRate: { value: "9", origin: "user" } });
    expect(saved.corrections.every((entry) => entry.operation === "add_item")).toBe(true);
    expect(saved.corrections.every((entry) => entry.after.origin === "user" && entry.after.sourceIds[0] === input.item.sourceIds[0])).toBe(true);
    const metadataCorrection = { baseRevision: saved.revision, quotationId: target.d.id, path: `items.${saved.quotations[0].items[0].id}.taxBasis`, after: { state: "value", value: "invented" }, reason: "Review tax basis" };
    await expect(correctField(request(metadataCorrection), target.c.id)).rejects.toMatchObject({ code: "invalid_correction" });
    metadataCorrection.after.value = "inclusive";
    const corrected = (await (await correctField(request(metadataCorrection), target.c.id)).json()).comparison as Comparison;
    expect(corrected.quotations[0].items[0].taxBasis).toBe("inclusive");
    expect(corrected.corrections.at(-1)).toMatchObject({ operation: "edit", before: { value: "exclusive" }, after: { value: "inclusive", origin: "user" } });
  });
  it("persists slow parser progress before later stages and the final failure", async () => {
    const { run } = await seeded(); const save = repository.saveRun.bind(repository); const completed: string[] = [];
    vi.spyOn(repository, "saveRun").mockImplementation(async (next, fence) => {
      if (next.message === "Checking format and document limits") await new Promise((done) => setTimeout(done, 50));
      const result = await save(next, fence); completed.push(next.message === "Checking format and document limits" ? "parser-callback" : next.stage); return result;
    });
    await executeRun(repository, run.id);
    expect(completed.indexOf("parser-callback")).toBeLessThan(completed.indexOf("extracting"));
    expect(completed.at(-1)).toBe("failed");
    expect(await repository.run("local-user", run.id)).toMatchObject({ stage: "failed", errorCode: "ai_unavailable" });
  });
  it("parses uploaded text without AI, detects duplicates and supports audited manual matching", async () => {
    const response = await createComparison(request({ name: "Manual purchase" })); const { comparison: c } = await response.json() as { comparison: Comparison };
    const text = "Independent Supply Co\nQuote A-12\nArchival folders 2 each USD 12.50\nDelivery not included";
    const uploaded = await upload(request({ text }), c.id); const payload = await uploaded.json() as { run: RunRecord; documentId: string };
    let run = await repository.run("local-user", payload.run.id);
    for (let n = 0; n < 100 && !["failed", "cancelled", "source_ready", "ready", "partial"].includes(run.stage); n++) { await new Promise((done) => setTimeout(done, 50)); run = await repository.run("local-user", run.id); }
    expect(run.stage).toBe("source_ready"); expect(run.processingMode).toBe("parse_only"); expect(run.errorCode).toBeUndefined();
    const parsed = await repository.getParsed(payload.documentId); expect(parsed?.sources.some((s) => s.text.includes("Archival"))).toBe(true);
    await expect(upload(request({ text }), c.id)).rejects.toMatchObject({ code: "duplicate", status: 409 });
    const original = await source(request(), payload.documentId); expect(await original.text()).toBe(text); expect(original.headers.get("Cache-Control")).toContain("no-store");
    let current = (await hydrateComparison(repository, await repository.get("local-user", c.id))).comparison;
    expect(current.quotations[0].status).toBe("source_ready"); expect(current.quotations[0].manifest.complete).toBe(true); // Parser coverage is separate from manual review completion.
    const added = await addItem(request({ baseRevision: current.revision, quotationId: payload.documentId, item: { description: "Archival folders", quantity: "2", unit: "each", unitPrice: "12.50", currency: "USD", kind: "goods" }, reason: "Read the original quotation" }), c.id);
    current = (await added.json()).comparison;
    expect(current.quotations[0].items[0].unitPrice).toMatchObject({ origin: "user", value: "12.50", sourceIds: [] }); expect(current.corrections).toHaveLength(6);
    const corrected = await correctField(request({ baseRevision: current.revision, quotationId: payload.documentId, path: "items.0.unitPrice", after: { state: "value", value: "12.75" }, reason: "Supplier confirmed the revised rate" }), c.id);
    current = (await corrected.json()).comparison; expect(current.corrections.at(-1)?.before.value).toBe("12.50"); expect(current.corrections.at(-1)?.after.value).toBe("12.75");
    const matches = await proposeGroups(request({ baseRevision: current.revision, mode: "baseline" }), c.id); current = (await matches.json()).comparison;
    expect(current.groups[0].explanation).toContain("not AI");
    await expect(proposeGroups(request({ baseRevision: current.revision, mode: "ai" }), c.id)).rejects.toMatchObject({ code: "ai_unavailable" });
    const supplier = await correctField(request({ baseRevision: current.revision, quotationId: payload.documentId, path: "supplier.name", after: { state: "value", value: "Independent Supply Co" }, reason: "Read the supplier header" }), c.id);
    current = (await supplier.json()).comparison;
    const issue = current.quotations[0].issues.find((entry) => entry.id === `${payload.documentId}:manual-review`)!;
    const acknowledged = await acknowledgeIssue(request({ baseRevision: current.revision, quotationId: payload.documentId, issueId: issue.id, reason: "Remaining original terms checked" }), c.id);
    current = (await acknowledged.json()).comparison;
    expect((await hydrateComparison(repository, current)).comparison.quotations[0].issues.find((i) => i.id === issue.id)?.resolved).toBe(true);
  });
});

describe("local exposure boundary", () => {
  it("accepts the loopback forwarding headers added by Next for a direct request", () => {
    expect(() => checkRequestBoundary(new Request("http://127.0.0.1:3001/api/status", { headers: { host: "127.0.0.1:3001", "x-forwarded-host": "127.0.0.1:3001", "x-forwarded-for": "::ffff:127.0.0.1", "x-forwarded-proto": "http" } }), true)).not.toThrow();
    expect(() => checkRequestBoundary(new Request("http://localhost:3001/api/comparisons", { method: "POST", headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "x-forwarded-host": "127.0.0.1:3001", "x-forwarded-for": "127.0.0.1", "x-forwarded-proto": "http" } }), true)).not.toThrow();
    for (const headers of [
      { host: "public.example", "x-forwarded-host": "localhost:3001" },
      { host: "localhost:3001", "x-forwarded-host": "localhost:3001, public.example" },
      { host: "localhost:3001", "x-forwarded-for": "203.0.113.1" },
      { host: "localhost:3001", "x-forwarded-for": "127.0.0.1, 203.0.113.1" },
      { host: "localhost:3001", "x-forwarded-host": "public.example@localhost:3001" },
    ]) expect(() => checkRequestBoundary(new Request("http://localhost:3001/api/status", { headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => typeof value === "string")) }), true)).toThrow();
  });
  it("rejects remote hosts, cross-origin writes, proxy forwarding and local mode on hosted providers", () => {
    expect(() => checkRequestBoundary(new Request("http://evil.example/api"), true)).toThrow();
    expect(() => checkRequestBoundary(new Request("http://localhost/api", { method: "POST", headers: { Origin: "https://evil.example" } }), true)).toThrow();
    expect(() => checkRequestBoundary(new Request("http://localhost/api", { headers: { "x-forwarded-host": "public.example" } }), true)).toThrow();
    vi.stubEnv("VERCEL", "1"); expect(configuration().local).toBe(false);
  });
});
