"use client";
// Shared create/edit form, ported from public/app.js's projectForm(p). Used from the project
// picker (create, admin-only) and from settings' new "general" section (edit).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

export type ProjectFormInitial = {
  id?: string; name?: string; domain?: string; color?: string; logo_url?: string; sitemap?: string;
  max_pages?: number; gsc_property?: string; keywords?: unknown[]; competitors?: unknown[];
};

export function ProjectForm({ initial, onDone }: { initial?: ProjectFormInitial; onDone?: () => void }) {
  const router = useRouter();
  const editing = !!initial?.id;
  const [name, setName] = useState(initial?.name || "");
  const [domain, setDomain] = useState(initial?.domain || "");
  const [color, setColor] = useState(initial?.color || "#5a4fcf");
  const [logo, setLogo] = useState(initial?.logo_url || "");
  const [sitemap, setSitemap] = useState(initial?.sitemap || "");
  const [maxPages, setMaxPages] = useState(String(initial?.max_pages || 120));
  const [gsc, setGsc] = useState(initial?.gsc_property || "");
  const [keywords, setKeywords] = useState((initial?.keywords || []).join("\n"));
  const [competitors, setCompetitors] = useState((initial?.competitors || []).join("\n"));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const body = {
      name, domain, color, logo_url: logo, sitemap, max_pages: Number(maxPages) || 120,
      gsc_property: gsc, keywords, competitors,
    };
    try {
      if (editing) {
        await api(`/api/projects/${initial!.id}`, { method: "PATCH", body });
        router.refresh();
        onDone?.();
      } else {
        const r = await api<{ id: string }>("/api/projects", { method: "POST", body });
        router.push(`/p/${r.id}/dash`);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {!editing && <h2 className="full" style={{ margin: 0, fontSize: 17 }}>افزودن پروژه</h2>}
      {err && <div className="err full" role="alert">{err}</div>}
      <div className="field"><label htmlFor="pf-name">نام</label><input id="pf-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="مثل: استیو" /></div>
      <div className="field"><label htmlFor="pf-domain">دامنه</label><input id="pf-domain" type="text" className="mono ltr" required value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" /></div>
      <div className="field">
        <label htmlFor="pf-color">رنگ برند</label>
        <div className="row"><input id="pf-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 56, height: 38, padding: 2 }} /><span className="hint">برای کارت‌ها و عکس‌ها</span></div>
      </div>
      <div className="field"><label htmlFor="pf-logo">آدرس لوگو (اختیاری)</label><input id="pf-logo" type="url" className="mono ltr" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://.../logo.png" /></div>
      <div className="field"><label htmlFor="pf-sitemap">آدرس sitemap (اختیاری)</label><input id="pf-sitemap" type="url" className="mono ltr" value={sitemap} onChange={(e) => setSitemap(e.target.value)} placeholder="خودکار از robots.txt" /></div>
      <div className="field"><label htmlFor="pf-max">حداکثر صفحات هر ممیزی</label><input id="pf-max" type="text" inputMode="numeric" value={maxPages} onChange={(e) => setMaxPages(e.target.value)} /><span className="hint">هر صفحه ~۱ ثانیه؛ ۱۲۰ صفحه ≈ ۳ دقیقه</span></div>
      <div className="field"><label htmlFor="pf-gsc">property سرچ کنسول (اختیاری)</label><input id="pf-gsc" type="text" className="mono ltr" value={gsc} onChange={(e) => setGsc(e.target.value)} placeholder="خودکار؛ مثل sc-domain:example.com" /></div>
      <div className="field full"><label htmlFor="pf-kw">کلمات هدف (هر خط یکی)</label><textarea id="pf-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
      <div className="field full"><label htmlFor="pf-comp">صفحات/دامنه‌های رقبا (هر خط یکی)</label><textarea id="pf-comp" className="mono ltr" value={competitors} onChange={(e) => setCompetitors(e.target.value)} /></div>
      <div className="full modal-actions">
        {!editing && onDone && <button type="button" className="btn" onClick={onDone}>انصراف</button>}
        <button className="btn primary" type="submit" disabled={busy}>{editing ? "ذخیره" : "افزودن و شروع ممیزی"}</button>
      </div>
    </form>
  );
}
