import { mkdir, readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Comparison, ParsedDocument, Quotation } from "@/lib/domain/types";
import type { Repository, State, DocumentRecord, RunRecord } from "./contracts";
import { ApiError } from "./errors";

const initialState = (): State => ({ version: 1, comparisons: {}, documents: {}, runs: {}, extractions: {}, parsed: {}, deletionOutbox: [] });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function retryFileOperation(operation: () => Promise<void>) {
  // Windows may briefly deny replacing/deleting a file while a concurrent read
  // or antivirus scanner holds it. Keep the transaction lock and retry safely.
  for (let attempt = 0; ; attempt++) {
    try { await operation(); return; }
    catch (error) {
      if (attempt >= 40 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await sleep(25);
    }
  }
}
const terminal = new Set(["source_ready", "ready", "partial", "failed", "cancelled", "waiting_quota"]);
const notFound = () => new ApiError(404, "not_found", "This resource is unavailable in your workspace.");

/** Single-machine repository. Atomic JSON snapshots and an exclusive file lock survive process restarts. */
export class LocalRepository implements Repository {
  readonly mode = "local" as const;
  readonly directory: string;
  constructor(directory = process.env.FIELDOPS_DATA_DIR || resolve(process.cwd(), ".fieldops")) { this.directory = resolve(directory); }
  private async state(): Promise<State> {
    try {
      const state = JSON.parse(await readFile(join(this.directory, "state.json"), "utf8")) as State;
      // Older snapshots never recorded consent to model processing. Normalize to
      // parser-only; the next atomic write persists that safe migration default.
      for (const document of Object.values(state.documents)) document.processingMode ??= "parse_only";
      for (const run of Object.values(state.runs)) run.processingMode ??= "parse_only";
      return state;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialState(); throw new ApiError(503, "storage_unreadable", "Local saved data could not be read. Restore a backup before continuing."); }
  }
  private async transaction<T>(fn: (state: State) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = join(this.directory, "state.lock");
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 200 && !lock; attempt++) {
      try { lock = await open(lockPath, "wx", 0o600); await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() })); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows can report a transient access/busy error while another writer's
        // lock is closing or being deleted. We have not acquired it: only wait,
        // and never inspect or delete that unknown lock on this error path.
        if (!lock && ["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) { await sleep(20); continue; }
        if (code !== "EEXIST") throw error;
        try {
          const owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
          try { process.kill(owner.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") await unlink(lockPath).catch(() => {}); }
        } catch { /* A writer may still be filling its lock file. */ }
        await sleep(20);
      }
    }
    if (!lock) throw new ApiError(503, "storage_busy", "Saved data is busy. Retry in a moment.");
    try {
      const state = await this.state();
      const result = fn(state);
      const temporary = join(this.directory, `state.${randomUUID()}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await retryFileOperation(() => rename(temporary, join(this.directory, "state.json")));
      return result;
    } finally { await lock.close(); await retryFileOperation(() => unlink(lockPath)).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }
  private owned(state: State, ownerId: string, id: string) {
    const record = state.comparisons[id];
    if (!record || record.ownerId !== ownerId || record.deletedAt) throw notFound();
    return record;
  }
  async list(ownerId: string) {
    const state = await this.state();
    return Object.values(state.comparisons).filter((r) => r.ownerId === ownerId && !r.deletedAt).map((r) => r.comparison).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(ownerId: string, id: string) { return this.owned(await this.state(), ownerId, id).comparison; }
  async create(ownerId: string, comparison: Comparison) {
    await this.transaction((state) => { if (state.comparisons[comparison.id]) throw new ApiError(409, "exists", "Comparison already exists."); state.comparisons[comparison.id] = { ownerId, comparison }; });
  }
  async save(ownerId: string, comparison: Comparison, expectedRevision: number) {
    await this.transaction((state) => {
      const record = this.owned(state, ownerId, comparison.id);
      if (record.comparison.revision !== expectedRevision) throw new ApiError(409, "stale_revision", "This comparison changed. Reload it before saving your edits.");
      state.comparisons[comparison.id] = { ownerId, comparison: { ...comparison, revision: expectedRevision + 1, updatedAt: new Date().toISOString() } };
    });
  }
  async remove(ownerId: string, comparisonId: string) {
    await this.transaction((state) => {
      this.owned(state, ownerId, comparisonId);
      for (const document of Object.values(state.documents).filter((d) => d.comparisonId === comparisonId && d.ownerId === ownerId)) {
        state.deletionOutbox.push({ id: randomUUID(), storagePath: document.storagePath, ownerId, createdAt: new Date().toISOString() });
        delete state.parsed[document.id];
        for (const key of Object.keys(state.checkpoints ?? {})) if (key.startsWith(document.id + ":")) delete state.checkpoints![key];
        for (const extraction of Object.values(state.extractions).filter((e) => e.documentId === document.id)) delete state.extractions[extraction.id];
        delete state.documents[document.id];
      }
      for (const run of Object.values(state.runs).filter((r) => r.comparisonId === comparisonId)) delete state.runs[run.id];
      delete state.comparisons[comparisonId];
    });
    await this.cleanup();
  }
  async removeDocument(ownerId: string, documentId: string, expectedRevision: number) {
    await this.transaction((state) => {
      const document = state.documents[documentId]; if (!document || document.ownerId !== ownerId) throw notFound();
      const { comparison } = this.owned(state, ownerId, document.comparisonId);
      if (comparison.revision !== expectedRevision) throw new ApiError(409, "stale_revision", "The comparison changed. Reload it before deleting this source.");
      const quotation = comparison.quotations.find((q) => q.documentId === documentId); const quotationId = quotation?.id ?? documentId;
      const deletedSources = new Set(quotation?.sources.map((s) => s.id) ?? []);
      comparison.quotations = comparison.quotations.filter((q) => q.documentId !== documentId);
      comparison.corrections = comparison.corrections.filter((c) => c.quotationId !== quotationId);
      comparison.groups = comparison.groups.map((group) => {
        if (!group.members.some((m) => m.quotationId === quotationId)) return group;
        const acceptedOrderQuantities = { ...group.acceptedOrderQuantities }; delete acceptedOrderQuantities[quotationId];
        return { ...group, members: group.members.filter((m) => m.quotationId !== quotationId), sourceIds: group.sourceIds.filter((s) => !deletedSources.has(s)), acceptedOrderQuantities, status: "stale" as const, approvedRevision: null };
      }).filter((g) => g.members.length);
      comparison.revision++; comparison.updatedAt = new Date().toISOString();
      state.deletionOutbox.push({ id: randomUUID(), storagePath: document.storagePath, ownerId, createdAt: new Date().toISOString() });
      delete state.documents[documentId]; delete state.parsed[documentId];
      for (const run of Object.values(state.runs).filter((r) => r.documentId === documentId)) delete state.runs[run.id];
      for (const extraction of Object.values(state.extractions).filter((e) => e.documentId === documentId)) delete state.extractions[extraction.id];
      for (const key of Object.keys(state.checkpoints ?? {})) if (key.startsWith(documentId + ":")) delete state.checkpoints![key];
    });
    await this.cleanup();
  }
  async createUpload(ownerId: string, document: DocumentRecord, run: RunRecord | null, quotation: Quotation, expectedRevision: number) {
    await this.transaction((state) => {
      const record = this.owned(state, ownerId, document.comparisonId);
      if (record.comparison.revision !== expectedRevision) throw new ApiError(409, "stale_revision", "The comparison changed during upload. Retry this file.");
      document.processingMode ??= "parse_only";
      if (run && run.processingMode !== document.processingMode) throw new ApiError(400, "processing_mode_mismatch", "The processing run must use the mode selected for this upload.");
      state.documents[document.id] = document;
      if (run) state.runs[run.id] = run;
      record.comparison.quotations.push(quotation); record.comparison.revision++; record.comparison.updatedAt = new Date().toISOString();
      for (const group of record.comparison.groups) { if (group.status === "approved") group.status = "stale"; }
    });
  }
  async finalizeUpload(ownerId: string, documentId: string, hash: string, run: RunRecord) {
    await this.transaction((state) => {
      const document = state.documents[documentId];
      if (!document || document.ownerId !== ownerId || document.status !== "uploading") throw notFound();
      this.owned(state, ownerId, document.comparisonId);
      if (run.processingMode !== document.processingMode) throw new ApiError(400, "processing_mode_mismatch", "The processing mode was pinned when this upload began.");
      document.status = "uploaded"; document.contentHash = hash; state.runs[run.id] = run;
    });
  }
  async document(ownerId: string, id: string) {
    const state = await this.state(); const document = state.documents[id];
    if (!document || document.ownerId !== ownerId || document.status === "deleted") throw notFound();
    this.owned(state, ownerId, document.comparisonId); return document;
  }
  async findDuplicate(ownerId: string, comparisonId: string, hash: string) {
    const state = await this.state(); this.owned(state, ownerId, comparisonId);
    return Object.values(state.documents).find((d) => d.ownerId === ownerId && d.comparisonId === comparisonId && d.contentHash === hash && d.status !== "deleted") ?? null;
  }
  async run(ownerId: string, id: string) {
    const state = await this.state(); const run = state.runs[id];
    if (!run || run.ownerId !== ownerId) throw notFound(); this.owned(state, ownerId, run.comparisonId); return run;
  }
  async runs(ownerId: string, comparisonId: string) {
    const state = await this.state(); this.owned(state, ownerId, comparisonId);
    return Object.values(state.runs).filter((r) => r.ownerId === ownerId && r.comparisonId === comparisonId);
  }
  async pendingRuns() {
    const state = await this.state();
    const now = new Date().toISOString();
    return Object.values(state.runs).filter((r) => (!terminal.has(r.stage) || (r.processingMode === "ai" && r.stage === "waiting_quota" && r.retryAfter && r.retryAfter <= now)) && !r.cancelRequested && (!r.leaseUntil || r.leaseUntil < now));
  }
  async saveRun(run: RunRecord, expectedFence?: string) {
    return this.transaction((state) => {
      const current = state.runs[run.id];
      if (!current || (expectedFence && current.fence !== expectedFence) || (current.cancelRequested && !run.cancelRequested)) return false;
      if (current.processingMode !== run.processingMode) return false;
      if (expectedFence && terminal.has(current.stage) && current.stage !== run.stage) return false;
      state.runs[run.id] = { ...run, updatedAt: new Date().toISOString() }; return true;
    });
  }
  async claimRun(id: string, fence: string, leaseUntil: string) {
    return this.transaction((state) => {
      const run = state.runs[id];
      const resumingQuota = run?.processingMode === "ai" && run.stage === "waiting_quota" && Boolean(run.retryAfter && run.retryAfter <= new Date().toISOString());
      if (!run || (terminal.has(run.stage) && !resumingQuota) || run.cancelRequested || (run.leaseUntil && run.leaseUntil > new Date().toISOString())) return null;
      if (!state.documents[run.documentId] || !state.comparisons[run.comparisonId]) return null;
      run.fence = fence; run.leaseUntil = leaseUntil; if (!resumingQuota) run.attempt++; run.stage = "validating"; run.updatedAt = new Date().toISOString(); delete run.retryAfter;
      return { ...run };
    });
  }
  async renewLease(id: string, fence: string, leaseUntil: string) {
    return this.transaction((state) => { const run = state.runs[id]; if (!run || run.fence !== fence || run.cancelRequested || terminal.has(run.stage)) return false; run.leaseUntil = leaseUntil; return true; });
  }
  async retryRun(ownerId: string, id: string) {
    return this.transaction((state) => {
      const run = state.runs[id];
      if (!run || run.ownerId !== ownerId) throw notFound(); this.owned(state, ownerId, run.comparisonId);
      if (!["failed", "cancelled", "waiting_quota"].includes(run.stage)) throw new ApiError(409, "run_active", "Only a failed, cancelled or quota-blocked file can be retried.");
      Object.assign(run, { stage: "queued", attempt: 0, progress: 0, cancelRequested: false, fence: randomUUID(), updatedAt: new Date().toISOString() });
      delete run.leaseUntil; delete run.errorCode; delete run.message; delete run.taskRunId; delete run.dispatchedAt; delete run.retryAfter; run.quotaWaits = 0;
      return { ...run };
    });
  }
  async saveParsed(run: RunRecord, parsed: ParsedDocument) {
    await this.transaction((state) => {
      const current = state.runs[run.id];
      if (!current || current.fence !== run.fence || current.cancelRequested || terminal.has(current.stage) || !state.documents[run.documentId]) return;
      state.parsed[run.documentId] = parsed;
    });
  }
  async getParsed(documentId: string) { return (await this.state()).parsed[documentId] ?? null; }
  async getCheckpoint(documentId: string, key: string) { return (await this.state()).checkpoints?.[`${documentId}:${key}`] ?? null; }
  async saveCheckpoint(run: RunRecord, key: string, value: unknown) {
    await this.transaction((state) => { const current = state.runs[run.id]; if (current?.fence === run.fence && !current.cancelRequested && state.documents[run.documentId]) { state.checkpoints ??= {}; state.checkpoints[`${run.documentId}:${key}`] = value; } });
  }
  async complete(run: RunRecord, quotation: Quotation) {
    return this.transaction((state) => {
      const current = state.runs[run.id]; const document = state.documents[run.documentId]; const record = state.comparisons[run.comparisonId];
      if (!current || current.fence !== run.fence || current.cancelRequested || !document || document.status !== "uploaded" || !record || terminal.has(current.stage)) return false;
      if (current.processingMode !== "ai" || run.processingMode !== "ai" || document.processingMode !== "ai") return false;
      const comparison = record.comparison; const index = comparison.quotations.findIndex((q) => q.documentId === run.documentId);
      if (index < 0 || comparison.quotations[index].extractionVersion >= run.extractionVersion) return false;
      const extraction = { id: `${run.documentId}:${run.extractionVersion}`, documentId: run.documentId, version: run.extractionVersion, quotation, createdAt: new Date().toISOString() };
      state.extractions[extraction.id] = extraction;
      if (comparison.corrections.some((c) => c.quotationId === comparison.quotations[index].id)) {
        current.stage = "partial"; current.message = "A new extraction was saved separately because this quotation has user corrections. Your edits were preserved.";
      } else {
        comparison.quotations[index] = quotation; current.stage = quotation.status;
        for (const group of comparison.groups) if (group.status === "approved") group.status = "stale";
      }
      comparison.revision++; comparison.updatedAt = new Date().toISOString(); current.progress = 100; current.updatedAt = new Date().toISOString(); delete current.leaseUntil;
      return true;
    });
  }
  private objectPath(storagePath: string) {
    if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(storagePath)) throw new ApiError(400, "invalid_path", "Invalid source reference.");
    const root = resolve(this.directory, "objects"); const target = resolve(root, storagePath);
    if (!target.startsWith(root + "/") && !target.startsWith(root + "\\")) throw new ApiError(400, "invalid_path", "Invalid source reference.");
    return target;
  }
  async writeObject(document: DocumentRecord, bytes: Uint8Array) {
    const path = this.objectPath(document.storagePath); await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 }); await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  }
  async readObject(document: DocumentRecord) { return new Uint8Array(await readFile(this.objectPath(document.storagePath))); }
  async deleteObject(document: DocumentRecord) { await unlink(this.objectPath(document.storagePath)).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  async cleanup() {
    const state = await this.state(); const done: string[] = [];
    for (const entry of state.deletionOutbox) {
      try { await unlink(this.objectPath(entry.storagePath)); done.push(entry.id); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") done.push(entry.id); }
    }
    if (done.length) await this.transaction((s) => { s.deletionOutbox = s.deletionOutbox.filter((entry) => !done.includes(entry.id)); });
  }
}
