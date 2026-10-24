import React from "react";
import { Markdown } from "../../lib/markdown";
import { parseResultTable } from "../../lib/task-result-table";

export default function ResultTable({
  content,
  format,
  label,
}: {
  content: string;
  format: unknown;
  label: string;
}) {
  const table = parseResultTable(format, content);
  if (!table) return <Markdown content={content} />;
  return (
    <div className="min-w-0 space-y-3">
      {table.before.trim() && <Markdown content={table.before} />}
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="scrollbar-slim max-w-full overflow-x-auto rounded-control border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <table className="w-full min-w-[28rem] border-collapse text-start text-sm leading-relaxed">
          <caption className="sr-only">{label}</caption>
          <thead className="bg-muted">
            <tr>
              {table.columns.map((heading, index) => (
                <th
                  key={index}
                  scope="col"
                  className="min-w-32 border-b border-border px-3 py-2 text-start align-top font-semibold [overflow-wrap:anywhere]"
                >
                  <bdi>{heading}</bdi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr
                key={index}
                className="border-b border-border/60 last:border-0"
              >
                {row.map((cell, column) => (
                  <td
                    key={column}
                    className="whitespace-pre-wrap px-3 py-2 align-top [overflow-wrap:anywhere]"
                  >
                    <bdi>{cell}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.after.trim() && <Markdown content={table.after} />}
    </div>
  );
}
