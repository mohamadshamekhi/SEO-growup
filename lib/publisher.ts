// Ported 1:1 from hub/publisher.py. What happens after something is written: an article goes
// to the site as an unpublished draft, the team gets a Telegram message. Runs for everything
// that reaches review. It never publishes; publishing stays a person's decision in the back
// office (hub/prepublish.py's publish(), in lib/prepublish.ts).
//
// This whole module sends real Telegram messages and pushes real article drafts to the live
// site. Ported, type-checked and built, but — same caution as lib/adapters.ts's apply()/
// undo() and lib/prices.ts's check() — never invoked against the real site/bot from here
// without the user's explicit go-ahead each time.
//
import fs from "node:fs";
import path from "node:path";
import * as adapters from "./adapters";
import { catalogRows } from "./catalog";
import type { ContentRow } from "./content";
import { get as getContent } from "./content";
import { DATA_DIR, getSetting, now as dbNow, q, run, setSetting } from "./db";
import { renderImage } from "./tools";
import * as planner from "./planner";
import type { ProjectRow } from "./projects";
import { proxiedFetch } from "./google-proxy";

const MAX_TRIES = 5;
const TG_API = (process.env.HUB_TELEGRAM_API || "https://api.telegram.org").replace(/\/+$/, "");
// Same limits as the team group has always had: no file paths or commands, no questions asked of the team.
const FORBIDDEN = /(data\/|\.md\b|\.py\b|python3|\/Users\/|\.env|تأیید می‌کنید|تایید می‌کنید|موافقید|کدام را)/;

export function getPublish(pid: string) {
  return { auto_draft: true, telegram: true, ...getSetting<{ auto_draft?: boolean; telegram?: boolean }>(`publish:${pid}`, {}) };
}

export function savePublish(pid: string, b: { auto_draft?: unknown; telegram?: unknown }) {
  setSetting(`publish:${pid}`, { auto_draft: !!b.auto_draft, telegram: !!b.telegram });
}

// ---------- telegram ----------
type TgConfig = { token: string; chat: string; mention_site?: string; mention_ig?: string; alerts?: boolean; reports?: boolean };

function tgFile(pid: string): string {
  return path.join(DATA_DIR, "keys", `telegram_${pid}.json`);
}

export function tgConfig(pid: string): TgConfig | null {
  const f = tgFile(pid);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

export function tgPublic(pid: string) {
  const c = tgConfig(pid);
  if (!c) return null;
  return { chat: c.chat, mention_site: c.mention_site || "", mention_ig: c.mention_ig || "", alerts: !!c.alerts, reports: !!c.reports, last_error: getSetting(`tg_error:${pid}`, "") };
}

export function tgSave(pid: string, token: string, chat: string, mentionSite = "", mentionIg = "", alerts = false, reports = false) {
  const cur = tgConfig(pid) || ({} as Partial<TgConfig>);
  token = String(token || "").trim() || cur.token || "";
  chat = String(chat || "").trim();
  if (!token || !chat) throw new Error("توکن ربات و شناسه چت لازم است");
  const f = tgFile(pid);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ token, chat, mention_site: String(mentionSite || "").trim(), mention_ig: String(mentionIg || "").trim(), alerts: !!alerts, reports: !!reports }), { mode: 0o600 });
}

