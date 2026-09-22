import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDevelopmentEnvironment } from "../eval/development-control";
import { loadDevelopmentEnvironment } from "../scripts/evaluate-development";

const directories: string[] = [];
const redirectedEndpoint = "https://synthetic-endpoint.invalid/private-test-value";

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(?:NEON_|TRIGGER_|VERCEL|SUPABASE_|NEXT_PUBLIC_SUPABASE_)/.test(key) || ["DATABASE_URL", "FIELDOPS_DATABASE_URL", "NODE_OPTIONS", "NODE_PRELOAD", "GROQ_BASE_URL"].includes(key)) vi.stubEnv(key, "");
  }
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FIELDOPS_PROCESSING_MODE", "parse_only");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("GROQ_FREE_TIER_CONFIRMED", "false");
  vi.stubEnv("GROQ_ZDR_CONFIRMED", "false");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("development evaluation uses only the official Groq endpoint", () => {
  it("rejects an inherited SDK endpoint override before loading credentials", async () => {
    expect(() => assertDevelopmentEnvironment({ GROQ_BASE_URL: redirectedEndpoint })).toThrow("clean local shell");
    vi.stubEnv("GROQ_BASE_URL", redirectedEndpoint);
    await expect(loadDevelopmentEnvironment("not-a-real-test-root", ".env.ai.local")).rejects.toThrow("clean local shell");
    try { await loadDevelopmentEnvironment("not-a-real-test-root", ".env.ai.local"); }
    catch (error) { expect(String(error)).not.toContain(redirectedEndpoint); }
    expect(process.env.GROQ_API_KEY).toBe("");
  });

  it("rejects an override inside the dedicated file before copying its key into the environment", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fieldops-eval-endpoint-"));
    directories.push(directory);
    await writeFile(path.join(directory, ".env.ai.local"), [
      `GROQ_BASE_URL=${redirectedEndpoint}`,
      "GROQ_API_KEY=SYNTHETIC-KEY-NOT-FOR-PROVIDER-USE",
      "GROQ_MODEL=openai/gpt-oss-120b",
      "GROQ_FREE_TIER_CONFIRMED=true",
      "GROQ_ZDR_CONFIRMED=true",
      "FIELDOPS_PROCESSING_MODE=ai",
    ].join("\n"));
    await expect(loadDevelopmentEnvironment(directory, ".env.ai.local")).rejects.toThrow("clean local shell");
    expect(process.env.GROQ_API_KEY).toBe("");
    expect(process.env.FIELDOPS_PROCESSING_MODE).toBe("parse_only");
  });
});
