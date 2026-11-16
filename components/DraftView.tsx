"use client";
// Renders any growth-action draft (landing/optimize/refresh/social/merge JSON from the AI) as a
// readable brief, with copy buttons. Unknown keys are ignored; nothing here writes anywhere.
import { useState } from "react";

type D = Record<string, unknown>;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function Copy({ text, label = "کپی" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* blocked */ } }}>
      {ok ? "کپی شد" : label}
    </button>
  );
}

export function draftText(d: D): string {
  const L: string[] = [];
  const add = (k: string, v: unknown) => { if (str(v)) L.push(`${k}: ${str(v)}`); };
  add("عنوان سئو", d.title); add("توضیح متا", d.meta); add("H1", d.h1); add("آدرس", d.slug); add("مقدمه", d.intro);
  add("علت", d.why_not_ranking || d.why_dropped);
  for (const s of [...arr<{ h2: string; points: string[] }>(d.sections), ...arr<{ h2: string; points: string[] }>(d.add_sections)]) L.push(`## ${s.h2}`, ...arr<string>(s.points).map((p) => `- ${p}`));
  if (arr(d.update).length) L.push("به‌روزرسانی‌ها:", ...arr<string>(d.update).map((p) => `- ${p}`));
  if (arr(d.faq).length) L.push("پرسش‌های متداول:", ...arr<{ q: string; a: string }>(d.faq).map((f) => `س: ${f.q}\nج: ${f.a}`));
  if (arr(d.internal_links).length) L.push("لینک داخلی:", ...arr<{ url?: string; from_url?: string; anchor: string }>(d.internal_links).map((l) => `- ${l.anchor} ← ${decodeURIComponent(l.url || l.from_url || "")}`));
  add("قالب", d.format); add("هوک", d.hook); add("کپشن", d.caption);
  if (arr(d.slides).length) L.push("اسلایدها:", ...arr<string>(d.slides).map((s, i) => `${i + 1}. ${s}`));
  if (arr(d.reel_script).length) L.push("سناریو ریل:", ...arr<{ sec: string; shot: string; voice: string; text: string }>(d.reel_script).map((r) => `${r.sec}: ${r.shot} | صدا: ${r.voice} | متن: ${r.text}`));
  add("دعوت به اقدام", d.cta); if (arr(d.hashtags).length) L.push(arr<string>(d.hashtags).join(" "));
  add("زمان انتشار", d.best_time); add("صفحه اصلی", d.keep);
  if (arr(d.steps).length) L.push("قدم‌ها:", ...arr<string>(d.steps).map((s, i) => `${i + 1}. ${s}`));
  if (arr(d.redirects).length) L.push("ریدایرکت‌ها:", ...arr<{ from: string; to: string }>(d.redirects).map((r) => `${decodeURIComponent(r.from)} → ${decodeURIComponent(r.to)}`));
  if (arr(d.checklist).length) L.push("چک‌لیست:", ...arr<string>(d.checklist).map((c) => `- ${c}`));
  add("یادداشت", d.note);
  return L.join("\n");
}

