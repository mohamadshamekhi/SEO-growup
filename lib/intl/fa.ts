// Ported from public/app.js's fa()/num() — Persian digit formatting used on every number
// shown in the UI. Keep this as the one shared place that does the ASCII<->Persian digit
// round-trip, per the plan's "shared utility, not ad-hoc" requirement.
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toFaDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

export function fromFaDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

export function faNum(value: number, maxFractionDigits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return toFaDigits(value.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits }));
}
