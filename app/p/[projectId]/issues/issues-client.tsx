"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

type Issue = { id: number; code: string; severity: string; url: string; detail: string; status: string; label: string; fix: string };

const SEV_FA: Record<string, string> = { critical: "بحرانی", warning: "هشدار", info: "اطلاع" };

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

  return (
    <div>
      {err && <div className="err" role="alert">{err}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>شدت</th><th>عنوان</th><th>صفحه</th><th>جزئیات</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #333" }}>
              <td>{SEV_FA[r.severity] || r.severity}</td>
              <td>{r.label}</td>
              <td className="ltr mono" style={{ fontSize: 12 }}>{r.url}</td>
              <td style={{ fontSize: 12, opacity: 0.8 }}>{r.detail}</td>
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
  );
}
