// Phase 0 placeholder — proves the stack end-to-end (server.ts -> Next -> DB) without any
// real feature yet. Phase 1 replaces this with the login/projects-picker page per the plan.
import { one } from "@/lib/db";
import { formatJalali, icuSmokeTest } from "@/lib/intl/jalali";
import { faNum } from "@/lib/intl/fa";

// Every real page in this app is session/DB-driven, so force dynamic rendering rather than
// letting Next statically prerender a snapshot at build time — set this per-page from here on.
export const dynamic = "force-dynamic";

export default function Home() {
  const row = one<{ n: number }>("SELECT COUNT(*) as n FROM projects");
  const icu = icuSmokeTest();
  return (
    <main style={{ padding: 32, fontFamily: "Vazirmatn, sans-serif" }}>
      <h1>Growth Hub — فاز ۰</h1>
      <p>پروژه‌های موجود در دیتابیس: {faNum(row?.n ?? 0)}</p>
      <p>
        تاریخ جلالی امروز: {formatJalali(Date.now())} ({icu.ok ? "تقویم جلالی فعال است" : `⚠️ تقویم جلالی غیرفعال، calendar=${icu.calendar}`})
      </p>
    </main>
  );
}
