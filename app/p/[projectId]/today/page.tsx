import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { suggestions, list } from "@/lib/growth-actions";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { jalaliYmd } from "@/lib/intl/jalali";
import { TodayClient } from "./today-client";

export const dynamic = "force-dynamic";

function todayFa(): string {
  return jalaliYmd(Date.now()).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export default async function TodayTab({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string; a?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const p = project(projectId);
  if (!p) notFound();
  const user = await currentUser();
  const r = user ? role(user, projectId) : null;
  const today = todayFa();
  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>امروز چه کنم</h1></div></div>
      <p className="page-note">{today} · کارهایی که بیشترین اثر را روی رشد سایت، پیج و فروش دارند؛ از سئو و محتوا تا اینستاگرام، کمپین و رقبا. «انجامش بده» پیش‌نویس آماده می‌سازد؛ هیچ چیز بدون تأیید شما منتشر نمی‌شود.</p>
      <TodayClient projectId={projectId} suggestions={suggestions(p)} actions={list(projectId)} canEdit={r === "admin" || r === "editor"} initialTab={sp.tab || (sp.a ? "doing" : "todo")} openId={sp.a ? Number(sp.a) : null} />
    </div>
  );
}
