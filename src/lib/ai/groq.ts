import { createHash } from "node:crypto";
import { extractionWireSchema, expandExtraction } from "./transport";
import { strictSchema } from "./schema";
import { AIUnavailableError, ProcessingError, bounded, checkCancelled, type ProcessingErrorCode, type ProgressOptions } from "../processing/errors";

export interface AIRequest { purpose: "extraction" | "matching" | "explanation"; schema: Record<string, unknown>; system: string; user: string; maxOutputTokens: number; transport?: "quotation-v4"; }
export interface AIResult { data: unknown; model: string; inputTokens: number; outputTokens: number; elapsedMs: number; costUsd: string | null; finishReason?: string; usageAvailable?: boolean; contentCharacters?: number; reasoningCharacters?: number; rejectedAt?: "transport"; providerError?: { code: string; message: string | null }; }
export type AIRequestFunction = (request: AIRequest, options?: { signal?: AbortSignal }) => Promise<AIResult>;
export interface AICheckpoint {
  get(key: string): Promise<AIResult | null>;
  set(key: string, value: AIResult): Promise<void>;
  /** Optional private rejection journal. Never expose result.data in application logs. */
  reject?(key: string, result: AIResult, errorCode: ProcessingErrorCode, context?: { cached: boolean }): Promise<void>;
}
export interface AIOptions extends ProgressOptions { request?: AIRequestFunction; checkpoint?: AICheckpoint; extractionVersion?: number; }
export const DEFAULT_MODEL = "openai/gpt-oss-120b";
export const PROMPT_VERSION = "fieldops-extraction-5";
const MODELS = new Set([DEFAULT_MODEL, "openai/gpt-oss-20b"]);
// One request at a time. Provider quota remains authoritative across deployed workers.
let pending: Promise<unknown> = Promise.resolve();
let quotaWindow = 0; let windowReservation = 0; let dailyDate = ""; let dailyReservation = 0;
export function liveAIConfiguration(): { ready: boolean; model: string; reason: string | null } {
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  if (process.env.FIELDOPS_PROCESSING_MODE !== "ai") return { ready: false, model, reason: "AI interpretation is disabled. Set FIELDOPS_PROCESSING_MODE=ai only when intentionally enabling the configured free integration." };
  if (!process.env.GROQ_API_KEY) return { ready: false, model, reason: "GROQ_API_KEY is missing. Demo fixtures are available; live extraction has not run." };
  if (process.env.GROQ_FREE_TIER_CONFIRMED !== "true") return { ready: false, model, reason: "Confirm the Groq account is on its Free Plan with GROQ_FREE_TIER_CONFIRMED=true. Paid accounts and paid fallback are not supported." };
  if (process.env.GROQ_ZDR_CONFIRMED !== "true") return { ready: false, model, reason: "Enable Zero Data Retention in Groq Data Controls, then set GROQ_ZDR_CONFIRMED=true before uploading private documents." };
  if (!MODELS.has(model)) return { ready: false, model, reason: "GROQ_MODEL must be an explicitly supported free-tier structured-output model: openai/gpt-oss-120b or openai/gpt-oss-20b." };
  return { ready: true, model, reason: null };
}
export function requireLiveAI(): void { const configuration = liveAIConfiguration(); if (!configuration.ready) throw new AIUnavailableError(configuration.reason ?? undefined); }

class RejectedResponse extends ProcessingError {
  readonly result: AIResult;
  constructor(message: string, result: AIResult, retryable = false) { super("invalid_output", message, retryable); this.result = { ...result, rejectedAt: "transport" }; }
}

