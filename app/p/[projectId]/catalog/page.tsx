import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { catalogRows } from "@/lib/catalog";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

export default async function CatalogTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();
  const items = catalogRows(projectId);
  const products = items.filter((i) => i.kind === "product");
  const articles = items.filter((i) => i.kind === "article");

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>محصولات و مقالات</h1></div></div>
      <p className="page-note">{faNum(products.length)} محصول · {faNum(articles.length)} مقاله</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>نوع</th><th>نام</th><th>موجودی</th><th>آدرس</th></tr></thead>
          <tbody>
            {items.slice(0, 300).map((i, idx) => (
              <tr key={idx}>
                <td>{i.kind === "product" ? "محصول" : "مقاله"}</td>
                <td style={{ fontSize: 13 }}>{i.name || "—"}</td>
                <td>{i.available == null ? <span className="muted">—</span> : i.available ? <span className="chip ok">موجود</span> : <span className="chip danger">ناموجود</span>}</td>
                <td className="url">{i.url}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
