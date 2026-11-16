"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

type Watch = { id: number; mine: string; others: string[]; changes: string[]; ts: number };
type Rival = { url: string; title: string; domain: string; score: number; reasons: string[] };
type RivalResult = { rivals: Rival[]; queries: string[]; notes: string[] };
const MAX_OTHERS = 5;

export function WatchesClient({ projectId, isAdmin, initial }: { projectId: string; isAdmin: boolean; initial: Watch[] }) {
  const router = useRouter();
  const [watches, setWatches] = useState(initial);
  const [mine, setMine] = useState("");
  const [others, setOthers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<RivalResult | null>(null);

  const picked = others.split("\n").map((x) => x.trim()).filter(Boolean);

  async function findRivals() {
    setFinding(true); setErr(""); setFound(null);
    try {
      const r = await api<RivalResult>(`/api/projects/${projectId}/watches/rivals?url=${encodeURIComponent(mine.trim())}`);
      setFound(r);
      if (r.rivals.length) setOthers(r.rivals.slice(0, MAX_OTHERS).map((x) => x.url).join("\n"));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setFinding(false);
    }
  }

  function togglePick(u: string) {
    const next = picked.includes(u) ? picked.filter((x) => x !== u) : [...picked, u].slice(0, MAX_OTHERS);
    setOthers(next.join("\n"));
  }

  async function add() {
    setBusy(true); setErr("");
    try {
      const othersList = others.split("\n").map((x) => x.trim()).filter(Boolean);
      const r = await api<{ id: number }>(`/api/projects/${projectId}/watches`, { method: "POST", body: { mine, others: othersList } });
      setWatches([{ id: r.id, mine, others: othersList, changes: [], ts: 0 }, ...watches]);
      setMine(""); setOthers(""); setFound(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {isAdmin && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h3>افزودن پایش جدید</h3>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="watch-mine">آدرس صفحه خودتان</label>
              <div className="row" style={{ gap: 8 }}>
                <input id="watch-mine" className="mono ltr" style={{ flex: 1, minWidth: 0 }} value={mine} onChange={(e) => setMine(e.target.value)} placeholder="https://..." />
                <button type="button" className="btn sm" disabled={finding || !/^https?:\/\//.test(mine.trim())} aria-busy={finding} onClick={findRivals}>
                  {finding ? "در حال پیدا کردن..." : "پیدا کردن رقبا"}
                </button>
              </div>
              <span className="hint">آدرس صفحه را بدهید تا رقبایش از روی جستجوهای گوگلِ همین صفحه و صفحه‌های سایت رقبا پیدا شود.</span>
            </div>
            {found && (
              <div className="field full rivals" aria-live="polite">
                {found.queries.length > 0 && <p className="muted small">جستجوهای گوگل این صفحه: {found.queries.join("، ")}</p>}
                {found.rivals.length > 0 ? (
                  <ul className="rival-list">
                    {found.rivals.map((r) => {
                      const on = picked.includes(r.url);
                      return (
                        <li key={r.url} className={on ? "on" : ""}>
                          <label>
                            <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX_OTHERS} onChange={() => togglePick(r.url)} />
                            <span className="rival-main">
                              <strong>{r.title || r.domain}</strong>
                              <span className="url ltr">{decodeURIComponent(r.url)}</span>
                              <span className="muted small">{r.reasons.join(" · ")}</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="muted small">رقیبی پیدا نشد.</p>}
                {found.notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
              </div>
            )}
            <div className="field full"><label>آدرس رقبا (هر خط یکی، حداکثر ۵)</label><textarea className="mono ltr" value={others} onChange={(e) => setOthers(e.target.value)} placeholder="https://..." /></div>
            <div className="full"><button type="button" className="btn sm primary" disabled={busy} onClick={add}>{busy ? "در حال افزودن..." : "افزودن پایش"}</button></div>
          </div>
        </div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {!watches.length && <p className="muted">هنوز پایشی اضافه نشده.</p>}
      <div className="pick-grid">
        {watches.map((w) => (
          <div key={w.id} className="panel">
            <div className="url">{w.mine}</div>
            <div className="muted small" style={{ marginTop: 4 }}>رقبا: {w.others.join("، ")}</div>
            <div className="muted small" style={{ marginTop: 4 }}>{w.ts ? `آخرین بررسی: ${formatJalaliDateTime(w.ts * 1000)}` : "هنوز بررسی نشده"}</div>
            {w.changes.length > 0 ? (
              <ul style={{ marginTop: 8, paddingInlineStart: 18 }}>
                {w.changes.map((c, i) => <li key={i} className="muted small">{c}</li>)}
              </ul>
            ) : (
              <p className="muted small" style={{ marginTop: 8 }}>{w.ts ? "تغییری نسبت به بار قبل نبود." : "در صف اولین بررسی."}</p>
            )}
          </div>
        ))}
      </div>
      {watches.length > 0 && <p className="muted small" style={{ marginTop: 10 }}>{faNum(watches.length)} پایش ثبت‌شده.</p>}
    </div>
  );
}
