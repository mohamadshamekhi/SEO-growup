"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import { formatJalali } from "@/lib/intl/jalali";
import type { QueryRow, Summary, Label } from "@/lib/seo-actions";

const LABEL_FA: Record<Label, string> = {
  top3: "۳ تای اول", page1: "صفحه اول", near: "نزدیک صفحه اول", far: "دور از صفحه اول", cannibal: "رقابت دو صفحه خودی",
  needs_article: "نیاز به مقاله", low_ctr: "کلیک کم با رتبه خوب", dropping: "افت جایگاه", rising: "رشد جایگاه", brand: "برند", no_page: "صفحه مشخص نیست",
};
const LABEL_TONE: Partial<Record<Label, string>> = { top3: "good", page1: "good", rising: "good", near: "info", cannibal: "warn", needs_article: "info", low_ctr: "warn", dropping: "bad", far: "", brand: "", no_page: "" };
const FILTERS: { key: "all" | Label | "acted"; label: string }[] = [
  { key: "all", label: "همه" }, { key: "near", label: "نزدیک صفحه اول" }, { key: "cannibal", label: "رقابت دو صفحه" },
  { key: "needs_article", label: "نیاز به مقاله" }, { key: "low_ctr", label: "کلیک کم" }, { key: "dropping", label: "افت" },
  { key: "page1", label: "صفحه اول" }, { key: "acted", label: "اقدام‌شده" },
];
const ACTION_FA: Record<string, string> = { optimize: "عنوان و توضیح بهینه شد", article: "مقاله در صف نوشتن", merge: "راهنمای ادغام گرفته شد" };

type ActionResult = { ok: boolean; result: { title?: string; meta?: string; url?: string; id?: number; keep?: string; others?: string[]; steps?: string[] } };

