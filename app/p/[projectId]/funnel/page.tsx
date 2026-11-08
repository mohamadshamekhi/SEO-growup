// Ported from public/app.js's tabSales() — read-focused for this pass (margin dropdowns,
// price-add form, cro/alternatives approve-reject actions are left for a follow-up; the data
// itself, which had zero frontend before, is now fully visible).
import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { rows, croList, tests, feedState, oosList, paidOos, restock } from "@/lib/funnel";
import { rollbacks, batches } from "@/lib/policy";
import { funnel as gaFunnel, getProperty, hasCartEvents, channels, tracking } from "@/lib/ga";
import { impactSummary } from "@/lib/growth";
import { rows as priceRows } from "@/lib/prices";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

function pathOf(u: string): string {
  try { return decodeURIComponent(u).replace(/^https?:\/\/[^/]+/, "") || "/"; } catch { return u; }
}
const n = (x: number | null) => (x == null ? "—" : faNum(x));
const IMPACT_NAME: Record<string, string> = { seo_title: "عنوان سئو", kw_title: "عنوان برای کلمه هدف", kw_description: "توضیح برای کلمه هدف", kw_faq: "پرسش‌های متداول", kw_refresh: "بازنویسی مقاله", internal_link: "لینک داخلی", brand: "برند", description: "توضیح محصول", meta_description: "توضیح متا", image_alt: "alt عکس", cro_description: "متن فروش", oos_links: "لینک جایگزین" };
const MARGIN: Record<string, string> = { high: "زیاد", normal: "معمولی", low: "کم" };
const PRICE_STATUS: Record<string, [string, string]> = { expensive: ["گران‌تر از ۱۰٪", "danger"], suspect: ["لینک مشکوک", "warn"], near: ["نزدیک به کمترین", "info"], cheapest: ["ارزان‌ترین", "ok"], unknown: ["نامعلوم", "info"] };
const VERD: Record<string, [string, string]> = { better: ["بهتر شد", "ok"], same: ["تغییر محسوسی نکرد", "info"], worse: ["بدتر شد", "danger"], little_data: ["داده کم", "info"] };
const TRACK: Record<string, [string, string]> = { ok: ["می‌رسد", "ok"], never: ["نرسیده", "danger"], stopped: ["قطع شده", "danger"] };

