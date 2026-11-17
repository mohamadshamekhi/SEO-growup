"use client";
import { Fragment, useState } from "react";
import { faNum } from "@/lib/intl/fa";
import { IssuesClient, type Issue } from "../issues/issues-client";

type PageRow = { url: string; key: string; kind: string; status: number; title: string; words: number };

export function PagesClient({ projectId, rows, issues, gscProperty = "" }: { projectId: string; rows: PageRow[]; issues: Record<string, Issue[]>; gscProperty?: string }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>آدرس</th><th>نوع</th><th>کد</th><th>عنوان</th><th className="num">کلمات</th><th className="num">مشکلات</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const list = issues[r.key] || [];
            const expanded = open === r.key;
            return (
              <Fragment key={r.key}>
                <tr>
                  <td className="url">{r.url}</td>
                  <td>{r.kind}</td>
                  <td className={r.status >= 400 ? "bad-txt" : ""}>{r.status}</td>
                  <td style={{ fontSize: 12 }}>{r.title}</td>
                  <td className="num">{faNum(r.words)}</td>
                  <td className="num">
                    {list.length ? (
                      <button
                        type="button"
                        className="btn sm issue-count"
                        aria-expanded={expanded}
                        aria-controls={`page-issues-${r.key}`}
                        aria-label={`${faNum(list.length)} مشکل؛ ${expanded ? "بستن" : "نمایش دلیل و رفع"}`}
                        onClick={() => setOpen(expanded ? null : r.key)}
                      >
                        <span className="sev warning">{faNum(list.length)}</span>
                        {expanded ? "بستن" : "دلیل و رفع"}
                      </button>
                    ) : faNum(0)}
                  </td>
                </tr>
                {expanded && (
                  <tr id={`page-issues-${r.key}`} className="guide-row">
                    <td colSpan={6}>
                      <IssuesClient projectId={projectId} initialRows={list} compact gscProperty={gscProperty} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
