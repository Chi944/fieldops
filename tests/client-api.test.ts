import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../src/components/context";

const documentId = "c849f053-70bb-42f9-808d-91e1f8a69b69";

afterEach(() => vi.unstubAllGlobals());

describe("client API recovery errors", () => {
  it("preserves the duplicate code and existing document when the message never says duplicate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: {
      code: "duplicate",
      message: "This exact file is already in the comparison. Open it or upload it intentionally as a separate quotation revision.",
      details: { documentId, signedUrl: "https://untrusted.invalid/private", unrelated: "discard" },
    } }, { status: 409 })));

    const error = await api("/api/comparisons/test/uploads/initiate").catch(error => error);
    expect(error).toBeInstanceOf(ApiRequestError);
    if (!(error instanceof ApiRequestError)) throw new Error("Expected a typed API failure");
    expect(error.status).toBe(409);
    expect(error.code).toBe("duplicate");
    expect(error.message).not.toMatch(/duplicate/i);
    expect(error.details).toEqual({ documentId });
  });

  it("does not reinterpret message text as a duplicate code or retain unsafe document paths", () => {
    const error = new ApiRequestError(429, { error: {
      code: "workspace_capacity",
      message: "Remove duplicate originals before adding more files.",
      details: { documentId: "../../external?token=private" },
    } });
    expect(error.code).toBe("workspace_capacity");
    expect(error.details).toBeUndefined();
    expect(new ApiRequestError(409, { error: { message: "duplicate file" } }).code).toBeUndefined();
  });

  it("gives a bounded recovery shape for non-JSON gateway failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<h1>Unavailable</h1>", { status: 502 })));
    const error = await api("/api/comparisons/test/uploads/initiate").catch(error => error);
    expect(error).toBeInstanceOf(ApiRequestError);
    if (!(error instanceof ApiRequestError)) throw new Error("Expected a typed API failure");
    expect(error.status).toBe(502);
    expect(error.message).toBe("The request could not be completed. Try again.");
    expect(error.code).toBeUndefined();
    expect(error.details).toBeUndefined();
  });
});
