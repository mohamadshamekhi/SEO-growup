"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

type Watch = { id: number; mine: string; others: string[]; changes: string[]; ts: number; auto?: boolean; reasons?: Record<string, string[]> };
type RivalSite = { domain: string; keywords: number; avgRank: number; score: number; sample: string[]; current: boolean };
type Sites = { sites: RivalSite[]; current: string[]; notes: string[] };
type Rival = { url: string; title: string; domain: string; score: number; reasons: string[] };
type RivalResult = { rivals: Rival[]; queries: string[]; notes: string[] };
const MAX_OTHERS = 5;

export function WatchesClient({ projectId, isAdmin, initial, sites }: { projectId: string; isAdmin: boolean; initial: Watch[]; sites: Sites }) {
  const router = useRouter();
  const [watches, setWatches] = useState(initial);
  const [mine, setMine] = useState("");
  const [others, setOthers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [finding, setFinding] = useState(false);
  const [current, setCurrent] = useState(sites.current);
  const [autoBusy, setAutoBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function saveSites(list: string[]) {
    setErr("");
    try {
      const r = await api<{ current: string[] }>(`/api/projects/${projectId}/watches/sites`, { method: "PUT", body: { domains: list } });
      setCurrent(r.current);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  async function runAuto() {
    setAutoBusy(true); setErr(""); setMsg("");
    try {
      const r = await api<{ sites: string[]; created: number; updated: number }>(`/api/projects/${projectId}/watches/auto`, { method: "POST" });
      setCurrent(r.sites);
      setMsg(`${faNum(r.created)} پایش جدید ساخته و ${faNum(r.updated)} پایش خودکار به‌روز شد. بررسی تغییرات در اجرای بعدی «پایش رقبا» انجام می‌شود.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setAutoBusy(false);
    }
  }

  async function removeWatch(id: number) {
    setErr("");
    try {
      await api(`/api/projects/${projectId}/watches?wid=${id}`, { method: "DELETE" });
      setWatches((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }
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
      <section className="panel" style={{ marginBottom: 14 }} aria-labelledby="sites-h">
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h3 id="sites-h" style={{ margin: 0 }}>سایت‌های رقیب</h3>
          {isAdmin && (
            <button type="button" className="btn sm primary" disabled={autoBusy} aria-busy={autoBusy} onClick={runAuto}>
              {autoBusy ? "در حال پیدا کردن..." : "پیدا کردن خودکار رقبا برای همه صفحات"}
            </button>
          )}
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {current.length ? current.map((d) => (
            <span key={d} className="chip ltr">
              {d}
              {isAdmin && <button type="button" className="chip-x" aria-label={`حذف ${d} از رقبا`} onClick={() => saveSites(current.filter((x) => x !== d))}>×</button>}
            </span>
          )) : <span className="muted small">هنوز سایت رقیبی ثبت نشده.</span>}
        </div>
        {sites.sites.filter((s) => !current.includes(s.domain)).length > 0 && (
          <>
            <p className="muted small" style={{ margin: "12px 0 6px" }}>سایت‌هایی که در گوگل بیشتر از همه کنار شما رتبه دارند:</p>
            <ul className="rival-list">
              {sites.sites.filter((s) => !current.includes(s.domain)).slice(0, 8).map((s) => (
                <li key={s.domain}>
                  <div className="rival-site">
                    <span className="rival-main">
                      <strong className="ltr">{s.domain}</strong>
                      <span className="muted small">در {faNum(s.keywords)} جستجو، میانگین رتبه {faNum(s.avgRank)} · مثل: {s.sample.join("، ")}</span>
                    </span>
                    {isAdmin && (
                      <button type="button" className="btn sm" disabled={current.length >= 5} onClick={() => saveSites([...current, s.domain])}>
                        {current.length >= 5 ? "سقف ۵ سایت" : "افزودن"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {sites.notes.map((n, i) => <p key={i} className="muted small" style={{ marginTop: 8 }}>{n}</p>)}
        <p className="muted small" style={{ marginTop: 8 }}>تا وقتی فهرست را دستی عوض نکرده‌اید، پنل خودش آن را به‌روز می‌کند. سایتی که حذف کنید دیگر خودکار برنمی‌گردد.</p>
      </section>

      {msg && <p className="muted small" role="status">{msg}</p>}

      {isAdmin && (
        <details className="panel" style={{ marginBottom: 14 }}>
          <summary><strong>افزودن پایش دستی</strong> <span className="muted small">(اختیاری؛ برای صفحه‌های مهم، پایش خودکار ساخته می‌شود)</span></summary>
          <div className="form-grid" style={{ marginTop: 12 }}>
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
        </details>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {!watches.length && <p className="muted">هنوز پایشی اضافه نشده.</p>}
      <div className="pick-grid">
        {watches.map((w) => (
          <div key={w.id} className="panel">
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <div className="url" style={{ minWidth: 0 }}>{decodeURIComponent(w.mine)}</div>
              <span className="chip">{w.auto ? "خودکار" : "دستی"}</span>
            </div>
            <ul className="watch-rivals">
              {w.others.map((o) => (
                <li key={o}>
                  <span className="url ltr">{decodeURIComponent(o)}</span>
                  {w.reasons?.[o]?.length ? <span className="muted small">{w.reasons[o].join(" · ")}</span> : null}
                </li>
              ))}
            </ul>
            <div className="muted small" style={{ marginTop: 4 }}>{w.ts ? `آخرین بررسی: ${formatJalaliDateTime(w.ts * 1000)}` : "هنوز بررسی نشده"}</div>
            {w.changes.length > 0 ? (
              <ul style={{ marginTop: 8, paddingInlineStart: 18 }}>
                {w.changes.map((c, i) => <li key={i} className="muted small">{c}</li>)}
              </ul>
            ) : (
              <p className="muted small" style={{ marginTop: 8 }}>{w.ts ? "تغییری نسبت به بار قبل نبود." : "در صف اولین بررسی."}</p>
            )}
            {isAdmin && (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn sm" onClick={() => removeWatch(w.id)}>حذف پایش</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {watches.length > 0 && <p className="muted small" style={{ marginTop: 10 }}>{faNum(watches.length)} پایش ثبت‌شده.</p>}
    </div>
  );
}
