"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import { formatJalali } from "@/lib/intl/jalali";
import type { GapRow } from "@/lib/kwgap";
import type { Suggestion, Kind } from "@/lib/growth-actions";

export type DecayRow = { url: string; title: string; clicks: number; prev_clicks: number | null; position: number; prev_position: number | null; impressions: number };
type Cann = { query: string; impressions: number; pages: { url: string; impressions: number; position: number; title: string }[] };
type NewPage = { domain: string; url: string; title: string; first_seen: number };
type Status = GapRow["status"];
type SortKey = "phrase" | "status" | "score" | "competitors" | "impressions" | "position";

const STATUS: Record<Status, [string, string]> = {
  gap: ["صفحه ندارید", "st-gap"], weak: ["رتبه ضعیف", "st-weak"], no_rank: ["صفحه دارید، رتبه ندارد", "st-norank"], lead: ["رتبه خوب", "st-lead"], other: ["نامشخص", "st-other"],
};
const TABS = [["gap", "شکاف کلمات"], ["cannibal", "رقابت داخلی"], ["decay", "صفحات رو به افت"], ["new", "صفحات تازه رقبا"]] as const;
const BUILD: { kind: Kind; label: string; when?: (r: GapRow) => boolean }[] = [
  { kind: "landing", label: "صفحه دسته/لندینگ" },
  { kind: "article", label: "مقاله" },
  { kind: "optimize", label: "بهینه‌سازی صفحه موجود", when: (r) => !!r.my_url },
  { kind: "social", label: "پست/ریل اینستاگرام" },
];
const PAGE = 50;
const dec = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };
const pathOf = (u: string) => { try { return dec(new URL(u).pathname); } catch { return dec(u); } };

function Avatar({ domain }: { domain: string }) {
  const hue = [...domain].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return <span className="cav" title={domain} aria-label={domain} style={{ background: `hsl(${hue} 45% 32%)` }}>{domain[0]?.toUpperCase()}</span>;
}

