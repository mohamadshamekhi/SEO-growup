"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";

export function MarginSelect({ projectId, url, initial }: { projectId: string; url: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [err, setErr] = useState("");

  async function change(level: string) {
    setValue(level);
    try {
      await api(`/api/projects/${projectId}/funnel`, { method: "POST", body: { action: "margin", url, level } });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); }
  }

  return (
    <>
      <label className="sr-only" htmlFor={`mg-${url}`}>سود</label>
      <select id={`mg-${url}`} value={value} onChange={(e) => change(e.target.value)}>
        <option value="high">زیاد</option>
        <option value="normal">معمولی</option>
        <option value="low">کم</option>
      </select>
      {err && <span className="err">{err}</span>}
    </>
  );
}
