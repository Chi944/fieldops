import { ApiError } from "./errors";
import { LIMITS } from "@/lib/domain/types";

export function configuration() {
  const deployed = Boolean(process.env.VERCEL || process.env.RENDER || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const local = process.env.FIELDOPS_LOCAL_MODE === "true" && !deployed;
  const supabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const model = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_FREE_TIER_CONFIRMED === "true" && process.env.GROQ_ZDR_CONFIRMED === "true" && ["openai/gpt-oss-120b", "openai/gpt-oss-20b"].includes(process.env.GROQ_MODEL || "openai/gpt-oss-120b"));
  const trigger = Boolean(process.env.TRIGGER_SECRET_KEY && process.env.TRIGGER_PROJECT_ID);
  return { mode: local ? "local" as const : supabase ? "cloud" as const : "demo" as const, local, supabase, model, trigger, deployed };
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
  if (!config.model) reasons.push("A free-tier extraction provider is not configured. No document will be presented as AI-extracted.");
  return { mode: config.mode, authenticated, canPersist: config.local || (config.supabase && authenticated), canUpload: config.local || (config.supabase && authenticated && config.trigger && config.model), canExtract: config.model && (config.local || config.trigger), reasons, limits: LIMITS };
}
