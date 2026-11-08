"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

type Member = { id: number; name: string; username: string; active: number; last_login: number | null; role: string };
type FreeUser = { id: number; name: string; username: string };

export function MembersClient({ projectId, initialMembers, freeUsers }: { projectId: string; initialMembers: Member[]; freeUsers: FreeUser[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [free, setFree] = useState(freeUsers);
  const [userId, setUserId] = useState<string>(free[0] ? String(free[0].id) : "");
  const [newRole, setNewRole] = useState("editor");
  const [err, setErr] = useState("");

  async function changeRole(uid: number, memberRole: string) {
    try {
      await api(`/api/projects/${projectId}/members`, { method: "POST", body: { user_id: uid, role: memberRole } });
      setMembers(members.map((m) => (m.id === uid ? { ...m, role: memberRole } : m)));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function removeMember(uid: number) {
    try {
      await api(`/api/projects/${projectId}/members/${uid}`, { method: "DELETE" });
      const removed = members.find((m) => m.id === uid);
      setMembers(members.filter((m) => m.id !== uid));
      if (removed) setFree([...free, { id: removed.id, name: removed.name, username: removed.username }]);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    try {
      await api(`/api/projects/${projectId}/members`, { method: "POST", body: { user_id: Number(userId), role: newRole } });
      const u = free.find((x) => x.id === Number(userId))!;
      setMembers([...members, { id: u.id, name: u.name, username: u.username, active: 1, last_login: null, role: newRole }]);
      setFree(free.filter((x) => x.id !== Number(userId)));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  return (
    <div>
      {err && <div className="err" role="alert">{err}</div>}
      {members.length ? (
        <ul className="plain-list">
          {members.map((m) => (
            <li key={m.id}>
              <span className="grow">
                <strong>{m.name}</strong> <span className="mono muted">{m.username}</span>
                {!m.active && <span className="chip danger"> غیرفعال</span>}
                <div className="muted small">{m.last_login ? `آخرین ورود ${formatJalaliDateTime(m.last_login * 1000)}` : "هنوز وارد نشده"}</div>
              </span>
              <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}>
                <option value="viewer">فقط مشاهده</option>
                <option value="editor">ویرایشگر</option>
              </select>
              <button className="btn sm icon-only" aria-label="حذف از پروژه" onClick={() => removeMember(m.id)}>✕</button>
            </li>
          ))}
        </ul>
      ) : <div className="empty-inline"><p>هنوز عضوی به این پروژه اضافه نشده.</p></div>}

      {free.length > 0 && (
        <form className="row add-row" onSubmit={addMember}>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {free.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
          </select>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="viewer">فقط مشاهده</option>
            <option value="editor">ویرایشگر</option>
          </select>
          <button className="btn" type="submit">افزودن به پروژه</button>
        </form>
      )}
    </div>
  );
}
