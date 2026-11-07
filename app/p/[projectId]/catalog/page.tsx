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
      <h1>محصولات و مقالات</h1>
      <p className="muted small">{faNum(products.length)} محصول · {faNum(articles.length)} مقاله</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>نوع</th><th>نام</th><th>موجودی</th><th>آدرس</th></tr></thead>
        <tbody>
          {items.slice(0, 300).map((i, idx) => (
            <tr key={idx} style={{ borderTop: "1px solid #333" }}>
              <td>{i.kind === "product" ? "محصول" : "مقاله"}</td>
              <td style={{ fontSize: 13 }}>{i.name || "—"}</td>
              <td>{i.available == null ? "—" : i.available ? "موجود" : "ناموجود"}</td>
              <td className="ltr mono" style={{ fontSize: 12 }}>{i.url}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
