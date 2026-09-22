import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { aiRequestKey, AIInterpretationError, type AIRequestFunction, type AIResult } from "../src/lib/ai/groq";
import { ProcessingError, type ProcessingErrorCode } from "../src/lib/processing/errors";
import { responseEvent, type DevelopmentEvent } from "./development-control";
import type { Quotation } from "../src/lib/domain/types";

const hashPattern = /^[a-f0-9]{64}$/;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
const errorCodes = new Set<ProcessingErrorCode>(["unsupported_format", "password_protected", "file_too_large", "limit_exceeded", "malformed_file", "unreadable", "cancelled", "timeout", "ai_unavailable", "quota", "model_error", "invalid_output", "invalid_evidence"]);
type Kind = "reservation" | "returned" | "rejected" | "operational";
interface Receipt { version: 1; kind: Kind; requestKey: string; configurationHash: string; model: string; documentId: string; at: string; result?: AIResult; code?: ProcessingErrorCode; cached?: boolean; retryAfterMs?: number; reservation?: DevelopmentEvent }
export class DevelopmentOutcomeError extends Error { constructor(public readonly code: "development_unknown_outcome" | "development_outcome_storage", message: string) { super(message); } }

/** Revalidation may change only observation time and cached usage metadata. */
export async function persistDevelopmentQuotation(directory: string, documentId: string, quotation: Quotation) {
  if (!/^[a-z]+-[1-3]$/.test(documentId) || quotation.documentId !== documentId) throw new Error("Invalid completed quotation identity.");
  const stableHash = (value: Quotation) => { const { extractedAt: _at, usage: _usage, ...body } = value; void _at; void _usage; return sha(body); };
  const exact = async (file: string) => { if (await realpath(file) !== file) throw new Error("Completed quotation paths must not redirect."); return readFile(file); };
  const readJson = async <T>(file: string): Promise<T | null> => { try { return JSON.parse((await exact(file)).toString("utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("An immutable completed quotation could not be verified."); } };
  const immutable = async (file: string, value: unknown) => { await mkdir(path.dirname(file), { recursive: true }); const handle = await open(file, "wx"); try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); } };
  const completionPath = path.join(directory, "document-completions", `${documentId}.json`), outputDirectory = path.join(directory, "outputs");
  let completion = await readJson<{ path: string; sha256: string; quotationHash: string }>(completionPath);
  if (!completion) {
    let existing: string[] = [];
    try { if (await realpath(outputDirectory) !== outputDirectory) throw new Error("Completed outputs must not redirect."); existing = (await readdir(outputDirectory)).filter(file => new RegExp(`^${documentId}-[0-9]+\\.json$`).test(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (existing.length > 1) throw new Error("Multiple completed outputs prevent automatic resume.");
    const filename = existing[0] ?? `${documentId}-${Date.now()}.json`;
    if (!existing.length) await immutable(path.join(outputDirectory, filename), quotation);
    const bytes = await exact(path.join(outputDirectory, filename));
    let saved: Quotation; try { saved = JSON.parse(bytes.toString("utf8")) as Quotation; } catch { throw new Error("The saved quotation is invalid."); }
    if (stableHash(saved) !== stableHash(quotation)) throw new Error("Saved quotation differs from revalidated response receipts.");
    completion = { path: `outputs/${filename}`, sha256: createHash("sha256").update(bytes).digest("hex"), quotationHash: stableHash(saved) };
    await immutable(completionPath, completion);
  }
  if (!new RegExp(`^outputs/${documentId}-[0-9]+\\.json$`).test(completion.path) || completion.quotationHash !== stableHash(quotation)) throw new Error("The revalidated quotation differs from its immutable completed output.");
  if (createHash("sha256").update(await exact(path.join(directory, completion.path))).digest("hex") !== completion.sha256) throw new Error("The immutable completed quotation changed.");
  return completion;
}

/** Dev-only exact-request receipts. No provider client or environment file is loaded. */
export async function developmentOutcomes(options: { directory: string; configurationHash: string; model: string; now?: () => number }) {
  if (!hashPattern.test(options.configurationHash)) throw new Error("Invalid development outcome configuration.");
  const base = path.join(options.directory, "outcomes"), now = options.now ?? Date.now;
  await mkdir(base, { recursive: true });
  if (await realpath(base) !== base) throw new Error("Development outcomes must not redirect.");
  const filename = (key: string, kind: Kind) => { if (!hashPattern.test(key)) throw new Error("Invalid development request key."); return path.join(base, `${key}.${kind}.json`); };
  const read = async (key: string, kind: Kind): Promise<Receipt | null> => {
    const file = filename(key, kind); let receipt: Receipt;
    try { if (await realpath(file) !== file) throw new Error("Development outcomes must not redirect."); receipt = JSON.parse(await readFile(file, "utf8")) as Receipt; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new DevelopmentOutcomeError("development_outcome_storage", "A development outcome could not be safely read."); }
    if (!receipt || receipt.version !== 1 || receipt.kind !== kind || receipt.requestKey !== key || receipt.configurationHash !== options.configurationHash || receipt.model !== options.model || !Number.isFinite(Date.parse(receipt.at)) || typeof receipt.documentId !== "string") throw new DevelopmentOutcomeError("development_outcome_storage", "A development outcome does not match its exact request/configuration.");
    if (["returned", "rejected"].includes(kind) && (!receipt.result || receipt.result.model !== options.model || ![receipt.result.inputTokens, receipt.result.outputTokens, receipt.result.elapsedMs].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0))) throw new DevelopmentOutcomeError("development_outcome_storage", "A returned outcome has invalid response metadata.");
    if (kind === "rejected" && !["invalid_output", "invalid_evidence"].includes(receipt.code ?? "")) throw new DevelopmentOutcomeError("development_outcome_storage", "A terminal interpretation outcome has an invalid code.");
    if (kind === "operational" && !errorCodes.has(receipt.code!)) throw new DevelopmentOutcomeError("development_outcome_storage", "An operational outcome has an invalid code.");
    return receipt;
  };
  const write = async (receipt: Receipt) => {
    const file = filename(receipt.requestKey, receipt.kind);
    const existing = await read(receipt.requestKey, receipt.kind);
    if (existing) {
      // Revalidation may visit the same rejection, but its original occurrence is immutable.
      if (existing.code !== receipt.code || sha(existing.result) !== sha(receipt.result) || existing.documentId !== receipt.documentId) throw new DevelopmentOutcomeError("development_outcome_storage", "An immutable development outcome conflicts with a later result.");
      return existing;
    }
    let handle;
    try { handle = await open(file, "wx"); await handle.writeFile(`${JSON.stringify(receipt)}\n`); await handle.sync(); }
    catch { throw new DevelopmentOutcomeError("development_outcome_storage", "A development outcome could not be durably saved. Do not retry its unknown dispatch."); }
    finally { await handle?.close(); }
    return receipt;
  };
  const make = (kind: Kind, key: string, documentId: string, extra: Partial<Receipt> = {}): Receipt => ({ version: 1, kind, requestKey: key, configurationHash: options.configurationHash, model: options.model, documentId, at: new Date(now()).toISOString(), ...extra });
  const replayRejection = (receipt: Receipt): never => { throw new AIInterpretationError(new ProcessingError(receipt.code!, "This exact request previously failed interpretation validation; its saved response remains rejected."), receipt.result!, true); };
  const reject = async (key: string, result: AIResult, code: ProcessingErrorCode, cached: boolean, documentId: string) => {
    if (!["invalid_output", "invalid_evidence"].includes(code)) throw new DevelopmentOutcomeError("development_outcome_storage", "Only interpretation failures may become terminal rejection receipts.");
    return write(make("rejected", key, documentId, { result, code, cached }));
  };
  return {
    async reserve(event: DevelopmentEvent) {
      if (!event.requestKey || !event.documentId) throw new DevelopmentOutcomeError("development_outcome_storage", "A durable reservation needs its exact request and document identity.");
      if (await read(event.requestKey, "reservation")) throw new DevelopmentOutcomeError("development_unknown_outcome", "This exact request already has a reservation. Its outcome must be replayed or reviewed; no new request was sent.");
      await write(make("reservation", event.requestKey, event.documentId, { at: event.at, reservation: event }));
    },
    reject,
    async rejectIfSettled(key: string) { const receipt = await read(key, "rejected"); if (receipt) replayRejection(receipt); },
    /** Called outside the request controller: settled outcomes consume no new slot or wait. */
    wrap(controller: AIRequestFunction): AIRequestFunction {
      return async (request, context) => {
        const key = aiRequestKey(request, options.model), rejected = await read(key, "rejected");
        if (rejected) return replayRejection(rejected);
        const returned = await read(key, "returned");
        if (returned) return returned.result!; // Outer schema/evidence/integration validation still runs.
        const operational = await read(key, "operational");
        if (operational) throw new ProcessingError(operational.code!, "This exact request previously ended with an operational failure. It will not be dispatched again.", false, operational.retryAfterMs);
        if (await read(key, "reservation")) throw new DevelopmentOutcomeError("development_unknown_outcome", "A prior request has no durable response or failure outcome. Its provider usage is unknown; automatic retry is prohibited.");
        return controller(request, context);
      };
    },
    /** Called inside the controller, after its exact-key reservation is saved. */
    dispatch(provider: AIRequestFunction): AIRequestFunction {
      return async (request, context) => {
        const key = aiRequestKey(request, options.model), reservation = await read(key, "reservation");
        if (!reservation) throw new DevelopmentOutcomeError("development_outcome_storage", "Provider dispatch requires a durable exact-request reservation.");
        let result: AIResult;
        try { result = await provider(request, context); }
        catch (error) {
          if (!(await read(key, "rejected"))) {
            const code = error instanceof ProcessingError && errorCodes.has(error.code) ? error.code : "model_error";
            await write(make("operational", key, reservation.documentId, { code, ...(error instanceof ProcessingError && error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}) }));
          }
          throw error;
        }
        // Persist before control returns to outer domain validation or usage logging.
        await write(make("returned", key, reservation.documentId, { result }));
        return result;
      };
    },
    /** Recover metadata lost after receipt fsync, without duplicating real usage. */
    async recover(events: DevelopmentEvent[], persist: (event: DevelopmentEvent) => Promise<void>) {
      const names = await readdir(base), keys = [...new Set(names.map(name => /^([a-f0-9]{64})\.(reservation|returned|rejected|operational)\.json$/.exec(name)?.[1]))];
      if (keys.includes(undefined)) throw new DevelopmentOutcomeError("development_outcome_storage", "Unknown development outcome file.");
      const missing: DevelopmentEvent[] = [];
      for (const key of keys as string[]) {
        const reservation = await read(key, "reservation"), returned = await read(key, "returned"), rejected = await read(key, "rejected"), operational = await read(key, "operational");
        if (!reservation && (returned || rejected || operational)) throw new DevelopmentOutcomeError("development_outcome_storage", "An outcome is missing its original reservation.");
        if (reservation && !events.some(event => event.requestKey === key && event.kind === "reservation")) missing.push({ ...reservation.reservation!, recovered: true });
        const response = returned ?? rejected;
        if (response && !response.cached && !events.some(event => event.requestKey === key && event.kind === "response")) missing.push({ ...responseEvent(response.result!), at: response.at, documentId: response.documentId, requestKey: key, recovered: true });
        if (rejected && !events.some(event => event.requestKey === key && event.kind === "rejection")) missing.push({ kind: "rejection", at: rejected.at, documentId: rejected.documentId, requestKey: key, code: rejected.code, cached: rejected.cached, recovered: true });
        if (operational && !events.some(event => event.requestKey === key && event.kind === "failure")) missing.push({ kind: "failure", at: operational.at, documentId: operational.documentId, requestKey: key, code: operational.code, recovered: true });
      }
      for (const event of missing.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) { await persist(event); events.push(event); }
      return { recoveredEvents: missing.length };
    },
  };
}
