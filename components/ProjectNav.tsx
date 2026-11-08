"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";

export default function ProjectNavItem({ href, icon, label }: { href: string; icon: string; label: string }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link className="nav-item" href={href} aria-current={current ? "page" : undefined}>
      <Icon name={icon} /><span className="grow">{label}</span>
    </Link>
  );
}
