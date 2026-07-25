"use client";

import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  /** Primary value — the hero. Neutral near-white mono. */
  primary: ReactNode;
  /** Secondary line, pinned to the card bottom for a shared baseline. */
  secondary?: ReactNode;
  /** Accent CSS var for the left border, e.g. "--color-price". */
  colorVar: string;
  loading?: boolean;
  /** Optional element between primary and the pinned secondary (e.g. a bar). */
  badge?: ReactNode;
}

/**
 * Headline metric card — mirrors VitalCard exactly: faint border, 2px colored
 * left accent, tiny uppercase label, big tabular-mono number, no shadow.
 */
export default function StatCard({
  label,
  primary,
  secondary,
  colorVar,
  loading = false,
  badge,
}: StatCardProps) {
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
      <div className="relative flex flex-col h-full p-4">
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

        {badge && <div style={{ marginTop: 8 }}>{badge}</div>}

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
