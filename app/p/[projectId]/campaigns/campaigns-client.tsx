"use client";
// New feature (no Python reference). Covers 3 campaign types in one list + one dialog form:
// seasonal/discount, content-goal, paid-ads. Budget/spend/metrics are manual entries only —
// no ads API is connected. content_ids/idea_ids link by raw numeric id (power-user field,
// same deferral pattern as tasks' assignee_id — a picker UI can follow later).
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import Icon from "@/components/Icon";
import type { CampaignRow, CampaignType, CampaignStatus } from "@/lib/campaigns";

const TYPES: Record<CampaignType, string> = { seasonal: "فصلی/تخفیفی", content: "محتوایی", paid: "تبلیغاتی پولی" };
const STATUSES: Record<CampaignStatus, string> = { planned: "برنامه‌ریزی‌شده", active: "فعال", paused: "متوقف", done: "پایان‌یافته", archived: "آرشیو" };

type FormState = {
  id?: number; name: string; type: CampaignType; status: CampaignStatus; goal: string;
  start_date: string; end_date: string; note: string;
  discount_percent: string; discount_note: string; product_urls: string;
  content_ids: string; idea_ids: string;
  channel: string; budget: string; spend: string; clicks: string; conversions: string; revenue: string;
};

const EMPTY: FormState = {
  name: "", type: "seasonal", status: "planned", goal: "", start_date: "", end_date: "", note: "",
  discount_percent: "", discount_note: "", product_urls: "", content_ids: "", idea_ids: "",
  channel: "", budget: "", spend: "", clicks: "", conversions: "", revenue: "",
};

function toForm(c: CampaignRow): FormState {
  return {
    id: c.id, name: c.name, type: c.type, status: c.status, goal: c.goal,
    start_date: c.start_date, end_date: c.end_date, note: c.note,
    discount_percent: c.discount_percent != null ? String(c.discount_percent) : "", discount_note: c.discount_note,
    product_urls: (c.product_urls || []).join("\n"), content_ids: (c.content_ids || []).join("\n"), idea_ids: (c.idea_ids || []).join("\n"),
    channel: c.channel, budget: c.budget != null ? String(c.budget) : "", spend: c.spend != null ? String(c.spend) : "",
    clicks: c.metrics?.clicks != null ? String(c.metrics.clicks) : "",
    conversions: c.metrics?.conversions != null ? String(c.metrics.conversions) : "",
    revenue: c.metrics?.revenue != null ? String(c.metrics.revenue) : "",
  };
}

function numOrNull(s: string): number | null {
  const n = Number(s);
  return s.trim() && !Number.isNaN(n) ? n : null;
}

