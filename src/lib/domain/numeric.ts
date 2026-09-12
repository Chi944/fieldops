import Decimal from "decimal.js";
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export function decimal(value: unknown): Decimal | null {
  if (typeof value !== "string" || value.length > 100 || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const result = new D(value); return result.isFinite() ? result : null;
}
const units: Record<string, [string, string]> = {
  each: ["count", "1"], unit: ["count", "1"], units: ["count", "1"], pc: ["count", "1"], pcs: ["count", "1"], piece: ["count", "1"], pieces: ["count", "1"],
  kg: ["mass", "1000"], g: ["mass", "1"], tonne: ["mass", "1000000"],
  m: ["length", "1000"], cm: ["length", "10"], mm: ["length", "1"],
  l: ["volume", "1000"], ml: ["volume", "1"], hour: ["time", "60"], hours: ["time", "60"], h: ["time", "60"], minute: ["time", "1"], minutes: ["time", "1"],
};
export function convertQuantity(quantity: string, from: string, to: string): string | null {
  const q = decimal(quantity), a = from.trim().toLowerCase(), b = to.trim().toLowerCase();
  if (!q || !a || !b) return null;
  if (a === b) return q.toFixed();
  const first = units[a], second = units[b];
  return first && second && first[0] === second[0] ? q.mul(first[1]).div(second[1]).toFixed() : null;
}
export function money(value: Decimal | string, currency = "USD"): string {
  const digits = ["JPY", "KRW", "VND", "CLP"].includes(currency.toUpperCase()) ? 0 : ["BHD", "KWD", "OMR", "JOD", "TND"].includes(currency.toUpperCase()) ? 3 : 2;
  return new D(value).toFixed(digits);
}
