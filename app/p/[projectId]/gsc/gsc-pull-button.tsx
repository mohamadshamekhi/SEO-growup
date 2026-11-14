"use client";
// No manual trigger existed for the "gsc" pull job (the one that actually fills
// gsc_snap/gsc_daily) — the connection test only checks auth, and the scheduler may not
// have retried since. This both triggers it now and shows the last attempt's own error,
// so "متصل نیست" vs. "پول هنوز اجرا نشده/خطا داد" stop looking identical.
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

type LastRun = { status: string; started_at: number; error: string } | null | undefined;

export function GscPullButton({ projectId, lastRun }: { projectId: string; lastRun: LastRun }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function pull() {
    setBusy(true); setMsg("");
    try {
      await api(`/api/projects/${projectId}/run`, { method: "POST", body: { kind: "gsc" } });
      setMsg("در صف قرار گرفت؛ نتیجه را چند لحظه دیگر یا در تب «فعالیت و کارها» ببین.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "10px 0 16px" }}>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn sm primary" disabled={busy} onClick={pull}>
          {busy ? "در حال ارسال..." : "دریافت الان از Search Console"}
        </button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
      {lastRun && lastRun.status === "error" && (
        <div className="err" style={{ marginTop: 8 }}>آخرین تلاش خطا داد: {lastRun.error}</div>
      )}
    </div>
  );
}
