"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

type ProjectLink = { project_id: string; role: string; name: string };
type User = { id: number; name: string; username: string; active: number; is_admin: number; last_login: number | null; projects: ProjectLink[] };

const ROLE_FA: Record<string, string> = { admin: "مدیر", editor: "ویرایشگر", viewer: "فقط مشاهده" };

function genPass(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

export function UsersClient({ currentUserId, initialUsers }: { currentUserId: number; initialUsers: User[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [err, setErr] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(genPass());
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await api<{ id: number }>("/api/users", { method: "POST", body: { name, username, password, is_admin: isAdmin } });
      setUsers([...users, { id: r.id, name, username, active: 1, is_admin: isAdmin ? 1 : 0, last_login: null, projects: [] }]);
      setShowNew(false); setName(""); setUsername(""); setPassword(genPass()); setIsAdmin(false);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); }
  }

  async function toggleActive(u: User) {
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body: { active: u.active ? 0 : 1 } });
      setUsers(users.map((x) => (x.id === u.id ? { ...x, active: u.active ? 0 : 1 } : x)));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function remove(u: User) {
    if (!confirm(`کاربر «${u.name}» حذف شود؟`)) return;
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      setUsers(users.filter((x) => x.id !== u.id));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function newPassword(u: User) {
    const pass = genPass();
    if (!confirm(`رمز جدید برای «${u.name}»:\n${pass}\n\nاین رمز را به او بدهید؛ دوباره نمایش داده نمی‌شود.`)) return;
    try {
      await api(`/api/users/${u.id}/password`, { method: "POST", body: { password: pass } });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  return (
    <div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="toolbar">
        <button className="btn primary" onClick={() => setShowNew(!showNew)}>+ کاربر جدید</button>
      </div>
      {showNew && (
        <section className="panel narrow" style={{ marginBottom: 14 }}>
          <form className="form-grid" onSubmit={createUser}>
            <div className="field"><label htmlFor="u-name">نام</label><input id="u-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="u-user">نام کاربری</label><input id="u-user" type="text" className="ltr" required value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div className="field full">
              <label htmlFor="u-pass">رمز اولیه</label>
              <div className="row"><input id="u-pass" type="text" className="mono ltr" style={{ flex: 1 }} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <span className="hint">این رمز را به عضو بدهید؛ بعد از ورود می‌تواند عوضش کند.</span>
            </div>
            <label className="check full"><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />مدیر (دسترسی به همه پروژه‌ها، اعضا و تنظیمات)</label>
            <div className="full"><button className="btn primary" type="submit" disabled={busy}>ساخت کاربر</button></div>
          </form>
        </section>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>نام</th><th>نام کاربری</th><th>دسترسی</th><th>آخرین ورود</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "off"}>
                <td><strong>{u.name}</strong>{u.id === currentUserId && <span className="chip"> شما</span>}{!u.active && <span className="chip danger"> غیرفعال</span>}</td>
                <td className="mono">{u.username}</td>
                <td className="wrap">
                  {u.is_admin ? <span className="chip info">مدیر؛ همه پروژه‌ها</span> : u.projects.length ? u.projects.map((p) => <span key={p.project_id} className="chip">{p.name} · {ROLE_FA[p.role] || p.role} </span>) : <span className="muted">بدون پروژه</span>}
                </td>
                <td className="muted">{u.last_login ? formatJalaliDateTime(u.last_login * 1000) : "—"}</td>
                <td>
                  <div className="row nowrap">
                    <button className="btn sm" onClick={() => newPassword(u)}>رمز جدید</button>
                    {u.id !== currentUserId && (
                      <>
                        <button className="btn sm" onClick={() => toggleActive(u)}>{u.active ? "غیرفعال" : "فعال"}</button>
                        <button className="btn sm icon-only" aria-label="حذف کاربر" onClick={() => remove(u)}>✕</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
