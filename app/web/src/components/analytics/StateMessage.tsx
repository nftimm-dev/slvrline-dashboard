import type { ReactNode } from "react";

interface StateMessageProps {
  title: string;
  detail?: ReactNode;
  /** "error" tints the border/title warmly; "info" stays neutral. */
  tone?: "error" | "info";
  height?: number;
}

/** Graceful "unavailable" / empty state box that fills a panel or chart slot. */
export default function StateMessage({
  title,
  detail,
  tone = "info",
  height = 200,
}: StateMessageProps) {
  const accent =
    tone === "error" ? "var(--color-very-stale)" : "var(--color-silver-400)";
  return (
    <div
      style={{
        minHeight: height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 6,
        padding: 24,
      }}
    >
      <span
        style={{
          fontSize: "0.875rem",
          fontWeight: 600,
          color: accent,
        }}
      >
        {title}
      </span>
      {detail && (
        <span
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-silver-400)",
            maxWidth: "42ch",
            lineHeight: 1.5,
          }}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
