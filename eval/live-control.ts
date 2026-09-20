import type { AIRequest, AIRequestFunction, AIResult } from "../src/lib/ai/groq";

export interface LiveHalt { code: string; purpose: AIRequest["purpose"]; retryAfterMs: number | null; at: string; }
export type LiveEvent = { event: string; at: string; purpose: AIRequest["purpose"]; code?: string; retryAfterMs?: number; inputTokens?: number; outputTokens?: number; elapsedMs?: number; model?: string; costUsd?: string | null; usageAvailable?: boolean };
export function errorCode(error: unknown): string { return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unexpected_error"; }

/** A single bounded session; successful request checkpoints survive separate sessions. */
export function liveRequestController(options: {
  request: AIRequestFunction;
  waitQuota?: boolean;
  maxNewRequests?: number;
  maxQuotaWaits?: number;
  persist(event: LiveEvent): Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}) {
  const state = { attemptedRequests: 0, completedResponses: 0, quotaWaits: 0, waitedMs: 0, halt: null as LiveHalt | null };
  const now = () => new Date(options.now?.() ?? Date.now()).toISOString();
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const request: AIRequestFunction = async (input, context): Promise<AIResult> => {
    if (state.halt) throw Object.assign(new Error("This evaluation session has paused; resume the same configuration after the reported limit."), state.halt);
    for (;;) {
      if (state.attemptedRequests >= (options.maxNewRequests ?? Number.POSITIVE_INFINITY)) {
        state.halt = { code: "evaluation_budget", purpose: input.purpose, retryAfterMs: null, at: now() };
        await options.persist({ event: "session_paused", ...state.halt, retryAfterMs: undefined });
        throw Object.assign(new Error("The requested evaluation request budget was reached. Completed requests are checkpointed."), state.halt);
      }
      state.attemptedRequests++;
      await options.persist({ event: "request_started", at: now(), purpose: input.purpose });
      try {
        const result = await options.request(input, context);
        state.completedResponses++;
        await options.persist({ event: "response_received", at: now(), purpose: input.purpose, inputTokens: result.inputTokens, outputTokens: result.outputTokens, elapsedMs: result.elapsedMs, model: result.model, costUsd: result.costUsd, usageAvailable: result.usageAvailable });
        return result;
      } catch (error) {
        const code = errorCode(error), raw = (error as { retryAfterMs?: unknown })?.retryAfterMs;
        const retryAfterMs = typeof raw === "number" && Number.isFinite(raw) ? Math.max(1000, raw) : 60_000;
        await options.persist({ event: "request_failed", at: now(), purpose: input.purpose, code, ...(code === "quota" ? { retryAfterMs } : {}) });
        if (code === "quota" && options.waitQuota && retryAfterMs <= 60_000 && state.quotaWaits < (options.maxQuotaWaits ?? 30) && state.attemptedRequests < (options.maxNewRequests ?? Number.POSITIVE_INFINITY)) {
          state.quotaWaits++; state.waitedMs += retryAfterMs;
          await options.persist({ event: "quota_wait", at: now(), purpose: input.purpose, retryAfterMs });
          await wait(retryAfterMs);
          continue;
        }
        if (code === "quota" || code === "ai_unavailable") state.halt = { code, purpose: input.purpose, retryAfterMs: code === "quota" ? retryAfterMs : null, at: now() };
        throw error;
      }
    }
  };
  return { request, state };
}
