// Global, all-projects panel settings — the "تنظیمات کلی پنل" the dashboard onboarding hint
// points to for the Google service-account key. Separate from /p/[id]/settings (per-project).
// Admin-only. Backed by the already-existing /api/settings + /api/settings/gsc-key routes.
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/server/current-user";
import { getSetting, q } from "@/lib/db";
import { keyInfo } from "@/lib/gsc";
import { faNum } from "@/lib/intl/fa";
import { formatJalaliDateTime } from "@/lib/intl/jalali";
import { PanelSettingsClient } from "./panel-settings-client";

export const dynamic = "force-dynamic";

export default async function GlobalSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.is_admin) redirect("/");

  const agents = q<{ id: number; name: string; last_seen: number | null }>("SELECT id, name, last_seen FROM agent_tokens ORDER BY id");

  return (
    <div className="picker">
      <div className="picker-top">
        <Link href="/">همه پروژه‌ها</Link>
      </div>
      <div className="page-head" style={{ padding: 0, border: 0 }}>
        <div className="head-title"><h1>تنظیمات کلی پنل</h1></div>
      </div>
      <PanelSettingsClient
        initialKey={keyInfo()}
        initialPagespeed={!!getSetting("pagespeed_key", "")}
        agents={agents.map((a) => ({ ...a, last_seen_fa: a.last_seen ? formatJalaliDateTime(a.last_seen * 1000) : "—" }))}
        agentsCount={faNum(agents.length)}
      />
    </div>
  );
}
