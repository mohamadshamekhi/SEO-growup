"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import type { Conn, ConnName, TestResult } from "@/lib/connections";

type Props = { projectId: string; initial: Conn[]; canEdit: boolean; gscProperty: string; gaProperty: string; serviceEmail: string };

export function ConnectionsClient({ projectId, initial, canEdit, gscProperty, gaProperty, serviceEmail }: Props) {
  const router = useRouter();
  const [results, setResults] = useState<Partial<Record<ConnName, TestResult>>>({});
  const [testing, setTesting] = useState<Set<ConnName>>(new Set());
  const [ga, setGa] = useState(gaProperty);
  const [gsc, setGsc] = useState(gscProperty);
  const [saving, setSaving] = useState<"ga" | "gsc" | null>(null);
  const [saveMsg, setSaveMsg] = useState<Partial<Record<"ga" | "gsc", { ok: boolean; text: string }>>>({});

  async function runTest(name: ConnName) {
    setTesting((s) => new Set(s).add(name));
    try {
      const r = await api<TestResult>(`/api/projects/${projectId}/connections`, { method: "POST", body: { test: name } });
      setResults((x) => ({ ...x, [name]: r }));
    } catch (e) {
      setResults((x) => ({ ...x, [name]: { ok: false, message: e instanceof ApiError ? e.message : "خطا", ms: 0 } }));
    } finally {
      setTesting((s) => { const n = new Set(s); n.delete(name); return n; });
    }
  }

  async function testAll() {
    // Telegram posts a real message to the team group, so it's only tested on its own button.
    await Promise.all(initial.filter((c) => c.name !== "telegram").map((c) => runTest(c.name)));
  }

  async function save(kind: "ga" | "gsc") {
    setSaving(kind);
    try {
      const r = await api<{ ok: boolean; message: string }>(`/api/projects/${projectId}/connections`, { method: "POST", body: { [kind]: kind === "ga" ? ga : gsc } });
      setSaveMsg((m) => ({ ...m, [kind]: { ok: r.ok, text: r.message } }));
      router.refresh();
    } catch (e) {
      setSaveMsg((m) => ({ ...m, [kind]: { ok: false, text: e instanceof ApiError ? e.message : "خطا" } }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, margin: "0 0 12px" }}>
        <button type="button" className="btn sm primary" disabled={testing.size > 0} onClick={testAll}>
          {testing.size > 0 ? `در حال تست (${faNum(testing.size)})...` : "تست همه"}
        </button>
        <span className="muted small">تلگرام در «تست همه» نیست چون پیام واقعی به گروه می‌فرستد.</span>
      </div>
      <div className="conn-list">
        {initial.map((c) => {
          const r = results[c.name];
          const state = r ? (r.ok ? "ok" : "bad") : !c.configured ? "off" : c.lastError ? "bad" : "idle";
          const stateFa = { ok: "وصل است", bad: "خطا", off: "تنظیم نشده", idle: "تست نشده" }[state];
          return (
            <section key={c.name} className={`panel conn conn-${state}`} aria-labelledby={`conn-${c.name}`}>
              <div className="conn-head">
                <span className={`conn-dot ${state}`} aria-hidden="true" />
                <h3 id={`conn-${c.name}`}>{c.title}</h3>
                <span className={`chip ${state === "ok" ? "good" : state === "bad" ? "bad" : state === "off" ? "warn" : ""}`}>{stateFa}</span>
                <button type="button" className="btn sm" disabled={testing.has(c.name)} aria-busy={testing.has(c.name)} onClick={() => runTest(c.name)}>
                  {testing.has(c.name) ? "در حال تست..." : c.name === "telegram" ? "ارسال پیام آزمایشی" : "تست"}
                </button>
              </div>
              <p className="muted small">{c.purpose}</p>
              <p className="small conn-detail">{c.detail}</p>
              {r && <p className={`small conn-result ${r.ok ? "up" : "down"}`} role="status">{r.message}{r.ms ? ` (${faNum(r.ms)}ms)` : ""}</p>}
              {!r && c.lastError && <p className="small conn-result down">آخرین خطا: {c.lastError}</p>}
              {!c.configured && c.where && <p className="muted small">برای تنظیم: {c.where}</p>}

              {c.editable === "ga" && canEdit && (
                <div className="conn-edit">
                  <label htmlFor="ga-prop">شناسه property گوگل آنالیتیکس (عدد)</label>
                  <div className="row" style={{ gap: 8 }}>
                    <input id="ga-prop" className="mono ltr" inputMode="numeric" placeholder="مثلاً 412345678" value={ga} onChange={(e) => setGa(e.target.value)} />
                    <button type="button" className="btn sm primary" disabled={saving !== null} onClick={() => save("ga")}>{saving === "ga" ? "در حال ذخیره و دریافت..." : "ذخیره و دریافت"}</button>
                  </div>
                  <p className="muted small">
                    در Google Analytics: Admin ← Property details ← Property ID (عدد است، نه G-...).
                    {serviceEmail && <> سپس در Admin ← Property access management، ایمیل <span className="mono ltr">{serviceEmail}</span> را با نقش Viewer اضافه کنید.</>}
                  </p>
                  {saveMsg.ga && <p className={`small ${saveMsg.ga.ok ? "up" : "down"}`} role="status">{saveMsg.ga.text}</p>}
                </div>
              )}
              {c.editable === "gsc" && canEdit && (
                <div className="conn-edit">
                  <label htmlFor="gsc-prop">property سرچ کنسول (اختیاری)</label>
                  <div className="row" style={{ gap: 8 }}>
                    <input id="gsc-prop" className="mono ltr" placeholder="sc-domain:example.com" value={gsc} onChange={(e) => setGsc(e.target.value)} />
                    <button type="button" className="btn sm" disabled={saving !== null} onClick={() => save("gsc")}>{saving === "gsc" ? "..." : "ذخیره"}</button>
                  </div>
                  <p className="muted small">خالی بگذارید تا از روی دامنه پیدا شود.{serviceEmail && <> ایمیل <span className="mono ltr">{serviceEmail}</span> باید در Search Console ← Settings ← Users and permissions اضافه شده باشد.</>}</p>
                  {saveMsg.gsc && <p className={`small ${saveMsg.gsc.ok ? "up" : "down"}`} role="status">{saveMsg.gsc.text}</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
