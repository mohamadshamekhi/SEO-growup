"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type Fix = { id: number; url: string; type: string; current: string; proposed: string; detail: string; status: string; apply_error: string };

const TYPE_FA: Record<string, string> = { seo_title: "عنوان سئو", meta_description: "توضیح متا", description: "توضیح محصول" };

export function FixesClient({ projectId, initialRows, hasAdapter }: { projectId: string; initialRows: Fix[]; hasAdapter: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function suggestAll() {
    setBusy(true); setMsg(""); setErr("");
    try {
      await api(`/api/projects/${projectId}/write`, { method: "POST", body: { what: "fixes", limit: 10 } });
      setMsg("در پس‌زمینه با هوش مصنوعی متن پیشنهاد می‌شود؛ چند لحظه دیگر صفحه را رفرش کن.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: number, status: "approved" | "rejected") {
    try {
      await api(`/api/projects/${projectId}/fixbulk`, { method: "POST", body: { ids: [id], status } });
      setRows(rows.map((r) => (r.id === id ? { ...r, status: status === "approved" ? "approved" : "pending" } : r)).filter((r) => status !== "rejected" || r.id !== id));
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function applySelected() {
    if (!selected.size) return;
    if (!confirm(`${selected.size} مورد روی سایت واقعی اعمال شود؟ این تغییر واقعی است (قابل برگشت از تب کارها نیست مگر از «اعمال‌شده‌ها»).`)) return;
    setBusy(true); setErr("");
    try {
      await api(`/api/projects/${projectId}/apply`, { method: "POST", body: { ids: [...selected], confirm: true } });
      setMsg("در صف اعمال روی سایت قرار گرفت؛ یکی‌یکی با فاصله اعمال می‌شود.");
      setSelected(new Set());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  const approved = rows.filter((r) => r.status === "approved");

  return (
    <div>
      <div className="row" style={{ gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <button type="button" className="btn sm" disabled={busy} onClick={suggestAll}>پیشنهاد خودکار با هوش مصنوعی</button>
        {!hasAdapter && <span className="muted small">این پروژه به API سایت وصل نیست؛ اعمال روی سایت غیرفعال است (تنظیمات → اتصال).</span>}
        {hasAdapter && approved.length > 0 && (
          <button type="button" className="btn sm primary" disabled={!selected.size || busy} onClick={applySelected}>
            اعمال {selected.size || ""} مورد تأییدشده روی سایت
          </button>
        )}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="muted small" style={{ marginBottom: 10 }}>{msg}</div>}
      {!rows.length && <p className="muted">فعلاً اصلاح متنی باز نیست.</p>}
      {rows.map((r) => (
        <details className="issue-group" key={r.id} open={r.status === "approved"}>
          <summary>
            <span className={`chip ${r.status === "approved" ? "ok" : r.proposed ? "warn" : ""}`}>
              {r.status === "approved" ? "تأییدشده" : r.proposed ? "منتظر تأیید" : "منتظر متن"}
            </span>
            <strong style={{ flex: 1 }}>{TYPE_FA[r.type] || r.type}</strong>
            {r.status === "approved" && hasAdapter && (
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} onClick={(e) => e.stopPropagation()} />
            )}
          </summary>
          <div style={{ padding: "0 14px 14px" }}>
            <div className="url" style={{ marginBottom: 6 }}>{r.url}</div>
            <div className="muted small" style={{ marginBottom: 8 }}>{r.detail}</div>
            {r.current && <div className="muted" style={{ marginBottom: 6 }}><b>فعلی: </b>{r.current}</div>}
            {r.proposed ? (
              <div style={{ marginBottom: 8 }}><b>پیشنهادی: </b>{r.proposed}</div>
            ) : (
              <div className="muted" style={{ marginBottom: 8 }}>هنوز متنی پیشنهاد نشده.</div>
            )}
            {r.apply_error && <div className="err">{r.apply_error}</div>}
            {r.status === "pending" && r.proposed && (
              <div className="row">
                <button type="button" className="btn sm primary" onClick={() => setStatus(r.id, "approved")}>تأیید</button>
                <button type="button" className="btn sm danger" onClick={() => setStatus(r.id, "rejected")}>رد</button>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
