// Ported from hub/extras.py's key_pages()/run_speed(). No service-account auth needed —
// PageSpeed Insights takes a plain optional API key.
import { getSetting, run } from "./db";
import { catalogRows } from "./catalog";
import type { ProjectRow } from "./projects";
import { googleFetch } from "./google-proxy";

function keyPages(project: ProjectRow): string[] {
  const base = `https://${project.domain}/`;
  const rows = catalogRows(project.id);
  const picks = [base];
  for (const kind of ["product", "article"] as const) {
    const hit = rows.find((r) => r.kind === kind);
    if (hit) picks.push(hit.url);
  }
  return picks;
}

type LighthouseResult = {
  lighthouseResult?: { categories?: { performance?: { score?: number } }; audits?: Record<string, { numericValue?: number }> };
  loadingExperience?: { metrics?: Record<string, { percentile?: number }>; overall_category?: string };
};

export async function runSpeed(project: ProjectRow, progress: (done: number, total: number, message: string) => void = () => {}) {
  const key = getSetting("pagespeed_key", "");
  const pages = keyPages(project);
  const out: number[] = [];
  const errors: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const url = pages[i];
    for (const strategy of ["mobile", "desktop"] as const) {
      progress(i, pages.length, `${strategy}: ${decodeURIComponent(url)}`);
      const params: Record<string, string> = { url, strategy, category: "performance" };
      if (key) params.key = key;
      const qs = new URLSearchParams(params);
      let d: LighthouseResult;
      try {
        const res = await googleFetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 429 && !key) throw new Error("سهمیه رایگان بدون کلید تمام شده؛ کلید رایگان PageSpeed را در تنظیمات وارد کنید.");
          errors.push(`${res.status} ${await res.text()}`.slice(0, 160));
          continue;
        }
        d = await res.json();
      } catch (e) {
        if ((e as Error).message.includes("سهمیه")) throw e;
        errors.push(String((e as Error).message).slice(0, 160));
        continue;
      }
      const a = d.lighthouseResult?.audits || {};
      const field = d.loadingExperience?.metrics || {};
      const val = (k: string) => a[k]?.numericValue ?? null;
      const score = Math.round((d.lighthouseResult?.categories?.performance?.score || 0) * 100);
      run(
        "INSERT INTO vitals(project_id,url,strategy,ts,score,lcp,cls,tbt,field_inp,field_lcp,field_overall) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        project.id, url, strategy, Date.now() / 1000, score,
        val("largest-contentful-paint"), val("cumulative-layout-shift"), val("total-blocking-time"),
        field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null, field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        d.loadingExperience?.overall_category || "",
      );
      out.push(score);
    }
  }
  if (!out.length) throw new Error(errors[0] || "نتیجه‌ای نیامد");
  return { measured: out.length, avg_score: Math.round(out.reduce((a, b) => a + b, 0) / out.length), errors: errors.length };
}
