"use client";

import type { RangeKey } from "@/hooks/useHistory";

interface TimeRangeSelectorProps {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
}

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "24h", label: "24H" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "all", label: "ALL" },
];

export default function TimeRangeSelector({
  value,
  onChange,
}: TimeRangeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {RANGES.map(({ key, label }) => {
        const isActive = key === value;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              fontSize: "0.6875rem",
              padding: "2px 8px",
              borderRadius: "var(--radius-chip)",
              border: isActive
                ? "1px solid var(--color-accent)"
                : "1px solid var(--color-silver-800)",
              backgroundColor: isActive
                ? "var(--color-accent-dim)"
                : "transparent",
              color: isActive
                ? "var(--color-accent)"
                : "var(--color-silver-400)",
              cursor: "pointer",
              transition: "all 0.15s",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
