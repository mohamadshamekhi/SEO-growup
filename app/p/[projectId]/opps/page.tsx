// Ported from public/app.js's tabOpps() — same content, no sub-tab JS interactivity
// (sections just stack). Admin-only, matching Python's role gate.
import { notFound, redirect } from "next/navigation";
import { project } from "@/lib/projects";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { state as oppsState } from "@/lib/opps";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

function pathOf(u: string): string {
  try { return decodeURIComponent(u).replace(/^https?:\/\/[^/]+/, "") || "/"; } catch { return u; }
}
const pos = (x: number | null) => (x == null ? "—" : faNum(x, 1));
const DEM: Record<string, [string, string]> = { none: ["محصولی پیدا نشد", "danger"], out_of_stock: ["فقط ناموجود", "warn"] };

export default async function OppsTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const user = (await currentUser())!;
  if (role(user, projectId) !== "admin") redirect(`/p/${projectId}/dash`);

  const d = oppsState(p);
  const g = d.digest;

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>فرصت‌ها</h1></div></div>
      <p className="page-note">این بخش از داده موجود خوانده می‌شود و چیزی را در سایت تغییر نمی‌دهد. گوگل جستجوهای کم‌تکرار را پنهان می‌کند، پس فهرست‌ها کامل نیستند.</p>

      <section className="panel" style={{ marginBottom: 14 }}>
        <h3>۳ کار مهم هفته بعد</h3>
        {g.actions.length ? <ol className="digest-actions">{g.actions.map((a, i) => <li key={i}>{a}</li>)}</ol> : <p className="muted">این هفته کار فوری‌ای پیدا نشد.</p>}
      </section>

      <div className="digest-grid" style={{ marginBottom: 14 }}>
        <section className="panel">
          <h3>کلیک گوگل در ۷ روز</h3>
          <p className="digest-num">{g.clicks == null ? "—" : faNum(g.clicks)}</p>
          <p className="muted small">{g.clicks_before == null ? "هفته قبل داده کافی نیست" : `هفته قبل: ${faNum(g.clicks_before)}`}؛ داده گوگل حدود ۳ روز عقب است.</p>
        </section>
        <section className="panel">
          <h3>تغییرهای این هفته</h3>
          <p className="digest-num">{faNum(g.total_changes)}</p>
          <p className="muted small">{g.changes.slice(0, 4).map((c) => `${c.type}: ${c.n}`).join("، ") || "تغییری ثبت نشده"}</p>
        </section>
        <section className="panel">
          <h3>نتیجه سنجش این هفته</h3>
          <p className="digest-num">{faNum((g.verdicts.better || 0) + (g.verdicts.same || 0) + (g.verdicts.worse || 0))}</p>
          <p className="muted small">بهتر {faNum(g.verdicts.better || 0)}، بدون تغییر {faNum(g.verdicts.same || 0)}، بدتر {faNum(g.verdicts.worse || 0)}</p>
        </section>
        <section className="panel">
          <h3>ورودی پولی روی ناموجود</h3>
          <p className="digest-num">{faNum(g.paid_sessions)}</p>
          <p className="muted small">روی {faNum(g.paid_oos)} محصول در ۲۸ روز گذشته</p>
        </section>
      </div>

      {g.restock.length > 0 && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <h3>پرتقاضاترین ناموجودها</h3>
          <ul className="small" style={{ margin: 0 }}>{g.restock.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}

      <section className="panel flush" style={{ marginBottom: 14 }}>
        <h3>صفحه‌هایی که با هم رقابت می‌کنند <span className="count">{faNum(d.cannibals.length)}</span></h3>
        {d.cannibals.length ? (
          <>
            <p className="muted small" style={{ padding: "0 16px" }}>گوگل برای یک جستجو چند صفحه تو را نشان داده است. صفحه اصلی از روی کلیک، نمایش و جایگاه ۲۸ روز پیشنهاد شده و بهتر است قبل از ادغام یک بار بررسی شود.</p>
            {d.cannibals.map((c, i) => (
              <div className="cro-item" key={i}>
                <div className="small"><strong>{c.queries.slice(0, 3).map((q) => q.query).join("، ")}</strong> <span className="muted">{faNum(c.impressions)} نمایش</span></div>
                <ul className="plain-list small" style={{ marginTop: 6 }}>
                  <li><span className="chip ok">صفحه اصلی</span> <span className="mono">{pathOf(c.primary.url)}</span> <span className="muted">جایگاه {pos(c.primary.position)}، {faNum(c.primary.impressions)} نمایش</span></li>
                  {c.others.map((o, oi) => <li key={oi}><span className="chip warn">رقیب</span> <span className="mono">{pathOf(o.url)}</span> <span className="muted">جایگاه {pos(o.position)}، {faNum(o.impressions)} نمایش</span></li>)}
                </ul>
              </div>
            ))}
          </>
        ) : <div className="empty-state"><h2>رقابتی پیدا نشد</h2><p>وقتی گوگل برای یک جستجو چند صفحه تو را نشان بدهد، اینجا می‌آید.</p></div>}
      </section>

      <section className="panel flush" style={{ marginBottom: 14 }}>
        <h3>صفحه‌های دسته‌بندی <span className="count">{faNum(d.categories.length)}</span></h3>
        {d.categories.length ? (
          <>
            <p className="muted small" style={{ padding: "0 16px" }}>از آخرین ممیزی و Search Console. پنل نمی‌تواند این صفحه‌ها را تغییر بدهد و رفعشان کار برنامه‌نویس است.</p>
            <div className="table-wrap plain">
              <table>
                <thead><tr><th>صفحه و ایراد</th><th className="num">کلمه</th><th className="num">نمایش</th><th className="num">کلیک</th><th className="num">جایگاه</th><th>جستجوی اصلی</th></tr></thead>
                <tbody>
                  {d.categories.map((r, i) => (
                    <tr key={i}>
                      <td><span className="mono small">{pathOf(r.url)}</span>{r.issues.length > 0 && <div className="small muted">{r.issues.join("؛ ")}</div>}</td>
                      <td className="num">{faNum(r.words || 0)}</td>
                      <td className="num">{faNum(r.impressions)}</td>
                      <td className="num">{faNum(r.clicks)}</td>
                      <td className="num">{pos(r.position)}</td>
                      <td className="small">{r.queries.join("، ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <div className="empty-state"><h2>هنوز صفحه دسته‌ای خوانده نشده</h2><p>بعد از ممیزی فنی، دسته‌ها اینجا می‌آیند.</p></div>}
      </section>

      <section className="panel flush">
        <h3>جستجوهایی که محصول موجود ندارند <span className="count">{faNum(d.demand.length)}</span></h3>
        {d.demand.length ? (
          <>
            <p className="muted small" style={{ padding: "0 16px" }}>تطبیق بر اساس کلمات نام محصول است و تقریبی است. قبل از خرید کالا یک بار جستجو را بررسی کن. جستجوهای آموزشی و نام خود سایت حذف شده‌اند.</p>
            <div className="table-wrap plain">
              <table>
                <thead><tr><th>جستجو</th><th className="num">نمایش</th><th className="num">کلیک</th><th className="num">جایگاه</th><th>وضعیت</th></tr></thead>
                <tbody>
                  {d.demand.map((r, i) => (
                    <tr key={i}>
                      <td>{r.query}{r.example && <div className="small muted">{r.example}</div>}</td>
                      <td className="num">{faNum(r.impressions)}</td>
                      <td className="num">{faNum(r.clicks)}</td>
                      <td className="num">{pos(r.position)}</td>
                      <td><span className={`chip ${DEM[r.status][1]}`}>{DEM[r.status][0]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <div className="empty-state"><h2>موردی پیدا نشد</h2><p>جستجویی که محصول موجود نداشته باشد اینجا می‌آید.</p></div>}
      </section>
    </div>
  );
}
