"use client";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export function PriceRemoveButton({ projectId, url, name }: { projectId: string; url: string; name: string }) {
  const router = useRouter();
  async function remove() {
    if (!confirm(`لینک قیمت «${name}» حذف شود؟`)) return;
    await api(`/api/projects/${projectId}/prices`, { method: "POST", body: { remove: url } });
    router.refresh();
  }
  return <button type="button" className="btn sm edit-only" onClick={remove}>حذف</button>;
}
