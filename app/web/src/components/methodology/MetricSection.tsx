import { ReactNode } from "react";

interface MetricSectionProps {
  title: string;
  children: ReactNode;
}

export default function MetricSection({ title, children }: MetricSectionProps) {
  return (
    <section className="mb-12">
      <h2
        style={{
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-silver-100)",
          marginBottom: 8,
        }}
      >
        {title}
      </h2>
      <hr
        style={{
          border: "none",
          borderTop: "1px solid var(--color-silver-800)",
          marginBottom: 20,
        }}
      />
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
