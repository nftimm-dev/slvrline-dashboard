# Phase 5: Frontend — Branded "Silver" Analytics Site

**Requirements satisfied:** DATA-03, DATA-04, DATA-05, VITALS-01, VITALS-02, DIV-02, UI-01, UI-02
**Phase goal:** A visitor landing on SLVRline reads live protocol vitals instantly, drills into
historical charts, and trusts the numbers because the methodology is documented and every data
source is labeled. The site has a cohesive "silver" identity — dark, data-dense, metallic accents.

**Baseline assumptions from Phase 4:**
- `app/web/` is a Next.js 15 App Router package in the pnpm workspace.
- `app/web/src/lib/db.ts`, `cache.ts`, `labels.ts` exist (Phase 4 Plan 01).
- `/api/vitals`, `/api/history`, `/api/market`, `/api/status` are implemented (Phase 4 Plans 02-04).
- Tailwind v4 and shadcn/ui are installed in `app/web/`.
- `app/indexer/METHODOLOGY.md` exists and contains the Dividends APR formula + V1/V2 split note.
- `CONTRACT_LABELS` and `getLabel` / `getBlockscoutUrl` are exported from `app/web/src/lib/labels.ts`.

**Plan execution order:**
```
Plan 01 (theme tokens + layout scaffold)
    └── Plan 02 (vitals strip + freshness)
            └── Plan 03 (charts + time-range selector)
    └── Plan 04 (methodology page + AddressLabel component)  [runs parallel with 02/03 after 01]
            └── Plan 05 (polish: mobile 375px + screenshot verification)
```

Plans 02, 03, 04 all depend on Plan 01's layout shell and theme tokens. Plans 02 and 04 can
execute in parallel (no file conflicts). Plan 03 depends on Plan 02 (charts slot below the vitals
strip, and share the same data-fetch pattern). Plan 05 is the verification gate.

---

## Plan 01 — Theme Tokens + Layout Scaffold

**Wave:** 1
**Depends on:** (none — first plan)
**Requirements:** UI-02

**What:** Install design tokens as Tailwind v4 CSS custom properties in `globals.css`. Create the
root layout (header with tagline + nav + status indicator), the dark shell, and the main page
skeleton with named layout slots. No data-fetching yet — just the branded chrome every other
component slots into.

**Why first:** Every subsequent plan inherits the token names (e.g. `text-silver-300`,
`bg-silver-950`, `accent-silver`) and the layout grid. Building on an untheormed scaffold
causes rework.

---

### Files

```
app/web/src/app/globals.css                      — Tailwind v4 @theme block + color tokens
app/web/src/app/layout.tsx                       — Root layout: ThemeProvider (dark), SiteHeader,
                                                   SiteFooter, slot for children
app/web/src/components/layout/SiteHeader.tsx     — Nav: SLVRline wordmark, "Methodology" link,
                                                   BlockscoutStatusDot (placeholder — wired in Plan 02)
app/web/src/components/layout/SiteFooter.tsx     — "Independent source of truth" tagline,
                                                   Blockscout explorer link, Phase link
app/web/src/components/layout/PageContainer.tsx  — Max-width wrapper (1280px) with side padding
```

---

### Task 1-A: Design Tokens (globals.css)

**Action:** In `app/web/src/app/globals.css`, add a Tailwind v4 `@theme` block with the SLVRline
silver palette. Use `@layer base` for dark-mode body defaults.

Key token values (use these exact names so Plans 02-05 can reference them without coordination):

```css
@theme {
  /* Near-black backgrounds — the "dark" in dark/data-dense */
  --color-silver-950: #0a0a0f;    /* page background */
  --color-silver-900: #111118;    /* card surface */
  --color-silver-800: #1a1a24;    /* elevated card / hover */
  --color-silver-700: #2a2a38;    /* subtle dividers */

  /* Metallic silver accent scale */
  --color-silver-400: #b0b8c8;    /* secondary text, axis labels */
  --color-silver-300: #c8d0e0;    /* primary text on dark */
  --color-silver-200: #dde3ee;    /* emphasis text */
  --color-silver-100: #f0f2f6;    /* headline numerals */

  /* Brand accent: cold electric blue-silver for interaction + highlight */
  --color-accent:     #7eb8e8;    /* primary interactive / highlights */
  --color-accent-dim: #3d6e9a;    /* muted accent for backgrounds */

  /* Semantic: protocol metric colors */
  --color-apr:        #a8f0c8;    /* Dividends APR — teal-mint (yield = good) */
  --color-supply:     #c8b8f0;    /* Supply/runway — muted purple */
  --color-staking:    #f0d8a8;    /* Staking — warm gold */
  --color-price:      --color-accent;  /* Price — accent blue */
  --color-lottery:    #f0a8b8;    /* Lottery — muted rose */

  /* Freshness indicator */
  --color-fresh:      #6fdb8f;    /* < 5 min ago */
  --color-stale:      #f0c050;    /* > 5 min ago */
  --color-very-stale: #e0604a;    /* > 15 min ago */

  /* Typography */
  --font-mono: "JetBrains Mono Variable", "Fira Code", ui-monospace, monospace;
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;

  /* Layout */
  --radius-card: 12px;
  --radius-chip: 6px;
}

@layer base {
  html { color-scheme: dark; }
  body {
    background-color: var(--color-silver-950);
    color: var(--color-silver-300);
    font-family: var(--font-sans);
    font-feature-settings: "tnum";  /* tabular numerals everywhere */
  }
}
```

Note on fonts: Use CSS `@import url(...)` for Google Fonts (Inter + JetBrains Mono variable fonts)
OR rely on system sans-serif/monospace if the user prefers no external requests. Mark with a
`TODO(fonts):` comment.