export function KwgapClient(props: {
  projectId: string; canEdit: boolean; initialTab: string; rows: GapRow[]; hasGsc: boolean; competitors: string[]; offTopic: number; scoreHelp: string;
  cannibal: Cann[]; decay: DecayRow[]; compNew: NewPage[];
}) {
  const { projectId, canEdit, hasGsc } = props;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [tab, setTab] = useState(TABS.some(([k]) => k === props.initialTab) ? props.initialTab : "gap");
  const [rows, setRows] = useState(props.rows);
  const [status, setStatus] = useState<Status | "all" | "ignored">("all");
  const [comp, setComp] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "score", dir: -1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState<{ text: string; undo?: () => void; href?: string } | null>(null);
  const tt = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest?.(".build-menu")) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("click", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  function go(t: string) {
    setTab(t);
    const u = new URLSearchParams(sp.toString()); u.set("tab", t);
    router.replace(`${pathname}?${u}`, { scroll: false });
  }
  function note(t: typeof toast) {
    setToast(t);
    if (tt.current) clearTimeout(tt.current);
    tt.current = setTimeout(() => setToast(null), 7000);
  }

  const live = rows.filter((r) => !r.ignored);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: live.length, ignored: rows.length - live.length };
    for (const r of live) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows, live]);

  const filtered = useMemo(() => {
    const s = search.trim();
    const list = rows.filter((r) =>
      (status === "ignored" ? r.ignored : !r.ignored && (status === "all" || r.status === status)) &&
      (comp === "all" || r.competitors.includes(comp)) &&
      (!s || r.phrase.includes(s) || r.variants.some((v) => v.includes(s))));
    const val = (r: GapRow): number | string => sort.k === "phrase" ? r.phrase : sort.k === "status" ? r.status : sort.k === "competitors" ? r.competitors.length : sort.k === "position" ? (r.position ?? 999) : r[sort.k];
    return [...list].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, status, comp, search, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  function sortBy(k: SortKey) { setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "phrase" || k === "position" ? 1 : -1 })); setPage(0); }
  function filterStatus(s: typeof status) { setStatus(s); setPage(0); setSel(new Set()); }

  function suggestionFor(r: GapRow, kind: Kind): Suggestion {
    const why = `${r.competitors.length} رقیب (${r.competitors.join("، ")}) برای «${r.phrase}» صفحه دارند${r.status === "gap" ? " و سایت ندارد" : r.my_url ? "؛ صفحه سایت در گوگل دیده نمی‌شود" : ""}.${r.variants.length ? ` عبارت‌های هم‌خانواده: ${r.variants.join("، ")}.` : ""}`;
    return { key: `gap:${kind}:${r.phrase}`, source: kind === "social" ? "social" : "seo", kind, title: `${BUILD.find((b) => b.kind === kind)!.label} برای «${r.phrase}»`, why, target: r.phrase, url: kind === "optimize" ? r.my_url || "" : "", impact: Math.min(90, Math.round(r.score / 2)), effort: kind === "landing" ? "high" : kind === "social" ? "low" : "mid" };
  }

  async function build(r: GapRow, kind: Kind) {
    setMenu(null); setBusy(`${r.phrase}:${kind}`); setErr("");
    try {
      const a = await api<{ id: number }>(`/api/projects/${projectId}/actions`, { method: "POST", body: { op: "start", suggestion: suggestionFor(r, kind) } });
      note({ text: `پیش‌نویس «${r.phrase}» آماده شد و یک کار در «کارها» ساخته شد.`, href: `/p/${projectId}/today?a=${a.id}` });
    } catch (e) { setErr(`«${r.phrase}»: ${e instanceof ApiError ? e.message : "خطا"}`); } finally { setBusy(null); }
  }

  async function ignore(phrases: string[], undo = false) {
    setRows((x) => x.map((r) => (phrases.includes(r.phrase) ? { ...r, ignored: !undo } : r)));
    setSel(new Set());
    try {
      if (undo) for (const ph of phrases) await api(`/api/projects/${projectId}/kwgap/ignore`, { method: "POST", body: { phrase: ph, undo: true } });
      else await api(`/api/projects/${projectId}/kwgap/ignore`, { method: "POST", body: { phrases } });
      if (!undo) note({ text: phrases.length === 1 ? `«${phrases[0]}» نادیده گرفته شد.` : `${faNum(phrases.length)} عبارت نادیده گرفته شد.`, undo: () => { ignore(phrases, true); setToast(null); } });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function bulkBuild() {
    const list = rows.filter((r) => sel.has(r.phrase));
    if (!list.length || !confirm(`برای ${faNum(list.length)} عبارت پیش‌نویس ساخته و در «کارها» ثبت می‌شود (صفحه ندارید ← صفحه دسته، صفحه دارید ← بهینه‌سازی). ادامه؟`)) return;
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      setBusy(`bulk:${i + 1}/${list.length}`);
      try { await api(`/api/projects/${projectId}/actions`, { method: "POST", body: { op: "start", suggestion: suggestionFor(list[i], list[i].my_url ? "optimize" : "landing") } }); ok++; } catch { /* keep going */ }
    }
    setBusy(null); setSel(new Set());
    note({ text: `${faNum(ok)} پیش‌نویس ساخته شد.`, href: `/p/${projectId}/today?tab=doing` });
  }

  async function startSimple(s: Suggestion) {
    setBusy(s.key); setErr("");
    try {
      const a = await api<{ id: number }>(`/api/projects/${projectId}/actions`, { method: "POST", body: { op: "start", suggestion: s } });
      note({ text: "پیش‌نویس آماده شد و یک کار در «کارها» ساخته شد.", href: `/p/${projectId}/today?a=${a.id}` });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(null); }
  }

  const kpis: { k: typeof status; label: string; tone: string }[] = [
    { k: "all", label: "کل فرصت‌ها", tone: "" }, { k: "gap", label: "صفحه ندارید", tone: "st-gap" }, { k: "no_rank", label: "صفحه دارید، رتبه ندارد", tone: "st-norank" },
    { k: "weak", label: "رتبه ضعیف", tone: "st-weak" }, { k: "other", label: "نامشخص", tone: "st-other" },
  ];
  const th = (k: SortKey, children: React.ReactNode, num = false) => (
    <th key={k} className={num ? "num" : ""} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => sortBy(k)}>{children}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
    </th>
  );

  return (
    <div>
      <div className="ptabs" role="tablist" aria-label="بخش‌ها">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="ptab" onClick={() => go(k)}>
            {l} <span className="count">{faNum(k === "gap" ? counts.all : k === "cannibal" ? props.cannibal.length : k === "decay" ? props.decay.length : props.compNew.length)}</span>
          </button>
        ))}
      </div>
      {err && <div className="err" role="alert">{err}</div>}

      {tab === "gap" && (
        <>
          <div className="kpis seo-kpis">
            {kpis.map((x) => (
              <button key={x.k} type="button" className={`kpi kpi-btn${status === x.k ? " on" : ""}`} aria-pressed={status === x.k} onClick={() => filterStatus(x.k)}>
                <div className="kpi-l">{x.label}</div><div className={`kpi-x ${x.tone}-x`}>{faNum(counts[x.k] || 0)}</div>
              </button>
            ))}
            <div className="kpi">
              <div className="kpi-l">رقبا</div><div className="kpi-x">{faNum(props.competitors.length)}</div>
              <div className="cavs">{props.competitors.map((c) => <Avatar key={c} domain={c} />)}</div>
              <Link className="small" href={`/p/${projectId}/watches`}>مدیریت رقبا</Link>
            </div>
          </div>
          {props.offTopic > 0 && <p className="muted small">{faNum(props.offTopic)} موضوع بی‌ربط به محصولات و جستجوهای سایت (مثل لوازم آرایشی یا خانگی رقبای عمومی) کنار گذاشته شد.</p>}
          {!hasGsc && <div className="banner warn"><span className="grow">سرچ کنسول وصل نیست؛ ستون‌های «نمایش گوگل» و «جایگاه» پنهان‌اند و وضعیت‌ها فقط از صفحه‌های سایت می‌آیند.</span><Link className="btn sm" href={`/p/${projectId}/connections`}>اتصال سرچ کنسول</Link></div>}

          <div className="row seo-toolbar">
            <input type="search" placeholder="جستجوی عبارت" aria-label="جستجوی عبارت" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ minWidth: 200 }} />
            <select aria-label="فیلتر رقیب" value={comp} onChange={(e) => { setComp(e.target.value); setPage(0); }}>
              <option value="all">همه رقبا</option>
              {props.competitors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className={`btn sm${status === "ignored" ? " primary" : ""}`} aria-pressed={status === "ignored"} onClick={() => filterStatus(status === "ignored" ? "all" : "ignored")}>نادیده‌گرفته‌ها <span className="count">{faNum(counts.ignored)}</span></button>
            <span className="spacer" />
            {canEdit && sel.size > 0 && (
              <div className="row bulkbar" style={{ gap: 6 }}>
                <span className="small">{faNum(sel.size)} انتخاب شده</span>
                {status !== "ignored" && <button type="button" className="btn sm primary" disabled={!!busy} onClick={bulkBuild}>{busy?.startsWith("bulk:") ? `در حال ساخت ${faNum(Number(busy.slice(5).split("/")[0]))}...` : "ساخت پیش‌نویس برای همه"}</button>}
                {status !== "ignored" ? <button type="button" className="btn sm" onClick={() => ignore([...sel])}>نادیده گرفتن همه</button> : <button type="button" className="btn sm" onClick={() => ignore([...sel], true)}>برگرداندن همه</button>}
              </div>
            )}
          </div>

          <div className="table-wrap">
            <table className="seo-table kw-table">
              <thead>
                <tr>
                  {canEdit && <th className="chk"><input type="checkbox" aria-label="انتخاب همه این صفحه" checked={shown.length > 0 && shown.every((r) => sel.has(r.phrase))} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...shown.map((r) => r.phrase)]) : new Set([...sel].filter((x) => !shown.some((r) => r.phrase === x))))} /></th>}
                  {th("phrase", "عبارت")}
                  {th("status", "وضعیت")}
                  <th className="num" aria-sort={sort.k === "score" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    <button type="button" className="th-sort" onClick={() => sortBy("score")} title={props.scoreHelp}>امتیاز ⓘ{sort.k === "score" ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
                  </th>
                  {th("competitors", "رقبا", true)}
                  {hasGsc && th("impressions", "نمایش گوگل", true)}
                  {hasGsc && th("position", "جایگاه", true)}
                  <th><span className="sr-only">اقدام</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const ex = open === r.phrase;
                  return (
                    <Fragment key={r.phrase}>
                      <tr className={sel.has(r.phrase) ? "sel" : ""}>
                        {canEdit && <td className="chk"><input type="checkbox" aria-label={`انتخاب ${r.phrase}`} checked={sel.has(r.phrase)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.phrase); else n.delete(r.phrase); setSel(n); }} /></td>}
                        <td>
                          <button type="button" className="phrase-btn" aria-expanded={ex} onClick={() => setOpen(ex ? null : r.phrase)}>
                            <strong>{r.phrase}</strong>
                            {r.variants.length > 0 && <span className="muted small"> +{faNum(r.variants.length)} هم‌خانواده</span>}
                          </button>
                          {r.my_url && <div className="url seo-url">{pathOf(r.my_url)}</div>}
                        </td>
                        <td><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                        <td className="num">{faNum(r.score)}</td>
                        <td className="num"><span className="cavs" title={r.competitors.join("، ")}>{r.competitors.map((c) => <Avatar key={c} domain={c} />)}</span></td>
                        {hasGsc && <td className="num">{r.impressions ? faNum(r.impressions) : "—"}</td>}
                        {hasGsc && <td className="num">{r.position != null ? faNum(r.position, 1) : "—"}</td>}
                        <td className="acts">
                          {canEdit && !r.ignored && (
                            <div className="build-menu">
                              <button type="button" className="btn sm primary" aria-haspopup="menu" aria-expanded={menu === r.phrase} disabled={!!busy} onClick={(e) => { e.stopPropagation(); setMenu(menu === r.phrase ? null : r.phrase); }}>
                                {busy?.startsWith(`${r.phrase}:`) ? "در حال ساخت..." : "بساز ▾"}
                              </button>
                              {menu === r.phrase && (
                                <div className="menu" role="menu">
                                  {BUILD.filter((b) => !b.when || b.when(r)).map((b) => <button key={b.kind} type="button" role="menuitem" onClick={() => build(r, b.kind)}>{b.label}</button>)}
                                </div>
                              )}
                            </div>
                          )}
                          {canEdit && (r.ignored
                            ? <button type="button" className="btn sm" onClick={() => ignore([r.phrase], true)}>برگردان</button>
                            : <button type="button" className="icon-btn" aria-label={`نادیده گرفتن ${r.phrase}`} title="نادیده بگیر" onClick={() => ignore([r.phrase])}>×</button>)}
                        </td>
                      </tr>
                      {ex && (
                        <tr className="guide-row">
                          <td colSpan={(canEdit ? 1 : 0) + 5 + (hasGsc ? 2 : 0)}>
                            <div className="guide kw-detail">
                              {r.variants.length > 0 && <p><span className="muted">عبارت‌های هم‌خانواده: </span>{r.variants.join("، ")}</p>}
                              <p><span className="muted">ربط به محصولات و جستجوهای سایت: </span>{faNum(Math.round(r.relevance * 100))}٪</p>
                              <p className="muted" style={{ margin: "6px 0 2px" }}>رقبایی که این موضوع را دارند:</p>
                              <ul className="plan-list">{r.competitors.map((c) => <li key={c}><Avatar domain={c} /> <span className="ltr">{c}</span></li>)}</ul>
                              {r.example && <p className="small" style={{ marginTop: 6 }}><span className="muted">نمونه صفحه رقیب: </span><a className="ltr mono" href={r.example} target="_blank" rel="noreferrer">{dec(r.example)}</a></p>}
                              {r.my_url && <p className="small"><span className="muted">صفحه شما: </span>{r.my_title} <span className="ltr mono">({pathOf(r.my_url)})</span></p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!filtered.length && <p className="muted" style={{ marginTop: 10 }}>{rows.length ? "عبارتی با این فیلتر نیست." : "هنوز صفحه‌ای از رقبا خوانده نشده؛ در «زمان‌بندی» کار «کلمات رقبا» را اجرا کنید."}</p>}
          {pages > 1 && (
            <nav className="pager" aria-label="صفحه‌بندی">
              <button type="button" className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>قبلی</button>
              <span className="small">صفحه {faNum(page + 1)} از {faNum(pages)} · {faNum(filtered.length)} عبارت</span>
              <button type="button" className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>بعدی</button>
            </nav>
          )}
          <p className="muted small" style={{ marginTop: 8 }}>{props.scoreHelp}</p>
        </>
      )}

      {tab === "cannibal" && (
        <div className="todo-list">
          {!props.cannibal.length && <div className="empty-state"><h2>رقابت داخلی پیدا نشد</h2><p>{hasGsc ? "هیچ کلمه‌ای نیست که دو صفحه از سایت سرش با هم رقابت کنند." : "برای این بخش سرچ کنسول لازم است."}</p></div>}
          {props.cannibal.map((c) => (
            <article key={c.query} className="panel todo-card">
              <div className="todo-body">
                <h3>«{c.query}»</h3>
                <p className="muted small">{faNum(c.impressions)} نمایش بین {faNum(c.pages.length)} صفحه تقسیم شده؛ گوگل نمی‌داند کدام را نشان دهد و هیچ‌کدام بالا نمی‌آید.</p>
                <ul className="plan-list">{c.pages.map((pg) => <li key={pg.url}>{pg.title || pathOf(pg.url)} <span className="muted small">— جایگاه {faNum(pg.position, 1)}، {faNum(pg.impressions)} نمایش</span></li>)}</ul>
              </div>
              {canEdit && <div className="todo-acts"><button type="button" className="btn sm primary" disabled={!!busy} onClick={() => startSimple({ key: `merge:${c.query}`, source: "seo", kind: "merge", title: `یکی کردن صفحه‌های رقیب برای «${c.query}»`, why: `${c.pages.length} صفحه سر این کلمه رقابت می‌کنند: ${c.pages.map((p) => pathOf(p.url)).join("، ")}`, target: c.query, url: c.pages[0].url, impact: 50, effort: "mid" })}>{busy === `merge:${c.query}` ? "..." : "راهنمای یکی کردن"}</button></div>}
            </article>
          ))}
        </div>
      )}

      {tab === "decay" && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {!props.decay.length ? <div className="empty-state"><h2>صفحه رو به افتی نیست</h2><p>{hasGsc ? "نسبت به ۲۸ روز قبل، هیچ صفحه‌ای جایگاه یا کلیکش افت محسوس نداشته." : "برای این بخش سرچ کنسول لازم است."}</p></div> : (
            <table className="seo-table">
              <thead><tr><th>صفحه</th><th className="num">جایگاه</th><th className="num">کلیک</th><th className="num">نمایش</th><th /></tr></thead>
              <tbody>
                {props.decay.map((d) => (
                  <tr key={d.url}>
                    <td><strong>{d.title || pathOf(d.url)}</strong><div className="url seo-url">{pathOf(d.url)}</div></td>
                    <td className="num nowrap">{d.prev_position != null ? <><span>{faNum(d.prev_position, 1)}</span> → <span className="down">▼ {faNum(d.position, 1)}</span></> : faNum(d.position, 1)}</td>
                    <td className="num nowrap">{d.prev_clicks != null ? <>{faNum(d.prev_clicks)} → <span className={d.clicks < d.prev_clicks ? "down" : ""}>{faNum(d.clicks)}</span></> : faNum(d.clicks)}</td>
                    <td className="num">{faNum(d.impressions)}</td>
                    <td>{canEdit && <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => startSimple({ key: `decay:${d.url}`, source: "seo", kind: "refresh", title: `بهبود «${d.title || pathOf(d.url)}»`, why: `جایگاه ${d.prev_position != null ? `${d.prev_position.toFixed(1)} → ` : ""}${d.position.toFixed(1)}، کلیک ${d.prev_clicks ?? "?"} → ${d.clicks}.`, target: "", url: d.url, impact: 55, effort: "mid" })}>{busy === `decay:${d.url}` ? "..." : "بهبود این صفحه"}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "new" && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {!props.compNew.length ? <div className="empty-state"><h2>صفحه تازه‌ای از رقبا دیده نشده</h2><p>بعد از هر بار خواندن سایت رقبا، صفحه‌هایی که تازه ساخته‌اند اینجا می‌آید.</p></div> : (
            <table className="seo-table">
              <thead><tr><th>رقیب</th><th>صفحه</th><th>اولین بار دیده شد</th><th /></tr></thead>
              <tbody>
                {props.compNew.map((n) => (
                  <tr key={n.url}>
                    <td className="nowrap"><Avatar domain={n.domain} /> <span className="ltr small">{n.domain}</span></td>
                    <td><a href={n.url} target="_blank" rel="noreferrer">{n.title || pathOf(n.url)}</a></td>
                    <td className="nowrap small">{formatJalali(n.first_seen * 1000)}</td>
                    <td>{canEdit && <button type="button" className="btn sm" disabled={!!busy} onClick={() => startSimple({ key: `comp:${n.url}`, source: "competitor", kind: "landing", title: `واکنش به ${n.domain}: ${n.title}`, why: `رقیب تازه این صفحه را ساخته: ${n.title}`, target: n.title, url: n.url, impact: 35, effort: "mid" })}>{busy === `comp:${n.url}` ? "..." : "پیشنهاد واکنش"}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.href && <Link className="btn sm" href={toast.href}>دیدن پیش‌نویس</Link>}
          {toast.undo && <button type="button" className="btn sm" onClick={toast.undo}>برگردان</button>}
        </div>
      )}
    </div>
  );
}
