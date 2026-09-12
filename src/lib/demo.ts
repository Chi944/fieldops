import Decimal from "decimal.js";
import { absent, Comparison, emptyItem, emptyQuotation, field, MatchGroup, QuoteItem, Quotation, valueOf } from "./domain/types";
import { proposeMatches } from "./domain/matching";
import { reconcileQuotation } from "./domain/validation";

interface DemoLine { id: string; description: string; sku: string; quantity: string; unit: string; price: string; amount?: string; kind?: QuoteItem["kind"]; packageSize?: string; packageUnit?: string; minimum?: string; billing?: string; scope?: string; duration?: string; spec?: string; tiers?: { min: string; max: string | null; price: string }[]; }
interface DemoQuote { id: string; name: string; number: string; currency?: string; lines: DemoLine[]; shipping?: string; lead?: string; payment?: string; notes?: string; revision?: string; }

/** Hand-authored demonstration data, never passed off as model extraction. Each field points into the complete original text. */
function quotation(spec: DemoQuote): Quotation {
  const q = emptyQuotation(spec.id, `${spec.number}.txt`), currency = spec.currency ?? "SGD", chunks: string[] = [];
  function source(id: string, text: string) {
    const start = chunks.reduce((n, line) => n + line.length + 1, 0); chunks.push(text);
    const sourceId = `${q.id}-${id}`;
    q.sources.push({ id: sourceId, documentId: q.documentId, kind: "text", text, start, end: start + text.length });
    return [sourceId];
  }
  const header = source("header", `${spec.name}\nQUOTATION ${spec.number}\nDate: 10 September 2026${spec.revision ? `\nRevision: ${spec.revision}` : ""}\nCurrency: ${currency}\nContact: Procurement desk | quotes@${spec.id}.example\nDemonstration quotation — fictional supplier and pricing.`);
  q.supplier.name = field(spec.name, header); q.supplier.contact = field("Procurement desk", header); q.supplier.email = field(`quotes@${spec.id}.example`, header);
  q.quotationNumber = field(spec.number, header); q.date = field("2026-09-10", header, "10 September 2026"); q.currency = field(currency, header); q.locale = field("English month name stated; decimal point in monetary values", header, "10 September 2026");
  q.revision = spec.revision ? field(spec.revision, header) : absent();
  for (const line of spec.lines) {
    const amount = line.amount ?? new Decimal(line.quantity).mul(line.price).toFixed(2);
    const raw = `${line.description} | Item ID: ${line.sku}\nQuantity: ${line.quantity} ${line.unit} | Unit price: ${currency} ${line.price} per ${line.unit} | Line amount: ${currency} ${amount}${line.packageSize ? `\nPackage contents: ${line.packageSize} ${line.packageUnit} per ${line.unit}; whole packages only` : ""}${line.minimum ? `\nMinimum order: ${line.minimum} ${line.unit}` : ""}${line.billing ? `\nBilling basis: ${line.billing}` : ""}${line.scope ? `\nScope: ${line.scope}` : ""}${line.duration ? `\nDuration: ${line.duration}` : ""}${line.spec ? `\nSpecification: ${line.spec}` : ""}${line.tiers ? `\nAll-unit quantity pricing (${line.unit}): ${line.tiers.map(t => `${t.min}–${t.max ?? "above"}: ${currency} ${t.price}`).join("; ")}` : ""}\nAll line prices exclude tax; tax rate: 9%.`;
    const ids = source(line.id, raw), item = emptyItem(`${q.id}-${line.id}`);
    Object.assign(item, { kind: line.kind ?? "goods", description: field(line.description, ids), identifier: field(line.sku, ids), quantity: field(line.quantity, ids), unit: field(line.unit, ids), unitPrice: field(line.price, ids), lineAmount: field(amount, ids), currency: field(currency, header), sourceIds: ids, taxBasis: "exclusive", taxRate: field("9", ids) });
    if (line.packageSize) { item.packageSize = field(line.packageSize, ids); item.packageUnit = field(line.packageUnit!, ids); item.orderIncrement = field("1", ids, "whole packages only"); }
    if (line.minimum) item.minimumOrder = field(line.minimum, ids);
    if (line.billing) item.billingBasis = field(line.billing, ids);
    if (line.scope) item.scope = field(line.scope, ids);
    if (line.duration) item.duration = field(line.duration, ids);
    if (line.spec) item.attributes.push({ key: "specification", label: "Specification", type: "text", value: field(line.spec, ids) });
    if (line.tiers) item.tiers = line.tiers.map(t => ({ min: t.min, max: t.max, unitPrice: t.price, unit: line.unit, basis: "all_units", sourceIds: ids }));
    q.items.push(item);
  }
  const subtotal = q.items.reduce((sum, item) => sum.plus(valueOf(item.lineAmount)!), new Decimal(0));
  const delivery = spec.shipping === undefined ? null : new Decimal(spec.shipping);
  const tax = subtotal.plus(delivery ?? 0).mul("0.09").toDecimalPlaces(2), total = subtotal.plus(delivery ?? 0).plus(tax);
  const totals = source("totals", `Subtotal: ${currency} ${subtotal.toFixed(2)}${delivery ? `\nShipping: ${currency} ${delivery.toFixed(2)}` : ""}\nTax (9% of subtotal${delivery ? " plus shipping" : ""}): ${currency} ${tax.toFixed(2)}\nQuoted total: ${currency} ${total.toFixed(2)}${spec.shipping === undefined ? " (delivery costs excluded)" : ""}`);
  q.statedSubtotal = field(subtotal.toFixed(2), totals); q.statedTotal = field(total.toFixed(2), totals);
  q.locale.sourceIds = [...header, ...totals];
  q.charges.push({ id: `${q.id}-shipping`, kind: "shipping", label: "Delivery", amount: spec.shipping === undefined ? absent() : field(spec.shipping, totals), currency: field(currency, header), appliesTo: "quotation" });
  q.charges.push({ id: `${q.id}-tax`, kind: "tax", label: "Tax at quoted quantities", amount: field(tax.toFixed(2), totals), currency: field(currency, header), appliesTo: "quotation" });
  const terms = source("terms", `Lead time: ${spec.lead ?? "7 business days from confirmed order"}\nPayment: ${spec.payment ?? "30 days from invoice"}\nValidity: 30 September 2026\nWarranty: 12 months for supplied goods; workmanship 90 days\nExclusions: Building works and changes outside the stated scope are excluded.${spec.notes ? `\nNotes: ${spec.notes}` : ""}`);
  q.terms.leadTime = field(spec.lead ?? "7 business days from confirmed order", terms); q.terms.payment = field(spec.payment ?? "30 days from invoice", terms); q.terms.validity = field("2026-09-30", terms, "30 September 2026"); q.terms.warranty = field("12 months for supplied goods; workmanship 90 days", terms); q.terms.exclusions = field("Building works and changes outside the stated scope are excluded.", terms);
  if (spec.notes) q.terms.notes = field(spec.notes, terms);
  q.originalText = chunks.join("\n"); q.contentHash = `demo-fixture-${q.id}-v1`; q.status = "ready"; q.format = "text"; q.isDemo = true; q.extractionVersion = 1; q.extractedAt = "2026-09-13T02:00:00.000Z";
  q.manifest = { parserVersion: "authored-demo-1", complete: true, warnings: [], units: [{ id: `${q.id}-text`, label: "Complete pasted quotation", status: "parsed", sourceCount: q.sources.length }] };
  const checked = reconcileQuotation(q);
  if (spec.shipping === undefined) checked.issues.push({ id: `${q.id}-delivery-review`, code: "missing_field", severity: "warning", message: "Delivery cost is not stated. Ask whether delivery is included and confirm the charge.", documentId: q.documentId, fieldPath: "charges.0.amount", sourceIds: [], resolved: false });
  return checked;
}
function comparison(id: string, name: string, description: string, quotes: Quotation[]): Comparison {
  return { id, workspaceId: "demo-workspace", name, description, createdAt: "2026-09-10T02:00:00.000Z", updatedAt: "2026-09-13T02:00:00.000Z", revision: 1, isDemo: true, quotations: quotes, groups: proposeMatches(quotes), corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "Keep original currencies separate. Flag missing costs and differences in scope." } };
}
function reviewed(groups: MatchGroup[]) { for (const group of groups) if (group.classification === "equivalent" && group.members.length > 1) { group.status = "approved"; group.approvedRevision = 1; } }

