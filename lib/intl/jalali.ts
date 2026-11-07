// Jalali (Persian) calendar formatting via Intl, same approach as public/app.js (jDate/
// jDateTime/jShort). This depends on the Node runtime's ICU data including the "persian"
// calendar — ppl/db-init.ts's caller should run icuSmokeTest() once at boot and log loudly
// if it silently falls back to Gregorian, per the plan's Phase 0 go/no-go gate.
const jDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "short", day: "numeric" });
const jDateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatJalali(ts: number): string {
  return jDate.format(new Date(ts));
}

export function formatJalaliDateTime(ts: number): string {
  return jDateTime.format(new Date(ts));
}

export function icuSmokeTest(): { ok: boolean; sample: string; calendar: string } {
  const resolved = jDate.resolvedOptions();
  const sample = jDate.format(new Date());
  return { ok: resolved.calendar === "persian", sample, calendar: resolved.calendar };
}
