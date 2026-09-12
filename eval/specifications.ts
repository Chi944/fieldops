import Decimal from "decimal.js";
import { absent, emptyItem, emptyQuotation, field, Quotation } from "../src/lib/domain/types";

export type FixtureFormat = "text_pdf" | "scan_pdf" | "png" | "xlsx" | "csv" | "text";
export type Split = "dev" | "heldout";
export interface BaseLine { label: string; price: string; quantity: string; unit: string; kind: "goods" | "service"; billing?: string; scope?: string; specification?: string; }
export interface ScenarioSpec { id: string; name: string; split: Split; lines: BaseLine[]; }
const goods = (label: string, price: string, quantity: string, unit = "each", specification = "Standard specification"): BaseLine => ({ label, price, quantity, unit, kind: "goods", specification });
const service = (label: string, price: string, quantity: string, unit: string, billing: string, scope: string): BaseLine => ({ label, price, quantity, unit, kind: "service", billing, scope });
export const SCENARIOS: ScenarioSpec[] = [
  { id: "industrial", name: "Industrial supplies", split: "dev", lines: [goods("M8 steel bolt", "0.18", "200", "each", "M8 zinc plated; grade 8.8"), goods("Nitrile work glove pair", "2.40", "30", "pair", "Size L; powder free"), goods("Machine lubricant", "12.50", "5", "l", "ISO VG 46"), goods("Ventilation filter", "34.50", "2", "each", "MERV 13"), service("Equipment inspection", "80", "2", "hour", "hourly", "Visual inspection; written checklist; repairs excluded"), service("Calibration visit", "140", "1", "project", "fixed_project", "Calibrate two instruments and provide certificates")] },
  { id: "office", name: "Office IT", split: "dev", lines: [goods("Business monitor", "220", "4", "each", "27 inch; 2560x1440; IPS"), goods("USB C cable", "12", "10", "each", "1 m; 100 W; USB 3.2"), goods("Keyboard", "45", "4", "each", "US layout; wired"), goods("Ethernet cable", "1.20", "100", "m", "Cat6; solid copper"), service("Workstation setup", "90", "4", "device", "fixed_project", "Install operating system; connect peripherals; test connectivity"), service("Remote support", "60", "6", "hour", "hourly", "Weekday remote support; hardware excluded")] },
  { id: "event", name: "Event production", split: "dev", lines: [service("PA system rental", "300", "1", "system", "fixed_project", "Two speakers; two microphones; mixer; one event day"), service("Stage setup", "180", "1", "project", "fixed_project", "Ground floor venue; setup and teardown"), service("Audio operator", "50", "6", "hour", "hourly", "Operate audio during event; setup excluded"), goods("Reusable cable tie", "0.50", "40", "each", "200 mm; reusable nylon"), service("Lighting kit rental", "140", "1", "kit", "fixed_project", "Four LED fixtures; one event day"), service("Event recording", "280", "1", "project", "fixed_project", "Single camera recording; raw video deliverable; editing excluded")] },
  { id: "translation", name: "Translation services", split: "dev", lines: [service("English to French translation", "0.12", "1200", "word", "per_word", "General business text; French France; source word count"), service("Independent proofreading", "0.04", "1200", "word", "per_word", "Second linguist reviews translated text"), service("Layout formatting", "35", "4", "hour", "hourly", "Preserve source PDF layout; editable file delivered"), service("Terminology glossary", "90", "1", "project", "fixed_project", "Forty approved business terms"), service("Project coordination", "60", "1", "project", "fixed_project", "One revision round; delivery coordination"), service("Monthly language support", "180", "1", "account", "monthly", "Two hours advisory support per month; translation excluded")] },
  { id: "laboratory", name: "Laboratory consumables", split: "heldout", lines: [goods("Sample vial", "0.75", "60", "each", "10 ml; clear glass; screw cap"), goods("Pipette tip", "0.08", "100", "each", "200 microlitre; filtered; sterile"), goods("Bench absorbent roll", "18", "3", "each", "500 mm wide; 50 m roll"), goods("Lab label", "0.15", "120", "each", "Cryogenic adhesive; 25x15 mm"), service("Cold storage rental", "95", "1", "shelf", "monthly", "One labelled shelf at minus 20 C; monitoring included"), service("Inventory audit", "150", "1", "project", "fixed_project", "Count consumables; provide CSV inventory; no sample handling")] },
  { id: "kitchen", name: "Commercial kitchen equipment", split: "heldout", lines: [goods("Stainless prep table", "340", "2", "each", "1200x600 mm; grade 304"), goods("Food storage container", "18", "12", "each", "10 l; food grade; lid included"), goods("Digital kitchen scale", "65", "2", "each", "15 kg capacity; 1 g resolution"), goods("Extraction duct", "22", "10", "m", "150 mm diameter; galvanized steel"), service("Equipment installation", "380", "1", "project", "fixed_project", "Place and level supplied equipment; electrical work excluded"), service("Kitchen maintenance", "95", "2", "hour", "hourly", "Inspection and cleaning; replacement parts excluded")] },
  { id: "installation", name: "Equipment installation", split: "heldout", lines: [goods("Network cable", "2.50", "100", "m", "Cat6A; shielded; solid copper"), goods("Wall data outlet", "14", "10", "each", "Dual RJ45; Cat6A"), goods("Cable channel", "6", "30", "m", "25x16 mm; white PVC"), service("Cable installation", "65", "12", "hour", "hourly", "Surface route only; supplied cable; no concealed building work"), service("Network certification", "160", "1", "project", "fixed_project", "Test ten network runs; electronic report delivered"), service("Network support", "120", "1", "site", "monthly", "Weekday remote support; replacement hardware excluded")] },
  { id: "facilities", name: "Facilities maintenance", split: "heldout", lines: [service("Office cleaning", "680", "1", "site", "monthly", "120 sqm; twice weekly; cleaning consumables included"), goods("HVAC replacement filter", "24", "6", "each", "MERV 13; 20x20 inches"), service("Emergency maintenance", "85", "2", "hour", "hourly", "Weekday labour; parts excluded"), goods("Refuse sack", "0.45", "60", "each", "120 l; heavy duty"), service("Window cleaning", "140", "1", "project", "fixed_project", "Interior glass; ground floor; 20 sqm"), service("Safety inspection", "190", "1", "project", "fixed_project", "Visual inspection; checklist report; certification excluded")] },
];
export const FORMAT_ORDER: FixtureFormat[] = ["text_pdf", "scan_pdf", "xlsx", "text", "csv", "text_pdf", "png", "xlsx", "text_pdf", "scan_pdf", "text", "text_pdf"];
export interface GoldField { path: string; value: string | null; state: string; critical: boolean; sourceKey: string; }
export interface AuthoredQuotation { id: string; scenarioId: string; split: Split; format: FixtureFormat; quotation: Quotation; fields: GoldField[]; blocks: { key: string; lines: string[] }[]; equivalentKeys: Record<string, string | null>; ambiguities: string[]; }

