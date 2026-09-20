import { describe, expect, it, vi } from "vitest";
import { body } from "@/lib/server/service";

function streamed(stream: ReadableStream<Uint8Array>, headers?: HeadersInit, signal?: AbortSignal) {
  return new Request("https://fieldops.example/api/comparisons", { method: "POST", body: stream, duplex: "half", headers, signal } as RequestInit);
}
const encode = (value: string) => new TextEncoder().encode(value);

describe("bounded JSON request bodies", () => {
  it("counts UTF-8 bytes across chunks, including a multibyte character split between chunks", async () => {
    const value = encode(JSON.stringify({ name: "Supplier € 漢" }));
    let index = 0;
    const request = streamed(new ReadableStream({ pull(controller) {
      if (index === value.length) controller.close(); else controller.enqueue(value.slice(index, ++index));
    } }));
    await expect(body(request)).resolves.toEqual({ name: "Supplier € 漢" });
  });

  it("stops an unknown-length stream at the byte limit instead of reading the entire body", async () => {
    const cancel = vi.fn(), chunk = encode("漢".repeat(100000));
    let reads = 0;
    const request = streamed(new ReadableStream({ pull(controller) { reads++; controller.enqueue(chunk); }, cancel }, { highWaterMark: 0 }));
    await expect(body(request)).rejects.toMatchObject({ status: 413, code: "input_too_large" });
    expect(reads).toBe(7); expect(cancel).toHaveBeenCalledOnce();
    // The rejected input was only 700,000 UTF-16 characters but 2.1 MB of UTF-8.
  });

  it("rejects excessive or malformed declared lengths without consuming input", async () => {
    for (const [length, status] of [[String(2 * 1024 * 1024 + 1), 413], ["-1", 400], ["NaN", 400], ["1.5", 400]] as const) {
      const pull = vi.fn();
      await expect(body(streamed(new ReadableStream({ pull }, { highWaterMark: 0 }), { "content-length": length }))).rejects.toMatchObject({ status });
      expect(pull).not.toHaveBeenCalled();
    }
  });

  it("does not trust a forged small Content-Length and rejects malformed UTF-8 or JSON", async () => {
    const large = new Uint8Array(2 * 1024 * 1024 + 1);
    for (const [bytes, code] of [[large, "input_too_large"], [Uint8Array.from([0x22, 0xff, 0x22]), "invalid_json"], [encode("{unfinished"), "invalid_json"]] as const) {
      const request = streamed(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), { "content-length": "1" });
      await expect(body(request)).rejects.toMatchObject({ code });
    }
  });

  it("cancels a stalled read on client abort and on its independent deadline", async () => {
    for (const deadline of [false, true]) {
      const controller = new AbortController(), cancel = vi.fn();
      const timeout = deadline ? vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal) : undefined;
      try {
        const request = streamed(new ReadableStream({ cancel }, { highWaterMark: 0 }), undefined, deadline ? undefined : controller.signal);
        const pending = expect(body(request)).rejects.toMatchObject({ status: 408, code: "input_timeout" });
        controller.abort(); await pending; expect(cancel).toHaveBeenCalledOnce();
        if (timeout) expect(timeout).toHaveBeenCalledWith(15000);
      } finally { timeout?.mockRestore(); }
    }
  });
});
