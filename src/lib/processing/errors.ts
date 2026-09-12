import type { ProcessingStage } from "../domain/types";

export type ProcessingErrorCode = "unsupported_format" | "password_protected" | "file_too_large" | "limit_exceeded" | "malformed_file" | "unreadable" | "cancelled" | "timeout" | "ai_unavailable" | "quota" | "model_error" | "invalid_output" | "invalid_evidence";
export class ProcessingError extends Error {
  constructor(public readonly code: ProcessingErrorCode, message: string, public readonly retryable = false, public readonly retryAfterMs?: number) {
    super(message); this.name = "ProcessingError";
  }
}
export class AIUnavailableError extends ProcessingError {
  constructor(message = "Live extraction is unavailable. Configure a Groq Free Plan API key and confirm free-tier and Zero Data Retention settings. The demonstration uses labelled fixtures.") {
    super("ai_unavailable", message); this.name = "AIUnavailableError";
  }
}
export interface ProcessingProgress { stage: ProcessingStage; progress: number; message: string; }
export interface ProgressOptions { signal?: AbortSignal; onProgress?: (event: ProcessingProgress) => void | Promise<void>; }
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProcessingError("cancelled", "Processing cancelled. Completed work has been preserved.");
}
export async function progress(options: ProgressOptions, stage: ProcessingStage, value: number, message: string): Promise<void> {
  checkCancelled(options.signal); await options.onProgress?.({ stage, progress: value, message });
}
export async function bounded<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal, onStop?: () => void | Promise<unknown>): Promise<T> {
  checkCancelled(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const guard = new Promise<never>((_, reject) => {
    const stop = (error: ProcessingError) => { void Promise.resolve(onStop?.()).catch(() => {}); reject(error); };
    timer = setTimeout(() => stop(new ProcessingError("timeout", "This processing stage exceeded its time limit. Retry this file or upload a smaller document.", true)), timeoutMs);
    abort = () => stop(new ProcessingError("cancelled", "Processing cancelled. Completed work has been preserved."));
    signal?.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([operation, guard]); }
  finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
}