export function tgRemove(pid: string) {
  const f = tgFile(pid);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

export async function tgSend(pid: string, text: string, topic: "site" | "instagram" = "site") {
  const c = tgConfig(pid);
  if (!c) throw new Error("تلگرام این پروژه تنظیم نشده");
  if (FORBIDDEN.test(text)) throw new Error("متن پیام مجاز نیست");
  const mention = (topic === "instagram" ? c.mention_ig : c.mention_site) || "";
  await post(c, c.chat, mention ? `${mention}\n${text}` : text);
}

async function post(c: TgConfig, chat: string, msg: string) {
  for (let i = 0; i < msg.length; i += 3900) {
    const body = JSON.stringify({ chat_id: chat, text: msg.slice(i, i + 3900), disable_web_page_preview: true });
    let res: Response;
    try {
      res = await proxiedFetch(`${TG_API}/bot${c.token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(String((e as Error).message || e).replace(c.token, "***").slice(0, 160));
    }
    const d = await res.json().catch(() => ({}));
    if (!d.ok) throw new Error("تلگرام پیام را نپذیرفت");
  }
}

/** Site-down alerts and reports go to this project's own bot and chat, only if that project asked for them. */
export async function notify(project: ProjectRow, kind: "alerts" | "reports", text: string): Promise<boolean> {
  const c = tgConfig(project.id);
  if (!c || !c[kind]) return false;
  return tryTg(project.id, () => tgSend(project.id, text));
}

/** Task messages to one person, through the bot of the project the task belongs to. */
export async function notifyPerson(project: ProjectRow, chat: string, text: string): Promise<boolean> {
  const c = tgConfig(project.id);
  if (!c || !String(chat || "").trim()) return false;
  return tryTg(project.id, () => post(c, String(chat).trim(), text));
}

async function tryTg(pid: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    setSetting(`tg_error:${pid}`, "");
    return true;
  } catch (e) {
    setSetting(`tg_error:${pid}`, String((e as Error).message || e).slice(0, 200));
    return false;
  }
}

export function articleMessage(project: ProjectRow, c: ContentRow): string {
  const o = c.output;
  const drafted = !!o.draft_id;
  const lines = [
    `مقاله جدید ${project.name} ` + (drafted ? "در سایت به‌صورت پیش‌نویس ثبت شد." : "نوشته شد و در پنل آماده بازبینی است."),
    `عنوان: ${o.title || c.topic}`, `slug: ${o.slug || ""}`,
    drafted ? "کار: متن و کاور را بازبینی کن و اگر درست بود منتشر کن." : "کار: متن را در پنل بازبینی کن.",
  ];
  if (c.flags.length) lines.push("نکته‌های بررسی: " + c.flags.map((x) => x.replace(/\n/g, " ")).join("؛ ").slice(0, 300));
  return lines.join("\n");
}

export function postMessage(c: ContentRow): string {
  const o = c.output;
  const day = c.brief.date ? `تاریخ پیشنهادی: ${c.brief.date}\n` : "";
  const tags = ((o.hashtags as string[]) || []).join(" ");
  return `پست اینستاگرام آماده است.\n${day}قالب: ${o.format || ""}\n\nهوک:\n${o.hook || ""}\n\nکپشن:\n${o.caption || ""}\n\n${tags}`.trim();
}

// ---------- site draft ----------
export async function coverImage(project: ProjectRow, c: ContentRow): Promise<string> {
  const o = c.output;
  if (o.image_file) return o.image_file as string;
  const rows = new Map(catalogRows(project.id).map((r) => [r.url, r]));
  const links = (c.brief.internal_links as { url: string }[] | undefined) || [];
  let imgs: string[] = [];
  for (const l of links) {
    for (const i of rows.get(l.url)?.images || []) {
      if (!/\/og\/|default|placeholder/.test(i)) { imgs = [i]; break; }
    }
    if (imgs.length) break;
  }
  if (!imgs.length) {
    for (const m of ((o.body_html as string) || "").matchAll(/href="([^"]+\/product\/[^"]+)"/g)) {
      const r = rows.get(m[1].replace(/\/+$/, ""));
      if (r?.images?.length) { imgs = r.images.slice(0, 1); break; }
    }
  }
  if (!imgs.length) throw new Error("عکسی برای کاور پیدا نشد؛ مقاله لینک محصول ندارد");
  return (await renderImage(project, { template: "cover", title: o.title as string, images: imgs })).file;
}

function saveContent(c: ContentRow) {
  run("UPDATE content SET status=?, output=?, note=?, updated=? WHERE id=?", c.status, JSON.stringify(c.output), c.note, dbNow(), c.id);
}

export class DuplicateError extends Error {}

type SteveLikeAdapter = { createDraft: (o: Record<string, unknown>, mediaId: string) => Promise<Record<string, unknown>>; uploadImage: (path: string) => Promise<string>; req: (m: string, p: string, b?: unknown) => Promise<Record<string, unknown>> };

/** Creates the unpublished draft and confirms from the site that it really is unpublished. */
export async function pushDraft(project: ProjectRow, c: ContentRow): Promise<string> {
  const o = c.output;
  const kind = (adapters.config(project.id) || {}).type;
  if (kind !== undefined && kind !== "steve") throw new Error("ساخت پیش‌نویس مقاله فعلاً فقط برای API استیو است؛ متن را از پنل کپی کنید");
  const api = adapters.client(project.id) as unknown as SteveLikeAdapter;
  await planner.syncArticles(project);
  if (q("SELECT 1 FROM site_articles WHERE project_id=? AND (slug=? OR title=?)", project.id, o.slug, o.title).length) {
    throw new DuplicateError("مقاله‌ای با همین عنوان یا slug الان در سایت هست");
  }
  o.image_file = await coverImage(project, c);
  const art = await api.createDraft(o, await api.uploadImage(path.join(DATA_DIR, o.image_file as string)));
  o.draft_id = art.id || art._id || "created";
  if (art.id) {
    const backRaw = await api.req("GET", `/article/${art.id}`);
    const back = (backRaw.article as Record<string, unknown>) ?? backRaw;
    if (back.is_published) { // must never happen; undo it at once rather than trust it
      await api.req("PATCH", `/article/${art.id}`, { is_published: false });
      o.publish_corrected = true;
    }
  }
  await planner.syncArticles(project);
  return o.draft_id as string;
}

/** One pass over everything waiting. Called every minute; each failure is retried a few times, then left visible in the panel.
 * Named processQueue, not process (hub/publisher.py's name) — process is Node's global object and a same-scope export named `process` would shadow it. */
export async function processQueue(project: ProjectRow): Promise<{ drafted: number; messages: number }> {
  const pid = project.id;
  const cfg = getPublish(pid);
  const done = { drafted: 0, messages: 0 };
  for (const row of q<{ id: number }>("SELECT id FROM content WHERE project_id=? AND status IN ('review','approved','drafted') ORDER BY id", pid)) {
    const c = getContent(row.id);
    if (!c) continue;
    const o = c.output;
    if (c.kind === "article" && (c.status === "review" || c.status === "approved") && cfg.auto_draft && adapters.config(pid) && !o.draft_id && !o.draft_blocked) {
      if (((o.draft_tries as number) || 0) >= MAX_TRIES) continue;
      try {
        await pushDraft(project, c);
        c.status = "drafted"; o.draft_error = "";
        done.drafted++;
      } catch (e) {
        if (e instanceof DuplicateError) {
          o.draft_blocked = true; c.note = e.message;
        } else {
          o.draft_tries = ((o.draft_tries as number) || 0) + 1;
          o.draft_error = c.note = `ثبت در سایت نشد: ${String((e as Error).message || e).slice(0, 200)}`;
          saveContent(c);
          continue; // message goes out once the draft exists
        }
      }
      saveContent(c);
    }
    if (!cfg.telegram || !tgConfig(pid) || o.tg_sent || ((o.tg_tries as number) || 0) >= MAX_TRIES) continue;
    if (c.kind === "article" && !o.body_html) continue;
    if (c.kind === "ig_post" && !o.caption) continue;
    try {
      if (c.kind === "article") await tgSend(pid, articleMessage(project, c));
      else await tgSend(pid, postMessage(c), "instagram");
      o.tg_sent = dbNow(); o.tg_error = "";
      done.messages++;
    } catch (e) {
      o.tg_tries = ((o.tg_tries as number) || 0) + 1;
      o.tg_error = String((e as Error).message || e).slice(0, 200);
    }
    saveContent(c);
  }
  return done;
}
