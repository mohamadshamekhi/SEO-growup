"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type Adapter = { type: string; base_url: string; writable: readonly string[] } | null;

export function AdapterClient({ projectId, initialAdapter }: { projectId: string; initialAdapter: Adapter }) {
  const router = useRouter();
  const [adapter, setAdapter] = useState(initialAdapter);
  const [type, setType] = useState("steve");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api<{ adapter: Adapter }>(`/api/projects/${projectId}/adapter`, { method: "POST", body: { type, base_url: baseUrl, token } });
      setAdapter(r.adapter);
      setToken("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("اتصال به سایت حذف شود؟")) return;
    await api(`/api/projects/${projectId}/adapter`, { method: "DELETE" });
    setAdapter(null);
    router.refresh();
  }

  return (
    <section style={{ margin: "16px 0" }}>
      <h3>اتصال به سایت</h3>
      {adapter ? (
        <div>
          <p>نوع: {adapter.type} · آدرس: <span className="ltr mono">{adapter.base_url}</span></p>
          <p className="muted small">قابل‌نوشتن: {adapter.writable.join("، ")}</p>
          <button className="btn sm danger" onClick={disconnect}>قطع اتصال</button>
        </div>
      ) : (
        <form onSubmit={connect} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <div className="field">
            <label htmlFor="ad-type">نوع</label>
            <select id="ad-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="steve">Steve</option>
              <option value="wordpress">WordPress</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ad-url">آدرس API</label>
            <input id="ad-url" className="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" required />
          </div>
          <div className="field">
            <label htmlFor="ad-token">توکن</label>
            <input id="ad-token" className="ltr" type="password" value={token} onChange={(e) => setToken(e.target.value)} required />
          </div>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" type="submit" disabled={busy}>اتصال و آزمایش</button>
        </form>
      )}
    </section>
  );
}
