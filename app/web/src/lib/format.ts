/**
 * Number formatting helpers for SLVRline analytics display.
 * Uses Intl.NumberFormat — no external dependencies.
 */

/** formatAPR(32452) → "32,452%" */
export function formatAPR(pct: number): string {
  return (
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(Math.round(pct)) + "%"
  );
}

/** formatSLVR(312450.8) → "312,451 SLVR" */
export function formatSLVR(amount: number, decimals = 0): string {
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount) + " SLVR"
  );
}

/**
 * formatUSD(0.0812) → "$0.0812"
 * formatUSD(185000) → "$185K"
 * formatUSD(89.89) → "$89.89"
 */
export function formatUSD(usd: number): string {
  if (usd >= 1_000_000) {
    return "$" + (usd / 1_000_000).toFixed(2) + "M";
  }
  if (usd >= 1_000) {
    return "$" + (usd / 1_000).toFixed(1) + "K";
  }
  if (usd >= 1) {
    return "$" + usd.toFixed(2);
  }
  // Small values: show 4 sig figs
  return "$" + usd.toPrecision(4);
}

/** formatRunway(18.4) → "~18 mo" */
export function formatRunway(months: number): string {
  return "~" + Math.round(months) + " mo";
}

/**
 * freshnessLabel(isoString) → "just now" | "Xs ago" | "Xm ago" | "Xh ago"
 */
export function freshnessLabel(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * freshnessColor(isoString) → "fresh" | "stale" | "very-stale"
 * Thresholds: < 5 min → fresh, 5-15 min → stale, > 15 min → very-stale
 */
export function freshnessColor(
  isoString: string
): "fresh" | "stale" | "very-stale" {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMinutes = diffMs / (1000 * 60);

  if (diffMinutes < 5) return "fresh";
  if (diffMinutes < 15) return "stale";
  return "very-stale";
}
