"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`همه داده‌های «${projectName}» در این پنل پاک شود؟ این کار برگشت‌ناپذیر است.`)) return;
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      router.push("/");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); setBusy(false); }
  }

  return (
    <>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn danger-solid" disabled={busy} onClick={del}>حذف {projectName}</button>
    </>
  );
}
