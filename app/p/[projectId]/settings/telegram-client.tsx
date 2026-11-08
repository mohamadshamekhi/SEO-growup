"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

type TgConfig = { chat: string; mention_site: string; mention_ig: string; alerts: boolean; reports: boolean; last_error: string } | null;

export function TelegramClient({ projectId, initial }: { projectId: string; initial: TgConfig }) {
  const [t, setT] = useState(initial);
  const [token, setToken] = useState("");
  const [chat, setChat] = useState(initial?.chat || "");
  const [mentionSite, setMentionSite] = useState(initial?.mention_site || "");
  const [mentionIg, setMentionIg] = useState(initial?.mention_ig || "");
  const [alerts, setAlerts] = useState(initial ? initial.alerts : true);
  const [reports, setReports] = useState(initial ? initial.reports : true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api<{ telegram_config: TgConfig }>(`/api/projects/${projectId}/telegram`, { method: "POST", body: { token, chat, mention_site: mentionSite, mention_ig: mentionIg, alerts, reports } });
      setT(r.telegram_config);
      setToken("");
      setMsg("ذخیره شد");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); }
  }

  async function test() {
    setErr(""); setBusy(true);
    try {
      await api(`/api/projects/${projectId}/telegram`, { method: "POST", body: { test: true } });
      setMsg("پیام آزمایشی ارسال شد");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); }
  }

  return (
    <section className="panel narrow" style={{ marginTop: 14 }}>
      <h3>تلگرام این پروژه</h3>
      <p className="muted">هر پروژه ربات، گروه و افراد خودش را دارد.</p>
      {t?.last_error && <div className="banner warn"><div className="grow">آخرین ارسال ناموفق بود: {t.last_error}</div></div>}
      {msg && <div className="chip ok">{msg}</div>}
      {err && <div className="err" role="alert">{err}</div>}
      <form className="form-grid" onSubmit={save}>
        <div className="field"><label htmlFor="tp-token">توکن ربات</label><input id="tp-token" type="password" className="mono ltr" autoComplete="off" placeholder={t ? "ذخیره شده؛ برای تغییر وارد کنید" : ""} value={token} onChange={(e) => setToken(e.target.value)} /></div>
        <div className="field"><label htmlFor="tp-chat">شناسه چت</label><input id="tp-chat" type="text" className="mono ltr" value={chat} onChange={(e) => setChat(e.target.value)} /></div>
        <div className="field"><label htmlFor="tp-ms">منشن مقاله‌ها</label><input id="tp-ms" type="text" className="ltr" value={mentionSite} onChange={(e) => setMentionSite(e.target.value)} placeholder="@name" /></div>
        <div className="field"><label htmlFor="tp-mi">منشن اینستاگرام</label><input id="tp-mi" type="text" className="ltr" value={mentionIg} onChange={(e) => setMentionIg(e.target.value)} placeholder="@name @name2" /></div>
        <label className="check full"><input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />هشدار قطعی سایت و افت امتیاز هم به این گروه برود</label>
        <label className="check full"><input type="checkbox" checked={reports} onChange={(e) => setReports(e.target.checked)} />گزارش هفتگی هم به این گروه برود</label>
        <div className="full row">
          <button className="btn primary" type="submit" disabled={busy}>ذخیره</button>
          {t && <button className="btn" type="button" disabled={busy} onClick={test}>ارسال آزمایشی</button>}
        </div>
      </form>
    </section>
  );
}
