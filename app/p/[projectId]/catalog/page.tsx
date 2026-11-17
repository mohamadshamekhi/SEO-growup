import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { catalogRows } from "@/lib/catalog";
import { faNum } from "@/lib/intl/fa";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { CatalogClient } from "./catalog-client";

export const dynamic = "force-dynamic";

export default async function CatalogTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();
  const user = await currentUser();
  const r = user ? role(user, projectId) : null;
  const items = catalogRows(projectId).map((i) => ({ url: i.url, kind: i.kind, name: i.name || i.title || "", available: i.available }));
  const products = items.filter((i) => i.kind === "product").length;

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>محصولات و مقالات</h1></div></div>
      <p className="page-note">{faNum(products)} محصول · {faNum(items.length - products)} مقاله · برای جابه‌جایی دسته، محصول‌ها را جستجو و انتخاب کنید.</p>
      <CatalogClient projectId={projectId} items={items} canEdit={r === "admin" || r === "editor"} />
    </div>
  );
}
