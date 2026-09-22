import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/lib/processing";
import { extractionChunks, sourceRecord } from "../src/lib/ai/chunks";

describe("explicit item blocks at extraction boundaries", () => {
  it.each([
    ["1. Layout cleanup", "2. Proofreading"],
    ["Layout cleanup | ID SERVICE-A", "Proofreading | SKU: SERVICE-B"],
  ])("keeps a following minimum-order line with its explicitly anchored item (%s)", async (first, second) => {
    const parsed = await parseDocument({ documentId: "synthetic-item-boundary", filename: "item-boundary.txt", text: [
      "Supplier: Self-authored demonstration service provider. This heading supplies document context and is not an item.",
      first,
      "Quantity 2 hour; unit price USD 40; line amount USD 80",
      "Billing: hourly; scope: Preserve document layout and deliver an editable file",
      "Minimum order: 4 hour",
      second,
      "Quantity 1 project; unit price USD 90; line amount USD 90",
      "Billing: fixed_project; scope: Review spelling and return one corrected file",
    ].join("\n") });
    // Every complete item fits. Only the preceding document heading pushes the
    // first item's continuation past the old character-based chunk boundary.
    const rowBytes = parsed.sources.map(source => JSON.stringify([sourceRecord(source)]).length);
    const maxCharacters = rowBytes.slice(0, 4).reduce((sum, size) => sum + size, 0);
    expect(rowBytes.slice(1, 5).reduce((sum, size) => sum + size, 0)).toBeLessThan(maxCharacters);
    const chunks = extractionChunks(parsed, maxCharacters);
    expect(chunks.flat().map(source => source.id)).toEqual(parsed.sources.map(source => source.id));
    const minimumOrderChunk = chunks.find(chunk => chunk.includes(parsed.sources[4]))!;
    expect(minimumOrderChunk).toContainEqual(parsed.sources[1]);
    expect(minimumOrderChunk).toContainEqual(parsed.sources[2]);
    expect(minimumOrderChunk).toContainEqual(parsed.sources[3]);
    for (const chunk of chunks) expect(chunk.reduce((sum, source) => sum + JSON.stringify([sourceRecord(source)]).length, 0)).toBeLessThanOrEqual(maxCharacters);
  });

  it("explicitly refuses an oversized item block instead of detaching its continuation", async () => {
    const parsed = await parseDocument({ documentId: "synthetic-oversized-item", filename: "large-item.txt", text: [
      "1. Document formatting | ID SERVICE-A",
      "Quantity 2 hour; unit price USD 40; line amount USD 80",
      "Billing: hourly; scope: Preserve the complete supplied document layout and deliver an editable file",
      "Minimum order: 4 hour",
    ].join("\n") });
    const largestRow = Math.max(...parsed.sources.map(source => JSON.stringify([sourceRecord(source)]).length));
    expect(() => extractionChunks(parsed, largestRow + 10)).toThrow(/item|block|section/i);
  });
});
