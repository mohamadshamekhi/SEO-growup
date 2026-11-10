"use client";
// Two manual actions requested from the dashboard: test the saved GSC property is actually
// reachable (synchronous, no data pull), and re-queue a full site audit (same "audit" job
// the scheduler/onboarding already use, via the existing /api/projects/[id]/run endpoint).
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { ConnTest } from "@/lib/gsc";

export function DashActions({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnTest | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditMsg, setAuditMsg] = useState("");

  async function testGsc() {
    setTesting(true); setResult(null);
    try {
      setResult(await api<ConnTest>(`/api/projects/${projectId}/gsc/test`));
    } catch (e) {
      setResult({ ok: false, property: "", error: e instanceof ApiError ? e.message : "خطا" });
    } finally {
      setTesting(false);
    }
  }

  async function recheck() {
    setAuditing(true); setAuditMsg("");
    try {
      await api(`/api/projects/${projectId}/run`, { method: "POST", body: { kind: "audit" } });
      setAuditMsg("ممیزی مجدد در صف قرار گرفت؛ چند دقیقه دیگر صفحه را رفرش کن.");
    } catch (e) {
      setAuditMsg(e instanceof ApiError ? e.message : "خطا");
    } finally {
      setAuditing(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "8px 0 14px" }}>
      <button type="button" className="btn sm" disabled={testing} onClick={testGsc}>
        {testing ? "در حال تست..." : "تست اتصال Search Console"}
      </button>
      {isAdmin && (
        <button type="button" className="btn sm" disabled={auditing} onClick={recheck}>
          {auditing ? "در حال ارسال..." : "بررسی مجدد سایت"}
        </button>
      )}
      {result && (
        <span className={`chip ${result.ok ? "ok" : "danger"}`}>
          {result.ok ? `متصل (${result.property})` : result.error || "وصل نیست"}
        </span>
      )}
      {auditMsg && <span className="muted small">{auditMsg}</span>}
    </div>
  );
}
