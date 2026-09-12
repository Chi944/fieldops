import type { Comparison, FieldValue } from "./types";
import { valueOf } from "./types";
import type { CalculatedGroup, Recommendation } from "./calculate";

export interface ExplicitLeadTime { minimum: number; maximum: number; basis: "business_days" | "calendar_days" | "unspecified_days" | "business_weeks" | "unspecified_weeks"; condition: string; raw: string; sourceIds: string[]; }
/** Only explicit finite integer/range durations; no inferred order date, calendar or business-week length. */
export function parseLeadTime(field: FieldValue): ExplicitLeadTime | null {
  if (field.state !== "value" || !field.value || !field.sourceIds.length) return null;
  const raw = field.value.trim();
  const match = /^(\d{1,4})(?:\s*(?:[-–—]|to)\s*(\d{1,4}))?\s+(?:(business|working|calendar)\s+)?(days?|weeks?)(?:\s+(.+))?$/i.exec(raw.replace(/[.;]$/, ""));
  if (!match) return null;
  let minimum = Number(match[1]), maximum = Number(match[2] ?? match[1]);
  if (minimum > maximum) return null;
  const qualifier = match[3]?.toLowerCase(), weekly = match[4].toLowerCase().startsWith("week");
  let basis: ExplicitLeadTime["basis"];
  if (qualifier === "calendar") { basis = "calendar_days"; if (weekly) { minimum *= 7; maximum *= 7; } }
  else if (qualifier === "business" || qualifier === "working") basis = weekly ? "business_weeks" : "business_days";
  else basis = weekly ? "unspecified_weeks" : "unspecified_days";
  const condition = (match[5] ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[.;]$/, "");
  if (condition && !/^(?:from|after|following|upon|subject to|once|excluding|including|on)\b/.test(condition)) return null;
  return { minimum, maximum, basis, condition, raw, sourceIds: [...field.sourceIds] };
}
export function leadTimeDecision(comparison: Comparison): Recommendation {
  const allSources = comparison.quotations.flatMap(q => q.terms.leadTime.sourceIds);
  const entries = comparison.quotations.map(q => ({ quotationId: q.id, name: valueOf(q.supplier.name) ?? "Unknown supplier", lead: parseLeadTime(q.terms.leadTime), complete: q.manifest.complete && q.status === "ready" }));
  const known = entries.filter((entry): entry is typeof entry & { lead: ExplicitLeadTime } => Boolean(entry.lead && entry.complete));
  const insufficient = (why: string): Recommendation => ({ kind: "lead_time", message: `Insufficient information for an overall earliest lead time: ${why} Stated durations are not guaranteed delivery dates.`, quotationIds: [], sourceIds: allSources });
  if (known.length < 2) return insufficient("at least two complete quotations need explicit comparable durations.");
  if (known.length !== entries.length) return insufficient("one or more suppliers have missing, ambiguous, unsupported or incomplete lead-time evidence.");
  if (known.some(entry => entry.lead.basis.startsWith("unspecified"))) return insufficient("the calendar/business duration basis is not explicitly stated.");
  if (new Set(known.map(entry => `${entry.lead.basis}:${entry.lead.condition}`)).size !== 1) return insufficient("day/week bases or start conditions differ; clarify them before comparing.");
  const earliest = known.filter(candidate => known.every(other => other.quotationId === candidate.quotationId || candidate.lead.maximum < other.lead.minimum));
  if (earliest.length !== 1) return insufficient("the stated lead-time ranges overlap or tie, so there is no unambiguous earliest supplier.");
  const winner = earliest[0];
  return { kind: "lead_time", message: `${winner.name} has the earliest explicitly stated comparable lead time: ${winner.lead.raw}. Its latest stated bound precedes the other suppliers' earliest bounds, using the same duration basis and start condition. This compares quoted lead times, not guaranteed delivery dates or overall suitability.`, quotationIds: [winner.quotationId], sourceIds: allSources };
}
/** Coverage and explicit review checklist only. Free prose is never interpreted as a verified semantic fit score. */
export function requirementDecisions(comparison: Comparison, groups: CalculatedGroup[]): Recommendation[] {
  const requirements = comparison.groups.filter(g => g.status !== "rejected" && g.requirements.trim());
  if (!requirements.length && !comparison.preferences.notes.trim()) return [];
  if (!requirements.length) return [{ kind: "requirements", message: `Requirements checklist for buyer review: ${comparison.preferences.notes.trim()} No requirement-level approvals have been recorded, so suitability is insufficiently established.`, quotationIds: [], sourceIds: [] }];
  return comparison.quotations.map(quote => {
    let covered = 0, conflicting = 0, missing = 0; const sourceIds: string[] = [];
    for (const requirement of requirements) {
      const values = groups.find(group => group.groupId === requirement.id)?.values.filter(value => value.quotationId === quote.id) ?? [];
      sourceIds.push(...values.flatMap(value => value.sourceIds));
      if (!values.length) missing++;
      else if (values.some(value => value.status === "eligible") && requirement.status === "approved" && requirement.classification === "equivalent") covered++;
      else conflicting++;
    }
    const checklist = requirements.map(g => `${g.label}: ${g.requirements.trim()}`).join("; ");
    return { kind: "requirements", message: `${valueOf(quote.supplier.name) ?? "Supplier"}: ${covered}/${requirements.length} entered requirement groups have reviewed comparable coverage; ${conflicting} need review or have conflicts; ${missing} are missing. Checklist: ${checklist}${comparison.preferences.notes.trim() ? ` General notes: ${comparison.preferences.notes.trim()}` : ""} Coverage records buyer-reviewed groups; it does not verify every free-text requirement or assign a suitability score.`, quotationIds: [quote.id], sourceIds: [...new Set(sourceIds)] };
  });
}
