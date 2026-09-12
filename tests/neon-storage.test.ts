import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { storageDelete, storageDiscardUpload, storageFinalizeUpload, storageRead, storageSourceUrl, storageUploadIntent, storageWrite } from "@/lib/server/neon-storage";
import type { DocumentRecord, Repository, RunRecord } from "@/lib/server/contracts";
import { emptyQuotation, LIMITS, type Comparison } from "@/lib/domain/types";
import { ApiError } from "@/lib/server/errors";
import { initiateUpload, finalizeUpload, source, upload } from "@/lib/server/service";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/context", () => ({ authorize: auth }));
vi.mock("@/lib/server/config", () => ({ capabilities: () => ({ canUpload: true, canExtract: true, processingMode: "parse_only", reasons: [] }), configuration: () => ({ local: false }), checkRequestBoundary: vi.fn() }));
vi.mock("@/lib/server/jobs", () => ({ dispatchRun: vi.fn(), startLocalRunner: vi.fn(), hasCompleteSourceCoverage: vi.fn(), hydrateComparison: async (_repository: unknown, comparison: Comparison) => ({ comparison, runs: [] }) }));

type Command = HeadObjectCommand | GetObjectCommand | PutObjectCommand | DeleteObjectCommand;
const synthetic = Buffer.from("Synthetic supplier\nItem A | 2 each | USD 12.50");
const missing = () => Object.assign(new Error("Synthetic missing object"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
let objects: Map<string, Buffer>;
let requests: Command[];
let send: (command: Command) => Promise<unknown>;
function document(): DocumentRecord {
  const ownerId = randomUUID(), id = randomUUID();
  return { id, ownerId, comparisonId: randomUUID(), filename: "Synthetic quotation.txt", contentType: "text/plain", contentHash: createHash("sha256").update(synthetic).digest("hex"), size: synthetic.byteLength, storagePath: `${ownerId}/${id}`, createdAt: new Date().toISOString(), status: "uploaded", processingMode: "parse_only" };
}
beforeEach(() => {
  vi.stubEnv("NEON_STORAGE_ENDPOINT", "https://br-synthetic.storage.c-1.us-east-2.aws.neon.tech");
  vi.stubEnv("NEON_STORAGE_ACCESS_KEY_ID", "synthetic-access-key"); vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "synthetic-secret-for-offline-signatures");
  vi.stubEnv("NEON_STORAGE_REGION", "us-east-2"); vi.stubEnv("NEON_STORAGE_BUCKET", "quotations");
  objects = new Map(); requests = [];
  auth.mockReset();
  send = async command => {
    requests.push(command); const key = command.input.Key!;
    if (command instanceof DeleteObjectCommand) { objects.delete(key); return {}; }
    if (command instanceof PutObjectCommand) { objects.set(key, Buffer.from(command.input.Body as Uint8Array)); return {}; }
    const bytes = objects.get(key); if (!bytes) throw missing();
    if (command instanceof HeadObjectCommand) return { ContentLength: bytes.byteLength };
    return { ContentLength: bytes.byteLength, Body: Readable.from([bytes]) };
  };
  vi.spyOn(S3Client.prototype, "send").mockImplementation((command) => send(command as Command) as never);
});

function cloudContext(doc: DocumentRecord) {
  const comparison: Comparison = { id: doc.comparisonId, workspaceId: doc.ownerId, name: "Synthetic private workspace", description: "", createdAt: doc.createdAt, updatedAt: doc.createdAt, revision: 1, isDemo: false,
    quotations: [{ ...emptyQuotation(doc.id, doc.filename), documentId: doc.id }], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } };
  const repository = { mode: "cloud", get: vi.fn().mockResolvedValue(comparison), document: vi.fn().mockResolvedValue(doc), findDuplicate: vi.fn().mockResolvedValue(doc), createUpload: vi.fn(),
    finalizeUpload: vi.fn(), writeObject: vi.fn(storageWrite), deleteObject: vi.fn(storageDelete), runs: vi.fn().mockResolvedValue([]) };
  auth.mockResolvedValue({ ownerId: doc.ownerId, workspaceId: doc.ownerId, user: { id: doc.ownerId, name: "Synthetic buyer" }, repository: repository as unknown as Repository });
  return { comparison, repository };
}
const uploadRequest = (doc: DocumentRecord, processingMode = "parse_only") => new Request("https://fieldops.example/api/upload", { method: "POST", body: JSON.stringify({ filename: doc.filename, size: doc.size, sha256: doc.contentHash, processingMode }) });