function idList(s: string): number[] {
  return s.split("\n").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

export function CampaignsClient({ projectId, initial }: { projectId: string; initial: CampaignRow[] }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<"all" | CampaignType>("all");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function openNew() { setForm(EMPTY); setErr(""); dialogRef.current?.showModal(); }
  function openEdit(c: CampaignRow) { setForm(toForm(c)); setErr(""); dialogRef.current?.showModal(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const body = {
      name: form.name, type: form.type, status: form.status, goal: form.goal,
      start_date: form.start_date, end_date: form.end_date, note: form.note,
      discount_percent: numOrNull(form.discount_percent), discount_note: form.discount_note,
      product_urls: form.product_urls.split("\n").map((x) => x.trim()).filter(Boolean),
      content_ids: idList(form.content_ids), idea_ids: idList(form.idea_ids),
      channel: form.channel, budget: numOrNull(form.budget), spend: numOrNull(form.spend),
      metrics: { clicks: numOrNull(form.clicks), conversions: numOrNull(form.conversions), revenue: numOrNull(form.revenue) },
    };
    try {
      if (form.id) {
        await api(`/api/campaigns/${form.id}`, { method: "PATCH", body });
      } else {
        await api(`/api/projects/${projectId}/campaigns`, { method: "POST", body });
      }
      dialogRef.current?.close();
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: number) {
    try {
      await api(`/api/campaigns/${id}`, { method: "DELETE" });
      setRows(rows.filter((r) => r.id !== id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  async function quickStatus(c: CampaignRow, status: CampaignStatus) {
    setRows(rows.map((r) => (r.id === c.id ? { ...r, status } : r)));
    try {
      await api(`/api/campaigns/${c.id}`, { method: "PATCH", body: { status } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  const visible = rows.filter((r) => filter === "all" || r.type === filter);

  return (
    <div>
      <div className="row" style={{ gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <div className="tabs">
          <button type="button" className={`btn sm ${filter === "all" ? "primary" : ""}`} onClick={() => setFilter("all")}>همه</button>
          {(Object.entries(TYPES) as [CampaignType, string][]).map(([k, l]) => (
            <button key={k} type="button" className={`btn sm ${filter === k ? "primary" : ""}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="btn primary sm" onClick={openNew}><Icon name="plus" />کمپین جدید</button>
      </div>

      {err && <div className="err" role="alert">{err}</div>}

      {!visible.length && <p className="muted">کمپینی در این دسته نیست.</p>}

      <div className="pick-grid">
        {visible.map((c) => {
          const roas = c.spend && c.metrics?.revenue != null ? Number(c.metrics.revenue) / Number(c.spend) : null;
          return (
            <div key={c.id} className="panel">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{c.name}</strong>
                <span className="chip">{TYPES[c.type]}</span>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <select value={c.status} onChange={(e) => quickStatus(c, e.target.value as CampaignStatus)}>
                  {(Object.entries(STATUSES) as [CampaignStatus, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span className="mono ltr muted">{c.start_date || "—"} تا {c.end_date || "—"}</span>
              </div>
              {c.goal && <p className="muted" style={{ marginTop: 6 }}>هدف: {c.goal}</p>}
              {c.type === "seasonal" && c.discount_percent != null && <p>تخفیف: {faNum(c.discount_percent)}٪ {c.discount_note ? `— ${c.discount_note}` : ""}</p>}
              {c.type === "content" && <p className="muted">{faNum(c.content_ids.length)} محتوا · {faNum(c.idea_ids.length)} ایده</p>}
              {c.type === "paid" && (
                <p className="muted">
                  {c.channel || "—"} · بودجه {c.budget != null ? faNum(c.budget) : "—"} · هزینه {c.spend != null ? faNum(c.spend) : "—"}
                  {roas != null && ` · ROAS ${faNum(roas, 2)}`}
                </p>
              )}
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <button type="button" className="btn sm" onClick={() => openEdit(c)}>ویرایش</button>
                <button type="button" className="btn sm danger" onClick={() => del(c.id)}>حذف</button>
              </div>
            </div>
          );
        })}
      </div>

      <dialog ref={dialogRef} className="modal wide">
        <div className="modal-pad">
          <form className="form-grid" onSubmit={submit}>
            <h2 className="full" style={{ margin: 0, fontSize: 17 }}>{form.id ? "ویرایش کمپین" : "کمپین جدید"}</h2>
            {err && <div className="err full" role="alert">{err}</div>}
            <div className="field"><label>نام</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field">
              <label>نوع</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CampaignType })}>
                {(Object.entries(TYPES) as [CampaignType, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>وضعیت</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}>
                {(Object.entries(STATUSES) as [CampaignStatus, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field"><label>هدف/KPI (اختیاری)</label><input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></div>
            <div className="field"><label>تاریخ شروع</label><input className="mono ltr" placeholder="۱۴۰۵/۰۸/۲۰" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div className="field"><label>تاریخ پایان</label><input className="mono ltr" placeholder="۱۴۰۵/۰۹/۰۱" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>

            {form.type === "seasonal" && (
              <>
                <div className="field"><label>درصد تخفیف</label><input type="text" inputMode="decimal" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} /></div>
                <div className="field"><label>توضیح تخفیف</label><input value={form.discount_note} onChange={(e) => setForm({ ...form, discount_note: e.target.value })} /></div>
                <div className="field full"><label>آدرس محصولات (هر خط یکی)</label><textarea className="mono ltr" value={form.product_urls} onChange={(e) => setForm({ ...form, product_urls: e.target.value })} /></div>
              </>
            )}

            {form.type === "content" && (
              <>
                <div className="field"><label>شناسه محتواها (هر خط یکی)</label><textarea className="mono ltr" value={form.content_ids} onChange={(e) => setForm({ ...form, content_ids: e.target.value })} /></div>
                <div className="field"><label>شناسه ایده‌ها (هر خط یکی)</label><textarea className="mono ltr" value={form.idea_ids} onChange={(e) => setForm({ ...form, idea_ids: e.target.value })} /></div>
              </>
            )}

            {form.type === "paid" && (
              <>
                <div className="field"><label>کانال</label><input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="مثل: گوگل ادز، اینستاگرام" /></div>
                <div className="field"><label>بودجه (تومان)</label><input type="text" inputMode="decimal" className="ltr" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
                <div className="field"><label>هزینه تا امروز</label><input type="text" inputMode="decimal" className="ltr" value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} /></div>
                <div className="field"><label>کلیک</label><input type="text" inputMode="decimal" className="ltr" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} /></div>
                <div className="field"><label>تبدیل/فروش</label><input type="text" inputMode="decimal" className="ltr" value={form.conversions} onChange={(e) => setForm({ ...form, conversions: e.target.value })} /></div>
                <div className="field"><label>درآمد</label><input type="text" inputMode="decimal" className="ltr" value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} /></div>
              </>
            )}

            <div className="field full"><label>یادداشت</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>

            <div className="full modal-actions">
              <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>انصراف</button>
              <button className="btn primary" type="submit" disabled={busy}>{form.id ? "ذخیره" : "افزودن"}</button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}
