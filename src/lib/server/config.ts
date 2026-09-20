import { ApiError } from "./errors";
import { LIMITS } from "@/lib/domain/types";

export function configuration() {
  const deployed = Boolean(process.env.VERCEL || process.env.RENDER || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const local = process.env.FIELDOPS_LOCAL_MODE === "true" && !deployed;
  const database = Boolean(process.env.FIELDOPS_DATABASE_URL);
  const auth = Boolean(process.env.NEON_AUTH_BASE_URL && (process.env.NEON_AUTH_COOKIE_SECRET?.length ?? 0) >= 32 && process.env.FIELDOPS_SITE_URL);
  const storage = Boolean(process.env.NEON_STORAGE_ENDPOINT && process.env.NEON_STORAGE_ACCESS_KEY_ID && process.env.NEON_STORAGE_SECRET_ACCESS_KEY && process.env.NEON_STORAGE_REGION);
  const cloud = database && auth;
  const processingMode = process.env.FIELDOPS_PROCESSING_MODE === "ai" ? "ai" as const : "parse_only" as const;
  const model = processingMode === "ai" && Boolean(process.env.GROQ_API_KEY && process.env.GROQ_FREE_TIER_CONFIRMED === "true" && process.env.GROQ_ZDR_CONFIRMED === "true" && ["openai/gpt-oss-120b", "openai/gpt-oss-20b"].includes(process.env.GROQ_MODEL || "openai/gpt-oss-120b"));
  const trigger = Boolean(process.env.TRIGGER_SECRET_KEY && process.env.TRIGGER_PROJECT_ID);
  const uploadsEnabled = process.env.FIELDOPS_UPLOADS_ENABLED !== "false";
  return { mode: local ? "local" as const : cloud ? "cloud" as const : "demo" as const, local, cloud, database, auth, storage, model, trigger, deployed, processingMode, uploadsEnabled };
}
export function isLoopback(url: string) {
  try { return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url).hostname.toLowerCase()); } catch { return false; }
}
export function checkRequestBoundary(request: Request, local: boolean) {
  const url = new URL(request.url);
  // Next inserts forwarding headers even for direct localhost requests. Accept only
  // a single loopback authority/client; public authorities and proxy chains fail closed.
  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const loopbackAuthority = (value: string) => !/[\s,@/\\]/.test(value) && isLoopback(`${url.protocol}//${value}`);
  if (local && (!isLoopback(request.url) || (host !== null && !loopbackAuthority(host))
    || (forwardedHost !== null && (!loopbackAuthority(forwardedHost) || (host !== null && forwardedHost !== host)))
    || (forwardedFor !== null && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(forwardedFor))
    || (forwardedProtocol !== null && `${forwardedProtocol}:` !== url.protocol)
    || request.headers.has("forwarded"))) {
    throw new ApiError(403, "local_only", "Local mode is available only on the loopback interface.");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    // Next's proxy URL may normalize 127.0.0.1 to localhost. After validating
    // loopback authorities, the actual Host header is the browser's origin.
    const expectedOrigin = local && host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
    if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "cross_origin", "This action must be sent from FieldOps.");
  }
}
export function capabilities(authenticated = false) {
  const config = configuration();
  const reasons: string[] = [];
  if (config.mode === "demo") reasons.push("Live workspace storage is not configured. The demonstration uses labelled sample data.");
  if (config.mode === "cloud" && !authenticated) reasons.push("Sign in with an invited GitHub account to use a private workspace.");
  if (config.mode === "cloud" && !config.trigger) reasons.push("Cloud processing is unavailable until the free background worker is configured.");
  if (config.mode === "cloud" && !config.storage) reasons.push("Uploads are unavailable until private file storage is configured.");
  if (config.mode === "cloud" && !config.uploadsEnabled) reasons.push("Cloud uploads and processing retries are temporarily paused. Saved comparisons, corrections and exports remain available.");
  if (!config.model) reasons.push("Automatic interpretation is off. Uploads prepare original sources for your manual review; no AI extraction is performed.");
  const canUpload = config.local || (config.cloud && authenticated && config.trigger && config.storage && config.uploadsEnabled);
  return { mode: config.mode, authenticated, canPersist: config.local || (config.cloud && authenticated), canUpload, canExtract: config.model && canUpload, processingMode: config.model ? config.processingMode : "parse_only" as const, reasons, limits: LIMITS };
}
