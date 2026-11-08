"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

export function IgnoreButton({ projectId, phrase }: { projectId: string; phrase: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/projects/${projectId}/kwgap/ignore`, { method: "POST", body: { phrase } });
          router.refresh();
        } catch (e) {
          alert(e instanceof ApiError ? e.message : "خطا");
        } finally {
          setBusy(false);
        }
      }}
    >
      نادیده بگیر
    </button>
  );
}
