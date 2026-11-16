"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import { formatJalali } from "@/lib/intl/jalali";
import { DraftView } from "@/components/DraftView";
import type { Suggestion, Action, Kind } from "@/lib/growth-actions";

const KIND_FA: Record<Kind, string> = {
  landing: "صفحه دسته/لندینگ", article: "مقاله", optimize: "بهینه‌سازی صفحه", refresh: "به‌روزرسانی صفحه", social: "پست/ریل",
  campaign: "کمپین", fix_issues: "رفع فنی", review_content: "انتشار محتوا", plan_week: "برنامه هفته", merge: "یکی کردن صفحه‌ها",
};
const SOURCE_FA: Record<string, string> = { seo: "سئو", content: "محتوا", social: "اینستاگرام", campaign: "کمپین", competitor: "رقبا", tech: "فنی", sales: "فروش" };
const EFFORT_FA = { low: ["کم", "good"], mid: ["متوسط", "info"], high: ["زیاد", "warn"] } as const;
const STATUS_FA: Record<Action["status"], string> = { doing: "در حال انجام", published: "منتشر شد؛ منتظر نتیجه", measured: "نتیجه سنجیده شد", dismissed: "رد شده" };
const TABS = [["todo", "پیشنهادهای امروز"], ["doing", "در حال انجام"], ["done", "منتشرشده و نتیجه"]] as const;

type Toast = { text: string; undo?: () => void } | null;

