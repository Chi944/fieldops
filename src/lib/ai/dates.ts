const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const months = monthNames.join("|");
const dayFirst = new RegExp(`^(\\d{1,2}) +(${months}) +(\\d{4})$`, "i");
const monthFirst = new RegExp(`^(${months}) +(\\d{1,2}),? +(\\d{4})$`, "i");
const wordCharacter = /[\p{L}\p{N}]/u;

/** Only normalizes a full written date already present verbatim in the excerpt.
 * The caller must still validate that excerpt against its original source IDs. */
export function normalizeWrittenDate(value: string, raw: string): string | null {
  const dayMatch = value.match(dayFirst), monthMatch = value.match(monthFirst);
  if ((dayMatch?.[0] ?? monthMatch?.[0]) !== value) return null;
  let literal = false;
  for (let offset = raw.indexOf(value); offset >= 0; offset = raw.indexOf(value, offset + 1)) {
    if (!wordCharacter.test(raw[offset - 1] ?? "") && !wordCharacter.test(raw[offset + value.length] ?? "")) { literal = true; break; }
  }
  if (!literal) return null;
  const day = Number(dayMatch?.[1] ?? monthMatch![2]);
  const month = monthNames.indexOf((dayMatch?.[2] ?? monthMatch![1]).toLowerCase()) + 1;
  const yearText = dayMatch?.[3] ?? monthMatch![3], year = Number(yearText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || day < 1 || day > days) return null;
  return `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
