/** Small, explicit vocabulary. Unknown commercial billing expressions need review. */
export function billingBasis(value: string | null): string | null {
  const label = value?.toLowerCase().trim().replace(/[_/-]+/g, " ").replace(/\s+/g, " ") ?? "";
  const aliases: Record<string, string> = {
    monthly: "monthly", month: "monthly", "per month": "monthly",
    yearly: "yearly", annual: "yearly", annually: "yearly", year: "yearly", "per year": "yearly",
    weekly: "weekly", week: "weekly", "per week": "weekly",
    quarterly: "quarterly", quarter: "quarterly", "per quarter": "quarterly", recurring: "recurring",
    hourly: "hourly", hour: "hourly", "per hour": "hourly",
    daily: "daily", day: "daily", "per day": "daily",
    "fixed project": "fixed_project", "fixed fee": "fixed_project", "lump sum": "fixed_project", "one time": "fixed_project",
    "per word": "per_word", "per unit": "per_unit",
  };
  return aliases[label] ?? null;
}
export const recurringBilling = (basis: string | null): boolean => basis !== null && ["monthly", "yearly", "weekly", "quarterly", "recurring"].includes(basis);
