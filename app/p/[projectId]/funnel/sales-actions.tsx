"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";
import type { ProductAdvice, SalesTip } from "@/lib/sales-actions";

type Res = { ok: boolean; result: { words?: number; title?: string } };

async function post(projectId: string, body: Record<string, string>) {
  return api<Res>(`/api/projects/${projectId}/sales`, { method: "POST", body });
}

/** Under each product name: what to do, and buttons for what the panel can do itself. */
export function ProductActions({ projectId, name, advice, canEdit }: { projectId: string; name: string; advice: ProductAdvice; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"cro" | "optimize" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!advice.tips.length && !advice.canCro && !advice.canOptimize) return null;

  async function run(kind: "cro" | "optimize") {
    const text = kind === "cro"
      ? `توضیح محصول «${name}» برای فروش بیشتر با هوش مصنوعی بازنویسی و مستقیم روی سایت ثبت می‌شود (فقط از مشخصات واقعی خود محصول، بدون قیمت/گارانتی/ادعای تازه؛ از تاریخچه قابل برگشت). ادامه؟`
      : `عنوان سئو و توضیح متای «${name}» برای کلمه «${advice.query}» بازنویسی و روی سایت ثبت می‌شود. ادامه؟`;
    if (!confirm(text)) return;
    setBusy(kind); setMsg(null);
    try {
      const r = await post(projectId, kind === "cro" ? { action: "cro", url: advice.url } : { action: "optimize", query: advice.query! });
      setMsg({ ok: true, text: kind === "cro" ? `توضیح جدید (${faNum(r.result.words || 0)} کلمه) روی سایت ثبت شد.` : `عنوان جدید ثبت شد: «${r.result.title}»` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "خطا" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="prod-actions">
      <button type="button" className="linkish small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "بستن پیشنهادها" : `${faNum(advice.tips.length)} پیشنهاد برای فروش بیشتر`}
      </button>
      {open && (
        <div className="guide" style={{ marginTop: 6 }}>
          <ul className="plan-list">{advice.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          {canEdit && (advice.canCro || advice.canOptimize) && (
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {advice.canOptimize && (
                <button type="button" className="btn sm primary" disabled={!!busy} aria-busy={busy === "optimize"} onClick={() => run("optimize")}>
                  {busy === "optimize" ? "در حال ثبت..." : `بهینه برای «${advice.query}»`}
                </button>
              )}
              {advice.canCro && (
                <button type="button" className="btn sm" disabled={!!busy} aria-busy={busy === "cro"} onClick={() => run("cro")}>
                  {busy === "cro" ? "در حال نوشتن و ثبت..." : "بازنویسی متن فروش"}
                </button>
              )}
            </div>
          )}
          {msg && <p className={`small ${msg.ok ? "up" : "down"}`} role="status" style={{ marginTop: 6 }}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}

const LEVEL: Record<SalesTip["level"], [string, string]> = { high: ["فوری", "bad"], mid: ["مهم", "warn"], low: ["بهبود", "info"] };

/** Top of the Sales tab: what to fix first, in order. */
export function SalesTips({ projectId, tips, croTargets, canEdit }: { projectId: string; tips: SalesTip[]; croTargets: { url: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState("");
  if (!tips.length) return null;

  async function croTop() {
    const targets = croTargets.slice(0, 3);
    if (!targets.length) return;
    if (!confirm(`توضیح این محصولات برای فروش بیشتر بازنویسی و روی سایت ثبت می‌شود:\n${targets.map((t) => `- ${t.name}`).join("\n")}\n\nادامه؟`)) return;
    let ok = 0; const errs: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      setBulk({ done: i, total: targets.length });
      try { await post(projectId, { action: "cro", url: targets[i].url }); ok++; }
      catch (e) { errs.push(`${targets[i].name}: ${e instanceof ApiError ? e.message : "خطا"}`); }
    }
    setBulk(null);
    setMsg(`${faNum(ok)} محصول بازنویسی و ثبت شد.${errs.length ? ` خطا: ${errs.join(" | ")}` : ""}`);
    router.refresh();
  }

  return (
    <section className="panel" style={{ marginBottom: 14 }} aria-labelledby="tips-h">
      <h3 id="tips-h">برای فروش بیشتر، به این ترتیب</h3>
      <ol className="sales-tips">
        {tips.map((t, i) => (
          <li key={i}>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`chip ${LEVEL[t.level][1]}`}>{LEVEL[t.level][0]}</span>
              <strong>{t.title}</strong>
            </div>
            <p className="muted small">{t.why}</p>
            <p className="small">{t.how}</p>
            {t.action?.kind === "link" && t.action.href && <Link className="btn sm" href={t.action.href}>{t.action.label}</Link>}
            {t.action?.kind === "cro_top" && canEdit && croTargets.length > 0 && (
              <button type="button" className="btn sm primary" disabled={!!bulk} onClick={croTop}>
                {bulk ? `در حال بازنویسی ${faNum(bulk.done + 1)} از ${faNum(bulk.total)}...` : t.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}
