"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type Guide = { what: string; why: string; cause: string; steps: string[]; owner: string; coverage: string; related: string[]; viaRedirect: boolean };
type Issue = { id: number; code: string; severity: string; url: string; detail: string; status: string; label: string; fix: string; canFix: boolean; guide: Guide | null };
type AutoFixResult = { ok: boolean; applied?: boolean; proposed?: string; reason?: string; fixedIds?: number[] };

const SEV_FA: Record<string, string> = { critical: "بحرانی", warning: "هشدار", info: "پیشنهاد" };
const RELATED_LABEL: Record<string, string> = {
  duplicate_title: "صفحه‌های دیگر با همین عنوان",
  duplicate_description: "صفحه‌های دیگر با همین meta description",
  img_no_alt: "تصاویر بدون alt",
};

export function IssuesClient({ projectId, initialRows }: { projectId: string; initialRows: Issue[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

  function toggleGuide(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function toggle(id: number, status: string) {
    setRows(rows.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await api(`/api/issues/${id}`, { method: "PATCH", body: { status } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  async function autofix(r: Issue) {
    if (!confirm(`متن جدید برای «${r.label}» (${r.url}) با هوش مصنوعی ساخته و مستقیم روی سایت ثبت می‌شود. ادامه؟`)) return;
    setBusy(r.id); setErr(""); setMsg("");
    try {
      const res = await api<AutoFixResult>(`/api/issues/${r.id}/autofix`, { method: "POST" });
      if (res.ok && res.applied) {
        const fixed = new Set(res.fixedIds?.length ? res.fixedIds : [r.id]);
        setRows((prev) => prev.filter((x) => !fixed.has(x.id)));
        setMsg(`رفع شد و روی سایت ثبت شد: «${res.proposed}»${fixed.size > 1 ? " (صفحه تکراری مقابل هم دیگر تکراری نیست)" : ""}`);
      } else {
        setErr(res.reason || "رفع خودکار ممکن نشد");
        if (res.ok && res.proposed) setMsg(`متن پیشنهادی: «${res.proposed}»`);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setBusy(null);
    }
  }

  async function recheck() {
    setChecking(true); setErr(""); setMsg("");
    try {
      await api(`/api/projects/${projectId}/run`, { method: "POST", body: { kind: "audit" } });
      setMsg("بررسی مجدد سایت در صف قرار گرفت؛ نتیجه را در تب «فعالیت و کارها» ببین.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, margin: "0 0 12px" }}>
        <button type="button" className="btn sm" disabled={checking} onClick={recheck}>بررسی مجدد سایت</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="muted small" style={{ marginBottom: 10 }}>{msg}</div>}
      {!rows.length ? (
        <div className="empty-inline"><p>مشکلی با این وضعیت نیست.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>شدت</th><th>عنوان</th><th>صفحه</th><th>جزئیات</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                <tr>
                  <td><span className={`sev ${r.severity}`}>{SEV_FA[r.severity] || r.severity}</span></td>
                  <td>{r.label}</td>
                  <td className="url">{r.url}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.detail}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {r.status === "open" && r.canFix && (
                        <button className="btn sm primary" disabled={busy !== null} aria-busy={busy === r.id} onClick={() => autofix(r)}>
                          {busy === r.id ? "در حال رفع..." : "رفع خودکار"}
                        </button>
                      )}
                      {r.guide && (
                        <button className="btn sm" aria-expanded={open.has(r.id)} aria-controls={`guide-${r.id}`} onClick={() => toggleGuide(r.id)}>
                          {open.has(r.id) ? "بستن توضیح" : "توضیح"}
                        </button>
                      )}
                      <button className="btn sm" onClick={() => toggle(r.id, r.status === "open" ? "ignored" : "open")}>
                        {r.status === "open" ? "نادیده بگیر" : "بازگردان"}
                      </button>
                    </div>
                  </td>
                </tr>
                {r.guide && open.has(r.id) && (
                  <tr id={`guide-${r.id}`} className="guide-row">
                    <td colSpan={5}><GuidePanel issue={r} guide={r.guide} /></td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GuidePanel({ issue, guide }: { issue: Issue; guide: Guide }) {
  return (
    <div className="guide">
      {guide.viaRedirect && (
        <p className="guide-note">
          این تکرار به‌خاطر ریدایرکت است: یکی از این آدرس‌ها به دیگری منتقل می‌شود، پس در واقع یک صفحه با دو آدرس است و نوشتن متن جدید لازم نیست.
          راه درست: آدرس قدیمی را از sitemap حذف کنید و لینک‌های داخلی را به آدرس نهایی بدهید.
        </p>
      )}
      <dl>
        <dt>مشکل چیست</dt>
        <dd>{guide.what}</dd>
        {guide.coverage && (<><dt>دلیل گوگل برای این صفحه</dt><dd>{issue.detail}: {guide.coverage}</dd></>)}
        <dt>چرا مهم است</dt>
        <dd>{guide.why}</dd>
        <dt>معمولاً چرا پیش می‌آید</dt>
        <dd>{guide.cause}</dd>
        <dt>چطور رفع کنیم</dt>
        <dd>
          <ol>{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </dd>
        {guide.related.length > 0 && (
          <>
            <dt>{RELATED_LABEL[issue.code] || "موارد مرتبط"}</dt>
            <dd><ul className="guide-urls">{guide.related.map((u) => <li key={u} className="url">{u}</li>)}</ul></dd>
          </>
        )}
        <dt>مسئول</dt>
        <dd>{guide.owner}</dd>
      </dl>
      {!issue.canFix && !guide.viaRedirect && (
        <p className="muted small">این مورد رفع خودکار ندارد چون تغییرش در کد سایت، سرور یا Search Console است، نه یک فیلد متنی.</p>
      )}
    </div>
  );
}