export async function requestAI<T = AIResult>(request: AIRequest, options: AIOptions = {}, validate?: (result: AIResult) => T | Promise<T>): Promise<T> {
  checkCancelled(options.signal);
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const key = createHash("sha256").update(JSON.stringify({ version: PROMPT_VERSION, model, request })).digest("hex");
  // Raw transport requests are never successful checkpoints. Domain callers must
  // validate schema, evidence and integration before an answer becomes resumable.
  const checkpoint = validate ? options.checkpoint : undefined;
  const reject = async (result: AIResult, error: unknown, cached: boolean) => {
    const errorCode = error instanceof ProcessingError ? error.code : "invalid_output";
    await options.checkpoint?.reject?.(key, result, errorCode, { cached });
    console.info(JSON.stringify({ event: "ai_response_rejected", requestKey: key, purpose: request.purpose, errorCode, cached }));
  };
  const previous = await checkpoint?.get(key);
  checkCancelled(options.signal);
  if (previous && validate) {
    try { return await validate(previous); }
    catch (error) {
      checkCancelled(options.signal);
      await reject(previous, error, true);
      // An old raw-response checkpoint may be invalid. Report it and bypass it;
      // a fresh response below still gets only one validation attempt per call.
    }
  }
  let result: AIResult;
  try { result = options.request ? await options.request(request, { signal: options.signal }) : await enqueue(() => requestGroq(request, options)); }
  catch (error) {
    if (error instanceof RejectedResponse) {
      await reject(error.result, error, false);
      // Keep private response contents inside the rejection hook, not the public error.
      throw new ProcessingError(error.code, error.message, error.retryable);
    }
    throw error;
  }
  checkCancelled(options.signal);
  let value: T;
  try { value = validate ? await validate(result) : result as T; }
  catch (error) { await reject(result, error, false); throw error; }
  checkCancelled(options.signal);
  await checkpoint?.set(key, result);
  return value;
}

async function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation); pending = result.catch(() => {}); return result;
}

/** Short transport aliases reduce repeated citation tokens; stored IDs stay parser-owned. */
export function compactExtractionRequest(request: AIRequest): { request: AIRequest; restore(data: unknown): unknown } {
  if (request.purpose !== "extraction") return { request, restore: data => data };
  let body: { sources?: { id: string; [key: string]: unknown }[]; context?: { id: string; [key: string]: unknown }[] };
  try { body = JSON.parse(request.user); } catch { return { request, restore: data => data }; }
  if (!Array.isArray(body.sources)) return { request, restore: data => data };
  const targets = body.sources, context = body.context ?? [];
  const all = [...targets, ...context];
  const original = new Map(all.map((source, index) => [`s${index}`, source.id]));
  const aliases = new Map(all.map((source, index) => [source.id, `s${index}`]));
  const user = JSON.stringify({ ...body, sources: targets.map(source => ({ ...source, id: aliases.get(source.id) })), ...(body.context ? { context: context.map(source => ({ ...source, id: aliases.get(source.id) })) } : {}) });
  function identifier(value: unknown): string {
    if (typeof value !== "string" || !original.has(value)) throw new Error("Unknown evidence alias");
    return original.get(value)!;
  }
  function restore(data: unknown): unknown {
    if (Array.isArray(data)) return data.map(restore);
    if (!data || typeof data !== "object") return data;
    return Object.fromEntries(Object.entries(data).map(([key, value]) => {
      if (key === "sourceIds") return [key, Array.isArray(value) ? value.map(identifier) : value];
      if (key === "sourceId" || key === "itemSourceId") return [key, value === null ? null : identifier(value)];
      return [key, restore(value)];
    }));
  }
  return { request: { ...request, user, ...(request.transport === "quotation-v4" ? { schema: strictSchema(extractionWireSchema) } : {}) }, restore: data => {
    const restored = restore(data);
    return request.transport === "quotation-v4" ? expandExtraction(restored, targets.map(source => source.id), context.map(source => source.id)) : restored;
  } };
}

function reserveQuota(tokens: number): void {
  const now = Date.now(); const date = new Date(now).toISOString().slice(0, 10);
  if (now - quotaWindow >= 60000) { quotaWindow = now; windowReservation = 0; }
  if (date !== dailyDate) { dailyDate = date; dailyReservation = 0; }
  if (tokens > 7500) throw new ProcessingError("limit_exceeded", "This extraction chunk is too large for the free model quota. Split the document into smaller sections.");
  if (dailyReservation + tokens > 180000) throw new ProcessingError("quota", "The local daily free-tier safety budget has been reached. Completed chunks are saved; resume after the daily quota resets.", true, 24 * 60 * 60 * 1000);
  if (windowReservation + tokens > 7500) throw new ProcessingError("quota", "Waiting for the free model token quota. Completed chunks are saved and will be reused when processing resumes.", true, Math.max(1000, 60000 - (now - quotaWindow)));
  windowReservation += tokens; dailyReservation += tokens;
}

