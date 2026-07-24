# Phase 5 Validation

**Date:** 2026-07-25
**Build:** `pnpm build` exit 0

## Build Result

```
Route (app)                                 Size  First Load JS
┌ ○ /                                    5.58 kB         111 kB
├ ○ /_not-found                            989 B         101 kB
├ ƒ /api/history                           133 B         101 kB
├ ƒ /api/market                            133 B         101 kB
├ ƒ /api/status                            133 B         101 kB
├ ƒ /api/vitals                            133 B         101 kB
└ ○ /methodology                           778 B         101 kB
```

No TypeScript errors. No build warnings.

## Live API Verification (dev server, `next dev --port 3000`)

### /api/vitals — Real data confirmed

| Metric | Value | Snapshot |
|--------|-------|----------|
| dividends_apr | 32452.36% | 2026-07-24T22:24:28.000Z |
| circulating_supply | 6296.21 SLVR | 2026-07-24T22:24:07.025Z |
| total_staked_slvr | 5042.44 SLVR | 2026-07-24T22:24:07.025Z |
| runway_months | 77.3 mo | 2026-07-24T22:24:07.025Z |
| lottery_round_state | round 14309 | 2026-07-24T22:24:07.025Z |
| price (slvr_usd) | $89.49 | 2026-07-24T22:52:23.724Z |

### /api/history — Row counts per metric (7d range)

| Metric | Rows |
|--------|------|
| dividends_apr | 85 |
| circulating_supply | 87 |
| total_staked_slvr | 3 |
| lottery_round_state | 87 |

### All range variants return 200

```
24h: 200
7d: 200
30d: 200
90d: 200
all: 200
```

## Home Page (`/`) — HTTP 200

HTML contains: SLVRline, Methodology nav link, DIVIDENDS APR, SLVR STAKED, SUPPLY, RUNWAY, SLVR PRICE — all confirmed present in SSR output.

Note: Chart canvas and vitals data are client-rendered via SWR (SSR provides the structural skeleton + loading state, client hydrates with real numbers).

## Methodology Page (`/methodology`) — HTTP 200

| Check | Result |
|-------|--------|
| "Dividends APR" section | ✓ |
| "Total SLVR Staked" section | ✓ |
| "Circulating Supply" section | ✓ |
| "Mining Runway" section | ✓ |
| "SLVR Price + Liquidity" section | ✓ |
| Formula content (1e18, 31,536,000) | ✓ |
| Blockscout links (robinhoodchain.blockscout.com/address/0x) | 82 links |
| Human labels (SLVR Token, Grid Lottery) | ✓ |

## Notes / Deviations

1. **ChartSection render-prop pattern refactored:** The plan specified `ChartSection` with a render-prop `children` function. In Next.js 15 App Router, passing functions as props from Server Components to Client Components is not allowed at build time. The fix was to create self-contained `*ChartSection.tsx` Client Components (AprChartSection, SupplyChartSection, StakingChartSection, LotteryChartSection) — each bundles its own state, useHistory hook, TimeRangeSelector, and chart component. The `ChartSection.tsx` base component is retained for documentation completeness.

2. **Charts are client-only:** AprChart (lightweight-charts v5), SupplyChart, StakingChart, LotteryChart (ECharts) are all `"use client"` components using dynamic import + imperative initialization. The SSR output for chart sections shows loading skeletons; charts render after hydration. This is correct behavior — canvas-based chart libraries cannot run server-side.

3. **lightweight-charts v5 API:** The plan referenced `addLineSeries()` which was renamed to `addSeries(LineSeries, ...)` in v5. Fixed automatically.

4. **Price history fallback:** As anticipated in the plan, Dexscreener does not expose OHLC history for this token. `PriceDisplay` renders the current price as a card with a "coming in v1.1" placeholder. No price chart rendered.

5. **total_staked_slvr history:** Only 3 rows in the 7d range (indexer has limited staking history). Charts show a "No data for this range" state gracefully for short ranges.

6. **AddressLabel is a Server Component** (no client JS): hover state relies on CSS class rather than JS event handlers. This is correct and improves performance.