export function TodayClient({ projectId, suggestions: initS, actions: initA, canEdit, initialTab, openId }: {
  projectId: string; suggestions: Suggestion[]; actions: Action[]; canEdit: boolean; initialTab: string; openId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [sugs, setSugs] = useState(initS);
  const [acts, setActs] = useState(initA);
  const [tab, setTab] = useState(TABS.some(([k]) => k === initialTab) ? initialTab : "todo");
  const [source, setSource] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [open, setOpen] = useState<number | null>(openId);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (openId) document.getElementById(`a-${openId}`)?.scrollIntoView({ block: "center" }); }, [openId]);

  function go(t: string) {
    setTab(t);
    const u = new URLSearchParams(sp.toString()); u.set("tab", t); u.delete("a");
    router.replace(`${pathname}?${u}`, { scroll: false });
  }
  function showToast(t: Toast) {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    return api<T>(`/api/projects/${projectId}/actions`, { method: "POST", body });
  }

  async function startOne(s: Suggestion) {
    setBusy(s.key); setErr("");
    try {
      const a = await call<Action>({ op: "start", suggestion: s });
      setSugs((x) => x.filter((y) => y.key !== s.key));
      setActs((x) => [a, ...x.filter((y) => y.id !== a.id)]);
      setOpen(a.id);
      showToast({ text: `«${s.title}» شروع شد و پیش‌نویسش آماده است (تب «در حال انجام»). یک کار هم در «کارها» ساخته شد.` });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(null); }
  }

  async function dismissOne(s: Suggestion) {
    setSugs((x) => x.filter((y) => y.key !== s.key));
    try {
      await call({ op: "dismiss", suggestion: s });
      showToast({ text: `«${s.title}» رد شد.`, undo: async () => { await call({ op: "restore", key: s.key }); setSugs((x) => [s, ...x]); setToast(null); } });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); setSugs((x) => [s, ...x]); }
  }

  async function act(a: Action, op: "redraft" | "apply" | "telegram" | "published" | "doing") {
    if (op === "apply" && !confirm(`عنوان سئو و توضیح متای این صفحه با پیش‌نویس جایگزین و روی سایت ثبت می‌شود (از تاریخچه قابل برگشت):\n${decodeURIComponent(a.url)}\n\nادامه؟`)) return;
    if (op === "telegram" && !confirm("این پیش‌نویس به‌عنوان کار امروز اینستاگرام به گروه تلگرام تیم فرستاده می‌شود. ادامه؟")) return;
    if (op === "published" && !confirm("تأیید می‌کنید این کار انجام و منتشر شده؟ از امروز اثرش سنجیده می‌شود و ۲ هفته بعد نتیجه را می‌بینید.")) return;
    setBusy(`${a.id}:${op}`); setErr("");
    try {
      if (op === "published" || op === "doing") {
        await call({ op: "status", id: a.id, status: op });
        setActs((x) => x.map((y) => (y.id === a.id ? { ...y, status: op === "published" ? "published" : "doing", published_at: op === "published" ? Date.now() / 1000 : null } : y)));
        showToast({ text: op === "published" ? "ثبت شد؛ نتیجه ۲ هفته بعد در تب «منتشرشده و نتیجه» می‌آید." : "به «در حال انجام» برگشت." });
      } else if (op === "redraft") {
        const n = await call<Action>({ op: "redraft", id: a.id });
        setActs((x) => x.map((y) => (y.id === a.id ? n : y)));
        showToast({ text: "پیش‌نویس تازه ساخته شد." });
      } else if (op === "apply") {
        const r = await call<{ title: string }>({ op: "apply", id: a.id });
        showToast({ text: `روی سایت ثبت شد: «${r.title}». اگر کار دیگری از این پیش‌نویس نمانده، «منتشر شد» را بزنید.` });
      } else {
        await call({ op: "telegram", id: a.id });
        showToast({ text: "به گروه تلگرام فرستاده شد." });
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(null); }
  }

  const sources = useMemo(() => [...new Set(sugs.map((s) => s.source))], [sugs]);
  const shownS = sugs.filter((s) => source === "all" || s.source === source);
  const doing = acts.filter((a) => a.status === "doing");
  const done = acts.filter((a) => a.status === "published" || a.status === "measured");
  const improved = acts.filter((a) => a.result?.verdict === "بهتر شد").length;

  return (
    <div>
      <div className="kpis seo-kpis">
        <button type="button" className={`kpi kpi-btn${tab === "todo" ? " on" : ""}`} onClick={() => go("todo")}><div className="kpi-l">پیشنهاد امروز</div><div className="kpi-x">{faNum(sugs.length)}</div><div className="muted small">{faNum(sugs.filter((s) => s.impact >= 70).length)} با اثر زیاد</div></button>
        <button type="button" className={`kpi kpi-btn${tab === "doing" ? " on" : ""}`} onClick={() => go("doing")}><div className="kpi-l">در حال انجام</div><div className="kpi-x">{faNum(doing.length)}</div><div className="muted small">پیش‌نویس آماده دارند</div></button>
        <button type="button" className={`kpi kpi-btn${tab === "done" ? " on" : ""}`} onClick={() => go("done")}><div className="kpi-l">منتشرشده</div><div className="kpi-x">{faNum(done.length)}</div><div className="muted small">{faNum(improved)} مورد نتیجه بهتر داده</div></button>
      </div>

      <div className="ptabs" role="tablist" aria-label="بخش‌ها">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ptab${tab === k ? " on" : ""}`} onClick={() => go(k)}>
            {l} <span className="count">{faNum(k === "todo" ? sugs.length : k === "doing" ? doing.length : done.length)}</span>
          </button>
        ))}
      </div>

      {err && <div className="err" role="alert">{err}</div>}

      {tab === "todo" && (
        <>
          {sources.length > 1 && (
            <div className="seg" role="group" aria-label="منبع" style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "10px 0" }}>
              <button type="button" className={`btn sm${source === "all" ? " primary" : ""}`} aria-pressed={source === "all"} onClick={() => setSource("all")}>همه</button>
              {sources.map((s) => <button key={s} type="button" className={`btn sm${source === s ? " primary" : ""}`} aria-pressed={source === s} onClick={() => setSource(s)}>{SOURCE_FA[s] || s} <span className="count">{faNum(sugs.filter((x) => x.source === s).length)}</span></button>)}
            </div>
          )}
          {!shownS.length && <div className="empty-state"><h2>فعلاً پیشنهادی نیست</h2><p>با دریافت داده تازه سرچ کنسول، ممیزی سایت و خواندن رقبا، پیشنهادهای جدید اینجا می‌آید.</p></div>}
          <ol className="todo-list">
            {shownS.map((s, i) => (
              <li key={s.key} className="panel todo-card">
                <div className="todo-rank" aria-hidden="true">{faNum(i + 1)}</div>
                <div className="todo-body">
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="chip info">{SOURCE_FA[s.source] || s.source}</span>
                    <span className="chip">{KIND_FA[s.kind]}</span>
                    <span className={`chip ${EFFORT_FA[s.effort][1]}`}>سختی: {EFFORT_FA[s.effort][0]}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p className="muted small">{s.why}</p>
                  {s.url && <p className="ltr mono small seo-url" style={{ maxWidth: "100%" }}>{decodeURIComponent(s.url)}</p>}
                  <div className="impact" title="اثر تخمینی بر اساس نمایش، فاصله تا صفحه اول، رقبا و فوریت">
                    <span className="muted small">اثر تخمینی</span>
                    <span className="impact-bar" aria-hidden="true"><span style={{ width: `${s.impact}%` }} /></span>
                    <span className="small">{faNum(s.impact)}/۱۰۰</span>
                  </div>
                </div>
                <div className="todo-acts">
                  {canEdit && (
                    <button type="button" className="btn sm primary" disabled={!!busy} aria-busy={busy === s.key} onClick={() => startOne(s)}>
                      {busy === s.key ? "در حال ساخت پیش‌نویس..." : "انجامش بده"}
                    </button>
                  )}
                  {s.link && <Link className="btn sm" href={s.link}>جزئیات</Link>}
                  {canEdit && <button type="button" className="icon-btn" aria-label={`رد کردن «${s.title}»`} title="رد کن" onClick={() => dismissOne(s)}>×</button>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {(tab === "doing" || tab === "done") && (
        <div className="todo-list" style={{ marginTop: 10 }}>
          {(tab === "doing" ? doing : done).length === 0 && <div className="empty-state"><h2>{tab === "doing" ? "کاری در حال انجام نیست" : "هنوز چیزی منتشر نشده"}</h2><p>{tab === "doing" ? "از «پیشنهادهای امروز» یکی را «انجامش بده» بزنید." : "بعد از انجام هر کار، «منتشر شد» را بزنید تا اثرش سنجیده شود."}</p></div>}
          {(tab === "doing" ? doing : done).map((a) => {
            const expanded = open === a.id;
            const hasTitleMeta = !!a.url && typeof a.draft.title === "string" && typeof a.draft.meta === "string";
            return (
              <article key={a.id} id={`a-${a.id}`} className={`panel todo-card${openId === a.id ? " focus" : ""}`}>
                <div className="todo-body">
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="chip info">{SOURCE_FA[a.source] || a.source}</span>
                    <span className="chip">{KIND_FA[a.kind]}</span>
                    <span className={`chip ${a.status === "measured" ? (a.result?.verdict === "بهتر شد" ? "good" : a.result?.verdict === "بدتر شد" ? "bad" : "") : a.status === "published" ? "info" : "warn"}`}>{a.status === "measured" ? a.result?.verdict || STATUS_FA.measured : STATUS_FA[a.status]}</span>
                    <span className="muted small">{formatJalali(a.created * 1000)}</span>
                  </div>
                  <h3>{a.title}</h3>
                  {a.url && <p className="ltr mono small seo-url" style={{ maxWidth: "100%" }}>{decodeURIComponent(a.url)}</p>}
                  {(a.status === "published" || a.status === "measured") && a.baseline && (
                    <p className="small">
                      قبل: جایگاه {a.baseline.position != null ? faNum(a.baseline.position, 1) : "—"}، {faNum(a.baseline.impressions)} نمایش، {faNum(a.baseline.clicks)} کلیک
                      {a.result?.after && <> · بعد: جایگاه {a.result.after.position != null ? faNum(a.result.after.position, 1) : "—"}، {faNum(a.result.after.impressions)} نمایش، {faNum(a.result.after.clicks)} کلیک</>}
                      {a.status === "published" && a.published_at && <span className="muted"> · سنجش از {formatJalali((a.published_at + 14 * 86400) * 1000)}</span>}
                    </p>
                  )}
                  <button type="button" className="linkish small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : a.id)}>{expanded ? "بستن پیش‌نویس" : "نمایش پیش‌نویس"}</button>
                  {expanded && <DraftView draft={a.draft} />}
                </div>
                {canEdit && (
                  <div className="todo-acts">
                    {a.status === "doing" && hasTitleMeta && <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => act(a, "apply")}>{busy === `${a.id}:apply` ? "در حال ثبت..." : "ثبت عنوان و توضیح روی سایت"}</button>}
                    {a.status === "doing" && a.kind === "social" && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(a, "telegram")}>{busy === `${a.id}:telegram` ? "..." : "ارسال به تلگرام تیم"}</button>}
                    {a.status === "doing" && !["article", "campaign", "plan_week", "fix_issues", "review_content"].includes(a.kind) && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(a, "redraft")}>{busy === `${a.id}:redraft` ? "..." : "پیش‌نویس تازه"}</button>}
                    {a.status === "doing" && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(a, "published")}>منتشر شد</button>}
                    {a.status === "published" && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(a, "doing")}>برگرداندن</button>}
                    {typeof a.draft.content_id === "number" && <Link className="btn sm" href={`/p/${projectId}/content`}>تب محتوا</Link>}
                    {typeof a.draft.campaign_id === "number" && <Link className="btn sm" href={`/p/${projectId}/campaigns`}>تب کمپین</Link>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="btn sm" onClick={toast.undo}>برگردان</button>}
        </div>
      )}
    </div>
  );
}