function delta(cur: number, prev: number | null) {
  if (prev == null) return null;
  const d = prev - cur; // lower position is better
  if (Math.abs(d) < 0.5) return <span className="muted small">بی‌تغییر</span>;
  return <span className={`small ${d > 0 ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"} {faNum(Math.abs(d), 1)}</span>;
}

function pct(cur: number, prev: number) {
  if (!prev) return "";
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p >= 0 ? "+" : ""}${faNum(p)}٪ نسبت به ۲۸ روز قبل`;
}

export function GscClient({ projectId, rows: initial, summary: s, canEdit }: { projectId: string; rows: QueryRow[]; summary: Summary; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [guides, setGuides] = useState<Record<string, string[]>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const visible = useMemo(() => rows.filter((r) =>
    (filter === "all" || (filter === "acted" ? !!r.last : r.labels.includes(filter))) &&
    (!search.trim() || r.query.includes(search.trim()))), [rows, filter, search]);

  async function act(r: QueryRow, action: "optimize" | "article" | "merge", quiet = false): Promise<boolean> {
    if (!quiet && action === "optimize" && !confirm(`عنوان سئو و توضیح متای صفحه زیر برای کلمه «${r.query}» با هوش مصنوعی بازنویسی و مستقیم روی سایت ثبت می‌شود (از تاریخچه قابل برگشت است):\n${decodeURIComponent(r.page || "")}\n\nادامه؟`)) return false;
    setBusy(`${r.query}:${action}`); setErr(""); if (!quiet) setMsg("");
    try {
      const res = await api<ActionResult>(`/api/projects/${projectId}/gsc/action`, { method: "POST", body: { query: r.query, action } });
      const last = { action, ts: Date.now() / 1000, position_before: r.position, detail: res.result as Record<string, unknown> };
      setRows((prev) => prev.map((x) => (x.query === r.query ? { ...x, last } : x)));
      if (action === "optimize") setMsg(`«${r.query}»: عنوان جدید «${res.result.title}» و توضیح جدید روی سایت ثبت شد. اثرش معمولاً ۱ تا ۳ هفته بعد در جایگاه دیده می‌شود.`);
      if (action === "article") setMsg(`مقاله «${r.query}» در صف تب «محتوا» قرار گرفت؛ بعد از نوشتن به‌صورت پیش‌نویس (منتشرنشده) روی سایت می‌رود.`);
      if (action === "merge") { setGuides((g) => ({ ...g, [r.query]: res.result.steps || [] })); setOpen(r.query); }
      return true;
    } catch (e) {
      setErr(`«${r.query}»: ${e instanceof ApiError ? e.message : "خطا"}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function bulkOptimize() {
    const targets = rows.filter((r) => r.actions.includes("optimize") && !r.last && r.labels.includes("near") && !r.labels.includes("cannibal")).slice(0, 5);
    if (!targets.length) { setMsg("فرصت نزدیک صفحه اولِ اقدام‌نشده‌ای نمانده."); return; }
    if (!confirm(`عنوان و توضیح ${faNum(targets.length)} صفحه برای این کلمه‌ها بازنویسی و روی سایت ثبت می‌شود:\n${targets.map((t) => `- ${t.query}`).join("\n")}\n\nادامه؟`)) return;
    setBulk({ done: 0, total: targets.length }); setMsg("");
    let ok = 0;
    const seen = new Set<string>();
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.page && seen.has(t.page)) { setBulk({ done: i + 1, total: targets.length }); continue; } // one rewrite per page per run
      if (t.page) seen.add(t.page);
      if (await act(t, "optimize", true)) ok++;
      setBulk({ done: i + 1, total: targets.length });
    }
    setBulk(null);
    setMsg(`${faNum(ok)} صفحه بهینه و روی سایت ثبت شد.`);
    router.refresh();
  }

  return (
    <div>
      <div className="kpis seo-kpis">
        <div className="kpi"><div className="kpi-l">کلیک ۲۸ روز</div><div className="kpi-x">{faNum(s.clicks)}</div><div className="muted small">{pct(s.clicks, s.prevClicks)}</div></div>
        <div className="kpi"><div className="kpi-l">نمایش ۲۸ روز</div><div className="kpi-x">{faNum(s.impressions)}</div><div className="muted small">{pct(s.impressions, s.prevImpressions)}</div></div>
        <div className="kpi"><div className="kpi-l">کلمه در صفحه اول گوگل</div><div className="kpi-x">{faNum(s.page1)}</div><div className="muted small">{faNum(s.top3)} در ۳ تای اول{s.prevPage1 != null ? ` · قبلاً ${faNum(s.prevPage1)}` : ""}</div></div>
        <div className="kpi"><div className="kpi-l">نزدیک صفحه اول</div><div className="kpi-x">{faNum(s.near)}</div><div className="muted small">جایگاه ۴ تا ۲۰؛ سریع‌ترین برد</div></div>
        <div className="kpi"><div className="kpi-l">کلیک قابل‌برد در ماه</div><div className="kpi-x">{faNum(s.potential)}</div><div className="muted small">اگر هر کلمه به رتبه ۳ برسد</div></div>
        <div className="kpi"><div className="kpi-l">اقدام‌های انجام‌شده</div><div className="kpi-x">{faNum(s.actionsDone)}</div><div className="muted small">{faNum(s.improved)} مورد جایگاهش بهتر شده</div></div>
      </div>

      <div className="row seo-toolbar">
        <div className="seg" role="group" aria-label="فیلتر وضعیت">
          {FILTERS.map((f) => {
            const n = f.key === "all" ? rows.length : f.key === "acted" ? rows.filter((r) => r.last).length : rows.filter((r) => r.labels.includes(f.key as Label)).length;
            return (
              <button key={f.key} type="button" className={`btn sm${filter === f.key ? " primary" : ""}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} <span className="count">{faNum(n)}</span>
              </button>
            );
          })}
        </div>
        <input type="search" placeholder="جستجوی کلمه" aria-label="جستجوی کلمه" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 180 }} />
        {canEdit && (
          <button type="button" className="btn sm primary" disabled={!!bulk || !!busy} onClick={bulkOptimize}>
            {bulk ? `در حال بهینه‌سازی ${faNum(bulk.done)} از ${faNum(bulk.total)}...` : "بهینه‌سازی ۵ فرصت برتر"}
          </button>
        )}
      </div>

      {err && <div className="err" role="alert">{err}</div>}
      {msg && <p className="muted small" role="status" style={{ margin: "0 0 10px" }}>{msg}</p>}

      <div className="table-wrap">
        <table className="seo-table">
          <thead>
            <tr><th>کلمه</th><th className="num">جایگاه</th><th className="num">نمایش</th><th className="num">کلیک</th><th className="num" title="کلیک اضافه در ماه اگر به رتبه ۳ برسد">پتانسیل</th><th>وضعیت</th><th /></tr>
          </thead>
          <tbody>
            {visible.slice(0, 200).map((r) => {
              const expanded = open === r.query;
              return (
                <Fragment key={r.query}>
                  <tr>
                    <td>
                      <strong>{r.query}</strong>
                      {r.page && <div className="url seo-url">{decodeURIComponent(r.page)}</div>}
                    </td>
                    <td className="num">{faNum(r.position, 1)} {delta(r.position, r.prev_position)}</td>
                    <td className="num">{faNum(r.impressions)}</td>
                    <td className="num">{faNum(r.clicks)}</td>
                    <td className="num">{r.potential ? `+${faNum(r.potential)}` : "—"}</td>
                    <td>
                      <div className="chips">{r.labels.map((l) => <span key={l} className={`chip ${LABEL_TONE[l] || ""}`}>{LABEL_FA[l]}</span>)}</div>
                      {r.last && (
                        <div className="small seo-last">
                          {ACTION_FA[r.last.action] || r.last.action} · {formatJalali(r.last.ts * 1000)}
                          {r.last.position_before != null && ` · جایگاه آن موقع ${faNum(r.last.position_before, 1)}، الان ${faNum(r.position, 1)}`}
                        </div>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn sm" aria-expanded={expanded} aria-controls={`q-${encodeURIComponent(r.query)}`} onClick={() => setOpen(expanded ? null : r.query)}>
                        {expanded ? "بستن" : "اقدام"}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr id={`q-${encodeURIComponent(r.query)}`} className="guide-row">
                      <td colSpan={7}>
                        <div className="guide">
                          <p style={{ margin: "0 0 10px", color: "var(--fg)" }}>{r.advice}</p>
                          {r.pages.length > 0 && (
                            <>
                              <p className="muted small" style={{ margin: "0 0 4px" }}>صفحه‌های سایت که برای این کلمه در گوگل دیده می‌شوند:</p>
                              <ul className="guide-urls" style={{ marginBottom: 10 }}>
                                {r.pages.map((p) => <li key={p.url}>{decodeURIComponent(p.url)} — جایگاه {faNum(p.position, 1)}، {faNum(p.impressions)} نمایش، {faNum(p.clicks)} کلیک</li>)}
                              </ul>
                            </>
                          )}
                          {canEdit && (
                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              {r.actions.includes("optimize") && (
                                <button type="button" className="btn sm primary" disabled={!!busy || !!bulk} aria-busy={busy === `${r.query}:optimize`} onClick={() => act(r, "optimize")}>
                                  {busy === `${r.query}:optimize` ? "در حال بازنویسی و ثبت..." : "بهینه‌سازی عنوان و توضیح برای این کلمه"}
                                </button>
                              )}
                              {r.actions.includes("article") && (
                                <button type="button" className="btn sm" disabled={!!busy || !!bulk} onClick={() => act(r, "article")}>
                                  {busy === `${r.query}:article` ? "..." : "نوشتن مقاله برای این کلمه"}
                                </button>
                              )}
                              {r.actions.includes("merge") && (
                                <button type="button" className="btn sm" disabled={!!busy || !!bulk} onClick={() => act(r, "merge")}>راهنمای یکی کردن صفحه‌ها</button>
                              )}
                              {!r.actions.length && <span className="muted small">برای این کلمه اقدام خودکاری لازم نیست.</span>}
                            </div>
                          )}
                          {guides[r.query] && (
                            <ol style={{ marginTop: 10 }}>{guides[r.query].map((g, i) => <li key={i}>{g}</li>)}</ol>
                          )}
                          {r.last?.action === "optimize" && typeof r.last.detail.title === "string" && (
                            <p className="muted small" style={{ marginTop: 10 }}>عنوان ثبت‌شده: «{String(r.last.detail.title)}» — توضیح: «{String(r.last.detail.meta || "")}»</p>
                          )}
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
      {!visible.length && <p className="muted" style={{ marginTop: 10 }}>کلمه‌ای با این فیلتر نیست.</p>}
      <p className="muted small" style={{ marginTop: 10 }}>
        ترتیب بر اساس اولویت است: کلیکی که هر کلمه می‌تواند بیاورد و نزدیکی‌اش به صفحه اول. اعداد جایگاه و نمایش مال ۲۸ روز گذشته‌اند و با هر دریافت داده تازه می‌شوند؛ اثر هر اقدام معمولاً ۱ تا ۳ هفته بعد دیده می‌شود.
      </p>
    </div>
  );
}