export default async function FunnelTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId: pid } = await params;
  const p = project(pid);
  if (!p) notFound();

  const allRows = rows(pid);
  const problems = allRows.filter((r) => r.stage);
  const shown = [...problems, ...allRows.filter((r) => !r.stage)].slice(0, 80);
  const cro = croList(pid);
  const t = tests(pid) as { url: string; days: number; views_before: number | null; units_before: number | null; views_after: number | null; units_after: number | null; verdict: string }[];
  const back = rollbacks(pid) as { url: string; reason: string; action: string }[];
  const feed = feedState(pid);
  const alt = oosList(pid);
  const paid = paidOos(pid);
  const stock = restock(pid);
  const gaConnected = !!Object.keys(gaFunnel(pid)).length;
  const gaProperty = !!getProperty(pid);
  const gaCarts = hasCartEvents(pid);
  const imp = impactSummary(pid);
  const ch = channels(pid);
  const track = tracking(pid);
  const prices = priceRows(pid);

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>فروش</h1></div></div>

      {!gaProperty && <div className="banner warn"><span className="grow">Analytics وصل نیست، پس بازدید و سبد خرید اینجا خالی است و تشخیص‌ها فقط از کلیک گوگل و فروش می‌آیند.</span></div>}
      {gaProperty && gaConnected && !gaCarts && <div className="banner warn"><span className="grow">Analytics وصل است ولی رویداد «افزودن به سبد» نمی‌رسد.</span></div>}
      {paid.length > 0 && <div className="banner warn"><span className="grow">{faNum(paid.length)} محصول ناموجود در ۲۸ روز گذشته {faNum(paid.reduce((a, r) => a + r.sessions, 0))} نشست پولی گرفته است.</span></div>}

      <section className="panel flush" style={{ marginBottom: 14 }}>
        <h3>قیف فروش محصولات <span className="count">{faNum(problems.length)} نیازمند توجه</span></h3>
        {shown.length ? (
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>محصول و تشخیص</th><th>موجودی</th><th className="num">بازدید</th><th className="num">سبد</th><th className="num">فروش</th><th className="num">کلیک گوگل</th><th className="num">جایگاه</th><th>سود</th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "normal", minWidth: 240 }}>
                      <a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                      {r.stage && <><div className="small"><strong>{r.stage_label}</strong></div><div className="muted small">{r.advice}</div></>}
                    </td>
                    <td>{r.available == null ? <span className="muted">نامعلوم</span> : r.available ? <span className="chip ok">موجود</span> : <span className="chip danger">ناموجود</span>}</td>
                    <td className="num">{n(r.views)}</td>
                    <td className="num">{n(r.carts)}</td>
                    <td className="num">{faNum(r.units)}</td>
                    <td className="num">{faNum(r.clicks)}</td>
                    <td className="num">{r.position ? faNum(r.position, 1) : "—"}</td>
                    <td>{MARGIN[r.margin]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state"><h2>هنوز محصولی شناخته نشده</h2><p>بعد از خواندن کاتالوگ، قیف هر محصول اینجا می‌آید.</p></div>}
      </section>

      {stock.length > 0 && (
        <section className="panel flush" style={{ marginBottom: 14 }}>
          <h3>فهرست خرید موجودی <span className="count">{faNum(stock.length)}</span></h3>
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>محصول</th><th className="num">ورودی</th><th className="num">ورودی پولی</th><th className="num">بازدید</th><th className="num">نمایش گوگل</th><th className="num">کلیک گوگل</th><th className="num">فروش</th><th>سود</th></tr></thead>
              <tbody>
                {stock.map((r, i) => (
                  <tr key={i}>
                    <td><a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a></td>
                    <td className="num">{faNum(r.sessions)}</td>
                    <td className="num">{r.paid ? <span className="chip warn">{faNum(r.paid)}</span> : faNum(0)}</td>
                    <td className="num">{n(r.views)}</td>
                    <td className="num">{faNum(r.impressions)}</td>
                    <td className="num">{faNum(r.clicks)}</td>
                    <td className="num">{faNum(r.units)}</td>
                    <td>{MARGIN[r.margin]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ch.length > 0 && (() => {
        const total = ch.reduce((a, c) => a + c.sessions, 0);
        return (
          <section className="panel" style={{ marginBottom: 14 }}>
            <h3>ورودی سایت از کجاست</h3>
            <ul className="plain-list">
              {ch.map((c, i) => (
                <li key={i} className="channel-row">
                  <span className="channel-name">{c.channel}</span>
                  <span className="channel-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round((c.sessions / total) * 100))}%` }} /></span>
                  <span className="small">{faNum(c.sessions)} ({faNum(Math.round((c.sessions / total) * 100))}٪)</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {track.length > 0 && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <h3>سلامت ردیابی</h3>
          <ul className="plain-list">
            {track.map((tr, i) => (
              <li key={i} className="channel-row">
                <span className="channel-name">{tr.label}</span>
                <span className={`chip ${TRACK[tr.status]?.[1] || "info"}`}>{TRACK[tr.status]?.[0] || tr.status}</span>
                <span className="small muted">{faNum(tr.total)} بار</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {prices.length > 0 && (
        <section className="panel flush" style={{ marginBottom: 14 }}>
          <h3>مقایسه قیمت در ترب <span className="count">{faNum(prices.length)}</span></h3>
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>محصول</th><th className="num">قیمت تو</th><th className="num">کمترین ترب</th><th className="num">بیشترین ترب</th><th>اختلاف</th><th>وضعیت</th></tr></thead>
              <tbody>
                {prices.map((r, i) => (
                  <tr key={i}>
                    <td><a href={r.torob_url} target="_blank" rel="noopener noreferrer">{r.name}</a>{r.available === 0 && <span className="chip danger"> ناموجود</span>}</td>
                    <td className="num">{r.own == null ? "—" : faNum(r.own)}</td>
                    <td className="num">{r.low == null ? "—" : faNum(r.low)}</td>
                    <td className="num">{r.high == null ? "—" : faNum(r.high)}</td>
                    <td>{r.gap == null ? "—" : <span className="ltr">{r.gap > 0 ? "+" : ""}{faNum(r.gap)}٪</span>}</td>
                    <td><span className={`chip ${PRICE_STATUS[r.status][1]}`}>{PRICE_STATUS[r.status][0]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {imp.length > 0 && (
        <section className="panel flush" style={{ marginBottom: 14 }}>
          <h3>اثر تغییرهای ثبت‌شده</h3>
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>نوع تغییر</th><th className="num">تعداد</th><th className="num">بهتر</th><th className="num">بدون تغییر</th><th className="num">بدتر</th><th className="num">داده کم</th></tr></thead>
              <tbody>
                {imp.map((g, i) => (
                  <tr key={i}>
                    <td>{IMPACT_NAME[g.type] || g.type}</td>
                    <td className="num">{faNum(g.changes)}</td>
                    <td className="num">{faNum(g.better)}</td>
                    <td className="num">{faNum(g.same)}</td>
                    <td className="num">{faNum(g.worse)}</td>
                    <td className="num">{faNum(g.little_data)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batches(pid).length > 0 && (
            <ul className="plain-list" style={{ padding: "6px 16px 12px" }}>
              {(batches(pid) as { day: string; count: number }[]).map((b, i) => (
                <li key={i} className="channel-row"><span className="channel-name">{b.day}</span><span className="grow small muted">{faNum(b.count)} تغییر فعال</span></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {t.length > 0 && (
        <section className="panel flush" style={{ marginBottom: 14 }}>
          <h3>نتیجه تغییر متن‌ها</h3>
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>صفحه</th><th>بازه</th><th>بازدید قبل ← بعد</th><th>فروش قبل ← بعد</th><th>نتیجه</th></tr></thead>
              <tbody>
                {t.map((x, i) => (
                  <tr key={i}>
                    <td className="mono small" style={{ whiteSpace: "normal" }}>{pathOf(x.url)}</td>
                    <td>{faNum(x.days)} روز</td>
                    <td>{n(x.views_before)} ← {n(x.views_after)}</td>
                    <td>{n(x.units_before)} ← {n(x.units_after)}</td>
                    <td><span className={`chip ${VERD[x.verdict]?.[1] || "info"}`}>{VERD[x.verdict]?.[0] || x.verdict}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {back.length > 0 && (
        <section className="panel flush" style={{ marginBottom: 14 }}>
          <h3>تغییرهایی که افت داشتند</h3>
          <ul className="plain-list" style={{ padding: "0 16px 12px" }}>
            {back.map((r, i) => (
              <li key={i}>
                <span className="grow"><span className="mono small">{pathOf(r.url)}</span><div className="muted small">{r.reason}</div></span>
                <span className={`chip ${r.action === "undone" ? "ok" : r.action === "alert" ? "warn" : "danger"}`}>{r.action === "undone" ? "برگشت داده شد" : r.action === "alert" ? "فقط هشدار" : "برگشت ناموفق"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(cro.length > 0 || alt.length > 0) && (
        <section className="panel flush" style={{ marginBottom: 14 }}>
          <h3>پیشنهادهای منتظر تأیید <span className="count">{faNum(cro.length + alt.length)}</span></h3>
          {cro.map((r, i) => (
            <details className="cro-item" key={`cro-${i}`}>
              <summary><span className="mono small">{pathOf(r.url)}</span>{r.apply_error && <span className="chip danger">{r.apply_error}</span>}</summary>
              <div className="cro-compare">
                <div><h4>الان</h4><p className="small">{r.current || <span className="muted">خالی</span>}</p></div>
                <div><h4>پیشنهاد</h4><p className="small">{r.proposed}</p></div>
              </div>
            </details>
          ))}
          {alt.map((r, i) => (
            <div className="cro-item" key={`alt-${i}`}>
              <div className="small"><strong>{r.name}</strong>{r.apply_error && <span className="chip danger"> {r.apply_error}</span>}</div>
              <ul className="small" style={{ margin: "6px 0" }}>{r.alternatives.map((a, ai) => <li key={ai}>{a}</li>)}</ul>
            </div>
          ))}
        </section>
      )}

      <section className="panel" style={{ marginBottom: 14 }}>
        <h3>فید محصولات</h3>
        <p className="muted small">{faNum(feed.ready)} از {faNum(feed.total)} محصول قیمت و موجودی خوانا دارند.</p>
        {feed.token ? (
          <>
            <p className="small">Google Merchant: <span className="mono ltr">/feed/{feed.token}/google.xml</span></p>
            <p className="small">فرمت عمومی JSON: <span className="mono ltr">/feed/{feed.token}/products.json</span></p>
          </>
        ) : <p className="muted small">هنوز فیدی ساخته نشده.</p>}
      </section>
    </div>
  );
}