export function authorQuotation(scenario: ScenarioSpec, supplier: number, format: FixtureFormat): AuthoredQuotation {
  const id = `${scenario.id}-${supplier + 1}`, q = emptyQuotation(id, id), alternate = supplier === 2;
  const comma = scenario.split === "heldout" && supplier === 1, currency = scenario.id === "event" && supplier === 2 ? "USD" : comma ? "EUR" : "SGD";
  const formatNumber = (value: string) => comma ? value.replace(".", ",") : value;
  const blocks: AuthoredQuotation["blocks"] = [], fields: GoldField[] = [], equivalentKeys: Record<string, string | null> = {}, ambiguities: string[] = [];
  const supplierName = `${["Alder", "Beacon", "Cedar"][supplier]} ${scenario.name}`;
  const ambiguousDate = scenario.id === "office" && supplier === 2;
  const header = [`${supplierName}`, `QUOTATION: ${id.toUpperCase()}-26`, `Date: ${ambiguousDate ? "03/04/2026" : "10 September 2026"}`, `Currency: ${currency}`, `Number convention: ${comma ? "decimal comma" : "decimal point"}`, "Fictional benchmark quotation; self-authored; no real supplier."];
  blocks.push({ key: "header", lines: header });
  q.supplier.name = field(supplierName); q.quotationNumber = field(`${id.toUpperCase()}-26`); q.date = ambiguousDate ? absent("ambiguous", "03/04/2026") : field("2026-09-10", [], "10 September 2026"); q.currency = field(currency); q.locale = field(`${comma ? "Decimal comma" : "Decimal point"}; ${ambiguousDate ? "numeric date order ambiguous" : "English month name stated"}`, [], header.join("\n"));
  if (ambiguousDate) ambiguities.push("date");
  const addField = (path: string, value: string | null, sourceKey: string, critical = true, state = "value") => fields.push({ path, value, state, critical, sourceKey });
  addField("supplier.name", supplierName, "header", false); addField("quotationNumber", q.quotationNumber.value, "header", false); addField("date", q.date.value, "header", false, q.date.state); addField("currency", currency, "header");
  scenario.lines.forEach((base, index) => {
    const item = emptyItem(`${id}-line-${index + 1}`), key = `line-${index + 1}`, identifier = `${scenario.id.toUpperCase()}-${index + 1}`;
    let quantity = base.quantity, unit = base.unit, price = new Decimal(base.price).mul(["1", "0.94", "1.06"][supplier]).toFixed(2);
    const packagePricing = index === 1 && supplier === 0 && base.kind === "goods";
    const size = scenario.id === "industrial" ? "10" : "2";
    if (packagePricing) { quantity = new Decimal(quantity).div(size).toFixed(); unit = "pack"; price = new Decimal(price).mul(size).toFixed(2); }
    const scopeConflict = index === 5 && alternate && base.kind === "service";
    const specificationConflict = index === 3 && alternate && base.kind === "goods";
    const scope = scopeConflict ? `${base.scope}; final report or revision deliverable excluded` : base.scope;
    const specification = specificationConflict ? `${base.specification}; alternate lower specification` : base.specification;
    const amount = new Decimal(quantity).mul(price).toFixed(2), discrepancy = scenario.id === "industrial" && supplier === 1 && index === 0;
    const statedAmount = discrepancy ? new Decimal(amount).plus("2").toFixed(2) : amount;
    const sourceLines = [`${index + 1}. ${base.label} | ID ${identifier}`, `Quantity ${formatNumber(quantity)} ${unit}; unit price ${currency} ${formatNumber(price)}; line amount ${currency} ${formatNumber(statedAmount)}`];
    if (packagePricing) sourceLines.push(`Package contents: ${size} ${base.unit} per pack; whole packs only`);
    if (scope) sourceLines.push(`Billing: ${base.billing}; scope: ${scope}`);
    if (specification) sourceLines.push(`Specification: ${specification}`);
    if (index === 1 && supplier === 1 && base.kind === "goods") sourceLines.push(`All-unit tiers (${unit}): 1-199 at ${formatNumber(price)}; 200 and above at ${formatNumber(new Decimal(price).mul("0.9").toFixed(2))}`);
    if (index === 2) sourceLines.push(`Minimum order: ${quantity} ${unit}`);
    Object.assign(item, { kind: base.kind, description: field(base.label), identifier: field(identifier), quantity: field(quantity), unit: field(unit), unitPrice: field(price), lineAmount: field(statedAmount), currency: field(currency), taxBasis: "exclusive", taxRate: field("9") });
    if (packagePricing) { item.packageSize = field(size); item.packageUnit = field(base.unit); item.orderIncrement = field("1", [], "whole packs only"); }
    if (scope) { item.billingBasis = field(base.billing!); item.scope = field(scope); }
    if (specification) item.attributes.push({ key: "specification", label: "Specification", type: "text", value: field(specification) });
    if (index === 1 && supplier === 1 && base.kind === "goods") item.tiers = [{ min: "1", max: "199", unitPrice: price, unit, basis: "all_units", sourceIds: [] }, { min: "200", max: null, unitPrice: new Decimal(price).mul("0.9").toFixed(2), unit, basis: "all_units", sourceIds: [] }];
    if (index === 2) item.minimumOrder = field(quantity);
    if (discrepancy) ambiguities.push(`items.${item.id}.lineAmount`);
    if (scopeConflict || specificationConflict) ambiguities.push(`items.${item.id}.${scopeConflict ? "scope" : "attributes"}`);
    equivalentKeys[item.id] = scopeConflict || specificationConflict ? null : `${scenario.id}:${index + 1}`;
    for (const fieldKey of ["identifier", "quantity", "unit", "unitPrice", "lineAmount", "currency"] as const) addField(`items.${item.id}.${fieldKey}`, item[fieldKey].value, fieldKey === "currency" ? "header" : key);
    if (packagePricing) { addField(`items.${item.id}.packageSize`, size, key); addField(`items.${item.id}.packageUnit`, base.unit, key); }
    if (scope) addField(`items.${item.id}.billingBasis`, base.billing!, key);
    q.items.push(item); blocks.push({ key, lines: sourceLines });
  });
  const subtotal = q.items.reduce((sum, item) => sum.plus(item.lineAmount.value!), new Decimal(0));
  const shipping = supplier === 1 ? null : supplier === 0 ? "25" : "30", tax = subtotal.plus(shipping ?? 0).mul("0.09").toDecimalPlaces(2), total = subtotal.plus(shipping ?? 0).plus(tax);
  blocks.push({ key: "totals", lines: [`Subtotal ${currency} ${formatNumber(subtotal.toFixed(2))}`, ...(shipping === null ? [] : [`Shipping ${currency} ${formatNumber(shipping)}`]), `Tax: 9%; all prices tax-exclusive; tax amount ${currency} ${formatNumber(tax.toFixed(2))}`, `Quoted total ${currency} ${formatNumber(total.toFixed(2))}${shipping === null ? "; delivery excluded and not priced" : ""}`] });
  q.statedSubtotal = field(subtotal.toFixed(2)); q.statedTotal = field(total.toFixed(2));
  addField("statedSubtotal", subtotal.toFixed(2), "totals"); addField("statedTotal", total.toFixed(2), "totals");
  q.charges = [{ id: `${id}-shipping`, kind: "shipping", label: "Shipping", amount: shipping === null ? absent() : field(shipping), currency: field(currency), appliesTo: "quotation" }, { id: `${id}-tax`, kind: "tax", label: "Tax", amount: field(tax.toFixed(2)), currency: field(currency), appliesTo: "quotation" }];
  if (shipping === null) { addField("charges.0.amount", null, "totals", true, "not_stated"); ambiguities.push("charges.0.amount"); }
  const lead = `${3 + supplier * 2} business days from confirmed order`;
  blocks.push({ key: "terms", lines: [`Lead time: ${lead}`, "Payment: 30 days from invoice. Valid until 30 September 2026.", "Exclusions: Unlisted work and materials. Services have no goods warranty.", "No exchange rate has been agreed."] });
  q.terms.leadTime = field(lead); q.terms.payment = field("30 days from invoice"); q.terms.validity = field("2026-09-30", [], "30 September 2026"); q.status = "ready"; q.format = format; q.isDemo = true; q.extractionVersion = 1;
  return { id, scenarioId: scenario.id, split: scenario.split, format, quotation: q, fields, blocks, equivalentKeys, ambiguities };
}
export function authoredDataset(): AuthoredQuotation[] {
  const counts: Record<Split, number> = { dev: 0, heldout: 0 };
  return SCENARIOS.flatMap(scenario => [0, 1, 2].map(supplier => authorQuotation(scenario, supplier, FORMAT_ORDER[counts[scenario.split]++])));
}
