import { describe, expect, it } from "vitest";
import { demoComparisons } from "../src/lib/demo";
import { leadTimeDecision, parseLeadTime } from "../src/lib/domain/decisions";
import { calculateComparison } from "../src/lib/domain/calculate";
import { absent, field } from "../src/lib/domain/types";

function leads(first: string, second: string, third: string) {
  const comparison = demoComparisons()[0];
  for (const [index, raw] of [first, second, third].entries()) comparison.quotations[index].terms.leadTime = field(raw, comparison.quotations[index].terms.leadTime.sourceIds);
  return comparison;
}
describe("evidence-linked decision criteria", () => {
  it("chooses an earliest range only when its latest bound precedes every other earliest bound", () => {
    const comparison = leads("3-5 business days from confirmed order", "7-10 business days from confirmed order", "12-14 business days from confirmed order");
    const result = leadTimeDecision(comparison);
    expect(result.quotationIds).toEqual(["northstar"]); expect(result.sourceIds).toHaveLength(3);
    expect(result.message).toContain("3-5 business days"); expect(result.message).toContain("not guaranteed delivery dates");
  });
  it("never ranks mixed business/calendar days or inconsistent start conditions", () => {
    expect(leadTimeDecision(leads("3 business days after deposit", "7 calendar days after deposit", "9 business days after deposit")).quotationIds).toEqual([]);
    expect(leadTimeDecision(leads("3 business days after deposit", "7 business days after drawing approval", "9 business days after deposit")).quotationIds).toEqual([]);
  });
  it("returns insufficient information for unknowns, unspecified bases, and overlapping ranges", () => {
    const comparison = leads("3-7 business days", "5-10 business days", "12 business days");
    expect(leadTimeDecision(comparison).message).toContain("overlap or tie");
    comparison.quotations[2].terms.leadTime = absent();
    expect(leadTimeDecision(comparison).message).toContain("missing, ambiguous");
    expect(leadTimeDecision(leads("3 days", "7 days", "10 days")).quotationIds).toEqual([]);
  });
  it("converts explicitly calendar weeks but never invents the length of a business week", () => {
    expect(parseLeadTime(field("2 calendar weeks after order.", ["source"]))?.maximum).toBe(14);
    expect(parseLeadTime(field("2 business weeks after order", ["source"]))?.maximum).toBe(2);
    expect(parseLeadTime(field("2 business weeks after order", ["source"]))?.basis).toBe("business_weeks");
    expect(parseLeadTime(field("About a week, subject to availability", ["source"]))).toBeNull();
    expect(parseLeadTime(field("3 calendar days", []))).toBeNull();
  });
  it("summarises reviewed requirement coverage without interpreting free prose as verified suitability", () => {
    const comparison = demoComparisons()[0];
    comparison.groups[0].requirements = "Black fabric and adjustable lumbar required";
    const requirements = calculateComparison(comparison).recommendations.filter(r => r.kind === "requirements");
    expect(requirements).toHaveLength(3);
    expect(requirements[0].message).toContain("2/2");
    expect(requirements[0].message).toContain("does not verify every free-text requirement");
    comparison.groups[0].status = "stale";
    expect(calculateComparison(comparison).recommendations.find(r => r.kind === "requirements")!.message).toContain("1/2");
  });
  it("orders criteria using the explicit user priority without assigning weighted scores", () => {
    const comparison = demoComparisons()[0]; comparison.preferences.priority = "lead_time";
    expect(calculateComparison(comparison).recommendations[0].kind).toBe("lead_time");
    comparison.preferences.priority = "requirements";
    expect(calculateComparison(comparison).recommendations[0].kind).toBe("requirements");
  });
  it("a forced approval cannot turn hourly and fixed project prices into equivalent comparisons", () => {
    const comparison = demoComparisons()[0], installation = comparison.groups.find(g => g.label === "Studio installation")!;
    installation.classification = "equivalent"; installation.status = "approved"; installation.approvedRevision = comparison.revision;
    const result = calculateComparison(comparison).groups.find(g => g.groupId === installation.id)!;
    expect(result.values.every(v => v.status === "not_comparable")).toBe(true); expect(result.lowestQuotationIds).toEqual([]);
  });
  it("a forced approval cannot override conflicting filter specifications", () => {
    const comparison = demoComparisons()[1], filters = comparison.groups.find(g => g.label === "HVAC replacement filter")!;
    filters.classification = "equivalent"; filters.status = "approved";
    const result = calculateComparison(comparison).groups.find(g => g.groupId === filters.id)!;
    expect(result.values.every(v => v.status === "not_comparable")).toBe(true); expect(result.lowestQuotationIds).toEqual([]);
  });
});
