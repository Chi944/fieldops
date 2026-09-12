import type { Comparison } from "./domain/types";
import { valueOf } from "./domain/types";
import { restoreCorrectionValue } from "./domain/corrections";
import { calculateComparison } from "./domain/calculate";

/** Export a pinned snapshot. All supplier strings are literal cells, never formulas. */
export async function comparisonWorkbook(
  comparison: Comparison,
  options: { sourceOrigin?: string; calculatedAt?: string } = {},
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const result = calculateComparison(comparison);
  if (options.calculatedAt) result.calculatedAt = options.calculatedAt;
  const original = structuredClone(comparison);
  for (const correction of [...comparison.corrections].reverse()) {
    const q = original.quotations.find((q) => q.id === correction.quotationId);
    if (!q) continue;
    try {
      restoreCorrectionValue(q, correction.path, correction.before);
    } catch {
      /* Deleted fields remain in the correction audit. */
    }
  }
  original.quotations.forEach((q) => {
    q.items = q.items.filter(
      (i) =>
        !comparison.corrections.some(
          (c) =>
            c.quotationId === q.id &&
            c.path === `items.${i.id}.description` &&
            c.operation === "add_item",
        ),
    );
  });
  workbook.creator = "FieldOps";
  workbook.created = new Date(result.calculatedAt);
  workbook.title = comparison.name;
  workbook.subject = "Evidence-linked supplier comparison";
  const addSheet = (
    name: string,
    headers: string[],
    rows: (string | number | null)[][],
  ) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(headers);
    rows.forEach((row) =>
      sheet.addRow(row.map((cell) => (cell === null ? "Not stated" : cell))),
    );
    sheet.columns.forEach((column, i) => {
      column.width = i === 0 ? 30 : 25;
    });
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF17665D" },
    };
    sheet.getRow(1).height = 28;
    sheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, sheet.rowCount), column: headers.length },
    };
    sheet.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
    };
    return sheet;
  };
  addSheet(
    "Summary",
    ["Field", "Value"],
    [
      ["Comparison", comparison.name],
      ["Comparison date", result.calculatedAt],
      ["Snapshot revision", comparison.revision],
      [
        "Mode",
        comparison.isDemo
          ? "Demonstration — saved sample extractions"
          : "User workspace",
      ],
      [
        "Unresolved issues",
        comparison.quotations
          .flatMap((q) => q.issues)
          .filter((i) => !i.resolved).length,
      ],
      [
        "Assumptions",
        "Only approved equivalence and explicit supplier price bases are used. Unknown costs are not zero.",
      ],
      [
        "Rounding",
        "Decimal calculation; supplier values preserved. See line-level discrepancies.",
      ],
      ...result.recommendations.map(
        (r) => [r.kind, r.message] as [string, string],
      ),
    ],
  );
  addSheet(
    "Comparison",
    [
      "Requirement",
      "Supplier",
      "Required quantity",
      "Unit",
      "Order quantity",
      "Surplus",
      "Amount",
      "Currency",
      "Eligibility",
      "Explanation",
    ],
    result.groups.flatMap((g) =>
      g.values.map((v) => [
        g.label,
        valueOf(
          comparison.quotations.find((q) => q.id === v.quotationId)!.supplier
            .name,
        ),
        v.requiredQuantity,
        comparison.groups.find((group) => group.id === g.groupId)
          ?.requiredUnit ?? "",
        v.orderQuantity,
        v.surplus,
        v.amount,
        v.currency,
        v.status,
        v.reasons.join("; "),
      ]),
    ),
  );
  addSheet(
    "Supplier totals",
    [
      "Supplier",
      "Currency",
      "Comparable subtotal",
      "Known charges",
      "Total",
      "Coverage",
      "Label",
      "Issues",
    ],
    result.suppliers.map((s) => [
      s.supplierName,
      s.currency,
      s.subtotal,
      s.knownCharges,
      s.total,
      `${s.coverage}/${s.requiredGroups}`,
      s.label,
      s.reasons.join("; "),
    ]),
  );
  addSheet(
    "Reviewed items",
    [
      "Supplier",
      "Quotation",
      "Item",
      "Identifier",
      "Quoted quantity",
      "Unit",
      "Unit price",
      "Stated line amount",
      "Currency",
      "Scope",
      "Billing basis",
      "Source IDs",
    ],
    comparison.quotations.flatMap((q) =>
      q.items.map((i) => [
        valueOf(q.supplier.name),
        q.filename,
        valueOf(i.description),
        valueOf(i.identifier),
        valueOf(i.quantity),
        valueOf(i.unit),
        valueOf(i.unitPrice),
        valueOf(i.lineAmount),
        valueOf(i.currency),
        valueOf(i.scope),
        valueOf(i.billingBasis),
        i.sourceIds.join(", "),
      ]),
    ),
  );
  addSheet(
    "Original items",
    [
      "Supplier",
      "Document",
      "Description",
      "Quantity",
      "Unit",
      "Unit price",
      "Line amount",
      "Currency",
      "Source IDs",
    ],
    original.quotations.flatMap((q) =>
      q.items.map((i) => [
        valueOf(q.supplier.name),
        q.filename,
        valueOf(i.description),
        valueOf(i.quantity),
        valueOf(i.unit),
        valueOf(i.unitPrice),
        valueOf(i.lineAmount),
        valueOf(i.currency),
        i.sourceIds.join(", "),
      ]),
    ),
  );
  addSheet(
    "Additional attributes",
    ["Document", "Item", "Attribute", "Value", "Type", "Unit", "Source IDs"],
    comparison.quotations.flatMap((q) => [
      ...q.attributes.map((a) => [
        q.filename,
        "Quotation",
        a.label,
        a.value.value,
        a.type,
        a.unit ?? "",
        a.value.sourceIds.join(", "),
      ]),
      ...q.items.flatMap((i) =>
        i.attributes.map((a) => [
          q.filename,
          valueOf(i.description),
          a.label,
          a.value.value,
          a.type,
          a.unit ?? "",
          a.value.sourceIds.join(", "),
        ]),
      ),
    ]),
  );
  addSheet(
    "Charges and price rules",
    ["Document", "Item", "Type", "Terms", "Source IDs"],
    comparison.quotations.flatMap((q) => [
      ...q.charges.map((c) => [
        q.filename,
        c.itemId ?? "Quotation",
        c.kind,
        `${c.label}: ${c.amount.value ?? c.amount.state} ${c.currency.value ?? "currency not stated"}; applies to ${c.appliesTo}; ${c.billingPeriod ?? "one-time or not stated"}`,
        c.amount.sourceIds.join(", "),
      ]),
      ...q.items.flatMap((i) => [
        [
          q.filename,
          valueOf(i.description),
          "Packaging / MOQ",
          `${i.packageSize.value ?? i.packageSize.state} ${i.packageUnit.value ?? ""} per ${i.unit.value ?? "unit"}; minimum ${i.minimumOrder.value ?? i.minimumOrder.state}; increment ${i.orderIncrement.value ?? i.orderIncrement.state}`,
          i.sourceIds.join(", "),
        ],
        ...i.tiers.map((t) => [
          q.filename,
          valueOf(i.description),
          "Quantity tier",
          `${t.min}–${t.max ?? "above"} ${t.unit}: ${t.unitPrice}, ${t.basis}`,
          t.sourceIds.join(", "),
        ]),
        ...(i.discount
          ? [
              [
                q.filename,
                valueOf(i.description),
                "Discount",
                `${i.discount.value} ${i.discount.kind}; basis ${i.discount.basis}; already included ${i.discount.alreadyIncluded}`,
                i.discount.sourceIds.join(", "),
              ],
            ]
          : []),
      ]),
    ]),
  );
  addSheet(
    "Field audit",
    [
      "Interpretation",
      "Document",
      "Field",
      "Value",
      "State",
      "Origin",
      "Raw supplier wording",
      "Source IDs",
    ],
    [original, comparison].flatMap((version, index) =>
      version.quotations.flatMap((q) => {
        const containers: [string, Record<string, unknown>][] = [
          ["", q as unknown as Record<string, unknown>],
          ["supplier.", q.supplier as unknown as Record<string, unknown>],
          ["terms.", q.terms as unknown as Record<string, unknown>],
          ...q.items.map(
            (i) =>
              [`items.${i.id}.`, i as unknown as Record<string, unknown>] as [
                string,
                Record<string, unknown>,
              ],
          ),
        ];
        return containers.flatMap(([prefix, object]) =>
          Object.entries(object)
            .filter(
              ([, v]) =>
                v && typeof v === "object" && "state" in v && "origin" in v,
            )
            .map(([key, v]) => {
              const f = v as import("./domain/types").FieldValue;
              return [
                index === 0 ? "Original interpretation" : "Reviewed",
                q.filename,
                `${prefix}${key}`,
                f.value ?? "",
                f.state,
                f.origin,
                f.raw ?? "",
                f.sourceIds.join(", "),
              ];
            }),
        );
      }),
    ),
  );
  addSheet(
    "Commercial terms",
    ["Supplier", "Term", "Value", "State", "Origin", "Source IDs"],
    comparison.quotations.flatMap((q) =>
      Object.entries(q.terms).map(([key, v]) => [
        valueOf(q.supplier.name),
        key,
        v.value,
        v.state,
        v.origin,
        v.sourceIds.join(", "),
      ]),
    ),
  );
  addSheet(
    "Review issues",
    ["Document", "Severity", "Issue", "Resolved", "Resolution", "Source IDs"],
    comparison.quotations.flatMap((q) =>
      q.issues.map((i) => [
        q.filename,
        i.severity,
        i.message,
        i.resolved ? "Yes" : "No",
        i.resolution ?? "",
        i.sourceIds.join(", "),
      ]),
    ),
  );
  addSheet(
    "Corrections",
    [
      "Quotation",
      "Field",
      "Original",
      "Correction",
      "Reason",
      "Author",
      "Date",
      "Original raw",
      "Original state",
      "Corrected state",
      "Operation",
    ],
    comparison.corrections.map((c) => [
      c.quotationId,
      c.path,
      c.before.value ?? c.before.state,
      c.after.value ?? c.after.state,
      c.reason,
      c.author,
      c.createdAt,
      c.before.raw ?? "",
      c.before.state,
      c.after.state,
      c.operation ?? "edit",
    ]),
  );
  addSheet(
    "Sources",
    ["Source ID", "Document", "Location", "Excerpt", "Original"],
    comparison.quotations.flatMap((q) =>
      q.sources.map((s) => [
        s.id,
        q.filename,
        s.sheet
          ? `${s.sheet}!${s.cell}`
          : s.page
            ? `Page ${s.page}`
            : `Characters ${s.start ?? 0}–${s.end ?? s.text.length}`,
        s.text,
        q.isDemo
          ? "Self-authored sample; original is available in the app"
          : `${options.sourceOrigin ?? ""}/api/documents/${q.documentId}/source`,
      ]),
    ),
  );
  addSheet(
    "Assumptions",
    ["Type", "Details"],
    [
      ["Requirement notes", comparison.preferences.notes],
      ...comparison.groups.map(
        (g) =>
          [
            g.label,
            `${g.requirements}; match: ${g.classification}, ${g.status}; billing periods: ${g.billingPeriods ?? "not set"}`,
          ] as [string, string],
      ),
      ...comparison.exchangeRates.map(
        (r) =>
          [
            "User-supplied FX",
            `1 ${r.from} = ${r.rate} ${r.to}; ${r.date}; ${r.source}`,
          ] as [string, string],
      ),
      ...comparison.quotations.map(
        (q) =>
          [
            q.filename,
            `Extraction version ${q.extractionVersion}; coverage ${q.manifest.complete ? "processed" : "incomplete"}; review still required`,
          ] as [string, string],
      ),
    ],
  );
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
