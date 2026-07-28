/**
 * ETH/USD price helpers — used to denominate the SLVR price line in USD.
 *
 *  - fetchEthUsdNow(): live ETH/USD from slvr.fun (same source the web app uses).
 *    Used by the cron so new points stay accurate.
 *  - fetchEthUsdHistory()/nearestUsd(): hourly ETH/USD from Coingecko (free, no
 *    key) — used ONLY by the one-time backfill so historical SLVR/USD is correct.
 *    Not a production dependency; the cron never calls Coingecko.
 *
 * SLVR is priced on-chain in ETH (SLVR/WETH pool); ETH/USD converts that to USD.
 */

/** Live ETH/USD. Returns 0 on failure so callers can null out the price. */
export async function fetchEthUsdNow(): Promise<number> {
  try {
    const r = await fetch("https://slvr.fun/api/price/eth", {
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json()) as { priceUsd?: number | string; price?: number | string };
    const v = Number(j.priceUsd ?? j.price ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/** Hourly [tsMs, usd] ETH/USD history for the last `days` (Coingecko), sorted asc. */
export async function fetchEthUsdHistory(days = 8): Promise<Array<[number, number]>> {
  const url = `https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${days}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Coingecko HTTP ${r.status}`);
  const j = (await r.json()) as { prices?: [number, number][] };
  return (j.prices ?? []).slice().sort((a, b) => a[0] - b[0]);
}

/** Nearest historical ETH/USD to a timestamp (ms). 0 if history is empty. */
export function nearestUsd(hist: Array<[number, number]>, tsMs: number): number {
  if (!hist.length) return 0;
  let best = hist[0];
  let bestD = Math.abs(hist[0][0] - tsMs);
  for (const p of hist) {
    const d = Math.abs(p[0] - tsMs);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best[1];
}
