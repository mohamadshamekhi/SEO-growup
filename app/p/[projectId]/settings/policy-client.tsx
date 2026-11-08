"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

type Policy = { meta: "approve" | "auto"; faq: "approve" | "auto"; content: "approve" | "auto"; rollback: "off" | "alert" | "auto" };

export function PolicyClient({ projectId, initial }: { projectId: string; initial: Policy }) {
  const [pol, setPol] = useState(initial);
  const [err, setErr] = useState("");

  async function update(key: keyof Policy, value: string) {
    const next = { ...pol, [key]: value } as Policy;
    setPol(next);
    try {
      await api(`/api/projects/${projectId}/policy`, { method: "POST", body: { [key]: value } });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  const row = (key: "meta" | "faq" | "content", label: string, hint: string) => (
    <div className="field">
      <label htmlFor={`pol-${key}`}>{label}</label>
      <select id={`pol-${key}`} value={pol[key]} onChange={(e) => update(key, e.target.value)}>
        <option value="approve">با تأیید من</option>
        <option value="auto">خودکار</option>
      </select>
      <span className="muted small">{hint}</span>
    </div>
  );

  return (
    <section className="panel narrow" style={{ marginTop: 14 }}>
      <h3>سطح اختیار پنل</h3>
      <p className="muted">مشخص می‌کند پنل چه تغییرهایی را بدون تأیید تو روی سایت ثبت کند. حتی در حالت خودکار، حداکثر ۱۰ تغییر در روز ثبت می‌شود.</p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="form-grid">
        {row("meta", "عنوان و توضیح صفحه", "کم‌خطرترین")}
        {row("faq", "پرسش‌های متداول", "روی صفحه محصول دیده می‌شود")}
        {row("content", "متن صفحه و توضیح محصول", "پرخطرترین؛ با احتیاط خودکار کن")}
        <div className="field">
          <label htmlFor="pol-rollback">اگر بعد از تغییر رتبه یا فروش افت کرد</label>
          <select id="pol-rollback" value={pol.rollback} onChange={(e) => update("rollback", e.target.value)}>
            <option value="alert">فقط هشدار بده</option>
            <option value="auto">خودکار برگردان</option>
            <option value="off">کاری نکن</option>
          </select>
          <span className="muted small">افت می‌تواند از نوسان خود گوگل هم باشد.</span>
        </div>
      </div>
    </section>
  );
}
