import type { Comparison, ProcessingMode, ProcessingRun, ParsedDocument, Quotation } from "@/lib/domain/types";

export interface DocumentRecord {
  id: string; comparisonId: string; ownerId: string; filename: string; contentType: string;
  contentHash: string; size: number; storagePath: string; createdAt: string;
  status: "uploading" | "uploaded" | "deleted"; supersedesId?: string; processingMode?: ProcessingMode;
}
export interface RunRecord extends ProcessingRun {
  ownerId: string; taskRunId?: string; dispatchedAt?: string; leaseUntil?: string;
  extractionVersion: number; expectedHash: string; retryable?: boolean;
  retryAfter?: string; quotaWaits?: number;
}
export interface ExtractionRecord { id: string; documentId: string; version: number; quotation: Quotation; createdAt: string; }
export interface ComparisonRecord { ownerId: string; comparison: Comparison; deletedAt?: string; }
export interface State {
  version: 1; comparisons: Record<string, ComparisonRecord>; documents: Record<string, DocumentRecord>;
  runs: Record<string, RunRecord>; extractions: Record<string, ExtractionRecord>; parsed: Record<string, ParsedDocument>;
  deletionOutbox: { id: string; storagePath: string; ownerId: string; createdAt: string }[];
  checkpoints?: Record<string, unknown>;
}
export interface Repository {
  mode: "local" | "cloud";
  list(ownerId: string): Promise<Comparison[]>;
  get(ownerId: string, id: string): Promise<Comparison>;
  create(ownerId: string, comparison: Comparison): Promise<void>;
  save(ownerId: string, comparison: Comparison, expectedRevision: number): Promise<void>;
  remove(ownerId: string, comparisonId: string): Promise<void>;
  removeDocument(ownerId: string, documentId: string, expectedRevision: number): Promise<void>;
  createUpload(ownerId: string, document: DocumentRecord, run: RunRecord | null, quotation: Quotation, expectedRevision: number): Promise<void>;
  finalizeUpload(ownerId: string, documentId: string, hash: string, run: RunRecord): Promise<void>;
  document(ownerId: string, id: string): Promise<DocumentRecord>;
  findDuplicate(ownerId: string, comparisonId: string, hash: string): Promise<DocumentRecord | null>;
  run(ownerId: string, id: string): Promise<RunRecord>;
  runs(ownerId: string, comparisonId: string): Promise<RunRecord[]>;
  pendingRuns(): Promise<RunRecord[]>;
  saveRun(run: RunRecord, expectedFence?: string): Promise<boolean>;
  renewLease(id: string, fence: string, leaseUntil: string): Promise<boolean>;
  claimRun(id: string, fence: string, leaseUntil: string): Promise<RunRecord | null>;
  retryRun(ownerId: string, id: string): Promise<RunRecord>;
  saveParsed(run: RunRecord, parsed: ParsedDocument): Promise<void>;
  getParsed(documentId: string): Promise<ParsedDocument | null>;
  getCheckpoint(documentId: string, key: string): Promise<unknown | null>;
  saveCheckpoint(run: RunRecord, key: string, value: unknown): Promise<void>;
  complete(run: RunRecord, quotation: Quotation): Promise<boolean>;
  writeObject(document: DocumentRecord, bytes: Uint8Array): Promise<void>;
  readObject(document: DocumentRecord): Promise<Uint8Array>;
  deleteObject(document: DocumentRecord): Promise<void>;
  cleanup(): Promise<void>;
}
