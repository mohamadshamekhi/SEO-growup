"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

export function GuideClient({ projectId, initial }: { projectId: string; initial: Record<string, string> }) {
  const [article, setArticle] = useState(initial.article || "");
  const [igPost, setIgPost] = useState(initial.ig_post || "");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api(`/api/projects/${projectId}/guide`, { method: "POST", body: { article, ig_post: igPost } });
      setMsg("ذخیره شد");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); }
  }

  return (
    <section className="panel narrow" style={{ marginTop: 14 }}>
      <h3>راهنمای نویسنده</h3>
      <p className="muted">قوانین مخصوص همین سایت که Claude موقع نوشتن رعایت می‌کند؛ مثل لحن، ممنوعیت‌ها و ساختار.</p>
      {msg && <div className="chip ok">{msg}</div>}
      {err && <div className="err" role="alert">{err}</div>}
      <form className="form-grid" onSubmit={save}>
        <div className="field full"><label htmlFor="gd-a">مقاله</label><textarea id="gd-a" rows={8} value={article} onChange={(e) => setArticle(e.target.value)} /></div>
        <div className="field full"><label htmlFor="gd-i">اینستاگرام</label><textarea id="gd-i" rows={6} value={igPost} onChange={(e) => setIgPost(e.target.value)} /></div>
        <div className="full"><button className="btn primary" type="submit" disabled={busy}>ذخیره راهنما</button></div>
      </form>
    </section>
  );
}
