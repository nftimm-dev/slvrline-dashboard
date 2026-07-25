"use client";

import Sparkline from "./Sparkline";

interface VitalCardProps {
  label: string;
  primary: string;
  secondary?: string;
  colorVar: string; // accent — left border + sparkline tint
  loading?: boolean;
  badge?: React.ReactNode;
  sparkline?: number[];
  // Accepted for API compatibility; freshness is now shown once, globally.
  snapshotAt?: string;
  blockNumber?: number | null;
  subtext?: string;
}

export default function VitalCard({
  label,
  primary,
  secondary,
  colorVar,
  loading = false,
  badge,
  sparkline,
}: VitalCardProps) {
  return (
    <div
      className="relative overflow-hidden h-full min-w-0"
      style={{
        backgroundColor: "var(--color-silver-900)",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--color-silver-800)",
        borderLeft: `2px solid var(${colorVar})`,
      }}
    >
      {/* Faint background trend (behind content) */}
      {sparkline && <Sparkline data={sparkline} colorVar={colorVar} />}

      {/* Content layer */}
      <div className="relative flex flex-col h-full p-4" style={{ zIndex: 1 }}>
        {/* Label — its own line, quiet */}
        <span
          className="uppercase whitespace-nowrap overflow-hidden text-ellipsis"
          style={{
            fontSize: "0.625rem",
            color: "var(--color-silver-400)",
            fontWeight: 600,
            letterSpacing: "0.09em",
          }}
        >
          {label}
        </span>

        {/* Primary value — neutral near-white; the number is the hero, not its colour */}
        {loading ? (
          <div
            className="rounded"
            style={{
              height: 30,
              marginTop: 8,
              backgroundColor: "var(--color-silver-800)",
              animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            }}
          />
        ) : (
          <span
            className="font-mono whitespace-nowrap overflow-hidden text-ellipsis"
            style={{
              fontSize: "clamp(1.25rem, 2.1vw, 1.6rem)",
              fontWeight: 700,
              color: "var(--color-silver-100)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.15,
              marginTop: 6,
            }}
          >
            {primary}
          </span>
        )}

        {/* Badge (e.g. SUPPLY progress bar) sits directly under the number */}
        {badge && <div style={{ marginTop: 8 }}>{badge}</div>}

        {/* Secondary — pinned to the card bottom so every card shares a baseline */}
        {secondary && (
          <span
            className="mt-auto whitespace-nowrap overflow-hidden text-ellipsis"
            style={{
              fontSize: "0.6875rem",
              color: "var(--color-silver-400)",
              paddingTop: 10,
            }}
          >
            {secondary}
          </span>
        )}
      </div>
    </div>
  );
}
