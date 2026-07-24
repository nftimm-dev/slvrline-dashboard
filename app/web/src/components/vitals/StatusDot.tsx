"use client";

import { useStatus } from "@/hooks/useStatus";

export default function StatusDot() {
  const { data } = useStatus();

  let dotColor = "var(--color-silver-700)"; // default: unknown
  let title = "Indexer status: unknown";

  if (data) {
    const { lag_seconds } = data;
    if (lag_seconds < 30) {
      dotColor = "var(--color-fresh)";
      title = `Indexer lag: ${lag_seconds.toFixed(0)}s`;
    } else if (lag_seconds < 120) {
      dotColor = "var(--color-stale)";
      title = `Indexer lag: ${lag_seconds.toFixed(0)}s`;
    } else {
      dotColor = "var(--color-very-stale)";
      title = `Indexer lag: ${lag_seconds.toFixed(0)}s`;
    }
  }

  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      title={title}
      style={{
        width: 8,
        height: 8,
        backgroundColor: dotColor,
        boxShadow: `0 0 5px ${dotColor}`,
      }}
    />
  );
}