function studio(): Comparison {
  const scope = "Install supplied studio furniture, panels, lights and cables; one site; disposal of packaging included";
  const common = { kind: "service" as const, billing: "fixed_project", scope, duration: "One installation visit" };
  const q = [
    quotation({ id: "northstar", name: "Northstar Studio Supply", number: "NSS-2026-104", shipping: "45", lead: "5 business days from confirmed order", lines: [
      { id: "chair", description: "Ergonomic studio chair", sku: "SC-100", quantity: "4", unit: "each", price: "185", spec: "Black fabric; adjustable lumbar; 3D arms" },
      { id: "panel", description: "Acoustic wall panel 600 × 600 mm", sku: "AP-60", quantity: "2", unit: "pack", price: "252", packageSize: "6", packageUnit: "each", spec: "25 mm recycled PET; charcoal" },
      { id: "light", description: "LED task light", sku: "LT-400", quantity: "4", unit: "each", price: "64", spec: "4000 K; CRI 90; dimmable" },
      { id: "cable", description: "Studio cable kit", sku: "CK-10", quantity: "4", unit: "each", price: "28", spec: "10 m; copper conductors; connectors included" },
      { id: "install", description: "Studio installation", sku: "INSTALL", quantity: "1", unit: "project", price: "480", ...common },
    ] }),
    quotation({ id: "meridian", name: "Meridian Works", number: "MW-882", lead: "3 business days from confirmed order", notes: "Delivery charges will be confirmed after the site address is supplied.", lines: [
      { id: "chair", description: "Ergonomic studio chair", sku: "SC-100", quantity: "4", unit: "each", price: "175", spec: "Black fabric; adjustable lumbar; 3D arms" },
      { id: "panel", description: "Acoustic wall panel 600 × 600 mm", sku: "AP-60", quantity: "10", unit: "each", price: "45", spec: "25 mm recycled PET; charcoal", tiers: [{ min: "1", max: "19", price: "45" }, { min: "20", max: null, price: "41" }] },
      { id: "light", description: "LED task light", sku: "LT-400", quantity: "4", unit: "each", price: "69", spec: "4000 K; CRI 90; dimmable" },
      { id: "cable", description: "Studio cable kit", sku: "CK-10", quantity: "4", unit: "each", price: "26", amount: "116", spec: "10 m; copper conductors; connectors included" },
      { id: "install", description: "Studio installation", sku: "INSTALL", quantity: "1", unit: "project", price: "420", ...common },
    ] }),
    quotation({ id: "copperline", name: "Copperline Projects", number: "CL-209-R2", shipping: "60", revision: "2", lead: "7 business days from confirmed order", lines: [
      { id: "chair", description: "Ergonomic studio chair", sku: "SC-100", quantity: "4", unit: "each", price: "179", spec: "Black fabric; adjustable lumbar; 3D arms" },
      { id: "panel", description: "Acoustic wall panel 600 × 600 mm", sku: "AP-60", quantity: "3", unit: "box", price: "168", packageSize: "4", packageUnit: "each", spec: "25 mm recycled PET; charcoal" },
      { id: "light", description: "LED task light", sku: "LT-400", quantity: "4", unit: "each", price: "65", spec: "4000 K; CRI 90; dimmable" },
      { id: "cable", description: "Studio cable kit", sku: "CK-10", quantity: "4", unit: "each", price: "30", spec: "10 m; copper conductors; connectors included" },
      { id: "install", description: "Studio installation", sku: "INSTALL", quantity: "8", unit: "hour", price: "60", kind: "service", billing: "hourly", scope: "Installation labour only; packaging disposal excluded; eight hours is an estimate", duration: "Estimated eight hours" },
    ] }),
  ];
  const result = comparison("demo-studio", "Studio equipment & installation", "Four workstations, acoustic treatment and installation for a small creative studio.", q);
  reviewed(result.groups);
  const panels = result.groups.find(g => g.members.some(m => m.itemId === "northstar-panel"))!;
  panels.label = "Acoustic wall panels"; panels.requiredQuantity = "10"; panels.requiredUnit = "each"; panels.acceptedOrderQuantities = { northstar: "2", copperline: "3" };
  panels.requirements = "Ten panels required. Demo reviewer accepted two spare panels from packaged offers.";
  return result;
}
function facilities(): Comparison {
  const quotes = ["Hearth Facilities", "Clearway Services", "Civic Maintenance"].map((name, index) => quotation({ id: `facilities-${index}`, name, number: `FM-${100 + index}`, shipping: "0", lead: `${3 + index * 2} business days from confirmed order`, lines: [
    { id: "clean", description: "Monthly office cleaning", sku: "CLEAN-120", quantity: "1", unit: "site", price: ["720", "680", "750"][index], kind: "service", billing: "monthly", scope: "120 sqm office; twice weekly cleaning; consumables included", duration: "One month" },
    { id: "filter", description: "HVAC replacement filter", sku: "F-20", quantity: "6", unit: "each", price: ["24", "22", "25"][index], spec: index === 1 ? "MERV 8; 20 × 20 inches" : "MERV 13; 20 × 20 inches" },
    { id: "callout", description: "Emergency maintenance labour", sku: "EM-1", quantity: "2", unit: "hour", price: ["85", "80", "90"][index], kind: "service", billing: "hourly", scope: "Weekday emergency labour; parts excluded", duration: "Two hours", minimum: "2" },
  ] }));
  const result = comparison("demo-facilities", "Facilities maintenance", "Cleaning, replacement filters and an emergency labour allowance for a shared office.", quotes);
  reviewed(result.groups);
  const recurring = result.groups.find(g => g.members.some(m => m.itemId.endsWith("-clean")))!; recurring.billingPeriods = "12"; recurring.requirements = "Twelve monthly billing periods; no annual discount assumed.";
  return result;
}
function event(): Comparison {
  const quotes = ["Stagecraft Events", "Daylight Production", "Signal Events"].map((name, index) => quotation({ id: `event-${index}`, name, number: `EV-${320 + index}`, currency: index === 2 ? "USD" : "SGD", shipping: ["80", "100", "60"][index], lines: [
    { id: "audio", description: "Portable PA system rental", sku: "PA-2", quantity: "1", unit: "system", price: ["320", "295", "220"][index], kind: "service", billing: "fixed_project", scope: "Two powered speakers, mixer, two microphones; one-day rental", duration: "One event day" },
    { id: "setup", description: "Event setup and teardown", sku: "SETUP-1", quantity: "1", unit: "project", price: ["180", "210", "150"][index], kind: "service", billing: "fixed_project", scope: "Single venue; ground-floor access; setup and teardown included", duration: "One event day" },
    { id: "operator", description: "Audio operator", sku: "OP-1", quantity: "6", unit: "hour", price: ["55", "50", "45"][index], kind: "service", billing: "hourly", scope: "Audio operation during event; setup time excluded", duration: "Six hours", minimum: "4" },
  ] }));
  const result = comparison("demo-event", "Community event production", "Compare a one-day audio package, venue setup and six hours of operator support.", quotes); reviewed(result.groups); return result;
}
/** Returns fresh copies so local demo edits cannot contaminate other visitors or subsequent resets. */
export function demoComparisons(): Comparison[] { return [studio(), facilities(), event()]; }
