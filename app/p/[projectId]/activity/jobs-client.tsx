"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

type Slot = { kind: string; started: number; done: number; total: number; message: string } | null;
type QueuedJob = { kind: string };
type HistoryJob = { kind: string; finished: number; status: string };
type RunRow = { id: number; kind: string; started_at: number; finished_at: number | null; status: string; error: string };
type Jobs = { current: Slot; writing: Slot; reading: Slot; queued: QueuedJob[]; history: HistoryJob[]; runs: RunRow[] };
type ActivityRow = { user_name: string; action: string; ts: number };

const LABEL: Record<string, string> = {
  uptime: "آپتایم", audit: "ممیزی فنی", articles: "لیست مقالات", catalog: "کاتالوگ محصولات",
  gsc: "Search Console", index: "وضعیت ایندکس", speed: "سرعت صفحات", watch: "پایش رقیب",
  kwgap: "شکاف کلمات با رقیب", prices: "قیمت رقبا", report: "گزارش هفتگی",
  write_content: "نوشتن محتوا با هوش مصنوعی", write_fixes: "پیشنهاد اصلاح متنی با هوش مصنوعی",
  apply: "اعمال اصلاح روی سایت", undo: "برگرداندن تغییر سایت",
};
const label = (k: string) => LABEL[k] || k;

const STATUS_FA: Record<string, string> = { ok: "موفق", error: "خطا", running: "در حال اجرا" };

function SlotCard({ title, slot }: { title: string; slot: Slot }) {
  if (!slot) return null;
  const pct = slot.total ? Math.round((slot.done / slot.total) * 100) : null;
  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="chip warn">{title}</span>
        <strong>{label(slot.kind)}</strong>
        {pct != null && <span className="muted small">{pct}٪</span>}
      </div>
      {slot.message && <div className="muted small" style={{ marginTop: 4 }}>{slot.message}</div>}
    </div>
  );
}

export function JobsClient({ projectId, initialActivity }: { projectId: string; initialActivity: ActivityRow[] }) {
  const [jobs, setJobs] = useState<Jobs | null>(null);
  const [activity, setActivity] = useState(initialActivity);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [j, a] = await Promise.all([
          api<Jobs>(`/api/projects/${projectId}/jobs`),
          api<ActivityRow[]>(`/api/projects/${projectId}/activity`),
        ]);
        if (alive) { setJobs(j); setActivity(a); setErr(""); }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "خطا در دریافت وضعیت");
      }
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [projectId]);

  const running = jobs && (jobs.current || jobs.writing || jobs.reading);
  const queued = jobs?.queued || [];

  return (
    <div>
      {err && <div className="err" role="alert">{err}</div>}

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>در حال اجرا</h2>
      {!jobs && <p className="muted">در حال دریافت وضعیت...</p>}
      {jobs && !running && <p className="muted">هیچ کاری الان در حال اجرا نیست.</p>}
      <SlotCard title="صف اصلی" slot={jobs?.current ?? null} />
      <SlotCard title="نوشتن" slot={jobs?.writing ?? null} />
      <SlotCard title="رقبا" slot={jobs?.reading ?? null} />

      {queued.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>در صف ({queued.length})</h2>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {queued.map((j, i) => <span className="chip" key={i}>{label(j.kind)}</span>)}
          </div>
        </>
      )}

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>اجراهای اخیر</h2>
      {!jobs?.runs.length && <p className="muted">هنوز اجرایی ثبت نشده.</p>}
      {!!jobs?.runs.length && (
        <table className="tbl">
          <thead><tr><th>کار</th><th>شروع</th><th>وضعیت</th><th>خطا</th></tr></thead>
          <tbody>
            {jobs.runs.map((r) => (
              <tr key={r.id}>
                <td>{label(r.kind)}</td>
                <td className="muted small">{formatJalaliDateTime(r.started_at * 1000)}</td>
                <td><span className={`chip ${r.status === "ok" ? "ok" : r.status === "error" ? "danger" : "warn"}`}>{STATUS_FA[r.status] || r.status}</span></td>
                <td className="muted small">{r.error ? r.error.slice(0, 120) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>اقدام‌های کاربران</h2>
      {!activity.length && <p className="muted">هنوز فعالیتی ثبت نشده.</p>}
      {!!activity.length && (
        <table className="tbl">
          <thead><tr><th>کاربر</th><th>اقدام</th><th>زمان</th></tr></thead>
          <tbody>
            {activity.map((a, i) => (
              <tr key={i}>
                <td>{a.user_name}</td>
                <td>{a.action}</td>
                <td className="muted small">{formatJalaliDateTime(a.ts * 1000)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
