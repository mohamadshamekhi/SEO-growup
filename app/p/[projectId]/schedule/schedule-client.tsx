"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

type JobDesc = { key: string; label: string; about: string; min_hours: number; on: boolean; hours: number; at: number | null; idle?: boolean; last: number | null; next: number | null };

export function ScheduleClient({ projectId, initialJobs, isAdmin }: { projectId: string; initialJobs: JobDesc[]; isAdmin: boolean }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [err, setErr] = useState("");

  async function toggle(key: string, on: boolean) {
    setJobs(jobs.map((j) => (j.key === key ? { ...j, on } : j)));
    try {
      await api(`/api/projects/${projectId}/schedule`, { method: "POST", body: { [key]: { on } } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  async function runNow(kind: string) {
    setErr("");
    try {
      await api(`/api/projects/${projectId}/run`, { method: "POST", body: { kind } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  return (
    <div>
      {err && <div className="err" role="alert">{err}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>کار</th><th>فعال</th><th>آخرین اجرا</th><th>اجرای بعدی</th><th></th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.key} style={{ borderTop: "1px solid #333" }}>
              <td>{j.label}<div style={{ fontSize: 11, opacity: 0.6 }}>{j.about}</div></td>
              <td>
                <input type="checkbox" checked={j.on} disabled={!isAdmin} onChange={(e) => toggle(j.key, e.target.checked)} />
              </td>
              <td>{j.last ? formatJalaliDateTime(j.last * 1000) : "—"}</td>
              <td>{j.idle ? "غیرفعال" : j.next ? formatJalaliDateTime(j.next * 1000) : "—"}</td>
              <td>
                {isAdmin && j.key !== "uptime" && <button className="btn sm" onClick={() => runNow(j.key)}>اجرای الان</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">کارهایی که هنوز در این نسخه پیاده نشده‌اند، بعد از اجرا پیام خطای روشن در تاریخچه می‌گذارند؛ موفق فرض نمی‌شوند.</p>
    </div>
  );
}