describe("Neon upload and source service boundaries", () => {
  it("does not write hosted pasted text when durable upload admission fails", async () => {
    const doc = document(); const { comparison, repository } = cloudContext(doc);
    comparison.quotations = []; comparison.revision = 0;
    repository.findDuplicate.mockResolvedValue(null);
    repository.createUpload.mockRejectedValue(new ApiError(429, "quota", "Synthetic admission failure"));
    repository.deleteObject.mockRejectedValue(new ApiError(503, "storage_unavailable", "Synthetic deletion failure"));
    const request = new Request("https://fieldops.example/api/upload", { method: "POST", body: JSON.stringify({ text: synthetic.toString(), filename: doc.filename }) });
    await expect(upload(request, comparison.id)).rejects.toMatchObject({ code: "quota" });
    expect(repository.createUpload).toHaveBeenCalledWith(doc.ownerId, expect.objectContaining({ status: "uploading", processingMode: "parse_only" }), null, expect.anything(), 0);
    expect(repository.writeObject).not.toHaveBeenCalled(); expect(repository.deleteObject).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0); expect(objects.size).toBe(0);
  });

  it("retains a hosted text intent after finalization fails and resumes its same immutable source", async () => {
    const doc = document(); const { comparison, repository } = cloudContext(doc);
    comparison.quotations = []; comparison.revision = 0;
    let stored: DocumentRecord | null = null; let persistedRun: RunRecord | undefined;
    repository.findDuplicate.mockImplementation(async () => stored);
    repository.createUpload.mockImplementation(async (_owner, intent, run, quotation) => {
      expect(objects.size).toBe(0); expect(run).toBeNull();
      stored = intent; comparison.quotations.push(quotation); comparison.revision++;
    });
    repository.finalizeUpload.mockRejectedValueOnce(new ApiError(429, "quota", "Synthetic finalization allowance exhausted"));
    repository.finalizeUpload.mockImplementation(async (_owner, documentId, _hash, run) => {
      expect(documentId).toBe(stored?.id); stored!.status = "uploaded"; persistedRun = run;
      repository.runs.mockResolvedValue([run]);
    });
    const request = () => new Request("https://fieldops.example/api/upload", { method: "POST", body: JSON.stringify({ text: synthetic.toString(), filename: doc.filename, processingMode: "parse_only" }) });
    await expect(upload(request(), comparison.id)).rejects.toMatchObject({ code: "quota" });
    const intent = repository.createUpload.mock.calls[0][1] as DocumentRecord;
    expect(intent.status).toBe("uploading"); expect(objects.get(intent.storagePath)).toEqual(synthetic);
    expect(repository.deleteObject).not.toHaveBeenCalled();
    const response = await upload(request(), comparison.id);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ documentId: intent.id, run: { id: persistedRun!.id, processingMode: "parse_only" } });
    expect(repository.createUpload).toHaveBeenCalledTimes(1);
    expect(repository.writeObject).toHaveBeenCalledTimes(2);
    expect(requests.filter(command => command instanceof PutObjectCommand)).toHaveLength(1);
  });

  it("resumes a matching unfinished intent without another record and keeps its processing mode pinned", async () => {
    const doc = { ...document(), status: "uploading" as const }; const { repository } = cloudContext(doc);
    const response = await initiateUpload(uploadRequest(doc), doc.comparisonId);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ documentId: doc.id, resumed: true, method: "PUT" });
    expect(repository.createUpload).not.toHaveBeenCalled();
    await expect(initiateUpload(uploadRequest(doc, "ai"), doc.comparisonId)).rejects.toMatchObject({ code: "duplicate" });
  });

  it("removes promoted bytes when finalization loses deletion, but preserves them for a retryable database error", async () => {
    const doc = { ...document(), status: "uploading" as const }; const { repository } = cloudContext(doc);
    objects.set(`${doc.storagePath}.upload`, synthetic);
    repository.finalizeUpload.mockRejectedValue(new ApiError(503, "storage_unavailable", "Synthetic database interruption"));
    await expect(finalizeUpload(uploadRequest(doc), doc.id)).rejects.toMatchObject({ status: 503 });
    expect(objects.get(doc.storagePath)).toEqual(synthetic); expect(repository.deleteObject).not.toHaveBeenCalled();
    repository.finalizeUpload.mockRejectedValue(new ApiError(404, "not_found", "Synthetic concurrent deletion"));
    await expect(finalizeUpload(uploadRequest(doc), doc.id)).rejects.toMatchObject({ status: 404 });
    expect(objects.size).toBe(0); expect(repository.deleteObject).toHaveBeenCalledWith(doc);
  });

  it("requires authentication and owner lookup before issuing a source URL", async () => {
    const doc = document(); auth.mockRejectedValue(new ApiError(401, "sign_in_required", "Sign in"));
    await expect(source(uploadRequest(doc), doc.id)).rejects.toMatchObject({ status: 401 });
    expect(requests).toHaveLength(0);
    const { repository } = cloudContext(doc); repository.document.mockRejectedValue(new ApiError(404, "not_found", "Another buyer's record"));
    await expect(source(uploadRequest(doc), doc.id)).rejects.toMatchObject({ status: 404 });
    expect(requests).toHaveLength(0); expect(repository.document).toHaveBeenCalledWith(doc.ownerId, doc.id);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Neon private storage adapter (offline S3 transport)", () => {
  it("verifies source bytes before writing and makes identical server writes idempotent", async () => {
    const doc = document();
    await expect(storageWrite(doc, Buffer.from("different"))).rejects.toMatchObject({ code: "integrity_check" });
    expect(requests).toHaveLength(0);
    await storageWrite(doc, synthetic); await storageWrite(doc, synthetic);
    expect(await storageRead(doc)).toEqual(synthetic);
    const writes = requests.filter(command => command instanceof PutObjectCommand);
    expect(writes).toHaveLength(1);
    expect(writes[0].input).toMatchObject({ Key: doc.storagePath, ContentType: "text/plain", ContentLength: doc.size, CacheControl: "private, no-store", Metadata: { "fieldops-sha256": doc.contentHash } });
  });

  it("rejects oversized or mismatched HEAD results before fetching any body", async () => {
    const doc = document(); objects.set(doc.storagePath, Buffer.alloc(doc.size + 1));
    await expect(storageRead(doc)).rejects.toMatchObject({ code: "integrity_check", status: 422 });
    expect(requests.every(command => command instanceof HeadObjectCommand)).toBe(true);
    requests = [];
    await expect(storageRead({ ...doc, size: LIMITS.fileBytes + 1 })).rejects.toMatchObject({ code: "integrity_check" });
    expect(requests).toHaveLength(0);
  });

  it("bounds a changing response stream and destroys it on overflow", async () => {
    const doc = document(); const stream = Readable.from([synthetic, Buffer.from("excess")]);
    send = async command => command instanceof HeadObjectCommand ? { ContentLength: doc.size } : { ContentLength: doc.size, Body: stream };
    await expect(storageRead(doc)).rejects.toMatchObject({ code: "integrity_check" });
    expect(stream.destroyed).toBe(true);
  });

  it("detects truncation and same-size content changes instead of presenting them as originals", async () => {
    const doc = document(); const changed = Buffer.from(synthetic); changed[0] ^= 1; objects.set(doc.storagePath, changed);
    await expect(storageRead(doc)).rejects.toMatchObject({ code: "integrity_check" });
    await expect(storageWrite(doc, synthetic)).rejects.toMatchObject({ code: "integrity_check" });
    expect(requests.some(command => command instanceof PutObjectCommand)).toBe(false);
    const stream = Readable.from([synthetic.subarray(0, -1)]);
    send = async command => command instanceof HeadObjectCommand ? { ContentLength: doc.size } : { ContentLength: doc.size, Body: stream };
    await expect(storageRead(doc)).rejects.toMatchObject({ code: "integrity_check" });
  });

  it("signs only staging PUTs with the declared media type and size and returns browser-safe headers", async () => {
    const doc = { ...document(), status: "uploading" as const };
    const ticket = await storageUploadIntent(doc), url = new URL(ticket.uploadUrl);
    expect(url.pathname).toBe(`/quotations/${doc.storagePath}.upload`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(expect.arrayContaining(["content-type", "content-length", "host"]));
    expect(ticket).toMatchObject({ method: "PUT", headers: { "Content-Type": "text/plain" } });
    expect(ticket.headers).not.toHaveProperty("Content-Length");
    expect(requests).toHaveLength(0);
    await expect(storageUploadIntent({ ...doc, status: "uploaded" })).rejects.toMatchObject({ code: "source_upload_complete" });
  });

  it("anchors a delayed upload signature to request start and refuses nearly expired requests", async () => {
    const doc = { ...document(), status: "uploading" as const };
    const requestedAt = new Date(Date.now() - 120_000);
    const ticket = await storageUploadIntent(doc, requestedAt), url = new URL(ticket.uploadUrl);
    expect(url.searchParams.get("X-Amz-Date")).toBe(requestedAt.toISOString().replace(/[:-]|\.\d{3}/g, ""));
    expect(ticket.expiresAt).toBe(new Date(requestedAt.getTime() + 300_000).toISOString());
    await expect(storageUploadIntent(doc, new Date(Date.now() - 285_000))).rejects.toMatchObject({ code: "upload_unavailable" });
  });

  it("promotes verified bytes and keeps the canonical original unchanged if a staging URL is replayed", async () => {
    const doc = { ...document(), status: "uploading" as const }; objects.set(`${doc.storagePath}.upload`, synthetic);
    expect(await storageFinalizeUpload(doc)).toEqual(synthetic);
    objects.set(`${doc.storagePath}.upload`, Buffer.from("replayed different input"));
    expect(await storageFinalizeUpload(doc)).toEqual(synthetic);
    await storageDiscardUpload(doc);
    expect(objects.has(`${doc.storagePath}.upload`)).toBe(false);
    expect(objects.get(doc.storagePath)).toEqual(synthetic);
    const source = new URL(await storageSourceUrl({ ...doc, status: "uploaded" }));
    expect(source.pathname).toBe(`/quotations/${doc.storagePath}`); expect(source.searchParams.get("X-Amz-Expires")).toBe("60");
    await expect(storageSourceUrl(doc)).rejects.toMatchObject({ code: "source_uploading" });
  });

  it("removes both canonical and temporary objects idempotently, rejecting a mismatched owner's path", async () => {
    const doc = document(); objects.set(doc.storagePath, synthetic); objects.set(`${doc.storagePath}.upload`, synthetic);
    await storageDelete(doc); await storageDelete(doc.storagePath); expect(objects.size).toBe(0);
    requests = [];
    await expect(storageRead({ ...doc, ownerId: randomUUID() })).rejects.toMatchObject({ code: "invalid_storage_path" });
    await expect(storageDelete("../private-file")).rejects.toMatchObject({ code: "invalid_storage_path" });
    expect(requests).toHaveLength(0);
  });

  it("fails closed on missing configuration and sanitizes provider failures", async () => {
    const doc = document(); vi.stubEnv("NEON_STORAGE_ENDPOINT", "https://example.com/private");
    await expect(storageRead(doc)).rejects.toMatchObject({ code: "storage_unconfigured" });
    expect(requests).toHaveLength(0);
    vi.stubEnv("NEON_STORAGE_ENDPOINT", "https://br-synthetic.storage.c-1.us-east-2.aws.neon.tech");
    send = async () => { throw new Error("Synthetic credential and signed URL must stay out of the response"); };
    await expect(storageRead(doc)).rejects.toMatchObject({ code: "storage_unavailable", message: "Private object storage is unavailable. Your saved work has been preserved; retry shortly." });
  });

  it("cancels an in-flight deletion using the caller's sweep deadline without starting staging cleanup", async () => {
    const doc = document(), controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const destroy = vi.spyOn(S3Client.prototype, "destroy");
    vi.mocked(S3Client.prototype.send).mockImplementation((command, options) => {
      requests.push(command as Command);
      transportSignal = (options as { abortSignal: AbortSignal }).abortSignal;
      return new Promise((_resolve, reject) => {
        transportSignal!.addEventListener("abort", () => reject(transportSignal!.reason), { once: true });
      }) as never;
    });
    const deletion = storageDelete(doc, { signal: controller.signal });
    expect(transportSignal?.aborted).toBe(false);
    controller.abort(new Error("Synthetic private cancellation detail"));
    await expect(deletion).rejects.toMatchObject({ code: "storage_unavailable", message: "Private object storage is unavailable. Your saved work has been preserved; retry shortly." });
    expect(transportSignal?.aborted).toBe(true);
    expect(requests.map(command => command.input.Key)).toEqual([doc.storagePath]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses one deletion signal for both objects and refuses an already expired sweep", async () => {
    const doc = document(), signals: AbortSignal[] = [];
    vi.mocked(S3Client.prototype.send).mockImplementation((command, options) => {
      signals.push((options as { abortSignal: AbortSignal }).abortSignal);
      return send(command as Command) as never;
    });
    await storageDelete(doc);
    expect(signals).toHaveLength(2); expect(signals[0]).toBe(signals[1]);
    requests = [];
    await expect(storageDelete(doc, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(requests).toHaveLength(0);
  });
});
