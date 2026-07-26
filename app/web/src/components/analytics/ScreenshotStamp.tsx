interface ScreenshotStampProps {
  className?: string;
  placement?: "top" | "bottom";
}

/** Quiet provenance mark for analytics cards that may be shared as screenshots. */
export default function ScreenshotStamp({
  className = "",
  placement = "bottom",
}: ScreenshotStampProps) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none select-none absolute right-3 z-10 font-mono leading-none ${
        placement === "top" ? "top-2.5" : "bottom-2.5"
      } ${className}`}
      style={{
        fontSize: "0.5rem",
        fontWeight: 500,
        letterSpacing: "0.08em",
        color: "var(--color-silver-300)",
        backgroundColor: "rgba(8, 9, 14, 0.72)",
        border: "1px solid rgba(126, 184, 232, 0.16)",
        borderRadius: 3,
        boxShadow: "0 0 12px rgba(126, 184, 232, 0.08)",
        opacity: 0.68,
        padding: "3px 5px",
      }}
    >
      slvrline.fun
    </span>
  );
}
