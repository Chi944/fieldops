import { compactExtractionRequest, type AIRequest, type AIRequestFunction, type AIResult } from "../src/lib/ai/groq";
import { errorCode } from "./live-control";
import type { Quotation } from "../src/lib/domain/types";
import { resolveField } from "../src/lib/domain/corrections";
import type { FixtureRecord } from "../scripts/generate-fixtures";
import { scoreFailedExtraction } from "./metrics";

export const DEVELOPMENT_IDS = ["industrial-1", "industrial-2", "industrial-3", "office-1", "office-2", "office-3", "event-1", "event-2", "event-3", "translation-1", "translation-2", "translation-3"] as const;
export const PAIRED_COHORT = ["industrial-1", "translation-2", "office-2"];
/** New study protocol only: historical reports keep their original scoring. */
export function unattemptedDevelopmentScore(fixture: FixtureRecord, comparisonKind?: "model") {
  return comparisonKind === "model" ? scoreFailedExtraction(fixture) : undefined;
}
export interface DevelopmentOptions {
  name: string; phase: "before" | "after"; live: boolean; documentIds: string[];
  maxRequests: number; maxReservedTokens: number; maxWaitMs: number; envFile?: ".env.ai.local";
  baselineName?: string;
  comparisonKind?: "model";
  model?: "openai/gpt-oss-120b" | "qwen/qwen3.8-27b";
  chunkFailurePolicy: "reject_document" | "retain_valid_chunks_v1";
  extractionTransport?: "legacy_v5" | "typed_fields_v1" | "typed_fields_v2" | "fact_ledger_v1" | "focused_fields_v1" | "focused_fields_v2";
}
export function parseDevelopmentOptions(args: string[]): DevelopmentOptions {
  const values = new Map<string, string>(); let live = false;
  const allowed = new Set(["--name", "--phase", "--split", "--documents", "--max-requests", "--max-reserved-tokens", "--max-wait-ms", "--env-file", "--mode", "--baseline-name", "--chunk-failure-policy", "--extraction-transport", "--comparison-kind", "--model"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--live" && !live) { live = true; continue; }
    if (!allowed.has(flag) || values.has(flag) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown, repeated or incomplete development-evaluation option.");
    values.set(flag, args[++index]);
  }
  if (values.has("--split") && values.get("--split") !== "dev") throw new Error("Only the development split is permitted; all and heldout are prohibited.");
  if (values.has("--mode") && (values.get("--mode") !== "baseline" || live)) throw new Error("Use --mode baseline or --live, not both.");
  const name = values.get("--name"), phase = values.get("--phase");
  if (!name || !/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("A --name containing 3–64 lowercase letters, digits and hyphens is required.");
  if (phase !== "before" && phase !== "after") throw new Error("Use --phase before or after.");
  const documentIds = values.has("--documents") ? values.get("--documents")!.split(",") : [...PAIRED_COHORT];
  assertDevelopmentIds(documentIds);
  const number = (flag: string, fallback: number, maximum: number, minimum = 1) => {
    const result = values.has(flag) ? Number(values.get(flag)) : fallback;
    if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}.`);
    return result;
  };
  const envFile = values.get("--env-file");
  if (envFile !== undefined && envFile !== ".env.ai.local") throw new Error("Only the dedicated .env.ai.local file may be loaded.");
  if (!live && envFile) throw new Error("Offline runs do not load credentials.");
  const baselineName = values.get("--baseline-name");
  if (baselineName !== undefined && (!live || phase !== "after" || baselineName === name || !/^[a-z][a-z0-9-]{2,63}$/.test(baselineName))) throw new Error("--baseline-name requires a different existing experiment name and a live after phase.");
  const comparisonKind = values.get("--comparison-kind"), model = values.get("--model");
  if (comparisonKind !== undefined && comparisonKind !== "model") throw new Error("Only explicit model comparison is supported.");
  if (comparisonKind === "model" && (!live || baselineName || !["openai/gpt-oss-120b", "qwen/qwen3.8-27b"].includes(model ?? "") || JSON.stringify(documentIds) !== JSON.stringify(PAIRED_COHORT))) throw new Error("Model comparison requires live mode, an allowlisted explicit model, the complete fixed cohort, and no referenced baseline.");
  if (model !== undefined && comparisonKind !== "model") throw new Error("--model requires explicit --comparison-kind model.");
  const chunkFailurePolicy = values.get("--chunk-failure-policy") ?? "reject_document";
  if (!["reject_document", "retain_valid_chunks_v1"].includes(chunkFailurePolicy)) throw new Error("Use a supported explicit chunk failure policy.");
  if (chunkFailurePolicy !== "reject_document" && (!live || (phase !== "after" && comparisonKind !== "model"))) throw new Error("Retaining validated chunks requires an explicit live after phase or model study.");
  const extractionTransport = values.get("--extraction-transport") ?? "legacy_v5";
  if (!["legacy_v5", "typed_fields_v1", "typed_fields_v2", "fact_ledger_v1", "focused_fields_v1", "focused_fields_v2"].includes(extractionTransport)) throw new Error("Use a supported explicit extraction transport.");
  if (extractionTransport !== "legacy_v5" && !live) throw new Error("Typed extraction transport requires an explicit live development run.");
  const study = comparisonKind === "model";
  return { name, phase, live, documentIds, maxRequests: number("--max-requests", study ? 12 : 24, study ? 12 : 24), maxReservedTokens: number("--max-reserved-tokens", study ? 90000 : 170000, study ? 90000 : 170000), maxWaitMs: number("--max-wait-ms", study ? 720000 : 600000, study ? 720000 : 600000, 0), chunkFailurePolicy: chunkFailurePolicy as DevelopmentOptions["chunkFailurePolicy"], extractionTransport: extractionTransport as DevelopmentOptions["extractionTransport"], ...(envFile ? { envFile } : {}), ...(baselineName ? { baselineName } : {}), ...(study ? { comparisonKind: "model" as const, model: model as DevelopmentOptions["model"] } : {}) };
}
/** Diagnostic only: preserve historical scoring while exposing unconfirmed defaults. */
export function unsourcedMissingStateAgreements(fixture: Pick<FixtureRecord, "fields">, quotation: Quotation, mappedItems: Record<string, string>): number {
  return fixture.fields.filter(gold => {
    if (gold.state === "value") return false;
    const parts = gold.path.split(".");
    if (parts[0] === "items" && mappedItems[parts[1]]) parts[1] = mappedItems[parts[1]];
    try { const actual = resolveField(quotation, parts.join(".")); return actual.state === gold.state && actual.sourceIds.length === 0; }
    catch { return false; }
  }).length;
}
export function assertDevelopmentIds(ids: string[]): void {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !(DEVELOPMENT_IDS as readonly string[]).includes(id))) throw new Error("Every selected document must be a unique, allowlisted development ID.");
}
export function assertDevelopmentEnvironment(environment: Record<string, string | undefined>): void {
  const forbidden = Object.keys(environment).filter(key => environment[key] && (/^(?:NEON_|TRIGGER_|VERCEL|AWS_|SUPABASE_|NEXT_PUBLIC_SUPABASE_)/.test(key) || ["DATABASE_URL", "FIELDOPS_DATABASE_URL", "NODE_OPTIONS", "NODE_PRELOAD", "GROQ_BASE_URL"].includes(key)));
  if (environment.NODE_ENV === "production" || forbidden.length) throw new Error("Development evaluation requires a clean local shell without production, cloud or Node preload configuration.");
}
export interface DevelopmentEvent {
  kind: "reservation" | "response" | "failure" | "rejection" | "quota_wait";
  at: string; documentId?: string; code?: string; cached?: boolean;
  attemptSlots?: number; reservedTokens?: number; waitMs?: number;
  inputTokens?: number; outputTokens?: number; elapsedMs?: number; usageAvailable?: boolean; costUsd?: string | null; model?: string;
  sharedAllocationId?: string;
  requestKey?: string; recovered?: boolean; scheduledWaitMs?: number;
}
/** Estimates mirror the compact application wire request. Two slots cover its one transient retry. */
export function requestReservation(request: AIRequest, maxTransportAttempts: 1 | 2 = 2) {
  const wire = compactExtractionRequest(request).request;
  const estimatedInput = Math.ceil((wire.system.length + wire.user.length + JSON.stringify(wire.schema).length) / 3);
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) throw new Error("Invalid output token reservation.");
  return { attemptSlots: maxTransportAttempts, reservedTokens: maxTransportAttempts * (estimatedInput + request.maxOutputTokens) };
}
/** Unknown attempts retain their own reservations; another request's overrun cannot offset them. */
export function accountedDevelopmentTokens(events: DevelopmentEvent[]): number {
  const requests = new Map<string, { reserved: number; known: number }>();
  let lastReservation: string | undefined;
  events.forEach((event, index) => {
    if (event.kind === "reservation") lastReservation = event.requestKey ?? `legacy-reservation:${index}`;
    if (!["reservation", "response"].includes(event.kind)) return;
    const key = event.requestKey ?? lastReservation ?? `unattributed-response:${index}`;
    const value = requests.get(key) ?? { reserved: 0, known: 0 };
    if (event.kind === "reservation") value.reserved += event.reservedTokens ?? 0;
    else if (event.usageAvailable === true) value.known += (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
    requests.set(key, value);
  });
  return [...requests.values()].reduce((sum, value) => sum + Math.max(value.reserved, value.known), 0);
}
export function summarizeDevelopmentUsage(events: DevelopmentEvent[]) {
  const responses = events.filter(event => event.kind === "response");
  return {
    dispatches: events.filter(event => event.kind === "reservation").length,
    reservedAttemptSlots: events.reduce((sum, event) => sum + (event.attemptSlots ?? 0), 0),
    reservedTokens: events.reduce((sum, event) => sum + (event.reservedTokens ?? 0), 0),
    accountedTokenFloor: accountedDevelopmentTokens(events),
    waitedMs: events.reduce((sum, event) => sum + (event.waitMs ?? 0), 0),
    returnedResponses: responses.length,
    responsesWithoutUsage: responses.filter(event => event.usageAvailable !== true).length,
    inputTokens: responses.reduce((sum, event) => sum + (event.usageAvailable === true ? event.inputTokens ?? 0 : 0), 0),
    outputTokens: responses.reduce((sum, event) => sum + (event.usageAvailable === true ? event.outputTokens ?? 0 : 0), 0),
    responseElapsedMs: responses.reduce((sum, event) => sum + (event.elapsedMs ?? 0), 0),
    failures: events.filter(event => event.kind === "failure").length,
    rejections: events.filter(event => event.kind === "rejection" && !event.cached).length,
    providerInvoiceUsd: null,
    scope: "Durable reservations record configured transport-attempt slots (one in the model study, two in the legacy protocol) and heuristic token estimates, not measured billing or a hard tokenizer bound. Returned token totals exclude explicitly unavailable usage; transport failures can have unreported usage. A reservation survives interruption, including dispatches whose outcome is unknown.",
  };
}
export const responseEvent = (result: AIResult): DevelopmentEvent => ({ kind: "response", at: new Date().toISOString(), inputTokens: result.inputTokens, outputTokens: result.outputTokens, elapsedMs: result.elapsedMs, usageAvailable: result.usageAvailable === true, costUsd: result.costUsd, model: result.model });

export function developmentRequestController(options: {
  limits: Pick<DevelopmentOptions, "maxRequests" | "maxReservedTokens" | "maxWaitMs">;
  events: DevelopmentEvent[]; request: AIRequestFunction; persist(event: DevelopmentEvent): Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  maxTransportAttempts?: 1 | 2;
  lastSharedActivity?: () => string | undefined;
  retryQuota?: boolean;
  requestKey?: (request: AIRequest) => string;
  durableWaits?: boolean;
}) {
  let halted: string | null = null;
  const halt = (code: string): never => { halted = code; throw Object.assign(new Error("Development evaluation paused at its configured boundary."), { code }); };
  const now = options.now ?? Date.now;
  const record = async (event: DevelopmentEvent) => { await options.persist(event); options.events.push(event); };
  const request: AIRequestFunction = async (input, context) => {
    if (input.purpose !== "extraction") return halt("development_scope");
    if (halted) return halt(halted);
    const requestKey = options.requestKey?.(input);
    for (;;) {
      const usage = summarizeDevelopmentUsage(options.events), reservation = requestReservation(input, options.maxTransportAttempts);
      if (usage.reservedAttemptSlots + reservation.attemptSlots > options.limits.maxRequests || usage.accountedTokenFloor + reservation.reservedTokens > options.limits.maxReservedTokens) return halt("evaluation_budget");
      // A reservation precedes SDK initialization and actual provider dispatch.
      // Pace from settlement, which is safely after the provider's quota window
      // began; use the reservation only when interruption left no known outcome.
      const lastActivity = [...options.events].reverse().find(event => ["reservation", "response", "failure"].includes(event.kind));
      const activity = Math.max(lastActivity ? Date.parse(lastActivity.at) : 0, options.lastSharedActivity?.() ? Date.parse(options.lastSharedActivity()!) : 0);
      const remaining = activity ? Math.max(0, 60000 - (now() - activity)) : 0;
      if (remaining > 60000 || !Number.isFinite(remaining)) return halt("evaluation_clock");
      if (remaining > 0) {
        if (usage.waitedMs + remaining > options.limits.maxWaitMs) return halt("evaluation_wait_budget");
        const waitStarted = now();
        await record({ kind: "quota_wait", at: new Date(now()).toISOString(), waitMs: options.durableWaits ? 0 : remaining, ...(options.durableWaits ? { scheduledWaitMs: remaining, requestKey } : {}), code: "paced_free_quota" });
        await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(remaining);
        if (options.durableWaits) await record({ kind: "quota_wait", at: new Date(now()).toISOString(), waitMs: Math.max(0, now() - waitStarted), requestKey, code: "completed_free_quota_wait" });
      }
      // Persist before dispatch: an interrupted or failed call never refunds its unknown usage.
      await record({ kind: "reservation", at: new Date(now()).toISOString(), ...reservation, ...(requestKey ? { requestKey } : {}) });
      try {
        const result = await options.request(input, context);
        await record({ ...responseEvent(result), at: new Date(now()).toISOString(), ...(requestKey ? { requestKey } : {}) });
        return result;
      } catch (error) {
        const code = errorCode(error), delay = (error as { retryAfterMs?: unknown })?.retryAfterMs;
        await record({ kind: "failure", at: new Date(now()).toISOString(), code, ...(requestKey ? { requestKey } : {}) });
        const waitMs = typeof delay === "number" && Number.isFinite(delay) ? Math.max(1000, delay) : 60000;
        if (options.retryQuota !== false && code === "quota" && waitMs <= 60000 && summarizeDevelopmentUsage(options.events).waitedMs + waitMs <= options.limits.maxWaitMs) {
          await record({ kind: "quota_wait", at: new Date().toISOString(), waitMs });
          await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(waitMs);
          continue;
        }
        if (["quota", "ai_unavailable", "evaluation_budget"].includes(code)) halted = code;
        throw error;
      }
    }
  };
  return { request, stop: (code: string) => { halted = code; }, get halt() { return halted; } };
}
