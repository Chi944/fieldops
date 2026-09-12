import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { LIMITS } from "@/lib/domain/types";
import type { DocumentRecord } from "./contracts";
import { ApiError } from "./errors";

const operationTimeoutMs = 45_000;
const sourceLifetimeSeconds = 60;
const uploadLifetimeSeconds = 300;
const canonicalKeyPattern = /^[A-Za-z0-9_-]{1,128}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyFor(document: DocumentRecord, allowDeleted = false) {
  if (!canonicalKeyPattern.test(document.storagePath) || document.storagePath !== `${document.ownerId}/${document.id}`) {
    throw new ApiError(422, "invalid_storage_path", "The saved source location is invalid.");
  }
  if (!allowDeleted && document.status === "deleted") throw new ApiError(404, "source_unavailable", "The original source is unavailable.");
  return document.storagePath;
}
function expectedSize(document: DocumentRecord) {
  if (!Number.isSafeInteger(document.size) || document.size <= 0 || document.size > LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(document.contentHash)) {
    throw new ApiError(422, "integrity_check", "The source has invalid size or integrity information.");
  }
  return document.size;
}
function checkLength(document: DocumentRecord, actual: number | undefined) {
  if (actual !== expectedSize(document)) throw new ApiError(422, "integrity_check", "Uploaded bytes do not match the selected file size. Delete this upload and try again.");
}
function checkBytes(document: DocumentRecord, bytes: Uint8Array) {
  checkLength(document, bytes.byteLength);
  if (createHash("sha256").update(bytes).digest("hex") !== document.contentHash) {
    throw new ApiError(422, "integrity_check", "Uploaded bytes do not match the selected file. Delete this upload and try again.");
  }
}
function storageConfiguration() {
  const endpoint = process.env.NEON_STORAGE_ENDPOINT;
  const accessKeyId = process.env.NEON_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.NEON_STORAGE_SECRET_ACCESS_KEY;
  const region = process.env.NEON_STORAGE_REGION;
  if (!endpoint || !accessKeyId || !secretAccessKey || !region) throw new ApiError(503, "storage_unconfigured", "Private Neon object storage is not configured.");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new ApiError(503, "storage_unconfigured", "Private Neon object storage has an invalid endpoint."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname.endsWith(".neon.tech") || !url.hostname.includes(".storage.")) {
    throw new ApiError(503, "storage_unconfigured", "Private Neon object storage must use its secure branch endpoint.");
  }
  const bucket = process.env.NEON_STORAGE_BUCKET || "quotations";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new ApiError(503, "storage_unconfigured", "The private storage bucket name is invalid.");
  return { endpoint, accessKeyId, secretAccessKey, region, bucket };
}
function safeStorageError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const detail = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (detail?.$metadata?.httpStatusCode === 404 || ["NotFound", "NoSuchKey"].includes(detail?.name ?? "")) {
    throw new ApiError(404, "source_unavailable", "The original source could not be found. Complete the upload or retry it.");
  }
  throw new ApiError(503, "storage_unavailable", "Private object storage is unavailable. Your saved work has been preserved; retry shortly.");
}
async function withStorage<T>(operation: (client: S3Client, bucket: string) => Promise<T>): Promise<T> {
  const config = storageConfiguration();
  const client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, forcePathStyle: true,
    maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  try { return await operation(client, config.bucket); }
  catch (error) { return safeStorageError(error); }
  finally { client.destroy(); }
}

/** The HEAD check happens before GET; the stream remains bounded if an upload changes between them. */
async function readKey(client: S3Client, bucket: string, document: DocumentRecord, key: string): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(operationTimeoutMs);
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
  checkLength(document, head.ContentLength);
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
  const body = result.Body as (AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void }) | undefined;
  const abort = () => body?.destroy?.(new Error("Storage read timed out"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    checkLength(document, result.ContentLength);
    if (!body || !(Symbol.asyncIterator in body)) throw new ApiError(503, "storage_unavailable", "The original source could not be read.");
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of body) {
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new ApiError(503, "storage_unavailable", "The original source could not be read.");
      size += chunk.byteLength;
      if (size > document.size || size > LIMITS.fileBytes) throw new ApiError(422, "integrity_check", "The uploaded object exceeds the selected file size.");
      chunks.push(chunk);
    }
    signal.throwIfAborted();
    const bytes = Buffer.concat(chunks, size); checkBytes(document, bytes); return bytes;
  } finally { signal.removeEventListener("abort", abort); body?.destroy?.(); }
}