**Verify:** `pnpm --filter @slvrline/web build` produces no Tailwind token errors.

---

### Task 1-B: Root Layout + Header + Footer

**Action:** Implement `layout.tsx` as the dark-mode shell. Set `<html className="dark">` and
`<body className="min-h-screen bg-[--color-silver-950]">`. Import `globals.css`.

`SiteHeader.tsx`:
- Left: "SLVRline" wordmark in `font-mono text-silver-100 tracking-widest text-sm uppercase`
  with a `text-accent` slash character prefix: `// SLVRline`
- Right: nav links — "Methodology" (`/methodology`), "Blockscout" (external, opens new tab,
  `https://robinhoodchain.blockscout.com`), and a `<StatusDot />` placeholder component
  (returns a gray dot until Plan 02 wires it to `/api/status`).
- Full-width border-bottom: `border-b border-silver-800`
- Height: `h-12` (48px); content padded via `PageContainer`.

`SiteFooter.tsx`:
- Single line: "Independent source of truth — computed from indexed Robinhood Chain data."
- Small print: "SLVR token `0x791229...`" rendered as an `<AddressLabel />` placeholder
  (component created in Plan 04; leave as an inline `<code>` for now with a `TODO` comment).
- Border-top: `border-t border-silver-800`

`PageContainer.tsx`:
- `max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8`
- Used by layout, header, and all page-level sections.

**Verify:** `curl -s http://localhost:3000 | grep SLVRline` returns a match (header renders).

---

### Acceptance Check (Plan 01)

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm dev &
sleep 6
curl -s http://localhost:3000 | grep -E "SLVRline|Methodology|silver-950"
# Expected: at least one match per term in the HTML
pnpm --filter @slvrline/web build
# Expected: Build completes with exit code 0, no Tailwind token errors
kill %1
```

---

## Plan 02 — Vitals Strip + Freshness Indicators

**Wave:** 2
**Depends on:** Plan 01
**Requirements:** DATA-03, VITALS-01, VITALS-02, DIV-02

**What:** The hero section of the home page. A 5-card strip of headline vitals pulled from
`/api/vitals` and `/api/market` via SWR polling (10-second interval). Each card shows the
headline number, a freshness indicator ("updated Xs ago" or "block #N"), and a unit label.
The `/api/status` endpoint drives the global `StatusDot` in the header.

**Why this order:** The vitals strip is the primary value delivery — success criterion #1 and #2
are both satisfied here. Charts (Plan 03) slot below the strip, so the strip must exist first.

---

### Files

```
app/web/src/app/page.tsx                                  — Home page: VitalsStrip + [chart slots]
app/web/src/components/vitals/VitalsStrip.tsx             — Grid container for 5 VitalCard components
app/web/src/components/vitals/VitalCard.tsx               — Single headline stat card
app/web/src/components/vitals/FreshnessChip.tsx           — "updated Xs ago" / "block #N" badge
app/web/src/components/vitals/StatusDot.tsx               — Header indicator (green/yellow/red lag)
app/web/src/hooks/useVitals.ts                            — SWR wrapper for /api/vitals + /api/market
app/web/src/hooks/useStatus.ts                            — SWR wrapper for /api/status
app/web/src/lib/format.ts                                 — Number formatting helpers (APR%, SLVR, USD)
```

---

### Task 2-A: SWR hooks + format utilities

Install SWR: `pnpm --filter @slvrline/web add swr`

`useVitals.ts`: `useSWR('/api/vitals', fetcher, { refreshInterval: 10_000 })` combined with
`useSWR('/api/market', fetcher, { refreshInterval: 60_000 })`. Return merged shape:

```typescript
type VitalsData = {
  dividends_apr:      { value: number; snapshot_at: string; block_number: number } | null;
  circulating_supply: { value: number; value2: number; value3: number; snapshot_at: string; block_number: number } | null;
  runway_months:      { value: number; value2: number; snapshot_at: string; block_number: number } | null;
  total_staked_slvr:  { value: number; value2: number; value3: number; snapshot_at: string; block_number: number } | null;
  price:              { slvr_usd: number; cached_at: string } | null;
}
```

`useStatus.ts`: `useSWR('/api/status', fetcher, { refreshInterval: 5_000 })`. Returns
`{ indexed_block, lag_blocks, lag_seconds, checked_at }`.

`format.ts` — implement these helpers (no external deps; use `Intl.NumberFormat`):

```typescript
// formatAPR(1229.4) → "1,229%"
export function formatAPR(pct: number): string

// formatSLVR(312450.8) → "312,451 SLVR"
export function formatSLVR(amount: number, decimals?: number): string

// formatUSD(0.0812) → "$0.0812"  |  formatUSD(185000) → "$185K"
export function formatUSD(usd: number): string

// formatRunway(18.4) → "~18 mo"
export function formatRunway(months: number): string

// freshnessLabel(isoString: string): "just now" | "Xs ago" | "Xm ago" | "Xh ago"
export function freshnessLabel(isoString: string): string

