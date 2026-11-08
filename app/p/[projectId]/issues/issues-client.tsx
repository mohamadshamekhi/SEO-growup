"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

type Issue = { id: number; code: string; severity: string; url: string; detail: string; status: string; label: string; fix: string };

const SEV_FA: Record<string, string> = { critical: "بحرانی", warning: "هشدار", info: "پیشنهاد" };

export function IssuesClient({ initialRows }: { initialRows: Issue[] }) {
  const [rows, setRows] = useState(initialRows);
  const [err, setErr] = useState("");

  async function toggle(id: number, status: string) {
    setRows(rows.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await api(`/api/issues/${id}`, { method: "PATCH", body: { status } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  if (!rows.length) return <div className="empty-inline"><p>مشکلی با این وضعیت نیست.</p></div>;

  return (
    <div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>شدت</th><th>عنوان</th><th>صفحه</th><th>جزئیات</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><span className={`sev ${r.severity}`}>{SEV_FA[r.severity] || r.severity}</span></td>
                <td>{r.label}</td>
                <td className="url">{r.url}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.detail}</td>
                <td>
                  <button className="btn sm" onClick={() => toggle(r.id, r.status === "open" ? "ignored" : "open")}>
                    {r.status === "open" ? "نادیده بگیر" : "بازگردان"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
