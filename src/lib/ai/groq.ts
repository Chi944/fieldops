import { createHash } from "node:crypto";
import { AIUnavailableError, ProcessingError, bounded, checkCancelled, type ProgressOptions } from "../processing/errors";

export interface AIRequest { purpose: "extraction" | "matching" | "explanation"; schema: Record<string, unknown>; system: string; user: string; maxOutputTokens: number; }
export interface AIResult { data: unknown; model: string; inputTokens: number; outputTokens: number; elapsedMs: number; costUsd: string | null; }
export type AIRequestFunction = (request: AIRequest, options?: { signal?: AbortSignal }) => Promise<AIResult>;
export interface AICheckpoint { get(key: string): Promise<AIResult | null>; set(key: string, value: AIResult): Promise<void>; }
export interface AIOptions extends ProgressOptions { request?: AIRequestFunction; checkpoint?: AICheckpoint; extractionVersion?: number; }
export const DEFAULT_MODEL = "openai/gpt-oss-120b";
export const PROMPT_VERSION = "fieldops-extraction-1";
const MODELS = new Set([DEFAULT_MODEL, "openai/gpt-oss-20b"]);
// One request at a time. Provider quota remains authoritative across deployed workers.
let pending: Promise<unknown> = Promise.resolve();
let quotaWindow = 0; let windowReservation = 0; let dailyDate = ""; let dailyReservation = 0;
export function liveAIConfiguration(): { ready: boolean; model: string; reason: string | null } {
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  if (!process.env.GROQ_API_KEY) return { ready: false, model, reason: "GROQ_API_KEY is missing. Demo fixtures are available; live extraction has not run." };
  if (process.env.GROQ_FREE_TIER_CONFIRMED !== "true") return { ready: false, model, reason: "Confirm the Groq account is on its Free Plan with GROQ_FREE_TIER_CONFIRMED=true. Paid accounts and paid fallback are not supported." };
  if (process.env.GROQ_ZDR_CONFIRMED !== "true") return { ready: false, model, reason: "Enable Zero Data Retention in Groq Data Controls, then set GROQ_ZDR_CONFIRMED=true before uploading private documents." };
  if (!MODELS.has(model)) return { ready: false, model, reason: "GROQ_MODEL must be an explicitly supported free-tier structured-output model: openai/gpt-oss-120b or openai/gpt-oss-20b." };
  return { ready: true, model, reason: null };
}
export function requireLiveAI(): void { const configuration = liveAIConfiguration(); if (!configuration.ready) throw new AIUnavailableError(configuration.reason ?? undefined); }

export async function requestAI(request: AIRequest, options: AIOptions = {}): Promise<AIResult> {
  checkCancelled(options.signal);
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const key = createHash("sha256").update(JSON.stringify({ version: PROMPT_VERSION, model, request })).digest("hex");
  const previous = await options.checkpoint?.get(key); if (previous) return previous;
  const result = options.request ? await options.request(request, { signal: options.signal }) : await enqueue(() => requestGroq(request, options));
  checkCancelled(options.signal); await options.checkpoint?.set(key, result); return result;
}

async function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation); pending = result.catch(() => {}); return result;
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
  const estimatedInput = Math.ceil((request.system.length + request.user.length + JSON.stringify(request.schema).length) / 3);
  reserveQuota(estimatedInput + request.maxOutputTokens);
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    checkCancelled(options.signal);
    try {
      const response = await bounded(client.chat.completions.create({ model: configuration.model, messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }], reasoning_effort: "low", temperature: 0,
        max_completion_tokens: request.maxOutputTokens, response_format: { type: "json_schema", json_schema: { name: `fieldops_${request.purpose}`, strict: true, schema: request.schema } } }, { signal: options.signal }), 45000, options.signal);
      const choice = response.choices[0];
      if (!choice || choice.finish_reason !== "stop" || !choice.message.content) throw new ProcessingError("invalid_output", "The model returned an incomplete extraction. Split this section into fewer rows and retry; no partial model output was accepted.");
      let data: unknown; try { data = JSON.parse(choice.message.content); } catch { throw new ProcessingError("invalid_output", "The model did not return valid structured data. Retry the failed section.", true); }
      return { data, model: configuration.model, inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0, costUsd: "0", elapsedMs: Date.now() - started };
    } catch (error) {
      if (options.signal?.aborted) throw new ProcessingError("cancelled", "Extraction cancelled. Saved parser and extraction chunks remain available.");
      if (error instanceof ProcessingError) throw error;
      const status = (error as { status?: number }).status;
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
