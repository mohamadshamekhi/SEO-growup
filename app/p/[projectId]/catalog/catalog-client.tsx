"use client";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { faNum } from "@/lib/intl/fa";

type Item = { url: string; kind: "product" | "article"; name: string; available: number | null };
type Cat = { id: string; name: string; parent: string };
const PAGE = 100;

export function CatalogClient({ projectId, items, canEdit }: { projectId: string; items: Item[]; canEdit: boolean }) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "product" | "article">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [page, setPage] = useState(0);

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((i) => (kind === "all" || i.kind === kind) && (!s || i.name.toLowerCase().includes(s) || decodeURIComponent(i.url).toLowerCase().includes(s)));
  }, [items, search, kind]);
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const selectedProducts = [...sel].filter((u) => items.find((i) => i.url === u)?.kind === "product");

  async function loadCats() {
    if (cats) return;
    try { setCats(await api<Cat[]>(`/api/projects/${projectId}/categories`)); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "دسته‌ها خوانده نشد" }); }
  }

  async function move() {
    const c = cats?.find((x) => x.id === cat);
    if (!c || !selectedProducts.length) return;
    if (!confirm(`${faNum(selectedProducts.length)} محصول به دسته «${c.name}» منتقل و روی سایت ثبت می‌شود (هر کدام از تاریخچه قابل برگشت است). ادامه؟`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ results: { url: string; ok: boolean; error?: string }[] }>(`/api/projects/${projectId}/categories`, { method: "POST", body: { urls: selectedProducts, category_id: c.id, category_name: c.name } });
      const ok = r.results.filter((x) => x.ok).length, bad = r.results.filter((x) => !x.ok);
      setMsg({ ok: !bad.length, text: `${faNum(ok)} محصول به «${c.name}» منتقل شد.${bad.length ? ` ${faNum(bad.length)} ناموفق: ${bad.slice(0, 3).map((b) => b.error).join(" | ")}` : ""}` });
      setSel(new Set());
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "خطا" }); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="row seo-toolbar">
        <input type="search" placeholder="جستجوی نام یا آدرس (مثلاً KING-BULL)" aria-label="جستجو" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ minWidth: 260 }} />
        <select aria-label="نوع" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPage(0); }}>
          <option value="all">همه</option><option value="product">محصول</option><option value="article">مقاله</option>
        </select>
        <span className="muted small">{faNum(list.length)} مورد</span>
      </div>
      {canEdit && selectedProducts.length > 0 && (
        <div className="row bulkbar" style={{ gap: 8, margin: "0 0 10px", flexWrap: "wrap" }}>
          <span className="small">{faNum(selectedProducts.length)} محصول انتخاب شده</span>
          <select aria-label="دسته مقصد" value={cat} onFocus={loadCats} onClick={loadCats} onChange={(e) => setCat(e.target.value)}>
            <option value="">{cats ? "دسته مقصد را انتخاب کنید" : "بارگذاری دسته‌ها..."}</option>
            {cats?.map((c) => <option key={c.id} value={c.id}>{c.parent ? `${c.parent} ← ` : ""}{c.name}</option>)}
          </select>
          <button type="button" className="btn sm primary" disabled={busy || !cat} onClick={move}>{busy ? "در حال ثبت..." : "انتقال به این دسته"}</button>
        </div>
      )}
      {msg && <p className={`small ${msg.ok ? "up" : "down"}`} role="status">{msg.text}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr>
            {canEdit && <th className="chk"><input type="checkbox" aria-label="انتخاب همه موارد این صفحه" checked={shown.length > 0 && shown.every((i) => sel.has(i.url))} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...shown.map((i) => i.url)]) : new Set([...sel].filter((u) => !shown.some((i) => i.url === u))))} /></th>}
            <th>نوع</th><th>نام</th><th>موجودی</th><th>آدرس</th>
          </tr></thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.url} className={sel.has(i.url) ? "sel" : ""}>
                {canEdit && <td className="chk"><input type="checkbox" aria-label={`انتخاب ${i.name}`} checked={sel.has(i.url)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(i.url); else n.delete(i.url); setSel(n); }} /></td>}
                <td>{i.kind === "product" ? "محصول" : "مقاله"}</td>
                <td style={{ fontSize: 13 }}>{i.name || "—"}</td>
                <td>{i.available == null ? <span className="muted">—</span> : i.available ? <span className="chip ok">موجود</span> : <span className="chip danger">ناموجود</span>}</td>
                <td className="url">{decodeURIComponent(i.url)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="صفحه‌بندی">
          <button type="button" className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>قبلی</button>
          <span className="small">صفحه {faNum(page + 1)} از {faNum(pages)}</span>
          <button type="button" className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>بعدی</button>
        </nav>
      )}
    </div>
  );
}
