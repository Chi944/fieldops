import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilities, configuration } from "@/lib/server/config";
import { liveAIConfiguration } from "@/lib/ai/groq";

beforeEach(() => {
  vi.stubEnv("FIELDOPS_UPLOADS_ENABLED", "");
  for (const key of ["FIELDOPS_LOCAL_MODE", "FIELDOPS_PROCESSING_MODE", "VERCEL", "RENDER", "AWS_LAMBDA_FUNCTION_NAME", "GROQ_API_KEY", "GROQ_FREE_TIER_CONFIRMED", "GROQ_ZDR_CONFIRMED", "TRIGGER_SECRET_KEY", "TRIGGER_PROJECT_ID", "DATABASE_URL", "FIELDOPS_DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "FIELDOPS_SITE_URL", "NEON_STORAGE_ENDPOINT", "NEON_STORAGE_ACCESS_KEY_ID", "NEON_STORAGE_SECRET_ACCESS_KEY", "NEON_STORAGE_REGION"]) vi.stubEnv(key, "");
});
afterEach(() => vi.unstubAllEnvs());
function cloud() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("FIELDOPS_DATABASE_URL", "postgresql://synthetic");
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://example.neonauth.us-east-2.aws.neon.tech/neondb/auth");
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "synthetic-cookie-key-32-characters-long");
  vi.stubEnv("FIELDOPS_SITE_URL", "https://example.vercel.app");
  vi.stubEnv("NEON_STORAGE_ENDPOINT", "https://synthetic.storage.neon.tech");
  vi.stubEnv("NEON_STORAGE_ACCESS_KEY_ID", "synthetic-id");
  vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "synthetic-secret");
  vi.stubEnv("NEON_STORAGE_REGION", "us-east-2");
  vi.stubEnv("TRIGGER_SECRET_KEY", "test-worker");
  vi.stubEnv("TRIGGER_PROJECT_ID", "test-project");
}
describe("personal processing admission", () => {
  it("pauses cloud admission explicitly while preserving saved-work access and local personal uploads", () => {
    cloud(); expect(configuration().uploadsEnabled).toBe(true); expect(capabilities(true).canUpload).toBe(true);
    vi.stubEnv("FIELDOPS_UPLOADS_ENABLED", "false");
    expect(configuration().uploadsEnabled).toBe(false);
    expect(capabilities(true)).toMatchObject({ mode: "cloud", canPersist: true, canUpload: false, canExtract: false });
    expect(capabilities(true).reasons).toContain("Cloud uploads and processing retries are temporarily paused. Saved comparisons, corrections and exports remain available.");
    vi.stubEnv("FIELDOPS_UPLOADS_ENABLED", "true"); expect(capabilities(true).canUpload).toBe(true);
    vi.stubEnv("FIELDOPS_UPLOADS_ENABLED", "false"); vi.stubEnv("FIELDOPS_LOCAL_MODE", "true"); vi.stubEnv("VERCEL", "");
    expect(capabilities(true)).toMatchObject({ mode: "local", canPersist: true, canUpload: true });
    expect(capabilities(true).reasons.some(reason => reason.includes("temporarily paused"))).toBe(false);
  });
  it("enables authenticated hosted parsing without a model and keeps anonymous uploads closed", () => {
    cloud();
    expect(capabilities(true)).toMatchObject({ mode: "cloud", canPersist: true, canUpload: true, canExtract: false, processingMode: "parse_only" });
    expect(capabilities(false)).toMatchObject({ canPersist: false, canUpload: false, canExtract: false });
    vi.stubEnv("TRIGGER_SECRET_KEY", "");
    expect(capabilities(true)).toMatchObject({ canPersist: true, canUpload: false });
  });
  it("requires explicit AI mode even if model credentials and account flags are configured", () => {
    cloud();
    vi.stubEnv("GROQ_API_KEY", "test-only"); vi.stubEnv("GROQ_FREE_TIER_CONFIRMED", "true"); vi.stubEnv("GROQ_ZDR_CONFIRMED", "true");
    expect(capabilities(true).canExtract).toBe(false);
    expect(liveAIConfiguration().ready).toBe(false);
    vi.stubEnv("FIELDOPS_PROCESSING_MODE", "ai");
    expect(capabilities(true).canExtract).toBe(true);
    expect(liveAIConfiguration().ready).toBe(true);
    expect(capabilities(false).canExtract).toBe(false);
    vi.stubEnv("GROQ_ZDR_CONFIRMED", "false");
    expect(capabilities(true)).toMatchObject({ canUpload: true, canExtract: false, processingMode: "parse_only" });
  });
  it("defaults local personal use to sources only and never enables local mode on Vercel", () => {
    vi.stubEnv("FIELDOPS_LOCAL_MODE", "true");
    expect(capabilities()).toMatchObject({ mode: "local", canPersist: true, canUpload: true, canExtract: false, processingMode: "parse_only" });
    vi.stubEnv("VERCEL", "1");
    expect(configuration().local).toBe(false);
    expect(capabilities()).toMatchObject({ mode: "demo", canUpload: false });
  });
  it("does not activate from a marketplace owner credential and blocks uploads without private storage", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic-owner");
    expect(configuration().mode).toBe("demo");
    cloud(); vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "");
    expect(capabilities(true)).toMatchObject({ canPersist: true, canUpload: false, canExtract: false });
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "too-short");
    expect(configuration().mode).toBe("demo");
  });
});
