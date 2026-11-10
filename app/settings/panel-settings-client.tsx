"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

type KeyInfo = { client_email: string; project_id: string } | { error: string } | null;
type Agent = { id: number; name: string; last_seen_fa: string };

export function PanelSettingsClient({ initialKey, initialPagespeed, agents, agentsCount }: {
  initialKey: KeyInfo; initialPagespeed: boolean; agents: Agent[]; agentsCount: string;
}) {
  const [keyInfo, setKeyInfo] = useState(initialKey);
  const [keyText, setKeyText] = useState("");
  const [keyErr, setKeyErr] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);

  const [pagespeedKey, setPagespeedKey] = useState("");
  const [hasPagespeed, setHasPagespeed] = useState(initialPagespeed);
  const [psErr, setPsErr] = useState("");
  const [psBusy, setPsBusy] = useState(false);

  async function saveKey(e: React.FormEvent) {
    e.preventDefault();
    setKeyErr(""); setKeyBusy(true);
    try {
      const r = await api<KeyInfo>("/api/settings/gsc-key", { method: "POST", body: { key: keyText } });
      setKeyInfo(r);
      setKeyText("");
    } catch (e) {
      setKeyErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setKeyBusy(false);
    }
  }

  async function savePagespeed(e: React.FormEvent) {
    e.preventDefault();
    setPsErr(""); setPsBusy(true);
    try {
      await api("/api/settings", { method: "POST", body: { pagespeed_key: pagespeedKey } });
      setHasPagespeed(true);
      setPagespeedKey("");
    } catch (e) {
      setPsErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setPsBusy(false);
    }
  }

  return (
    <div>
      <section className="panel narrow" style={{ marginBottom: 14 }}>
        <h3>کلید Service Account گوگل</h3>
        <p className="muted small">برای Search Console و Google Analytics یک کلید مشترک کافی است. ایمیل این Service Account را بعداً باید در خود Search Console/Analytics هر سایت به‌عنوان کاربر اضافه کنی.</p>
        {keyInfo && "client_email" in keyInfo && (
          <div className="chip ok" style={{ marginBottom: 10 }}>متصل: <span className="mono ltr">{keyInfo.client_email}</span></div>
        )}
        {keyInfo && "error" in keyInfo && <div className="chip danger" style={{ marginBottom: 10 }}>{keyInfo.error}</div>}
        {!keyInfo && <div className="chip" style={{ marginBottom: 10 }}>هنوز کلیدی وارد نشده</div>}
        <form className="form-grid" onSubmit={saveKey}>
          {keyErr && <div className="err full" role="alert">{keyErr}</div>}
          <div className="field full">
            <label>محتوای فایل JSON کلید Service Account</label>
            <textarea className="mono ltr" rows={8} required value={keyText} onChange={(e) => setKeyText(e.target.value)} placeholder='{"type": "service_account", ...}' />
          </div>
          <div className="full"><button className="btn primary" type="submit" disabled={keyBusy}>ذخیره کلید</button></div>
        </form>
      </section>

      <section className="panel narrow" style={{ marginBottom: 14 }}>
        <h3>کلید PageSpeed Insights (اختیاری)</h3>
        {hasPagespeed && <div className="chip ok" style={{ marginBottom: 10 }}>تنظیم شده</div>}
        <form className="form-grid" onSubmit={savePagespeed}>
          {psErr && <div className="err full" role="alert">{psErr}</div>}
          <div className="field full">
            <label>API Key</label>
            <input className="mono ltr" value={pagespeedKey} onChange={(e) => setPagespeedKey(e.target.value)} placeholder={hasPagespeed ? "برای تغییر، کلید جدید بنویس" : ""} />
          </div>
          <div className="full"><button className="btn primary" type="submit" disabled={psBusy || !pagespeedKey}>ذخیره</button></div>
        </form>
      </section>

      <section className="panel narrow">
        <h3>agentهای نویسنده متصل<span className="muted"> ({agentsCount})</span></h3>
        {agents.length === 0 ? <p className="muted">هیچ agent خارجی وصل نشده.</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th>نام</th><th>آخرین اتصال</th></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid #333" }}>
                  <td>{a.name}</td>
                  <td className="mono ltr">{a.last_seen_fa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
