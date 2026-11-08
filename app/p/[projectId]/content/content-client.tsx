"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

type ContentRow = { id: number; kind: "article" | "ig_post"; status: string; topic: string; brief: Record<string, unknown>; output: Record<string, unknown>; flags: string[]; note: string };

const CST: Record<string, [string, string]> = {
  queued: ["در صف نوشتن", ""], writing: ["در حال نوشتن", "info"], review: ["منتظر بازبینی", "warn"],
  drafted: ["پیش‌نویس در سایت", "ok"], published: ["منتشر شد", "ok"], approved: ["تأییدشده", "ok"], rejected: ["ردشده", "danger"],
};

export function ContentClient({ projectId, initialItems, catalogSize }: { projectId: string; initialItems: ContentRow[]; catalogSize: number }) {
  const [items, setItems] = useState(initialItems);
  const [view, setView] = useState<"article" | "ig_post">("article");
  const [err, setErr] = useState("");
  const [topic, setTopic] = useState("");
  const [keyword, setKeyword] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = items.filter((c) => c.kind === view);
  const queued = items.filter((c) => c.status === "queued").length;

  async function setStatus(id: number, status: string) {
    try {
      await api(`/api/content/${id}`, { method: "POST", body: { status } });
      setItems(items.map((c) => (c.id === id ? { ...c, status } : c)));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function pushDraft(id: number) {
    if (!confirm("این مقاله به‌صورت پیش‌نویس منتشرنشده به سایت فرستاده شود؟")) return;
    try {
      await api(`/api/content/${id}/draft`, { method: "POST" });
      setItems(items.map((c) => (c.id === id ? { ...c, status: "drafted" } : c)));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function doPublish(id: number) {
    try {
      const chk = await api<{ fails: number }>(`/api/content/${id}/check`, { method: "POST" });
      if (!confirm(chk.fails ? `${chk.fails} مشکل جدی دارد؛ با این حال منتشر شود؟` : "این مقاله منتشر شود؟")) return;
      await api(`/api/content/${id}/publish`, { method: "POST", body: { force: !!chk.fails } });
      setItems(items.map((c) => (c.id === id ? { ...c, status: "published" } : c)));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function del(id: number) {
    try {
      await api(`/api/content/${id}`, { method: "DELETE" });
      setItems(items.filter((c) => c.id !== id));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function addArticle(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: number }>(`/api/projects/${projectId}/content`, { method: "POST", body: { topic, keyword, notes } });
      setItems([{ id: r.id, kind: "article", status: "queued", topic, brief: {}, output: {}, flags: [], note: "" }, ...items]);
      setTopic(""); setKeyword(""); setNotes("");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); }
  }

  async function makeIgPlan() {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/igplan`, { method: "POST" });
      location.reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); setBusy(false); }
  }

  async function writeNow() {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/write`, { method: "POST", body: { what: "content", limit: 5 } });
      setErr("");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); }
  }

  return (
    <div>
      {err && <div className="err" role="alert">{err}</div>}
      {!catalogSize && <div className="banner warn"><span className="grow">کاتالوگ خالی است؛ بدون آن لینک داخلی و برنامه اینستاگرام ساخته نمی‌شود.</span></div>}

      <div className="toolbar">
        <button className={`btn sm${view === "article" ? " primary" : ""}`} onClick={() => setView("article")}>مقاله‌ها ({items.filter((c) => c.kind === "article").length})</button>
        <button className={`btn sm${view === "ig_post" ? " primary" : ""}`} onClick={() => setView("ig_post")}>اینستاگرام ({items.filter((c) => c.kind === "ig_post").length})</button>
        <button className="btn sm" disabled={!queued || busy} onClick={writeNow}>نوشتن {Math.min(queued, 5)} مورد با Claude</button>
        <span className="muted small">نوشتن از سهمیه Claude Code مصرف می‌کند. مقاله نوشته‌شده طبق تنظیمات زمان‌بندی پیش‌نویس می‌شود؛ چیزی منتشر نمی‌شود.</span>
      </div>

      {view === "article" ? (
        <section className="panel" style={{ marginBottom: 14 }}>
          <h3>مقاله جدید</h3>
          <form className="form-grid" onSubmit={addArticle}>
            <div className="field"><label htmlFor="ar-topic">موضوع</label><input id="ar-topic" type="text" required maxLength={200} value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
            <div className="field"><label htmlFor="ar-kw">کلمه کلیدی هدف</label><input id="ar-kw" type="text" maxLength={120} value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
            <div className="field full"><label htmlFor="ar-notes">نکته برای نویسنده (اختیاری)</label><input id="ar-notes" type="text" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="full"><button className="btn primary" type="submit" disabled={busy}>افزودن به صف</button></div>
          </form>
        </section>
      ) : (
        <div className="toolbar"><button className="btn primary" disabled={!catalogSize || busy} onClick={makeIgPlan}>ساخت برنامه هفته بعد (۵ پست)</button></div>
      )}

      {shown.length === 0 ? <div className="empty-state"><h2>هنوز چیزی نیست</h2></div> : shown.map((c) => {
        const o = c.output as { title?: string; meta_description?: string; slug?: string; body_html?: string; hook?: string; caption?: string; format?: string; hashtags?: string[]; draft_id?: string; published_url?: string; tg_sent?: number; tg_error?: string };
        const [label, cl] = CST[c.status] || [c.status, ""];
        return (
          <details className="issue-group" key={c.id}>
            <summary>
              <span className={`chip ${cl}`}>{label}</span>
              <strong style={{ flex: 1 }}>{o.title || c.topic}</strong>
              {c.flags.length > 0 && <span className="sev warning">{c.flags.length} نکته</span>}
            </summary>
            <div style={{ padding: "0 14px 14px" }}>
              {c.note && <div className="muted" style={{ marginBottom: 8 }}>{c.note}</div>}
              {c.flags.map((f, i) => <div className="list-item" key={i}><span className="grow" style={{ whiteSpace: "normal" }}>{f}</span></div>)}
              {c.kind === "article" && o.body_html && (
                <div className="muted" style={{ margin: "8px 0", fontSize: 13 }}>
                  توضیح متا: {o.meta_description}<br />slug: <span className="mono">{o.slug}</span>
                </div>
              )}
              {c.kind === "ig_post" && o.caption && (
                <div style={{ marginTop: 8 }}>
                  <div className="chip">{o.format}</div>
                  <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>{o.hook}</p>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{o.caption}</p>
                  <p className="mono muted ltr">{(o.hashtags || []).join(" ")}</p>
                  {o.tg_sent && <span className="chip ok">پیام تلگرام رفت</span>}
                  {o.tg_error && <span className="chip danger">پیام تلگرام نرفت</span>}
                </div>
              )}
              {o.published_url && <a className="btn sm" href={o.published_url} target="_blank" rel="noopener noreferrer">دیدن مقاله</a>}
              <div className="row" style={{ marginTop: 10 }}>
                {c.status === "review" && (
                  <>
                    <button className="btn sm primary" onClick={() => setStatus(c.id, "approved")}>تأیید</button>
                    <button className="btn sm danger" onClick={() => setStatus(c.id, "rejected")}>رد</button>
                  </>
                )}
                {c.kind === "article" && ["review", "approved"].includes(c.status) && !o.draft_id && (
                  <button className="btn sm primary" onClick={() => pushDraft(c.id)}>فرستادن پیش‌نویس به سایت</button>
                )}
                {c.kind === "article" && c.status === "drafted" && <button className="btn sm primary" onClick={() => doPublish(c.id)}>انتشار</button>}
                {c.status !== "writing" && <button className="btn sm danger icon-only" aria-label="حذف" onClick={() => del(c.id)}>✕</button>}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