// freshnessColor(isoString): "fresh" | "stale" | "very-stale"
// Used to pick the CSS variable class on FreshnessChip
export function freshnessColor(isoString: string): "fresh" | "stale" | "very-stale"
```

`freshnessColor` thresholds: `< 5 min` → `"fresh"`, `5-15 min` → `"stale"`, `> 15 min` → `"very-stale"`.

**Verify:** `npx tsc --noEmit` passes in `app/web/`.

---

### Task 2-B: VitalCard, FreshnessChip, VitalsStrip, StatusDot

`FreshnessChip.tsx`:
- Props: `snapshotAt: string` (ISO), `blockNumber?: number`
- Renders: a `<span>` with the `freshnessLabel` text + a colored dot.
- Dot color: CSS custom property selected by `freshnessColor` result:
  - `"fresh"` → `bg-[--color-fresh]`
  - `"stale"` → `bg-[--color-stale]`
  - `"very-stale"` → `bg-[--color-very-stale]`
- If `blockNumber` is provided, append `" · block #N"` in `text-silver-400 font-mono text-[10px]`.

`VitalCard.tsx`:
- Props: `label: string`, `primary: string`, `secondary?: string`, `colorVar: string`,
  `snapshotAt?: string`, `blockNumber?: number`, `loading?: boolean`
- Layout (mobile-first, 375px column):
  ```
  ┌─────────────────────────────┐
  │ LABEL           [freshness] │  ← silver-400 uppercase 11px / chip right
  │ PRIMARY VALUE               │  ← silver-100 font-mono text-3xl tabular
  │ secondary info              │  ← silver-400 text-sm
  └─────────────────────────────┘
  ```
- Card styles: `bg-[--color-silver-900] rounded-[--radius-card] p-4 border border-silver-800`
- `primary` colored with `colorVar` CSS variable: `style={{ color: \`var(${colorVar})\` }}`
- Loading state: render a `<div className="animate-pulse h-8 bg-silver-800 rounded" />` for the
  primary value slot.
- No click/hover interaction — purely display. Keep it static (good for screenshots).

Five card definitions for `VitalsStrip.tsx`:

| Slot | Label | Primary | Secondary | colorVar |
|------|-------|---------|-----------|----------|
| 0 | DIVIDENDS APR | `formatAPR(dividends_apr.value)` | "7-day annualized" | `--color-apr` |
| 1 | SLVR STAKED | `formatSLVR(total_staked_slvr.value)` | `formatSLVR(value2)` + " permanent" | `--color-staking` |
| 2 | SUPPLY | `formatSLVR(circulating_supply.value)` + " circ" | `formatSLVR(value2)` + " total · 500K max" | `--color-supply` |
| 3 | RUNWAY | `formatRunway(runway_months.value)` | `formatSLVR(value2)` + " remaining" | `--color-supply` |
| 4 | SLVR PRICE | `formatUSD(price.slvr_usd)` | "per SLVR" | `--color-price` |

`VitalsStrip.tsx`:
- Layout: CSS Grid. Mobile (375px): `grid-cols-2` with slot 4 (price) spanning full width as
  a "hero price" below the 2×2 grid. Tablet (640px+): `grid-cols-3`. Desktop (1024px+):
  `grid-cols-5`.
- Uses `useVitals()` hook. Shows all 5 cards in loading state until data arrives.
- Wraps the grid in a section with `pt-8 pb-6` (vertical rhythm below header).

`StatusDot.tsx`:
- Uses `useStatus()` hook.
- Lag thresholds: `lag_seconds < 30` → green dot `bg-[--color-fresh]`, `30-120s` → amber
  `bg-[--color-stale]`, `> 120s` → red `bg-[--color-very-stale]`.
- Renders as a 8×8px rounded-full dot with a `title="Indexer lag: Xs"` tooltip.
- Wire into `SiteHeader.tsx` replacing the placeholder from Plan 01.

`page.tsx` (home):
- Server Component wrapper that renders `<VitalsStrip />` (Client Component) inside
  `<PageContainer>`.
- Add `{/* CHART SLOTS — Plan 03 */}` comment block below strip so Plan 03 has a clear
  insertion point.

**Verify:**
```bash
# With dev server running:
curl -s http://localhost:3000 | grep -i "DIVIDENDS APR\|SLVR STAKED\|SUPPLY\|RUNWAY\|PRICE"
# Expected: All 5 label strings present in SSR output (loading skeleton is rendered server-side too)

# Visual check — MUST be done by reviewer:
# Open http://localhost:3000 in browser, resize to 375px width.
# Confirm: 5 cards visible without horizontal scroll; freshness chips show colored dots;
# all numbers display (even if 0 or loading) — no layout breakage.
```

---

### Acceptance Check (Plan 02 — maps to Success Criteria 1 + 2)

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm dev &
sleep 6

# SC1: Five vitals present in page HTML at 375px (verified by content, not width — width is CSS)
curl -s http://localhost:3000 | grep -c "DIVIDENDS APR\|SLVR STAKED\|SUPPLY\|RUNWAY\|SLVR PRICE"
# Expected: 5 (or more with duplicates in skeleton + real)

# SC2: Freshness data wired — snapshot_at must appear in HTML or JS bundle
curl -s http://localhost:3000/api/vitals | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['dividends_apr']['snapshot_at'])"
# Expected: ISO timestamp string (not null)

kill %1
```

---

## Plan 03 — Historical Charts + Time-Range Selector

**Wave:** 3
**Depends on:** Plan 02 (page.tsx layout slots, useVitals hook pattern)
**Requirements:** DATA-03, UI-01

**What:** Five chart sections below the vitals strip, one per metric family. Each section has a
`24H / 7D / 30D / 90D / ALL` button group (time-range selector) that calls `/api/history` with
the selected range and re-renders the chart without a page reload. APR/price charts use
TradingView lightweight-charts (line chart). Supply, staking, and lottery charts use ECharts
(multi-series area/bar).

**Chart library split (honor STACK.md decision):**
- lightweight-charts: `dividends_apr` (single-series line), `price` (from `/api/market` + Dexscreener — note: `/api/history` does not have a `price` metric; price chart is rendered
  directly from Dexscreener data embedded in `/api/market` response, which returns only current
  price, not historical. For v1, price chart is a 7D line from Dexscreener's `priceChange`
  data — mark as `TODO(price-history)` if Dexscreener does not expose OHLC for this token).
  **Practical fallback:** If Dexscreener lacks historical OHLC for this token, render an
  APR-only lightweight-charts section and show the price as a single-value card with a
  "Historical chart coming soon" placeholder.
- ECharts: `circulating_supply` (stacked area: circulating vs. total), `total_staked_slvr`
  (stacked area: total staked, permanent lock split), `lottery_round_state` (bar: bet count
  per snapshot period).

---

### Files

```
app/web/src/components/charts/TimeRangeSelector.tsx       — 24H/7D/30D/90D/ALL button group
app/web/src/components/charts/ChartSection.tsx            — Section wrapper: title + selector + chart slot
app/web/src/components/charts/AprChart.tsx                — lightweight-charts line chart for APR
app/web/src/components/charts/SupplyChart.tsx             — ECharts stacked-area: circ vs total supply
app/web/src/components/charts/StakingChart.tsx            — ECharts stacked-area: ve-staked vs LP-staked
app/web/src/components/charts/LotteryChart.tsx            — ECharts bar: lottery_round_state over time
app/web/src/components/charts/PriceDisplay.tsx            — Price card + placeholder (see note above)
app/web/src/hooks/useHistory.ts                           — SWR wrapper for /api/history?metric=&range=
```

---

### Task 3-A: Install charting libraries + shared wiring

Install:
```bash
pnpm --filter @slvrline/web add lightweight-charts echarts echarts-for-react
```

Do NOT install `lightweight-charts-react-wrapper` — it is not necessary; instantiate
lightweight-charts directly via `useRef` + `useEffect` (the canonical imperative pattern
documented in STACK.md). This avoids an extra wrapper dependency.

`useHistory.ts`:
```typescript
// Returns { data: HistoryResponse | undefined, isLoading, error }
// HistoryResponse = { metric: string; range: string; rows: HistoryRow[] }
// HistoryRow = { t: string; v: number; v2: number | null; v3: number | null; block: number }
export function useHistory(metric: MetricName, range: RangeKey): UseHistoryResult
```
Use `useSWR` with cache key `['/api/history', metric, range]`. Deduplicate keys so switching
range tabs on the same metric reuses the cache until the 5-minute HTTP TTL expires. On range
change, immediately show previous data while revalidating (SWR stale-while-revalidate default).

`TimeRangeSelector.tsx`:
- Props: `value: RangeKey`, `onChange: (r: RangeKey) => void`
- Renders 5 buttons: `24H · 7D · 30D · 90D · ALL`
- Active button: `bg-accent-dim text-accent border-accent` outline
- Inactive: `text-silver-400 hover:text-silver-200`
- Size: `text-xs py-1 px-2` (compact — fits inside chart section header bar)
- `RangeKey = "24h" | "7d" | "30d" | "90d" | "all"` (matches API contract exactly)

`ChartSection.tsx`:
- Props: `title: string`, `metric: MetricName`, `children: (range: RangeKey, data: HistoryResponse | undefined, isLoading: boolean) => React.ReactNode`
- Manages `range` state (default `"7d"`), calls `useHistory(metric, range)`, passes result to children via render-prop pattern.
- Layout: `mb-10` vertical rhythm; header row = `flex justify-between items-center mb-4`:
  - Left: `<h2 className="text-silver-200 font-semibold text-base">{title}</h2>`
  - Right: `<TimeRangeSelector />`
- Body: children occupying `h-64` (256px) container with `overflow-hidden`.

`ChartSection` usage in `page.tsx` (replacing the `{/* CHART SLOTS — Plan 03 */}` comment):
```tsx
<ChartSection title="Dividends APR" metric="dividends_apr">
  {(range, data, isLoading) => <AprChart data={data} isLoading={isLoading} />}
</ChartSection>
<ChartSection title="Supply" metric="circulating_supply">
  {(range, data, isLoading) => <SupplyChart data={data} isLoading={isLoading} />}
</ChartSection>
<ChartSection title="Staking" metric="total_staked_slvr">
  {(range, data, isLoading) => <StakingChart data={data} isLoading={isLoading} />}
</ChartSection>
<ChartSection title="Lottery Activity" metric="lottery_round_state">
  {(range, data, isLoading) => <LotteryChart data={data} isLoading={isLoading} />}
</ChartSection>
<PriceDisplay />
```

---

### Task 3-B: Individual chart components

**AprChart.tsx** (lightweight-charts):
- Imperative mount via `useRef<HTMLDivElement>` + `useEffect`.
- On mount: `createChart(ref.current, { layout: { background: { color: '#111118' }, textColor: '#c8d0e0' }, grid: { vertLines: { color: '#2a2a38' }, horzLines: { color: '#2a2a38' } }, timeScale: { timeVisible: true } })`.
- Add a `LineSeries` with `color: 'var(--color-apr)'` (resolve to hex `#a8f0c8` for the chart
  constructor — CSS variables don't resolve inside canvas; use the hex value directly).
- On `data` change: `series.setData(rows.map(r => ({ time: r.t.slice(0,10), value: r.v })))`.
  Note: lightweight-charts v5 `time` must be UTC date string `"YYYY-MM-DD"` for daily data or
  Unix timestamp (seconds) for sub-daily. For hourly data use `Math.floor(new Date(r.t).getTime() / 1000)`.
- On unmount: `chart.remove()`.
- Loading state: render `<div className="animate-pulse bg-silver-800 h-full rounded" />`.

**SupplyChart.tsx** (ECharts):
- Use `echarts-for-react` `<ReactECharts>` component.
- Option: 2-series area chart.
  - Series 1: `v` (circulating supply) — `color: '#c8b8f0'`, `areaStyle: { opacity: 0.2 }`.
  - Series 2: `v2` (total supply) — `color: '#8888bb'`, `areaStyle: { opacity: 0.1 }`.
- X-axis: `data: rows.map(r => r.t.slice(0,10))` (date strings).
- Y-axis: `axisLabel: { formatter: v => \`${(v/1000).toFixed(0)}K\` }`.
- Dark theme: set `backgroundColor: '#111118'`, `textStyle: { color: '#c8d0e0' }`.
- `style={{ height: '256px' }}` on the ReactECharts component.

**StakingChart.tsx** (ECharts):
- Option: 2-series stacked area.
  - Series 1: `v` (total staked) — `color: '#f0d8a8'`.
  - Series 2: `v2` (permanently locked) — `color: '#b89850'`, `stack: 'staking'`.
- Same dark theme config as SupplyChart.

**LotteryChart.tsx** (ECharts):
- Option: bar chart using `v` (round number stored in `lottery_round_state.value`).
  Actually `lottery_round_state` is current-state only (round number, bet count, jackpot) so
  the time-series rows represent snapshots of these values over time, not per-round resolution.
  Render `v` (round number progression) as a line and `v2` (active bet count at snapshot) as a
  bar. Use `yAxis: [{ type: 'value', name: 'Round' }, { type: 'value', name: 'Bets' }]` dual-axis.

**PriceDisplay.tsx**:
- Not a time-series chart — renders the current price card from `useVitals()` plus a
  `text-silver-400 text-sm` label: "Historical OHLC chart coming in v1.1 — live data from
  Dexscreener". Shows `total_liquidity_usd` and `pool_count` from `/api/market`. Links to
  Dexscreener for the SLVR token.

---

### Acceptance Check (Plan 03 — maps to Success Criterion 5)

```bash
pnpm dev &
sleep 6

# SC5: /api/history returns rows for each metric
for metric in dividends_apr circulating_supply total_staked_slvr lottery_round_state; do
  COUNT=$(curl -s "http://localhost:3000/api/history?metric=${metric}&range=7d" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['rows']))")
  echo "${metric}: ${COUNT} rows"
done
# Expected: each metric prints a row count (may be 0 if DB is empty — that's OK at plan-time;
# the selector must work and return 200 in all cases)

# Range selector wires correctly — test all ranges on one metric:
for range in 24h 7d 30d 90d all; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/history?metric=dividends_apr&range=${range}")
  echo "${range}: ${STATUS}"
done
# Expected: all return 200

kill %1
```

Visual reviewer check (required):
- Toggle each range button on the Dividends APR chart section.
- Confirm: chart re-renders without full page reload, loading state appears briefly, data updates.

---

## Plan 04 — Methodology Page + AddressLabel Component

**Wave:** 2 (runs parallel with Plan 02; no file conflicts)
**Depends on:** Plan 01
**Requirements:** DATA-04, DATA-05

**What:** The `/methodology` page documents every metric's formula, data source, and contract
address. An `AddressLabel` component wraps any address displayed on the site (footer, methodology
page, market section) with a human-readable label and Blockscout link, pulling from the
`labels.ts` registry built in Phase 4.

---

### Files

```
app/web/src/app/methodology/page.tsx              — Static Server Component; pulls data from
                                                    app/indexer/METHODOLOGY.md at build time
app/web/src/components/common/AddressLabel.tsx    — Renders: [label] [0x…truncated] → Blockscout
app/web/src/components/methodology/MetricSection.tsx — Reusable section: title + formula + source table
app/web/src/components/methodology/ContractTable.tsx — Table of all labeled contracts + Blockscout links
```

---

### Task 4-A: AddressLabel component (DATA-05)

`AddressLabel.tsx`:
- Props: `address: string`, `showFull?: boolean`, `className?: string`
- Imports `getLabel` and `getBlockscoutUrl` from `@/lib/labels`.
- Renders:
  ```tsx
  <a href={getBlockscoutUrl(address)} target="_blank" rel="noopener noreferrer"
     className="inline-flex items-center gap-1 text-accent hover:text-silver-100
                underline-offset-2 hover:underline transition-colors">
    <span className="font-medium">{getLabel(address)}</span>
    <code className="text-silver-400 text-[11px] font-mono">
      {showFull ? address : `${address.slice(0,6)}…${address.slice(-4)}`}
    </code>
    <ExternalLinkIcon className="w-3 h-3 text-silver-400" />
  </a>
  ```
- Use `ExternalLinkIcon` from `lucide-react` (already in shadcn/ui installs).
- If `getLabel(address)` returns the raw address (no match in registry), display the full
  address without truncation and without the label span.

---

### Task 4-B: Methodology page (DATA-04)

`methodology/page.tsx` — Server Component. Build all content inline (no client JS needed).

Structure:
```
/methodology
  ├── Page header: "Methodology" h1 + subtitle "How every number on SLVRline is computed."
  ├── Section: Dividends APR
  │     Formula block (from METHODOLOGY.md §1) rendered as <pre><code>
  │     Annualization window: 7 days, 31,536,000 seconds/year
  │     Caveat: early/high magnitude (reproduce §7 warning)
  │     Data source: dividend_index_update table (V2 contract only for live headline)
  │     V1/V2 discontinuity note (§8): "do not stitch V1 + V2 index values"
  │     Contract: <AddressLabel address="0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" showFull />
  │     Cross-check: link to Goldsky subgraph for independent verification
  │
  ├── Section: Total SLVR Staked
  │     Formula: sum of veSLVR staking + LP staking contract balances
  │     Breakdown: veSLVR (permanent lock vs time-decay)
  │     Contracts: <AddressLabel> for veSLVR staking, LP staking
  │
  ├── Section: Circulating Supply
  │     Formula: on-chain totalSupply() − cumulative burns − team vesting − growth fund
  │     Exclusions: <AddressLabel> for team vesting + growth fund
  │     SLVR token: <AddressLabel address="0x791229...">
  │
  ├── Section: Mining Runway
  │     Formula: (500,000 − total_emitted) / 30d_emission_rate
  │     Current cap: 500,000 SLVR hard max
  │     Emission source: Grid Lottery V2 emission events
  │     Contract: <AddressLabel address="0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" showFull />
  │
  ├── Section: SLVR Price + Liquidity
  │     Source: Dexscreener API (not on-chain; server-side proxied)
  │     Primary pool: <AddressLabel address="0xe365b92239097Ed3322131411DbE15a5c4068eff" showFull />
  │     Liquidity: aggregated across all pools in Dexscreener response
  │
  └── Section: All Protocol Contracts (ContractTable)
        Full table of every address in labels.ts with label, purpose, Blockscout link
```

`MetricSection.tsx`:
- Props: `title: string`, `children: React.ReactNode`
- Renders: `<section className="mb-12">` with `<h2>` + horizontal rule + content.

`ContractTable.tsx`:
- Server Component. Imports `CONTRACT_LABELS` and `WALLET_LABELS` from `@/lib/labels`.
- Renders two `<table>` elements (Production Contracts, Special Wallets).
- Columns: Label | Purpose | Address (as AddressLabel with showFull) | Status
- Status column: "Production" / "Historical" / "Infrastructure" per the categories in PROJECT.md.
- Styled: `border-collapse`, `border border-silver-800`, header row `bg-silver-900`.

---

### Acceptance Check (Plan 04 — maps to Success Criteria 3 + 4)

```bash
pnpm dev &
sleep 6

# SC3: Methodology page exists and contains required sections
curl -s http://localhost:3000/methodology | grep -cE "Dividends APR|Circulating Supply|Mining Runway|SLVR Price|Total SLVR Staked"
# Expected: 5 (one match per required metric section)

# SC3: Formula content is present
curl -s http://localhost:3000/methodology | grep -E "7.day|1e18|604.800|31.536"
# Expected: at least 2 matches (formula notation from METHODOLOGY.md)

# SC4: Blockscout links rendered correctly
curl -s http://localhost:3000/methodology | grep -c "robinhoodchain.blockscout.com/address/0x"
# Expected: >= 10 (one per contract in the methodology sections + ContractTable)

# SC4: AddressLabel renders human labels (not raw hex only)
curl -s http://localhost:3000/methodology | grep -E "SLVR Token|SLVR Hub|Vote Escrow|Grid Lottery"
# Expected: 4 matches (labeled, not raw addresses)

kill %1
```

---

## Plan 05 — Polish + Mobile/375px + Screenshot Verification

**Wave:** 4
**Depends on:** Plans 02, 03, 04
**Requirements:** UI-01, UI-02 (completion), VITALS-01 (screenshot verification)
**Autonomous:** false — requires a checkpoint:human-verify for visual sign-off

**What:** Tighten all responsive breakpoints, verify the 375px screenshot looks share-worthy,
add loading skeleton polish, ensure the methodology page renders well on mobile, fix any
overflow/truncation issues, and wire the footer's `AddressLabel` placeholder from Plan 01.

---

### Files (modifications only — no new files unless needed)

```
app/web/src/app/globals.css                    — Add any missing responsive utilities / print styles
app/web/src/app/page.tsx                       — Final section spacing, meta tags (OG), viewport
app/web/src/app/layout.tsx                     — Wire footer AddressLabel; add <meta> viewport
app/web/src/components/vitals/VitalsStrip.tsx  — Verify 2-col layout at 375px; price card spans full width
app/web/src/components/vitals/VitalCard.tsx    — Ensure primary numeral truncates cleanly at 375px
app/web/src/components/charts/AprChart.tsx     — Ensure chart height 256px on mobile without overflow
```

---

### Task 5-A: Mobile layout audit + fixes

Walk through each component at 375px viewport (using `window.innerWidth = 375` or browser devtools):

**VitalsStrip at 375px:**
- Expected: `grid-cols-2` produces a 2×2 grid for cards 0-3, card 4 (price) in a full-width row.
- Check: No horizontal scroll. No card content overflows. Primary numerals wrap gracefully.
- Fix if needed: Add `min-w-0 overflow-hidden text-ellipsis` to `VitalCard`'s primary value span.

**Charts at 375px:**
- Expected: `ChartSection` title + `TimeRangeSelector` buttons fit on one row without overflow.
- `TimeRangeSelector` at 375px: 5 buttons × ~36px = ~180px — should fit with `flex-wrap` fallback.
- Add `flex-wrap gap-1` to the button container as a safeguard.
- Chart canvas/div: confirm `h-64` respects the parent width (ECharts + lightweight-charts both
  respond to container width when `style={{ width: '100%' }}`).

**Methodology page at 375px:**
- `ContractTable`: add `overflow-x-auto` wrapper so the table scrolls horizontally on mobile
  without breaking page layout.
- Address codes: `text-[10px]` ensures they don't force line-wraps.

**Wire footer AddressLabel:**
- In `SiteFooter.tsx`, replace the `<code>` placeholder from Plan 01 with:
  `<AddressLabel address="0x791229E3EbD6CFdC3D8157f48722684173C29aD9" />`

---

### Task 5-B: OG meta + page title

In `app/web/src/app/layout.tsx`, export a Next.js `metadata` object:

```typescript
export const metadata = {
  title: 'SLVRline — SLVR Protocol Analytics',
  description: 'Independent source of truth for SLVR mining vitals: Dividends APR, staking, supply, runway, and price on Robinhood Chain.',
  openGraph: {
    title: 'SLVRline',
    description: 'Live SLVR protocol analytics — independently computed from indexed chain data.',
    url: 'https://slvrline.xyz',
    siteName: 'SLVRline',
    // og:image intentionally omitted for v1 — add with @vercel/og in v1.1
  },
};
```

In `methodology/page.tsx`, export:
```typescript
export const metadata = { title: 'Methodology — SLVRline' };
```

---

### Task 5-C: Build verification

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm build
# Expected: exits 0, no TypeScript errors, no "missing chunk" warnings
```

---

### Checkpoint: Human Visual Verification

**What was built:** Full SLVRline frontend — vitals strip, freshness indicators, historical charts
with time-range selector, methodology page with labeled contracts, dark silver theme, mobile layout.

**How to verify (exact steps):**

1. `cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web && pnpm dev`
2. Open `http://localhost:3000` in Chrome.
3. Open DevTools → Device toolbar → set to iPhone SE (375 × 667).
4. Verify:
   - All 5 vitals cards visible without horizontal scroll at 375px.
   - Each card shows a colored freshness chip (dot + text).
   - Primary numerals are readable (not truncated into nothing).
   - "SLVRline" wordmark and nav links visible in header.
   - StatusDot present in header (color varies with indexer lag).
5. Take a screenshot of the vitals strip at 375px — confirm it looks share-worthy (clean, dark, numbers prominent).
6. Scroll down: confirm 4 chart sections with `24H / 7D / 30D / 90D / ALL` buttons.
7. Click the `30D` button on Dividends APR — confirm the selector activates (button highlights) and chart re-renders.
8. Navigate to `http://localhost:3000/methodology`:
   - Confirm 5 metric sections present.
   - Confirm at least one contract address renders with a human label and Blockscout link.
   - Click a Blockscout link — confirm it opens `robinhoodchain.blockscout.com/address/0x...`.
9. Resize to 1280px — confirm 5-column vitals strip layout.

**Resume signal:** Type "approved" or describe specific layout issues (card X overflows, chart Y blank, etc.)

---

### Acceptance Check (Plan 05 — maps to all 5 Success Criteria)

```bash
# Final build check
pnpm --filter @slvrline/web build
# Expected: exit 0

# SC1: Vitals strip renders all 5 metrics in page HTML
curl -s http://localhost:3000 | grep -c "APR\|STAKED\|SUPPLY\|RUNWAY\|PRICE"
# Expected: >= 5

# SC2: snapshot_at present per metric (freshness data flows through)
curl -s http://localhost:3000/api/vitals | python3 -m json.tool | grep snapshot_at | wc -l
# Expected: >= 5 (one per metric)

# SC3: Methodology page has formula content
curl -s http://localhost:3000/methodology | grep -E "7-day|annuali" | wc -l
# Expected: >= 1

# SC4: Blockscout links present
curl -s http://localhost:3000/methodology | grep -c blockscout
# Expected: >= 10

# SC5: History API responds 200 for all ranges
for range in 24h 7d 30d 90d all; do
  echo -n "${range}: "; curl -s -o /dev/null -w "%{http_code}\n" \
    "http://localhost:3000/api/history?metric=dividends_apr&range=${range}"
done
# Expected: all 200
```

---

## Must-Haves (Goal-Backward)

```yaml
must_haves:
  truths:
    - "A visitor sees all 5 headline vitals without scrolling on a 375px viewport"
    - "Every live number shows how fresh it is (timestamp or block number)"
    - "The methodology page explains the formula + contracts for every displayed metric"
    - "Every contract address on the site has a human label and Blockscout link"
    - "Switching time range on any chart updates the chart without a page reload"

  artifacts:
    - path: "app/web/src/app/globals.css"
      provides: "Design token @theme block with silver palette + semantic metric colors"
      contains: "--color-silver-950"
    - path: "app/web/src/app/page.tsx"
      provides: "Home page shell with VitalsStrip and chart section slots"
    - path: "app/web/src/components/vitals/VitalsStrip.tsx"
      provides: "5-card responsive grid; 2-col at 375px, 5-col at 1024px+"
    - path: "app/web/src/components/vitals/VitalCard.tsx"
      provides: "Single metric card with primary value, secondary info, FreshnessChip"
    - path: "app/web/src/components/vitals/FreshnessChip.tsx"
      provides: "Colored dot + time-since-snapshot label"
    - path: "app/web/src/components/vitals/StatusDot.tsx"
      provides: "Header indexer lag indicator wired to /api/status"
    - path: "app/web/src/hooks/useVitals.ts"
      provides: "SWR polling of /api/vitals + /api/market at 10s/60s intervals"
    - path: "app/web/src/lib/format.ts"
      provides: "formatAPR, formatSLVR, formatUSD, formatRunway, freshnessLabel helpers"
    - path: "app/web/src/components/charts/TimeRangeSelector.tsx"
      provides: "24H/7D/30D/90D/ALL button group; onChange fires without page reload"
    - path: "app/web/src/components/charts/ChartSection.tsx"
      provides: "Reusable section: title + selector + chart slot; manages range state"
    - path: "app/web/src/components/charts/AprChart.tsx"
      provides: "lightweight-charts line chart for dividends_apr time-series"
    - path: "app/web/src/components/charts/SupplyChart.tsx"
      provides: "ECharts stacked-area for circulating vs total supply"
    - path: "app/web/src/components/charts/StakingChart.tsx"
      provides: "ECharts stacked-area for total staked vs permanent lock"
    - path: "app/web/src/components/charts/LotteryChart.tsx"
      provides: "ECharts bar/line for lottery_round_state snapshots"
    - path: "app/web/src/app/methodology/page.tsx"
      provides: "Static Server Component with all 5 metric formula sections + ContractTable"
    - path: "app/web/src/components/common/AddressLabel.tsx"
      provides: "Renders: [human label] [0x…truncated] as Blockscout link; uses labels.ts"
    - path: "app/web/src/components/methodology/ContractTable.tsx"
      provides: "Table of all contracts from labels.ts with Blockscout links"

  key_links:
    - from: "VitalsStrip.tsx"
      to: "/api/vitals"
      via: "useVitals hook (SWR 10s interval)"
      pattern: "useSWR.*api/vitals"
    - from: "VitalsStrip.tsx"
      to: "/api/market"
      via: "useVitals hook (SWR 60s interval)"
      pattern: "useSWR.*api/market"
    - from: "FreshnessChip.tsx"
      to: "snapshot_at field from /api/vitals response"
      via: "freshnessLabel(snapshot_at) + freshnessColor(snapshot_at)"
      pattern: "freshnessLabel|freshnessColor"
    - from: "StatusDot.tsx"
      to: "/api/status"
      via: "useStatus hook (SWR 5s interval)"
      pattern: "useSWR.*api/status"
    - from: "ChartSection.tsx"
      to: "/api/history"
      via: "useHistory(metric, range) — SWR with [url, metric, range] cache key"
      pattern: "useSWR.*api/history"
    - from: "TimeRangeSelector.tsx"
      to: "ChartSection range state"
      via: "onChange prop → useState in ChartSection"
      pattern: "onChange.*setRange|setRange.*onChange"
    - from: "AddressLabel.tsx"
      to: "labels.ts registry"
      via: "getLabel(address) + getBlockscoutUrl(address)"
      pattern: "getLabel|getBlockscoutUrl"
    - from: "ContractTable.tsx"
      to: "labels.ts CONTRACT_LABELS + WALLET_LABELS"
      via: "direct import; Server Component (no client JS)"
      pattern: "CONTRACT_LABELS|WALLET_LABELS"
    - from: "methodology/page.tsx"
      to: "AddressLabel for each production contract address"
      via: "inline <AddressLabel address='0x...' showFull /> per section"
      pattern: "AddressLabel.*showFull"
```

---

## Summary: Wave Execution Order

| Wave | Plan | Requirements | Autonomous | Notes |
|------|------|-------------|------------|-------|
| 1 | Plan 01 — Theme + Layout | UI-02 | Yes | All other plans depend on this |
| 2 | Plan 02 — Vitals Strip | DATA-03, VITALS-01, VITALS-02, DIV-02 | Yes | Parallel with Plan 04 |
| 2 | Plan 04 — Methodology + AddressLabel | DATA-04, DATA-05 | Yes | Parallel with Plan 02 |
| 3 | Plan 03 — Charts + Selector | DATA-03, UI-01 | Yes | After Plan 02 (uses page slots) |
| 4 | Plan 05 — Polish + Verification | UI-01, UI-02 (done), VITALS-01 (screenshot) | No (checkpoint) | After all prior plans |

---

## Component Tree

```
app/web/src/
├── app/
│   ├── globals.css                         ← @theme tokens (silver palette, semantic colors)
│   ├── layout.tsx                          ← dark shell, SiteHeader, SiteFooter
│   ├── page.tsx                            ← Home: VitalsStrip + 5× ChartSection + PriceDisplay
│   └── methodology/
│       └── page.tsx                        ← Server Component: 5 MetricSection + ContractTable
│
├── components/
│   ├── layout/
│   │   ├── SiteHeader.tsx                  ← wordmark + nav + StatusDot
│   │   ├── SiteFooter.tsx                  ← tagline + AddressLabel(SLVR token)
│   │   └── PageContainer.tsx               ← max-w-[1280px] centering wrapper
│   │
│   ├── vitals/
│   │   ├── VitalsStrip.tsx                 ← 5-card grid (2→3→5 col breakpoints)
│   │   ├── VitalCard.tsx                   ← label + primary value + secondary + FreshnessChip
│   │   ├── FreshnessChip.tsx               ← colored dot + "Xs ago" + "block #N"
│   │   └── StatusDot.tsx                   ← header indexer lag indicator (green/amber/red)
│   │
│   ├── charts/
│   │   ├── TimeRangeSelector.tsx           ← 24H/7D/30D/90D/ALL button group
│   │   ├── ChartSection.tsx                ← title + selector + chart slot (render-prop)
│   │   ├── AprChart.tsx                    ← lightweight-charts line (dividends_apr)
│   │   ├── SupplyChart.tsx                 ← ECharts stacked area (circ vs total supply)
│   │   ├── StakingChart.tsx                ← ECharts stacked area (ve-staked vs LP + perm-lock)
│   │   ├── LotteryChart.tsx                ← ECharts bar+line (lottery_round_state snapshots)
│   │   └── PriceDisplay.tsx                ← Current price card + Dexscreener attribution
│   │
│   ├── common/
│   │   └── AddressLabel.tsx                ← [label] [0x…] → Blockscout (uses labels.ts)
│   │
│   └── methodology/
│       ├── MetricSection.tsx               ← Reusable section: h2 + hr + content
│       └── ContractTable.tsx               ← Full contract table from CONTRACT_LABELS
│
├── hooks/
│   ├── useVitals.ts                        ← SWR /api/vitals (10s) + /api/market (60s)
│   ├── useStatus.ts                        ← SWR /api/status (5s)
│   └── useHistory.ts                       ← SWR /api/history?metric=&range= (5min HTTP TTL)
│
└── lib/
    ├── db.ts                               ← postgres.js singleton (Phase 4)
    ├── cache.ts                            ← in-process TTL cache (Phase 4)
    ├── labels.ts                           ← CONTRACT_LABELS + WALLET_LABELS registry (Phase 4)
    └── format.ts                           ← formatAPR, formatSLVR, formatUSD, freshnessLabel
```

---

*Phase 5 plan — SLVRline branded frontend*
*Written: 2026-07-25*
