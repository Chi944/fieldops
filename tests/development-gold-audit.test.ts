import { describe, expect, it } from "vitest";
import { auditNumericRows } from "../scripts/check-development-gold";
import { emptyItem, emptyQuotation } from "../src/lib/domain/types";

describe("independent numeric development-gold audit", () => {
  it("detects incorrect quantity, price and missing MOQ labels without printing values", () => {
    const quote = emptyQuotation("synthetic-audit", "synthetic.txt"), item = emptyItem("synthetic-item");
    for (const [key, value] of [["identifier", "SYNTHETIC-A"], ["quantity", "2"], ["unitPrice", "40"], ["minimumOrder", "4"]] as const) item[key] = { state: "value", value, raw: value, origin: "supplier", sourceIds: [] };
    quote.items.push(item);
    expect(auditNumericRows(quote, "Service | ID SYNTHETIC-A | Quantity 2 hour | Unit price USD 40.00 | MOQ 4 hour").passed).toBe(true);
    const failure = auditNumericRows(quote, "Service | ID SYNTHETIC-A | Quantity 3 hour | Unit price USD 50.00");
    expect(failure.passed).toBe(false);
    expect(failure.failures).toEqual(["row-1:quantity", "row-1:unitPrice", "row-1:minimumOrder"]);
  });
  it("distinguishes absent MOQ from explicit zero and does not borrow the next item's values", () => {
    const quote = emptyQuotation("synthetic-audit", "synthetic.txt");
    for (const identifier of ["SYNTHETIC-A", "SYNTHETIC-B"]) {
      const item = emptyItem(identifier);
      for (const [key, value] of [["identifier", identifier], ["quantity", "2"], ["unitPrice", "40"]] as const) item[key] = { state: "value", value, raw: value, origin: "supplier", sourceIds: [] };
      quote.items.push(item);
    }
    const result = auditNumericRows(quote, "Item | ID SYNTHETIC-A | Unit price USD 40 | MOQ 0 each\nItem | ID SYNTHETIC-B | Quantity 2 each | Unit price USD 40");
    expect(result.quantity).toEqual({ checked: 2, matched: 1 });
    expect(result.minimumOrder).toMatchObject({ notStatedChecked: 2, notStatedMatched: 1 });
    expect(result.failures).toEqual(["row-1:quantity", "row-1:minimumOrder-not-stated"]);
  });
});
