"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type AuthState = { setup_needed: boolean; can_setup: boolean; user: { id: number } | null };

export default function LoginPage() {
  const router = useRouter();
  const [state, setState] = useState<AuthState | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AuthState>("/api/auth/state").then((s) => {
      if (s.user) { router.replace("/"); return; }
      setState(s);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (state?.setup_needed) {
        await api("/api/auth/setup", { method: "POST", body: { name, username, password } });
      } else {
        const r = await api<{ ok?: boolean; needs_code?: boolean }>("/api/auth/login", { method: "POST", body: { username, password, code: code || undefined } });
        if (r.needs_code) { setNeedsCode(true); setBusy(false); return; }
      }
      router.replace("/");
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "خطای غیرمنتظره");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: "0 16px" }}>
      <h1>Growth Hub</h1>
      <h2 style={{ fontSize: 16, fontWeight: 400, color: "var(--muted, #888)" }}>
        {state.setup_needed ? "ساخت مدیر اول" : "ورود"}
      </h2>
      {state.setup_needed && !state.can_setup && (
        <p role="alert">ساخت مدیر اول فقط از خود این کامپیوتر ممکن است.</p>
      )}
      <form onSubmit={submit} className="form-grid" style={{ display: "grid", gap: 12 }}>
        {state.setup_needed && (
          <div className="field">
            <label htmlFor="name">نام</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label htmlFor="username">نام کاربری</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" className="ltr mono" />
        </div>
        <div className="field">
          <label htmlFor="password">رمز</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            autoComplete={state.setup_needed ? "new-password" : "current-password"} className="ltr" />
        </div>
        {needsCode && (
          <div className="field">
            <label htmlFor="code">کد دومرحله‌ای</label>
            <input id="code" value={code} onChange={(e) => setCode(e.target.value)} className="ltr mono" autoFocus />
          </div>
        )}
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" type="submit" disabled={busy || (state.setup_needed && !state.can_setup)}>
          {state.setup_needed ? "ساخت و ورود" : "ورود"}
        </button>
      </form>
    </main>
  );
}
