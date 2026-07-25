"use client";

import type { ReactNode } from "react";

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** Cell renderer. */
  render: (row: Row, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Render this column monospace + tabular (numbers, addresses). */
  mono?: boolean;
  /** Optional fixed/min width. */
  width?: number | string;
}

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  loading?: boolean;
  skeletonRows?: number;
  emptyMessage?: string;
  /** Constrain height and scroll vertically past this (px). Header stays pinned. */
  maxHeight?: number;
}

/**
 * Quiet analytics table: sticky faint header, hairline row separators, mono
 * tabular numerics, generous vertical rhythm. No zebra striping — restraint.
 */
export default function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 8,
  emptyMessage = "No data available",
  maxHeight,
}: DataTableProps<Row>) {
  const showSkeleton = loading && rows.length === 0;
  const scroll = maxHeight !== undefined;

  return (
    <div
      className="overflow-x-auto"
      style={scroll ? { maxHeight, overflowY: "auto" } : undefined}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.8125rem",
        }}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  padding: "10px 14px",
                  textAlign: col.align ?? "left",
                  color: "var(--color-silver-400)",
                  fontWeight: 600,
                  fontSize: "0.6875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  borderBottom: "1px solid var(--color-silver-800)",
                  whiteSpace: "nowrap",
                  width: col.width,
                  backgroundColor: "var(--color-silver-900)",
                  ...(scroll
                    ? { position: "sticky" as const, top: 0, zIndex: 1 }
                    : {}),
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showSkeleton
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: "10px 14px",
                        borderBottom: "1px solid var(--color-silver-800)",
                      }}
                    >
                      <div
                        className="rounded"
                        style={{
                          height: 12,
                          width: col.align === "right" ? "60%" : "80%",
                          marginLeft: col.align === "right" ? "auto" : 0,
                          backgroundColor: "var(--color-silver-800)",
                          animation:
                            "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : rows.length === 0
              ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      style={{
                        padding: "28px 14px",
                        textAlign: "center",
                        color: "var(--color-silver-400)",
                      }}
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                )
              : rows.map((row, i) => (
                  <tr
                    key={rowKey(row, i)}
                    style={{ borderBottom: "1px solid var(--color-silver-800)" }}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          padding: "10px 14px",
                          textAlign: col.align ?? "left",
                          color: "var(--color-silver-200)",
                          fontFamily: col.mono ? "var(--font-mono)" : undefined,
                          fontVariantNumeric: col.mono ? "tabular-nums" : undefined,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {col.render(row, i)}
                      </td>
                    ))}
                  </tr>
                ))}
        </tbody>
      </table>
    </div>
  );
}
