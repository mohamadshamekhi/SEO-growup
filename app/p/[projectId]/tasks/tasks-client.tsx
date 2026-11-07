"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type Task = { id: number; title: string; status: string; due: string; assignee: string | null; assignee_id: number | null };

const STATUS_FA: Record<string, string> = { todo: "برای انجام", doing: "در حال انجام", done: "انجام‌شده" };

// Assignee picker is deferred to Phase 6's frontend polish pass — the API already supports
// assignee_id (see POST /api/projects/[id]/tasks), this client just doesn't expose it yet.
export function TasksClient({ projectId, initialTasks }: { projectId: string; initialTasks: Task[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [, startTransition] = useTransition();

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const r = await api<{ id: number }>(`/api/projects/${projectId}/tasks`, { method: "POST", body: { title } });
      setTasks([{ id: r.id, title, status: "todo", due: "", assignee: null, assignee_id: null }, ...tasks]);
      setTitle("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  async function setStatus(id: number, status: string) {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body: { status } });
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  async function del(id: number) {
    try {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      setTasks(tasks.filter((t) => t.id !== id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطا");
    }
  }

  return (
    <div>
      <form onSubmit={addTask} style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان کار جدید" required style={{ flex: 1 }} />
        <button className="btn primary" type="submit">افزودن</button>
      </form>
      {err && <div className="err" role="alert">{err}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>وضعیت</th><th>عنوان</th><th>مسئول</th><th>مهلت</th><th></th></tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} style={{ borderTop: "1px solid #333" }}>
              <td>
                <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)}>
                  {Object.entries(STATUS_FA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </td>
              <td>{t.title}</td>
              <td>{t.assignee || "—"}</td>
              <td className="ltr">{t.due || "—"}</td>
              <td><button className="btn sm danger" onClick={() => del(t.id)}>حذف</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
