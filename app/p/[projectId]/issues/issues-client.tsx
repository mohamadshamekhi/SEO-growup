"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type Guide = { what: string; why: string; cause: string; steps: string[]; owner: string; coverage: string; related: string[]; viaRedirect: boolean };
type Diagnosis = { stack: string; evidence: string[]; summary: string; cause: string; steps: string[]; code: { where: string; lang: string; snippet: string }[]; verify: string; created: number };
export type Issue = { id: number; code: string; severity: string; url: string; detail: string; status: string; label: string; fix: string; canFix: boolean; technical: boolean; guide: Guide | null; diagnosis: Diagnosis | null };
type DiagnoseResult = { ok: boolean; diagnosis?: Diagnosis; reason?: string };
type AutoFixResult = { ok: boolean; applied?: boolean; proposed?: string; reason?: string; fixedIds?: number[] };

const SEV_FA: Record<string, string> = { critical: "بحرانی", warning: "هشدار", info: "پیشنهاد" };
const RELATED_LABEL: Record<string, string> = {
  duplicate_title: "صفحه‌های دیگر با همین عنوان",
  duplicate_description: "صفحه‌های دیگر با همین meta description",
  img_no_alt: "تصاویر بدون alt",
};

/** Self-contained message for whoever has to fix it by hand (developer, server admin, SEO). */
function handoff(r: Issue): string {
  const g = r.guide!;
  return [
    `${g.owner} عزیز، این مشکل سئو را لطفاً رفع کن:`,
    `مشکل: ${r.label}`,
    `صفحه: ${decodeURIComponent(r.url)}`,
    r.detail ? `جزئیات: ${r.detail}` : "",
    `توضیح: ${g.what}`,
    `چرا مهم است: ${g.why}`,
    g.coverage ? `دلیل گوگل: ${g.coverage}` : "",
    g.related.length ? `موارد مرتبط:\n${g.related.map((u) => `- ${decodeURIComponent(u)}`).join("\n")}` : "",
    ...(r.diagnosis
      ? [
          `تشخیص: ${r.diagnosis.summary}`,
          r.diagnosis.cause ? `علت فنی: ${r.diagnosis.cause}` : "",
          `شواهد از صفحه:\n${r.diagnosis.evidence.map((e) => `- ${e}`).join("\n")}`,
          `راه رفع:\n${r.diagnosis.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
          ...r.diagnosis.code.map((c) => `${c.where}:\n\`\`\`${c.lang}\n${c.snippet}\n\`\`\``),
          r.diagnosis.verify ? `بررسی بعد از رفع: ${r.diagnosis.verify}` : "",
        ]
      : [`راه رفع:\n${g.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`]),
  ].filter(Boolean).join("\n");
}

