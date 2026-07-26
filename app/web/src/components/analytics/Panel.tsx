import type { ReactNode } from "react";
import ScreenshotStamp from "./ScreenshotStamp";

interface PanelProps {
  title?: string;
  /** Small muted note beside the title (e.g. "top 10 · % of supply"). */
  note?: ReactNode;
  /** Right-aligned control slot in the header row. */
  action?: ReactNode;
  children: ReactNode;
  /** Remove inner padding (e.g. for full-bleed tables). */
  flush?: boolean;
  className?: string;
}

/** Bordered surface used to group a chart or table under a heading. */
export default function Panel({
  title,
  note,
  action,
  children,
  flush = false,
  className = "",
}: PanelProps) {
  return (
    <section className={`mb-8 ${className}`}>
      {(title || action) && (
        <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
          <h2
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-silver-200)",
            }}
          >
            {title}
            {note && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 400,
                  color: "var(--color-silver-400)",
                  marginLeft: 8,
                }}
              >
                {note}
              </span>
            )}
          </h2>
          {action}
        </div>
      )}
      <div
        className="relative overflow-hidden"
        style={{
          borderRadius: "var(--radius-card)",
          border: "1px solid var(--color-silver-800)",
          backgroundColor: "var(--color-silver-900)",
          padding: flush ? "0 0 24px" : "16px 16px 28px",
        }}
      >
        {children}
        <ScreenshotStamp />
      </div>
    </section>
  );
}
