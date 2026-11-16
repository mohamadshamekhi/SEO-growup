"use client";
import { useState } from "react";
import type { CampaignPlan } from "@/lib/campaign-plan";

/** Plain-text version of the whole brief, for pasting into a doc or sending to the team. */
export function planText(name: string, p: CampaignPlan): string {
  const L: string[] = [`برنامه کمپین: ${name}`, "", "شرح کامل", p.overview, "", `چرا الان: ${p.why_now}`, `ایده محوری: ${p.big_idea}`, `پیام اصلی: ${p.key_message}`, `پیشنهاد به مشتری: ${p.offer}`, "", "مخاطب"];
  p.audience.forEach((a) => L.push(`- ${a.segment}: ${a.need} | تردید: ${a.objection}`));
  L.push("", "استوری‌لاین");
  p.storyline.forEach((x, i) => L.push(`${i + 1}. ${x.phase} (${x.when}) — ${x.title}`, `   ${x.story}`, `   حس: ${x.feeling}`));
  L.push("", "روند اجرا");
  p.timeline.forEach((t) => L.push(`${t.when} | ${t.stage} | مسئول: ${t.owner} | کانال: ${t.channels.join("، ")}`, ...t.actions.map((a) => `   - ${a}`), ...(t.deliverables.length ? [`   خروجی: ${t.deliverables.join("، ")}`] : [])));
  L.push("", "محصولات کمپین");
  p.products.forEach((x) => L.push(`- ${x.name} [${x.role}] ${decodeURIComponent(x.url)}`, `   چرا: ${x.why}`, `   زاویه تبلیغ: ${x.angle}`));
  L.push("", "محتوای آماده");
  p.content.forEach((x) => L.push(`- ${x.channel} / ${x.format} (${x.when})`, `   هوک: ${x.hook}`, `   متن: ${x.copy}`, `   دعوت به اقدام: ${x.cta}`));
  L.push("", "شاخص‌ها");
  p.kpis.forEach((k) => L.push(`- ${k.metric}: ${k.target} (${k.how})`));
  L.push("", "چک‌لیست قبل از شروع", ...p.checklist.map((c) => `- ${c}`), "", "ریسک‌ها");
  p.risks.forEach((r) => L.push(`- ${r.risk} → ${r.mitigation}`));
  return L.join("\n");
}

function CopyBtn({ text, label = "کپی متن" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* blocked */ } }}>
      {done ? "کپی شد" : label}
    </button>
  );
}

export function PlanView({ plan: p }: { plan: CampaignPlan }) {
  return (
    <div className="plan">
      <section>
        <h3>شرح کامل</h3>
        {p.overview.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
        <div className="plan-facts">
          {p.big_idea && <div><span>ایده محوری</span><strong>{p.big_idea}</strong></div>}
          {p.key_message && <div><span>پیام اصلی</span><strong>{p.key_message}</strong></div>}
          {p.offer && <div><span>پیشنهاد به مشتری</span><strong>{p.offer}</strong></div>}
          {p.why_now && <div><span>چرا الان</span><strong>{p.why_now}</strong></div>}
        </div>
      </section>

      {p.audience.length > 0 && (
        <section>
          <h3>مخاطب</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>بخش مخاطب</th><th>نیاز و انگیزه</th><th>تردید و جواب ما</th></tr></thead>
            <tbody>{p.audience.map((a, i) => <tr key={i}><td><strong>{a.segment}</strong></td><td>{a.need}</td><td>{a.objection}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      {p.storyline.length > 0 && (
        <section>
          <h3>استوری‌لاین</h3>
          <ol className="plan-story">
            {p.storyline.map((x, i) => (
              <li key={i}>
                <div className="plan-story-head"><span className="chip">{x.phase}</span><strong>{x.title}</strong><span className="muted small">{x.when}</span></div>
                <p>{x.story}</p>
                {x.feeling && <p className="muted small">حسی که می‌سازد: {x.feeling}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {p.timeline.length > 0 && (
        <section>
          <h3>روند اجرا</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>زمان</th><th>مرحله</th><th>کارها</th><th>کانال</th><th>مسئول</th><th>خروجی</th></tr></thead>
            <tbody>
              {p.timeline.map((t, i) => (
                <tr key={i}>
                  <td className="nowrap">{t.when}</td>
                  <td><strong>{t.stage}</strong></td>
                  <td><ul className="plan-list">{t.actions.map((a, j) => <li key={j}>{a}</li>)}</ul></td>
                  <td>{t.channels.join("، ")}</td>
                  <td>{t.owner}</td>
                  <td>{t.deliverables.join("، ")}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      {p.products.length > 0 && (
        <section>
          <h3>محصولات کمپین</h3>
          <div className="plan-products">
            {p.products.map((x) => (
              <article key={x.url} className="plan-product">
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <a href={x.url} target="_blank" rel="noreferrer"><strong>{x.name}</strong></a>
                  <span className="chip">{x.role}</span>
                </div>
                <p><span className="muted">چرا این محصول: </span>{x.why}</p>
                <p><span className="muted">زاویه تبلیغ: </span>{x.angle}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {p.content.length > 0 && (
        <section>
          <h3>محتوای آماده</h3>
          <div className="plan-content">
            {p.content.map((x, i) => (
              <article key={i} className="plan-piece">
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div className="row" style={{ gap: 6 }}><span className="chip">{x.channel}</span><span className="chip">{x.format}</span><span className="muted small">{x.when}</span></div>
                  <CopyBtn text={[x.hook, x.copy, x.cta].filter(Boolean).join("\n\n")} />
                </div>
                {x.hook && <p className="plan-hook">{x.hook}</p>}
                <p className="plan-copy">{x.copy}</p>
                {x.cta && <p><span className="muted">دعوت به اقدام: </span>{x.cta}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      {p.kpis.length > 0 && (
        <section>
          <h3>شاخص‌های موفقیت</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>شاخص</th><th>هدف پیشنهادی</th><th>چطور اندازه بگیریم</th></tr></thead>
            <tbody>{p.kpis.map((k, i) => <tr key={i}><td><strong>{k.metric}</strong></td><td>{k.target}</td><td>{k.how}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      {(p.checklist.length > 0 || p.risks.length > 0) && (
        <section className="plan-two">
          {p.checklist.length > 0 && (
            <div><h3>چک‌لیست قبل از شروع</h3><ul className="plan-list">{p.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
          )}
          {p.risks.length > 0 && (
            <div><h3>ریسک‌ها و راه کنترل</h3><ul className="plan-list">{p.risks.map((r, i) => <li key={i}><strong>{r.risk}</strong> — {r.mitigation}</li>)}</ul></div>
          )}
        </section>
      )}
      <p className="muted small">اعداد هدف، تخفیف و پیشنهادها اولیه‌اند و باید تیم تأییدشان کند؛ قیمت و موجودی را قبل از انتشار از سایت چک کنید.</p>
    </div>
  );
}
