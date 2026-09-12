import { MatchGroup, ParsedDocument, Quotation, SourceSpan } from "../src/lib/domain/types";
import { resolveField } from "../src/lib/domain/corrections";
import { decimal } from "../src/lib/domain/calculate";
import { FixtureRecord } from "../scripts/generate-fixtures";

export const canonical = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const pairKey = (first: string, second: string) => [first, second].sort().join("|");
export interface Fraction { numerator: number; denominator: number; value: number | null; }
export const fraction = (numerator: number, denominator: number): Fraction => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
export interface MatchingMetrics { equivalentPrecision: Fraction; equivalentRecall: Fraction; truePositive: number; falsePositive: number; falseNegative: number; candidatePairs: number; hardNegativeFalseEquivalences: Fraction; }
export function scoreMatches(documents: FixtureRecord[], groups: MatchGroup[]): MatchingMetrics {
  const truth = new Set<string>(), hardNegatives = new Set<string>(); let candidatePairs = 0;
  for (let a = 0; a < documents.length; a++) for (let b = a + 1; b < documents.length; b++) {
    const first = documents[a], second = documents[b]; if (first.scenarioId !== second.scenarioId) continue;
    for (const itemA of first.quotation.items) for (const itemB of second.quotation.items) {
      candidatePairs++; const key = pairKey(itemA.id, itemB.id), meaningA = first.equivalentKeys[itemA.id], meaningB = second.equivalentKeys[itemB.id];
      if (meaningA && meaningA === meaningB) truth.add(key);
      else if (itemA.identifier.value === itemB.identifier.value) hardNegatives.add(key);
    }
  }
  const predicted = new Set<string>();
  for (const group of groups) if (group.classification === "equivalent" && group.status !== "rejected") for (let a = 0; a < group.members.length; a++) for (let b = a + 1; b < group.members.length; b++) {
    if (group.members[a].quotationId !== group.members[b].quotationId) predicted.add(pairKey(group.members[a].itemId, group.members[b].itemId));
  }
  const truePositive = [...predicted].filter(key => truth.has(key)).length, falsePositive = predicted.size - truePositive, falseNegative = truth.size - truePositive;
  return { equivalentPrecision: fraction(truePositive, predicted.size), equivalentRecall: fraction(truePositive, truth.size), truePositive, falsePositive, falseNegative, candidatePairs, hardNegativeFalseEquivalences: fraction([...predicted].filter(key => hardNegatives.has(key)).length, hardNegatives.size) };
}
export function parserMetrics(expected: FixtureRecord, parsed: ParsedDocument) {
  const text = canonical(parsed.sources.map(s => s.text).join(" "));
  const identifiers = expected.quotation.items.map(i => canonical(i.identifier.value!));
  const located = parsed.sources.filter(s => s.kind === "sheet" ? Boolean(s.sheet && s.cell) : s.kind === "text" ? s.start !== undefined && s.end !== undefined : Boolean(s.page));
  const boxes = parsed.sources.filter(s => s.box);
  const bounded = boxes.filter(s => s.pageWidth && s.pageHeight && s.box!.x >= -2 && s.box!.y >= -2 && s.box!.width > 0 && s.box!.height > 0 && s.box!.x + s.box!.width <= s.pageWidth + 2 && s.box!.y + s.box!.height <= s.pageHeight + 2);
  return { complete: parsed.manifest.complete, units: parsed.manifest.units.length, parsedUnits: parsed.manifest.units.filter(u => u.status === "parsed" || u.status === "empty").length, sourceCount: parsed.sources.length, itemIdentifierCoverage: fraction(identifiers.filter(id => text.includes(id)).length, identifiers.length), sourceLocationsPresent: fraction(located.length, parsed.sources.length), boxesWithinPage: fraction(bounded.length, boxes.length) };
}
function agrees(actual: SourceSpan, expected: SourceSpan): boolean {
  if (actual.documentId !== expected.documentId) return false;
  if (expected.sheet) return actual.sheet === expected.sheet && actual.cell === expected.cell;
  if (expected.start !== undefined) return actual.start !== undefined && actual.start >= expected.start && actual.start <= (expected.end ?? expected.start);
  if (actual.page !== expected.page) return false;
  if (!expected.box || !actual.box || !expected.pageWidth || !expected.pageHeight || !actual.pageWidth || !actual.pageHeight) return true;
  const x = (actual.box.x + actual.box.width / 2) / actual.pageWidth, y = (actual.box.y + actual.box.height / 2) / actual.pageHeight;
  return x >= expected.box.x / expected.pageWidth - 0.01 && x <= (expected.box.x + expected.box.width) / expected.pageWidth + 0.01 && y >= expected.box.y / expected.pageHeight - 0.01 && y <= (expected.box.y + expected.box.height) / expected.pageHeight + 0.01;
}
export function scoreExtraction(expected: FixtureRecord, actual: Quotation, parsed: ParsedDocument) {
  const mapped = new Map<string, string>(), used = new Set<string>();
  for (const goldItem of expected.quotation.items) {
    const matching = actual.items.filter(item => canonical(item.identifier.value ?? "") === canonical(goldItem.identifier.value!) && !used.has(item.id));
    if (matching.length === 1) { mapped.set(goldItem.id, matching[0].id); used.add(matching[0].id); }
  }
  let correctStated = 0, stated = 0, correctCritical = 0, critical = 0, states = 0, correctStates = 0, totalReferences = 0, validReferences = 0, locatedFields = 0, fieldsWithSources = 0;
  const sourceMap = new Map(parsed.sources.map(source => [source.id, source]));
  const failures: { path: string; expected: string | null; actual: string | null; state: string }[] = [];
  for (const gold of expected.fields) {
    let path = gold.path;
    if (path.startsWith("items.")) { const pieces = path.split("."), mappedId = mapped.get(pieces[1]); if (mappedId) { pieces[1] = mappedId; path = pieces.join("."); } }
    let value: ReturnType<typeof resolveField> | null = null;
    try { value = resolveField(actual, path); } catch { /* A missing row/field is an extraction miss. */ }
    const numeric = ["quantity", "unitPrice", "lineAmount", "packageSize", "minimumOrder", "statedSubtotal", "statedTotal", "amount"].includes(gold.path.split(".").at(-1)!);
    const sameValue = numeric ? Boolean(decimal(value?.value)?.eq(decimal(gold.value) ?? "NaN")) : canonical(value?.value ?? "") === canonical(gold.value ?? "");
    const correct = value?.state === gold.state && (gold.state !== "value" || sameValue);
    if (gold.state === "value") { stated++; if (correct) correctStated++; if (gold.critical) { critical++; if (correct) correctCritical++; } }
    else { states++; if (correct) correctStates++; }
    if (!correct) failures.push({ path: gold.path, expected: gold.value, actual: value?.value ?? null, state: value?.state ?? "missing" });
    if (value?.sourceIds.length) {
      fieldsWithSources++; totalReferences += value.sourceIds.length;
      validReferences += value.sourceIds.filter(id => sourceMap.has(id)).length;
      if (correct && value.sourceIds.some(id => { const source = sourceMap.get(id); return source && expected.fieldLocations[gold.path]?.some(location => agrees(source, location)); })) locatedFields++;
    }
  }
  const extractionAmbiguities = expected.ambiguities.filter(path => !path.endsWith(".scope") && !path.endsWith(".attributes"));
  const detectedAmbiguities = extractionAmbiguities.filter(path => {
    const field = expected.fields.find(f => f.path === path);
    if (field && field.state !== "value") { try { return resolveField(actual, path).state === field.state; } catch { return false; } }
    const itemId = path.startsWith("items.") ? mapped.get(path.split(".")[1]) : undefined;
    return actual.issues.some(issue => !issue.resolved && issue.itemId === itemId && issue.code === "amount_mismatch");
  });
  return { statedFieldAccuracy: fraction(correctStated, stated), criticalFieldAccuracy: fraction(correctCritical, critical), annotatedMissingStateAccuracy: fraction(correctStates, states), lineItemPrecision: fraction(used.size, actual.items.length), lineItemRecall: fraction(used.size, expected.quotation.items.length), annotatedReviewSignalRecall: fraction(detectedAmbiguities.length, extractionAmbiguities.length), sourceReferenceResolvability: fraction(validReferences, totalReferences), correctFieldLocationAgreement: fraction(locatedFields, fieldsWithSources), failures, mappedItems: Object.fromEntries(mapped) };
}