async function requestGroq(request: AIRequest, options: AIOptions): Promise<AIResult> {
  requireLiveAI(); checkCancelled(options.signal);
  const configuration = liveAIConfiguration();
  const Groq = (await import("groq-sdk")).default;
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 45000 });
  const wire = compactExtractionRequest(request);
  const estimatedInput = Math.ceil((wire.request.system.length + wire.request.user.length + JSON.stringify(wire.request.schema).length) / 3);
  reserveQuota(estimatedInput + request.maxOutputTokens);
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    checkCancelled(options.signal);
    try {
      const response = await bounded(client.chat.completions.create({ model: configuration.model, messages: [{ role: "system", content: wire.request.system }, { role: "user", content: wire.request.user }], reasoning_effort: "low", temperature: 0,
        max_completion_tokens: request.maxOutputTokens, response_format: { type: "json_schema", json_schema: { name: `fieldops_${request.purpose}_${createHash("sha256").update(JSON.stringify(wire.request.schema)).digest("hex").slice(0, 12)}`, strict: true, schema: wire.request.schema } } }, { signal: options.signal }), 45000, options.signal);
      const choice = response.choices[0];
      const result: AIResult = { data: choice?.message.content ?? null, model: configuration.model, inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0, usageAvailable: !!response.usage, costUsd: response.usage ? "0" : null, elapsedMs: Date.now() - started, finishReason: choice?.finish_reason ?? "missing", contentCharacters: choice?.message.content?.length ?? 0, reasoningCharacters: choice?.message.reasoning?.length ?? 0 };
      if (!choice || choice.finish_reason !== "stop" || !choice.message.content) throw new RejectedResponse("The model returned an incomplete extraction. Split this section into fewer rows and retry; no partial model output was accepted.", result);
      let data: unknown; try { data = JSON.parse(choice.message.content); } catch { throw new RejectedResponse("The model did not return valid structured data. Retry the failed section.", result, true); }
      try { data = wire.restore(data); }
      catch { throw new RejectedResponse("The model returned evidence outside its supplied source records. The interpretation was rejected.", { ...result, data }); }
      return { ...result, data };
    } catch (error) {
      if (options.signal?.aborted) throw new ProcessingError("cancelled", "Extraction cancelled. Saved parser and extraction chunks remain available.");
      if (error instanceof ProcessingError) throw error;
      const status = (error as { status?: number }).status;
      const payload = (error as { error?: { error?: { code?: string; message?: unknown; failed_generation?: unknown }; code?: string; message?: unknown; failed_generation?: unknown } }).error;
      const validation = payload?.error ?? payload;
      if (status === 400 && validation?.code === "json_validate_failed" && typeof validation.failed_generation === "string") {
        throw new RejectedResponse("The provider rejected its generated structured output. No interpretation was accepted; retry this quotation section or use manual review.", { data: validation.failed_generation, model: configuration.model, inputTokens: 0, outputTokens: 0, elapsedMs: Date.now() - started, costUsd: null, finishReason: "provider_schema_rejected", usageAvailable: false, providerError: { code: validation.code, message: typeof validation.message === "string" ? validation.message : null } });
      }
      if (status === 429) {
        const headers = (error as { headers?: { get?(key: string): string | null; [key: string]: unknown } }).headers;
        const raw = headers?.get?.("retry-after") ?? headers?.["retry-after"];
        const retryAfterMs = typeof raw === "string" && Number.isFinite(Number(raw)) ? Math.max(1000, Number(raw) * 1000) : 60000;
        throw new ProcessingError("quota", "The Groq free-tier quota is currently exhausted. Processing will resume from saved chunks after quota reset; no paid fallback is used.", true, retryAfterMs);
      }
      if (status === 401 || status === 403) throw new AIUnavailableError("The Groq key is invalid or the configured model is unavailable to this account. Check your Free Plan key and model permissions.");
      if (attempt === 0 && (status === undefined || status >= 500)) {
        // Retry only transient transport failures, and reserve their worst-case usage too.
        reserveQuota(estimatedInput + request.maxOutputTokens);
        continue;
      }
      throw new ProcessingError("model_error", "The model request failed. Your quotation text was not added to application logs. Check model configuration and retry the failed file.", status === undefined || status >= 500);
    }
  }
  throw new ProcessingError("model_error", "The model request failed after the bounded retry limit.", true);
}
