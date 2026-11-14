"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type Issue = { id: number; code: string; severity: string; url: string; detail: string; status: string; label: string; fix: string };
type AutoFixResult = { ok: boolean; applied?: boolean; proposed?: string; reason?: string };

const SEV_FA: Record<string, string> = { critical: "بحرانی", warning: "هشدار", info: "پیشنهاد" };
// Only these codes have a real, single-field, safe one-click fix (lib/issue-autofix.ts);
// everyone else (duplicate_* needs cross-page uniqueness, the rest are structural/server-side).
const AUTOFIXABLE = new Set(["missing_title", "title_length", "missing_description", "description_length"]);

export function IssuesClient({ projectId, initialRows }: { projectId: string; initialRows: Issue[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  async function toggle(id: number, status: string) {
    setRows(rows.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await api(`/api/issues/${id}`, { method: "PATCH", body: { status } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  async function autofix(r: Issue) {
    if (!confirm(`متن جدید برای «${r.label}» (${r.url}) با هوش مصنوعی ساخته و مستقیم روی سایت ثبت می‌شود. ادامه؟`)) return;
    setBusy(r.id); setErr(""); setMsg("");
    try {
      const res = await api<AutoFixResult>(`/api/issues/${r.id}/autofix`, { method: "POST" });
      if (res.ok && res.applied) {
        setRows(rows.map((x) => (x.id === r.id ? { ...x, status: "fixed" } : x)));
        setMsg(`رفع شد: «${res.proposed}»`);
      } else {
        setErr(res.reason || "رفع خودکار ممکن نشد");
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(null);
    }
  }

  async function recheck() {
    setChecking(true); setErr(""); setMsg("");
    try {
      await api(`/api/projects/${projectId}/run`, { method: "POST", body: { kind: "audit" } });
      setMsg("بررسی مجدد سایت در صف قرار گرفت؛ نتیجه را در تب «فعالیت و کارها» ببین.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, margin: "0 0 12px" }}>
        <button type="button" className="btn sm" disabled={checking} onClick={recheck}>بررسی مجدد سایت</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="muted small" style={{ marginBottom: 10 }}>{msg}</div>}
      {!rows.length ? (
        <div className="empty-inline"><p>مشکلی با این وضعیت نیست.</p></div>
      ) : (
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
                    <div className="row" style={{ gap: 6 }}>
                      {r.status === "open" && AUTOFIXABLE.has(r.code) && (
                        <button className="btn sm primary" disabled={busy === r.id} onClick={() => autofix(r)}>
                          {busy === r.id ? "در حال رفع..." : "رفع خودکار"}
                        </button>
                      )}
                      <button className="btn sm" onClick={() => toggle(r.id, r.status === "open" ? "ignored" : "open")}>
                        {r.status === "open" ? "نادیده بگیر" : "بازگردان"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
