import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Right-aligned slot (e.g. a freshness / updated indicator). */
  aside?: ReactNode;
}

/** Consistent page title block, matching the Methodology header scale. */
export default function PageHeader({ title, subtitle, aside }: PageHeaderProps) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            color: "var(--color-silver-100)",
            marginBottom: 6,
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              color: "var(--color-silver-400)",
              fontSize: "0.9375rem",
              maxWidth: "60ch",
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {aside && <div className="flex-shrink-0">{aside}</div>}
    </div>
  );
}
