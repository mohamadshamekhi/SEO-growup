"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

export function PriceForm({ projectId, productOptions, hasAnyPrices }: { projectId: string; productOptions: { url: string; name: string }[]; hasAnyPrices: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(productOptions[0]?.url || "");
  const [torobUrl, setTorobUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api(`/api/projects/${projectId}/prices`, { method: "POST", body: { url, torob_url: torobUrl } });
      setTorobUrl("");
      router.refresh();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); }
  }

  async function runNow() {
    setBusy(true);
    try { await api(`/api/projects/${projectId}/prices`, { method: "POST", body: { run: true } }); } finally { setBusy(false); }
  }

  if (!productOptions.length && !hasAnyPrices) return null;

  return (
    <form id="price-form" className="form-grid edit-only" style={{ padding: "12px 16px 14px" }} onSubmit={add}>
      {productOptions.length > 0 && (
        <>
          <div className="field">
            <label htmlFor="pr-url">محصول</label>
            <select id="pr-url" required value={url} onChange={(e) => setUrl(e.target.value)}>
              <option value="">انتخاب محصول</option>
              {productOptions.map((p) => <option key={p.url} value={p.url}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pr-link">لینک همین محصول در ترب</label>
            <input id="pr-link" type="url" className="mono ltr" placeholder="https://torob.com/p/..." required value={torobUrl} onChange={(e) => setTorobUrl(e.target.value)} />
          </div>
        </>
      )}
      {err && <div className="err full" role="alert">{err}</div>}
      <div className="full row">
        {productOptions.length > 0 && <button className="btn primary" type="submit" disabled={busy}>افزودن لینک</button>}
        {hasAnyPrices && <button type="button" className="btn" disabled={busy} onClick={runNow}>بررسی الان</button>}
      </div>
    </form>
  );
}