export function DraftView({ draft: d }: { draft: D }) {
  const sections = [...arr<{ h2: string; points: string[] }>(d.sections), ...arr<{ h2: string; points: string[] }>(d.add_sections)];
  const fields: [string, unknown][] = [["عنوان سئو", d.title], ["توضیح متا", d.meta], ["H1", d.h1], ["آدرس پیشنهادی", d.slug], ["قالب", d.format], ["هوک", d.hook], ["زمان انتشار", d.best_time], ["صفحه اصلی", d.keep]];
  return (
    <div className="draft">
      {str(d.note) && <p className="small">{str(d.note)}</p>}
      {fields.filter(([, v]) => str(v)).length > 0 && (
        <dl className="draft-fields">
          {fields.filter(([, v]) => str(v)).map(([k, v]) => (
            <div key={k}><dt>{k}{(k === "عنوان سئو" || k === "توضیح متا") && <span className="muted small"> ({str(v).length} کاراکتر)</span>}</dt><dd className={k === "آدرس پیشنهادی" || k === "صفحه اصلی" ? "ltr mono" : ""}>{str(v)}</dd></div>
          ))}
        </dl>
      )}
      {str(d.why_not_ranking || d.why_dropped) && <p className="small"><span className="muted">علت: </span>{str(d.why_not_ranking || d.why_dropped)}</p>}
      {str(d.intro) && <p className="small">{str(d.intro)}</p>}
      {sections.length > 0 && <div className="draft-block"><h4>ساختار تیترها</h4>{sections.map((s, i) => <div key={i}><strong>{s.h2}</strong><ul className="plan-list">{arr<string>(s.points).map((p, j) => <li key={j}>{p}</li>)}</ul></div>)}</div>}
      {arr(d.update).length > 0 && <div className="draft-block"><h4>به‌روزرسانی‌ها</h4><ul className="plan-list">{arr<string>(d.update).map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      {str(d.caption) && <div className="draft-block"><div className="row" style={{ justifyContent: "space-between" }}><h4>کپشن</h4><Copy text={[str(d.hook), str(d.caption), str(d.cta), arr<string>(d.hashtags).join(" ")].filter(Boolean).join("\n\n")} label="کپی کپشن" /></div><p className="plan-copy small">{str(d.caption)}</p>{str(d.cta) && <p className="small"><span className="muted">دعوت به اقدام: </span>{str(d.cta)}</p>}{arr(d.hashtags).length > 0 && <p className="small ltr">{arr<string>(d.hashtags).join(" ")}</p>}</div>}
      {arr(d.slides).length > 0 && <div className="draft-block"><h4>اسلایدها</h4><ol className="plan-list">{arr<string>(d.slides).map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
      {arr(d.reel_script).length > 0 && (
        <div className="draft-block"><h4>سناریو ریل</h4>
          <div className="table-wrap"><table><thead><tr><th>ثانیه</th><th>تصویر</th><th>صدا</th><th>متن روی صفحه</th></tr></thead>
            <tbody>{arr<{ sec: string; shot: string; voice: string; text: string }>(d.reel_script).map((r, i) => <tr key={i}><td className="nowrap">{r.sec}</td><td>{r.shot}</td><td>{r.voice}</td><td>{r.text}</td></tr>)}</tbody></table></div>
        </div>
      )}
      {arr(d.faq).length > 0 && <div className="draft-block"><h4>پرسش‌های متداول</h4>{arr<{ q: string; a: string }>(d.faq).map((f, i) => <p key={i} className="small"><strong>{f.q}</strong><br />{f.a}</p>)}</div>}
      {arr(d.internal_links).length > 0 && <div className="draft-block"><h4>لینک داخلی</h4><ul className="plan-list">{arr<{ url?: string; from_url?: string; anchor: string }>(d.internal_links).map((l, i) => <li key={i}>«{l.anchor}» ← <span className="ltr mono small">{decodeURIComponent(l.url || l.from_url || "")}</span></li>)}</ul></div>}
      {arr(d.steps).length > 0 && <div className="draft-block"><h4>قدم‌ها</h4><ol className="plan-list">{arr<string>(d.steps).map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
      {arr(d.redirects).length > 0 && <div className="draft-block"><h4>ریدایرکت ۳۰۱</h4><ul className="plan-list ltr mono small">{arr<{ from: string; to: string }>(d.redirects).map((r, i) => <li key={i}>{decodeURIComponent(r.from)} → {decodeURIComponent(r.to)}</li>)}</ul></div>}
      {arr(d.checklist).length > 0 && <div className="draft-block"><h4>چک‌لیست</h4><ul className="plan-list">{arr<string>(d.checklist).map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      {draftText(d) && <div style={{ marginTop: 8 }}><Copy text={draftText(d)} label="کپی کل پیش‌نویس" /></div>}
    </div>
  );
}