export function IssuesClient({ projectId, initialRows, compact = false, gscProperty = "" }: { projectId: string; initialRows: Issue[]; compact?: boolean; gscProperty?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [diagnosing, setDiagnosing] = useState<number | null>(null);

  async function diagnose(r: Issue, fresh = false) {
    setDiagnosing(r.id); setErr(""); setMsg("");
    setOpen((prev) => new Set(prev).add(r.id));
    try {
      const res = await api<DiagnoseResult>(`/api/issues/${r.id}/diagnose${fresh ? "?fresh=1" : ""}`, { method: "POST" });
      if (res.ok && res.diagnosis) setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, diagnosis: res.diagnosis! } : x)));
      else setErr(res.reason || "تشخیص ممکن نشد");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setDiagnosing(null);
    }
  }

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
        router.refresh();
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

  async function copyHandoff(r: Issue) {
    setErr(""); setMsg("");
    try {
      await navigator.clipboard.writeText(handoff(r));
      setMsg(`پیام آماده برای «${r.guide!.owner}» کپی شد؛ همان را برایش بفرستید.`);
    } catch {
      setErr("کپی ممکن نشد؛ متن را از پنل «توضیح» بردارید.");
    }
  }

  async function recheckIndex() {
    setChecking(true); setErr(""); setMsg("");
    try {
      await api(`/api/projects/${projectId}/run`, { method: "POST", body: { kind: "index", only_open: true } });
      setMsg("بررسی دوباره ایندکس صفحه‌های ایندکس‌نشده در صف قرار گرفت؛ صفحه‌هایی که ایندکس شده باشند خودکار از این فهرست می‌روند.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setChecking(false);
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
      {!compact && (
        <div className="row" style={{ gap: 8, margin: "0 0 12px" }}>
          <button type="button" className="btn sm" disabled={checking} onClick={recheck}>بررسی مجدد سایت</button>
          {rows.some((r) => r.code === "not_indexed" && r.status === "open") && <button type="button" className="btn sm" disabled={checking} onClick={recheckIndex}>بررسی دوباره ایندکس در گوگل</button>}
        </div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="muted small" style={{ marginBottom: 10 }}>{msg}</div>}
      {!rows.length ? (
        <div className="empty-inline"><p>مشکلی با این وضعیت نیست.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>شدت</th><th>عنوان</th>{!compact && <th>صفحه</th>}<th>جزئیات</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                <tr>
                  <td><span className={`sev ${r.severity}`}>{SEV_FA[r.severity] || r.severity}</span></td>
                  <td>{r.label}</td>
                  {!compact && <td className="url">{r.url}</td>}
                  <td className="muted" style={{ fontSize: 12 }}>{r.detail}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {r.status === "open" && r.canFix && (
                        <button className="btn sm primary" disabled={busy !== null} aria-busy={busy === r.id} onClick={() => autofix(r)}>
                          {busy === r.id ? "در حال رفع..." : "رفع خودکار"}
                        </button>
                      )}
                      {r.status === "open" && r.code === "not_indexed" && gscProperty && (
                        <a className="btn sm primary" target="_blank" rel="noreferrer"
                          href={`https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(gscProperty)}&id=${encodeURIComponent(r.url)}`}
                          title="Search Console همین آدرس را باز می‌کند؛ آنجا «Request indexing» را بزنید (گوگل برای این کار API ندارد)">
                          درخواست ایندکس در گوگل ↗
                        </a>
                      )}
                      {r.status === "open" && r.technical && r.code !== "not_indexed" && (
                        <button className={`btn sm${r.canFix ? "" : " primary"}`} disabled={diagnosing !== null} aria-busy={diagnosing === r.id}
                          onClick={() => (r.diagnosis ? toggleGuide(r.id) : diagnose(r))}>
                          {diagnosing === r.id ? "در حال بررسی صفحه..." : "راه‌حل فنی"}
                        </button>
                      )}
                      {r.status === "open" && !r.canFix && r.guide && (
                        <button className="btn sm" onClick={() => copyHandoff(r)}>کپی پیام برای {r.guide.owner}</button>
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
                    <td colSpan={compact ? 4 : 5}>
                      <GuidePanel issue={r} guide={r.guide} />
                      {diagnosing === r.id && <p className="muted small" role="status">صفحه زنده بررسی می‌شود و راه‌حل فنی نوشته می‌شود؛ ممکن است تا یک دقیقه طول بکشد.</p>}
                      {r.diagnosis && diagnosing !== r.id && <DiagnosisPanel d={r.diagnosis} onRefresh={() => diagnose(r, true)} busy={diagnosing !== null} />}
                    </td>
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
        <p className="muted small">این مورد در کد سایت، سرور یا Search Console رفع می‌شود، نه با تغییر یک متن. «راه‌حل فنی» صفحه زنده را بررسی می‌کند و دقیق می‌گوید کجای کد و چطور باید عوض شود؛ «کپی پیام برای {guide.owner}» همه را با کد برای مسئولش آماده می‌کند.</p>
      )}
    </div>
  );
}

function DiagnosisPanel({ d, onRefresh, busy }: { d: Diagnosis; onRefresh: () => void; busy: boolean }) {
  const [copied, setCopied] = useState<number | null>(null);
  async function copy(i: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  }
  return (
    <section className="guide diag" aria-label="راه‌حل فنی">
      <div className="diag-head">
        <h3>راه‌حل فنی</h3>
        <span className="muted small">فریم‌ورک: <span className="ltr">{d.stack}</span></span>
        <button type="button" className="btn sm" disabled={busy} onClick={onRefresh}>بررسی دوباره</button>
      </div>
      <dl>
        <dt>تشخیص</dt>
        <dd>{d.summary}</dd>
        {d.cause && (<><dt>علت فنی</dt><dd>{d.cause}</dd></>)}
        <dt>شواهد از صفحه زنده</dt>
        <dd><ul className="guide-urls diag-ev">{d.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></dd>
        <dt>قدم‌های رفع</dt>
        <dd><ol>{d.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></dd>
        {d.code.length > 0 && (
          <>
            <dt>کد</dt>
            <dd>
              {d.code.map((c, i) => (
                <div key={i} className="diag-code">
                  <div className="diag-code-head">
                    <span>{c.where}</span>
                    <button type="button" className="btn sm" onClick={() => copy(i, c.snippet)}>{copied === i ? "کپی شد" : "کپی کد"}</button>
                  </div>
                  <pre dir="ltr"><code>{c.snippet}</code></pre>
                </div>
              ))}
            </dd>
          </>
        )}
        {d.verify && (<><dt>بررسی بعد از رفع</dt><dd>{d.verify}</dd></>)}
      </dl>
    </section>
  );
}
