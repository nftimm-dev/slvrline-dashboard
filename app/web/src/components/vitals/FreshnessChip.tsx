"use client";

import { freshnessLabel, freshnessColor } from "@/lib/format";

interface FreshnessChipProps {
  snapshotAt: string;
  blockNumber?: number | null;
}

const COLOR_MAP = {
  fresh: "var(--color-fresh)",
  stale: "var(--color-stale)",
  "very-stale": "var(--color-very-stale)",
};

export default function FreshnessChip({
  snapshotAt,
  blockNumber,
}: FreshnessChipProps) {
  const label = freshnessLabel(snapshotAt);
  const color = freshnessColor(snapshotAt);
  const dotColor = COLOR_MAP[color];

  return (
    <span
      className="inline-flex items-center gap-1 flex-shrink-0"
      style={{ fontSize: "0.6875rem" }}
    >
      <span
        className="inline-block rounded-full flex-shrink-0"
        style={{
          width: 6,
          height: 6,
          backgroundColor: dotColor,
          boxShadow: `0 0 4px ${dotColor}`,
        }}
      />
      <span style={{ color: "var(--color-silver-400)" }}>{label}</span>
      {blockNumber != null && (
        <span
          className="font-mono"
          style={{
            color: "var(--color-silver-400)",
            fontSize: "0.625rem",
          }}
        >
          · #{blockNumber.toLocaleString()}
        </span>
      )}
    </span>
  );
}
