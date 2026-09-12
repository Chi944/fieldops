import { task } from "@trigger.dev/sdk";
import Decimal from "decimal.js";
import { parseDocument } from "@/lib/processing";

/** Fixed synthetic input only: this check never opens saved documents or calls AI. */
export async function runSyntheticChecks() {
  const documentId = "fieldops-trigger-health-synthetic";
  const csv = [
    "description,quantity,unit,unit_price,currency,line_amount",
    '"Replacement filter, size M",3,each,0.10,USD,0.30',
    "Onsite commissioning,2,hour,125.50,USD,251.00",
  ].join("\n");
  const parsed = await parseDocument({
    documentId,
    filename: "fieldops-synthetic-health.csv",
    bytes: new TextEncoder().encode(csv),
    signal: AbortSignal.timeout(10_000),
  });
  const cell = (address: string) => {
    const source = parsed.sources.find((candidate) => candidate.cell === address);
    if (!source || source.documentId !== documentId || source.kind !== "sheet" || source.sheet !== "CSV") {
      throw new Error(`Synthetic CSV evidence check failed at ${address}.`);
    }
    return source.text;
  };
  if (!parsed.manifest.complete || parsed.sources.length !== 18 || cell("A2") !== "Replacement filter, size M" || cell("C3") !== "hour") {
    throw new Error("Synthetic CSV structure check failed.");
  }
  let total = new Decimal(0);
  for (const row of [2, 3]) {
    const amount = new Decimal(cell(`B${row}`)).mul(cell(`D${row}`));
    if (!amount.eq(cell(`F${row}`)) || cell(`E${row}`) !== "USD") throw new Error("Synthetic decimal line check failed.");
    total = total.plus(amount);
  }
  if (!total.eq("251.30")) throw new Error("Synthetic decimal total check failed.");
  return {
    ok: true,
    input: "fixed_synthetic_csv",
    parserVersion: parsed.manifest.parserVersion,
    sourceCells: parsed.sources.length,
    checks: ["csv_quoted_field", "csv_cell_evidence", "decimal_line_amounts", "decimal_total"],
    calculatedTotal: total.toFixed(2),
    currency: "USD",
    modelCalls: 0,
    databaseCalls: 0,
    privateFilesRead: 0,
  };
}

export const healthCheck = task({
  id: "fieldops-health-check",
  machine: "micro",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  queue: { name: "fieldops-health-check", concurrencyLimit: 1 },
  run: async () => runSyntheticChecks(),
});
