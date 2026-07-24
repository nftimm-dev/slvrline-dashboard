"use client";

import FreshnessChip from "./FreshnessChip";

interface VitalCardProps {
  label: string;
  primary: string;
  secondary?: string;
  colorVar: string;
  snapshotAt?: string;
  blockNumber?: number | null;
  loading?: boolean;
  badge?: React.ReactNode;
  subtext?: string;
  fullWidth?: boolean;
}

export default function VitalCard({
  label,
  primary,
  secondary,
  colorVar,
  snapshotAt,
  blockNumber,
  loading = false,
  badge,
  subtext,
}: VitalCardProps) {
  return (
    <div
      className="flex flex-col gap-2 p-4 border min-w-0"
      style={{
        backgroundColor: "var(--color-silver-900)",
        borderRadius: "var(--radius-card)",
        borderColor: "var(--color-silver-800)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      {/* Label row */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span
          className="uppercase tracking-widest flex-shrink-0"
          style={{
            fontSize: "0.6875rem",
            color: "var(--color-silver-400)",
            fontWeight: 600,
            letterSpacing: "0.1em",
          }}
        >
          {label}
        </span>
        {snapshotAt && (
          <FreshnessChip snapshotAt={snapshotAt} blockNumber={blockNumber} />
        )}
      </div>

      {/* Primary value */}
      {loading ? (
        <div
          className="rounded"
          style={{
            height: 36,
            backgroundColor: "var(--color-silver-800)",
            animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      ) : (
        <span
          className="font-mono leading-none overflow-hidden text-ellipsis whitespace-nowrap"
          style={{
            fontSize: "1.625rem",
            fontWeight: 700,
            color: `var(${colorVar})`,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {primary}
        </span>
      )}

      {/* Badge (e.g. EARLY warning) */}
      {badge && <div>{badge}</div>}

      {/* Secondary info */}
      {secondary && (
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--color-silver-400)",
            lineHeight: 1.4,
          }}
        >
          {secondary}
        </span>
      )}

      {/* Subtext (e.g. APR context disclaimer) */}
      {subtext && (
        <p
          style={{
            fontSize: "0.6875rem",
            color: "var(--color-silver-400)",
            lineHeight: 1.5,
            marginTop: 2,
          }}
        >
          {subtext}
        </p>
      )}
    </div>
  );
}