/** Callers must authorize the record first. Canonical keys are never writable by a browser URL. */
export async function storageRead(document: DocumentRecord): Promise<Uint8Array> {
  const key = keyFor(document); expectedSize(document);
  return withStorage((client, bucket) => readKey(client, bucket, document, key));
}
export async function storageWrite(document: DocumentRecord, bytes: Uint8Array): Promise<void> {
  const key = keyFor(document); checkBytes(document, bytes);
  await withStorage(async (client, bucket) => {
    // Neon does not document conditional PUT enforcement. Only trusted server code
    // writes this key; concurrent valid finalizations can write identical bytes only.
    try { await readKey(client, bucket, document, key); return; }
    catch (error) {
      const detail = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (detail?.$metadata?.httpStatusCode !== 404 && !["NotFound", "NoSuchKey"].includes(detail?.name ?? "")) throw error;
    }
    const inline = ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(document.contentType);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: document.size, ContentType: document.contentType,
      CacheControl: "private, no-store", ContentDisposition: `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      Metadata: { "fieldops-sha256": document.contentHash } }), { abortSignal: AbortSignal.timeout(operationTimeoutMs) });
  });
}
export async function storageUploadIntent(document: DocumentRecord, requestedAt = new Date()) {
  const key = keyFor(document); expectedSize(document);
  if (document.status !== "uploading") throw new ApiError(409, "source_upload_complete", "This source is already saved.");
  const age = Date.now() - requestedAt.getTime();
  if (!Number.isFinite(age) || age < -1000 || age >= (uploadLifetimeSeconds - 15) * 1000) {
    throw new ApiError(503, "upload_unavailable", "The upload request took too long. Retry the file to get a fresh upload link.");
  }
  return withStorage(async (client, bucket) => ({
    uploadUrl: await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: `${key}.upload`, ContentType: document.contentType, ContentLength: document.size }),
      { expiresIn: uploadLifetimeSeconds, signingDate: requestedAt, signableHeaders: new Set(["content-type", "content-length"]) }),
    method: "PUT" as const,
    // Content-Length is signed but the browser sets it from the File body.
    headers: { "Content-Type": document.contentType },
    expiresIn: uploadLifetimeSeconds,
    expiresAt: new Date(requestedAt.getTime() + uploadLifetimeSeconds * 1000).toISOString(),
  }));
}
export async function storageFinalizeUpload(document: DocumentRecord): Promise<Uint8Array> {
  const key = keyFor(document); expectedSize(document);
  // A previous finalize can have saved bytes before its DB commit or response failed.
  try { return await storageRead(document); }
  catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
  const bytes = await withStorage((client, bucket) => readKey(client, bucket, document, `${key}.upload`));
  await storageWrite(document, bytes); return bytes;
}
export async function storageDiscardUpload(document: DocumentRecord): Promise<void> {
  const key = keyFor(document, true);
  await withStorage(async (client, bucket) => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${key}.upload` }), { abortSignal: AbortSignal.timeout(operationTimeoutMs) }); });
}
export async function storageDelete(documentOrKey: DocumentRecord | string, options: { signal?: AbortSignal } = {}): Promise<void> {
  const key = typeof documentOrKey === "string" ? documentOrKey : keyFor(documentOrKey, true);
  if (!canonicalKeyPattern.test(key)) throw new ApiError(422, "invalid_storage_path", "The saved source location is invalid.");
  // One deadline covers both objects and SDK retries; callers can impose a shorter sweep budget.
  const timeout = AbortSignal.timeout(operationTimeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  await withStorage(async (client, bucket) => {
    for (const target of [key, `${key}.upload`]) {
      signal.throwIfAborted();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: target }), { abortSignal: signal });
    }
    signal.throwIfAborted();
  });
}
export async function storageSourceUrl(document: DocumentRecord): Promise<string> {
  const key = keyFor(document); expectedSize(document);
  if (document.status !== "uploaded") throw new ApiError(409, "source_uploading", "This source has not finished uploading.");
  return withStorage(async (client, bucket) => {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(operationTimeoutMs) });
    checkLength(document, head.ContentLength);
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: sourceLifetimeSeconds });
  });
}
