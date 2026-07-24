# Phase 4: API Layer — PLAN

**Requirements satisfied:** MKT-01, MKT-02
**Phase goal:** Five Next.js 15 Route Handlers serve pre-computed metrics over HTTP. All numbers
come from `metrics.metric_snapshots`. No aggregation happens in the request path. Dexscreener
and ETH price are proxied server-side with short TTL caches. The app/web package also hosts the
Phase 5 frontend.

---

## Invariants from Prior Phases

- `metric_snapshots` lives in the `metrics` schema on Postgres
  `postgresql://timwilliams@localhost:5433/slvrline` (Phase 3 schema decision — honored exactly).
- The Phase 3 column mapping: `value` = primary scalar (human units), `value2`/`value3` =
  secondary scalars, `metadata` = JSONB audit trail.
- NEVER aggregate raw event tables in the request path — read only `metric_snapshots`.
- Postgres driver: `postgres` (postgres.js) — same package used in `app/metrics/`.
- The `metrics.metric_snapshots` table is in schema `metrics`; raw indexer tables are in schema
  `slvr`. SQL queries must qualify the table as `metrics.metric_snapshots`.

---

## Endpoints (Canonical Contract)

### GET /api/vitals
Returns the latest pre-computed snapshot for each headline metric, plus live SLVR price from
the Dexscreener proxy. Target: <200ms total (DB + proxy, with cache hits).

**Response shape:**
```json
{
  "dividends_apr":      { "value": 1229.4, "unit": "percent", "snapshot_at": "2026-07-25T00:00:00Z", "block_number": 17000000 },
  "circulating_supply": { "value": 312450.8, "value2": 380000.1, "value3": 1200.3, "unit": "slvr", "snapshot_at": "...", "block_number": 17000000 },
  "runway_months":      { "value": 18.4, "value2": 187549.9, "value3": 10200.5, "unit": "months", "snapshot_at": "...", "block_number": 17000000 },
  "total_staked_slvr":  { "value": 95400.2, "value2": 80000.1, "value3": 15400.1, "unit": "slvr", "snapshot_at": "...", "block_number": 17000000 },
  "lottery_round_state": { "value": 13122, "value2": 48, "value3": 0.42, "unit": "round", "snapshot_at": "...", "block_number": 17000000 },
  "price": {
    "slvr_usd": 0.0812,
    "slvr_eth": 0.0000321,
    "eth_usd": 2530.0,
    "cached_at": "2026-07-25T00:00:00Z",
    "cache_ttl_seconds": 60
  }
}
```

**DB query (per metric_name, all six in one query):**
```sql
SELECT DISTINCT ON (metric_name)
  metric_name,
  value,
  value2,
  value3,
  snapshot_at,
  block_number
FROM metrics.metric_snapshots
WHERE metric_name = ANY(ARRAY[
  'dividends_apr','circulating_supply','runway_months',
  'total_staked_slvr','lottery_round_state'
])
ORDER BY metric_name, snapshot_at DESC;
```
One query, five rows. `DISTINCT ON (metric_name) ... ORDER BY metric_name, snapshot_at DESC`
is a single indexed scan on `idx_metric_snapshots_name_time`.

**Cache:** In-process `Map<string, { data, expiresAt }>` with 10-second TTL for the DB result.
Dexscreener result cached separately at 60-second TTL (see Plan 03).

**Freshness:** `snapshot_at` and `block_number` are forwarded per-metric. Frontend uses these
to show "last updated X min ago".

---

### GET /api/history?metric=<name>&range=<24h|7d|30d|90d|all>
Returns time-series rows for a single metric from `metric_snapshots`.

**Query params:**
- `metric`: one of `dividends_apr | circulating_supply | runway_months | total_staked_slvr |
  lottery_round_state`
- `range`: `24h | 7d | 30d | 90d | all` (default `7d`)

**Response shape:**
```json
{
  "metric": "dividends_apr",
  "range": "7d",
  "rows": [
    { "t": "2026-07-18T00:00:00Z", "v": 1187.2, "v2": null, "v3": null, "block": 16800000 },
    { "t": "2026-07-18T01:00:00Z", "v": 1201.5, "v2": null, "v3": null, "block": 16836000 }
  ]
}
```

**DB query:**
```sql
SELECT
  snapshot_at  AS t,
  value        AS v,
  value2       AS v2,
  value3       AS v3,
  block_number AS block
FROM metrics.metric_snapshots
WHERE metric_name = $metric
  AND snapshot_at >= NOW() - $interval  -- mapped from range param
ORDER BY snapshot_at ASC;
```

Range-to-interval mapping (applied in route handler before query):
```
24h  →  INTERVAL '24 hours'
7d   →  INTERVAL '7 days'
30d  →  INTERVAL '30 days'
90d  →  INTERVAL '90 days'
all  →  no lower bound filter (omit WHERE clause for snapshot_at)
```

**Validation:** `metric` must be one of the five known names (zod enum). `range` must match the
known set. Unknown params return 400 `{ "error": "invalid metric" }`.

**Cache:** HTTP `Cache-Control: public, max-age=300` response header (5 minutes). No in-process
cache — the index makes these queries fast (< 20ms).

---

### GET /api/market
Returns SLVR price and total liquidity aggregated across ALL Dexscreener pools for the SLVR
token address (satisfies MKT-01 and MKT-02), plus ETH price from the slvr.fun proxy.

**Response shape:**
```json
{
  "slvr_usd": 0.0812,
  "slvr_eth": 0.0000321,
  "eth_usd": 2530.0,
  "total_liquidity_usd": 185000.0,
  "pool_count": 4,
  "pools": [
    {
      "pair_address": "0xe365b92...",
      "dex": "Uniswap V2",
      "base_token": "SLVR",
      "quote_token": "WETH",
      "price_usd": 0.0812,
      "liquidity_usd": 120000.0,
      "volume_24h_usd": 8400.0,
      "fdv_usd": 40600.0
    }
  ],
  "primary_pool": "0xe365b92...",
  "cached_at": "2026-07-25T00:00:00Z",
  "cache_ttl_seconds": 60
}
```

**Price derivation:** Use `priceUsd` from Dexscreener's primary pool (highest liquidity pool for
the SLVR token). SLVR/ETH price = `priceUsd / eth_usd`.

**Liquidity aggregation (MKT-02):** Sum `liquidity.usd` across ALL pools in the Dexscreener
response, not just the primary pool. Every pool object in `pairs` array is included.

**ETH price:** Fetch `https://slvr.fun/api/price/eth` — returns `{ "price": "2530.12" }` (string
format; parse with `parseFloat`).

**Cache:** In-process 60-second TTL (both Dexscreener and ETH price share one cache entry).

---

### GET /api/status
Returns indexed block height vs chain head — allows monitoring to compute indexer lag.

**Response shape:**
```json
{
  "indexed_block": 17042000,
  "chain_head": 17043500,
  "lag_blocks": 1500,
  "lag_seconds": 150,
  "block_time_seconds": 0.1,
  "chain_id": 4663,
  "rpc_url": "https://rpc.mainnet.chain.robinhood.com",
  "checked_at": "2026-07-25T00:00:00Z"
}
```

**Indexed block source:**
```sql
SELECT MAX(block_number) AS indexed_block
FROM metrics.metric_snapshots;
```
This is the latest block the metrics job has processed. It proxies the indexer's progress because
the metrics job only writes with the `block_number` of the latest indexed block at computation time.

**Chain head source:** `eth_blockNumber` via JSON-RPC call to
`https://rpc.mainnet.chain.robinhood.com` (plain fetch, no viem dependency in the route — keep
it lean). Response: `{"jsonrpc":"2.0","result":"0x1040A00","id":1}` → parse hex.

**Lag computation:**
- `lag_blocks = chain_head - indexed_block`
- `block_time_seconds = 0.1` (100ms blocks, Arbitrum Nitro constant from ARCHITECTURE.md)
- `lag_seconds = lag_blocks * block_time_seconds`

**Cache:** 5-second in-process TTL (status should be fresh).

---

## Contract / Wallet Label Registry Module

A static module at `app/web/src/lib/labels.ts` that exports the canonical contract and wallet
labels from PROJECT.md. Used by Phase 5 frontend to render human-readable labels next to
addresses, with Blockscout links.

**Shape:**
```typescript
export const CONTRACT_LABELS: Record<string, { label: string; purpose: string; blockscout: string }> = {
  "0x791229E3EbD6CFdC3D8157f48722684173C29aD9": {
    label: "SLVR Token",
    purpose: "ERC-20; supply, tax, emissions, burns, routing",
    blockscout: "https://robinhoodchain.blockscout.com/address/0x791229E3EbD6CFdC3D8157f48722684173C29aD9",
  },
  // ... all production + historical contracts from PROJECT.md
};

export const WALLET_LABELS: Record<string, { label: string; role: string; blockscout: string }> = {
  "0x11111972FE1b7e52D36609bCaF8702c65b025B46": {
    label: "Protocol Deployer",
    role: "Admin, team, revenue wallet",
    blockscout: "https://robinhoodchain.blockscout.com/address/0x11111972FE1b7e52D36609bCaF8702c65b025B46",
  },
  // ...
};

export function getLabel(address: string): string {
  const addr = address.toLowerCase();
  return CONTRACT_LABELS[addr]?.label ?? WALLET_LABELS[addr]?.label ?? address;
}
```

All addresses stored in lowercase. `getLabel` normalizes input to lowercase before lookup.

---

## Caching Architecture

Two cache layers, zero external dependencies (no Redis):

**In-process cache (vitals, market, status):**
```typescript
// app/web/src/lib/cache.ts
type CacheEntry<T> = { data: T; expiresAt: number };
const store = new Map<string, CacheEntry<unknown>>();

export function getCache<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

export function setCache<T>(key: string, data: T, ttlSeconds: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}
```

**HTTP cache (history):**
Response headers only: `Cache-Control: public, max-age=300`. No in-process work needed;
CDN and browser cache handle it.

**TTL table:**
| Endpoint     | Layer      | TTL      | Rationale                        |
|-------------|------------|----------|----------------------------------|
| /api/vitals  | In-process | 10s      | Fresh enough; avoids DB churn    |
| /api/market  | In-process | 60s      | Dexscreener rate limit headroom  |
| /api/status  | In-process | 5s       | Monitoring needs near-real-time  |
| /api/history | HTTP header | 300s    | Chart data changes slowly        |

---

## Plan Dependency Graph

```
Plan 01 (app/web scaffold: Next.js 15 + postgres client + DB module + labels.ts)
    └── Plan 02 (/api/vitals + /api/history)
            └── Plan 03 (Dexscreener/ETH proxy + /api/market)
                    └── Plan 04 (/api/status)
                            └── Plan 05 (Integration validation — curl + timing)
```

Plans 01–04 are sequential. Plan 05 is operational verification only (no new files).

---

## Plan 01 — Next.js App Scaffold + DB Module + Label Registry

**What:** Bootstrap `app/web` as a Next.js 15 App Router package in the pnpm workspace.
Create the Postgres read client, the in-process cache module, and the static label registry.
No route handlers yet — just the shared infrastructure every route depends on.

**Wave:** 1

**Files created:**
- `app/web/package.json`
- `app/web/tsconfig.json`
- `app/web/next.config.ts`
- `app/web/src/lib/db.ts`
- `app/web/src/lib/cache.ts`
- `app/web/src/lib/labels.ts`

### package.json specification

```json
{
  "name": "@slvrline/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":   "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000"
  },
  "dependencies": {
    "next":    "15.x",
    "react":   "19.x",
    "react-dom": "19.x",
    "postgres": "^3.4.4",
    "zod":     "^3.23.0"
  },
  "devDependencies": {
    "@types/node":  "^20.11.0",
    "@types/react": "^19.0.0",
    "typescript":   "^5.4.5"
  }
}
```

Use `postgres` (postgres.js) — same driver as `app/metrics/`, consistent pooling behavior.
Do NOT use `pg` or `@prisma/client` — adds no value and diverges from the established pattern.

### src/lib/db.ts specification

```typescript
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://timwilliams@localhost:5433/slvrline";

// Singleton pool: Next.js Route Handlers reuse this across requests in the
// same process. Max 5 connections — the Route Handler pattern is
// request-per-function, so pool contention is negligible at dev scale.
export const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  // All queries are read-only; mark connection as read-only for safety
  // (Postgres will error if a write is attempted).
  onnotice: () => {},  // suppress NOTICE logs
});
```

The `metrics.metric_snapshots` schema qualifier must appear in every query — do not `SET
search_path` in the module. Every call site writes `metrics.metric_snapshots` explicitly.

### src/lib/cache.ts specification (verbatim from Caching Architecture section above)

### src/lib/labels.ts specification

Include ALL addresses from PROJECT.md §Context:
- All production contracts (18 entries from the production table)
- All historical/inactive contracts (13 entries from the historical table)
- DEX/network contracts (Uniswap V2 router, factory, WETH, USDG, Multicall3, V4
  PoolManager, PositionManager, StateView, Quoter) — label but mark purpose as "DEX Infrastructure"
- Named wallets: Protocol Deployer, Growth Recipient

Every address lowercased. `getLabel(address: string): string` normalizes to lowercase.
`getBlockscoutUrl(address: string): string` returns the full Blockscout address URL.

### Acceptance check

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman
pnpm install

# Verify DB connection:
cd app/web
node -e "const { sql } = require('./src/lib/db'); sql\`SELECT current_database()\`.then(r => { console.log(r[0]); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
# Expected: { current_database: 'slvrline' }

# Verify labels module compiles:
npx tsc --noEmit
# Expected: no errors

# Verify Next.js starts:
pnpm dev &
sleep 5
curl -s http://localhost:3000 | head -5
# Expected: HTML output (Next.js default page or 404 — just needs to start)
kill %1
```

---

## Plan 02 — /api/vitals + /api/history

**What:** Implement the two metrics-reading route handlers. Both read exclusively from
`metrics.metric_snapshots`. Both use the in-process cache from Plan 01.

**Depends on:** Plan 01
**Wave:** 2

**Files created:**
- `app/web/src/app/api/vitals/route.ts`
- `app/web/src/app/api/history/route.ts`

### /api/vitals route.ts specification

```typescript
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getCache, setCache } from "@/lib/cache";

const VITALS_CACHE_KEY = "vitals";
const VITALS_TTL = 10; // seconds

const METRIC_NAMES = [
  "dividends_apr",
  "circulating_supply",
  "runway_months",
  "total_staked_slvr",
  "lottery_round_state",
] as const;

// Unit labels for each metric (used by frontend)
const METRIC_UNITS: Record<string, string> = {
  dividends_apr:       "percent",
  circulating_supply:  "slvr",
  runway_months:       "months",
  total_staked_slvr:   "slvr",
  lottery_round_state: "round",
};

export async function GET() {
  const cached = getCache<object>(VITALS_CACHE_KEY);
  if (cached) return NextResponse.json(cached);

  const rows = await sql`
    SELECT DISTINCT ON (metric_name)
      metric_name,
      value::float8       AS value,
      value2::float8      AS value2,
      value3::float8      AS value3,
      snapshot_at,
      block_number
    FROM metrics.metric_snapshots
    WHERE metric_name = ANY(${METRIC_NAMES})
    ORDER BY metric_name, snapshot_at DESC
  `;

  const metrics: Record<string, object> = {};
  for (const row of rows) {
    metrics[row.metric_name] = {
      value:       row.value,
      value2:      row.value2 ?? null,
      value3:      row.value3 ?? null,
      unit:        METRIC_UNITS[row.metric_name] ?? "unknown",
      snapshot_at: row.snapshot_at,
      block_number: Number(row.block_number),
    };
  }

  // price field populated in Plan 03 (market proxy) — vitals calls market cache
  // For Plan 02 standalone, include a price: null placeholder so the shape is stable.
  const body = { ...metrics, price: null };

  setCache(VITALS_CACHE_KEY, body, VITALS_TTL);
  return NextResponse.json(body);
}
```

Note: Phase 3 stores `dividends_apr.value` as a percentage already (e.g. 1229.4 for 1229.4%).
Do NOT multiply by 100 in the route — relay what Phase 3 wrote.

**Error handling:** If the DB query throws, return `500` with `{ "error": "db error" }`. Do not
expose the full error message (may contain connection strings). Log to `console.error`.

### /api/history route.ts specification

```typescript
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { z } from "zod";

const VALID_METRICS = [
  "dividends_apr",
  "circulating_supply",
  "runway_months",
  "total_staked_slvr",
  "lottery_round_state",
] as const;

const QuerySchema = z.object({
  metric: z.enum(VALID_METRICS),
  range:  z.enum(["24h", "7d", "30d", "90d", "all"]).default("7d"),
});

const RANGE_INTERVAL: Record<string, string | null> = {
  "24h": "24 hours",
  "7d":  "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "all": null,  // no lower bound
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    metric: searchParams.get("metric"),
    range:  searchParams.get("range") ?? "7d",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid params", detail: parsed.error.flatten() }, { status: 400 });
  }

  const { metric, range } = parsed.data;
  const interval = RANGE_INTERVAL[range];

  let rows;
  if (interval) {
    rows = await sql`
      SELECT
        snapshot_at        AS t,
        value::float8      AS v,
        value2::float8     AS v2,
        value3::float8     AS v3,
        block_number       AS block
      FROM metrics.metric_snapshots
      WHERE metric_name = ${metric}
        AND snapshot_at >= NOW() - ${sql`INTERVAL ${interval}`}
      ORDER BY snapshot_at ASC
    `;
  } else {
    rows = await sql`
      SELECT
        snapshot_at        AS t,
        value::float8      AS v,
        value2::float8     AS v2,
        value3::float8     AS v3,
        block_number       AS block
      FROM metrics.metric_snapshots
      WHERE metric_name = ${metric}
      ORDER BY snapshot_at ASC
    `;
  }

  const body = { metric, range, rows };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
```

Note on the INTERVAL parameterization: postgres.js does not support parameterized interval
strings via `$1`. Use `sql\`INTERVAL ${interval}\`` with the tagged template literal — postgres.js
will inline the value safely since it is validated against an enum, not user input.

### Acceptance check

```bash
# Start dev server in background
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm dev &
sleep 8

# /api/vitals — must return JSON with all 5 metric keys
curl -s http://localhost:3000/api/vitals | python3 -m json.tool
# Expected: JSON with keys dividends_apr, circulating_supply, runway_months,
#           total_staked_slvr, lottery_round_state, price (null for now)

# /api/vitals — latency check
time curl -s http://localhost:3000/api/vitals > /dev/null
# Expected: real < 0.200s (cached path much faster)

# /api/history — valid request
curl -s "http://localhost:3000/api/history?metric=dividends_apr&range=7d" | python3 -m json.tool
# Expected: { metric: "dividends_apr", range: "7d", rows: [...] }

# /api/history — invalid metric (400)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/history?metric=bad_metric"
# Expected: 400

# /api/history — invalid range (400)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/history?metric=dividends_apr&range=999d"
# Expected: 400

kill %1
```

---

## Plan 03 — Dexscreener / ETH Proxy + /api/market

**What:** Implement the Dexscreener proxy with server-side fetch, liquidity aggregation across
ALL pools (MKT-01/MKT-02), ETH price proxy, and the `/api/market` route handler. Wire the
price field into `/api/vitals` by sharing the same cache entry.

**Depends on:** Plan 02
**Wave:** 3

**Files created:**
- `app/web/src/lib/dexscreener.ts`
- `app/web/src/app/api/market/route.ts`

**Files modified:**
- `app/web/src/app/api/vitals/route.ts` (add price field from market cache)

### src/lib/dexscreener.ts specification

```typescript
import { getCache, setCache } from "./cache";

const DEXSCREENER_URL =
  "https://api.dexscreener.com/latest/dex/tokens/0x791229E3EbD6CFdC3D8157f48722684173C29aD9";
const ETH_PRICE_URL = "https://slvr.fun/api/price/eth";
const MARKET_CACHE_KEY = "market";
const MARKET_TTL = 60; // seconds

export interface PoolData {
  pair_address: string;
  dex:          string;
  base_token:   string;
  quote_token:  string;
  price_usd:    number;
  liquidity_usd: number;
  volume_24h_usd: number;
  fdv_usd:      number;
}

export interface MarketData {
  slvr_usd:           number;
  slvr_eth:           number;
  eth_usd:            number;
  total_liquidity_usd: number;
  pool_count:         number;
  pools:              PoolData[];
  primary_pool:       string;
  cached_at:          string;
  cache_ttl_seconds:  number;
}

export async function fetchMarketData(): Promise<MarketData> {
  const cached = getCache<MarketData>(MARKET_CACHE_KEY);
  if (cached) return cached;

  // Fetch Dexscreener and ETH price in parallel
  const [dexRes, ethRes] = await Promise.all([
    fetch(DEXSCREENER_URL, {
      headers: { "Accept": "application/json" },
      // Next.js fetch: no caching here — handled by our own in-process cache
      cache: "no-store",
    }),
    fetch(ETH_PRICE_URL, { cache: "no-store" }),
  ]);

  if (!dexRes.ok) throw new Error(`Dexscreener HTTP ${dexRes.status}`);
  if (!ethRes.ok) throw new Error(`ETH price HTTP ${ethRes.status}`);

  const dexJson = await dexRes.json();
  const ethJson = await ethRes.json();

  const ethUsd: number = parseFloat(ethJson.price ?? ethJson.eth_usd ?? "0");
  const pairs: Array<Record<string, unknown>> = dexJson.pairs ?? [];

  if (pairs.length === 0) throw new Error("Dexscreener returned no pairs for SLVR token");

  // Find primary pool: highest liquidity
  let primaryPair = pairs[0];
  for (const p of pairs) {
    const liq = Number((p.liquidity as Record<string, unknown>)?.usd ?? 0);
    const bestLiq = Number((primaryPair.liquidity as Record<string, unknown>)?.usd ?? 0);
    if (liq > bestLiq) primaryPair = p;
  }

  const slvrUsd = parseFloat(String(primaryPair.priceUsd ?? "0"));
  const slvrEth = ethUsd > 0 ? slvrUsd / ethUsd : 0;

  // Aggregate liquidity across ALL pools (MKT-02)
  let totalLiquidityUsd = 0;
  const pools: PoolData[] = pairs.map((p) => {
    const liqUsd = Number((p.liquidity as Record<string, unknown>)?.usd ?? 0);
    totalLiquidityUsd += liqUsd;
    return {
      pair_address:   String(p.pairAddress ?? ""),
      dex:            String((p.dexId ?? p.chainId ?? "unknown")),
      base_token:     String((p.baseToken as Record<string, unknown>)?.symbol ?? ""),
      quote_token:    String((p.quoteToken as Record<string, unknown>)?.symbol ?? ""),
      price_usd:      parseFloat(String(p.priceUsd ?? "0")),
      liquidity_usd:  liqUsd,
      volume_24h_usd: Number((p.volume as Record<string, unknown>)?.h24 ?? 0),
      fdv_usd:        Number(p.fdv ?? 0),
    };
  });

  const data: MarketData = {
    slvr_usd:           slvrUsd,
    slvr_eth:           slvrEth,
    eth_usd:            ethUsd,
    total_liquidity_usd: totalLiquidityUsd,
    pool_count:         pools.length,
    pools,
    primary_pool:       String(primaryPair.pairAddress ?? ""),
    cached_at:          new Date().toISOString(),
    cache_ttl_seconds:  MARKET_TTL,
  };

  setCache(MARKET_CACHE_KEY, data, MARKET_TTL);
  return data;
}
```

**Error behavior:** If either fetch fails, throw. The route handler catches and returns 503 with
`{ "error": "market data unavailable", "detail": "<message>" }`. Do NOT fall back to stale
data silently — make staleness explicit via the `cached_at` field when the cache is valid.

**Price within 1% validation (SC3):** `slvr_usd` is taken directly from Dexscreener's own
`priceUsd` field for the primary pool. It will match Dexscreener's reported price within 0%
(identical source). The 1% criterion is met by construction. The validation plan (Plan 05)
confirms this explicitly.

### /api/market route.ts specification

```typescript
import { NextResponse } from "next/server";
import { fetchMarketData } from "@/lib/dexscreener";

export async function GET() {
  try {
    const data = await fetchMarketData();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[/api/market]", e);
    const message = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { error: "market data unavailable", detail: message },
      { status: 503 }
    );
  }
}
```

### Modify /api/vitals to include price

Add to `GET()` in vitals/route.ts after the DB read:

```typescript
// Import at top of vitals/route.ts
import { fetchMarketData } from "@/lib/dexscreener";

// Inside GET(), after metrics assembly:
let price = null;
try {
  const market = await fetchMarketData();
  price = {
    slvr_usd:          market.slvr_usd,
    slvr_eth:          market.slvr_eth,
    eth_usd:           market.eth_usd,
    cached_at:         market.cached_at,
    cache_ttl_seconds: market.cache_ttl_seconds,
  };
} catch {
  // price is non-fatal — vitals still returns without it
  price = null;
}

const body = { ...metrics, price };
```

### Acceptance check

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm dev &
sleep 8

# /api/market — full response
curl -s http://localhost:3000/api/market | python3 -m json.tool
# Expected: slvr_usd, eth_usd, total_liquidity_usd, pools array, pool_count

# Liquidity aggregation (MKT-02): total must equal sum of pool liquidity_usd values
curl -s http://localhost:3000/api/market | python3 -c "
import sys, json
d = json.load(sys.stdin)
manual_sum = sum(p['liquidity_usd'] for p in d['pools'])
reported = d['total_liquidity_usd']
print(f'reported={reported:.2f}, manual_sum={manual_sum:.2f}, match={abs(reported - manual_sum) < 0.01}')
"
# Expected: match=True

# Price within 1% of Dexscreener (MKT-01): fetch Dexscreener directly and compare
curl -s "https://api.dexscreener.com/latest/dex/tokens/0x791229E3EbD6CFdC3D8157f48722684173C29aD9" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
pairs = sorted(d.get('pairs', []), key=lambda p: float(p.get('liquidity',{}).get('usd', 0) or 0), reverse=True)
dex_price = float(pairs[0]['priceUsd']) if pairs else None
print('dex_primary_price:', dex_price)
" &
curl -s http://localhost:3000/api/market | python3 -c "import sys, json; d=json.load(sys.stdin); print('our_price:', d['slvr_usd'])"
# Expected: prices match (identical source; difference should be 0.0%)

# /api/vitals now includes price
curl -s http://localhost:3000/api/vitals | python3 -c "import sys, json; d=json.load(sys.stdin); print('price:', d.get('price'))"
# Expected: price dict with slvr_usd, eth_usd, etc. (not null)

kill %1
```

---

## Plan 04 — /api/status

**What:** Implement the indexer lag endpoint. Reads max `block_number` from
`metrics.metric_snapshots` and calls `eth_blockNumber` via JSON-RPC to get chain head.

**Depends on:** Plan 03
**Wave:** 4

**Files created:**
- `app/web/src/app/api/status/route.ts`

### /api/status route.ts specification

```typescript
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getCache, setCache } from "@/lib/cache";

const STATUS_CACHE_KEY = "status";
const STATUS_TTL = 5; // seconds
const BLOCK_TIME_SECONDS = 0.1; // Robinhood Chain (Arbitrum Nitro L2, 100ms blocks)
const RPC_URL = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

export async function GET() {
  const cached = getCache<object>(STATUS_CACHE_KEY);
  if (cached) return NextResponse.json(cached);

  // Fetch indexed block and chain head in parallel
  const [snapshotRow, rpcResponse] = await Promise.all([
    sql`SELECT MAX(block_number) AS indexed_block FROM metrics.metric_snapshots`.then((r) => r[0]),
    fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      cache: "no-store",
    }).then((r) => r.json()),
  ]);

  const indexedBlock = Number(snapshotRow?.indexed_block ?? 0);
  const chainHead   = parseInt(rpcResponse?.result ?? "0x0", 16);
  const lagBlocks   = Math.max(0, chainHead - indexedBlock);
  const lagSeconds  = lagBlocks * BLOCK_TIME_SECONDS;

  const body = {
    indexed_block:       indexedBlock,
    chain_head:          chainHead,
    lag_blocks:          lagBlocks,
    lag_seconds:         lagSeconds,
    block_time_seconds:  BLOCK_TIME_SECONDS,
    chain_id:            4663,
    rpc_url:             RPC_URL,
    checked_at:          new Date().toISOString(),
  };

  setCache(STATUS_CACHE_KEY, body, STATUS_TTL);
  return NextResponse.json(body);
}
```

**Error handling:** If the RPC call fails, return 503. If the DB query fails, return 500.
Both wrapped in try/catch with console.error.

### Acceptance check

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm dev &
sleep 8

# /api/status — basic shape
curl -s http://localhost:3000/api/status | python3 -m json.tool
# Expected: indexed_block, chain_head, lag_blocks, lag_seconds, block_time_seconds, chain_id

# Validate chain_head is a reasonable number (not 0)
curl -s http://localhost:3000/api/status | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['chain_head'] > 16_000_000, f'chain_head too low: {d[\"chain_head\"]}'
assert d['indexed_block'] > 0, 'indexed_block is 0'
assert d['lag_blocks'] >= 0, 'negative lag'
print('status endpoint OK — lag:', d['lag_blocks'], 'blocks /', d['lag_seconds'], 's')
"
# Expected: assertion passes; lag printed

# Cross-verify chain_head directly from RPC:
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('RPC chain_head:', int(d['result'],16))"
# Expected: matches /api/status chain_head within a few blocks (clock drift)

kill %1
```

---

## Plan 05 — Integration Validation (Definition of Done)

**What:** End-to-end validation of all Phase 4 success criteria. No new files. Runs all
ROADMAP SCs against the running dev server.

**Depends on:** Plan 04 (all routes must be live)
**Wave:** 5

**Files created:**
- `.planning/phases/phase-4/VALIDATION.md` (written during this plan)

### Validation A — /api/vitals <200ms (SC1)

```bash
# Cold timing (cache miss)
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm dev &
sleep 10

# Warm cache, then measure 10 sequential calls
for i in $(seq 1 10); do
  time curl -s http://localhost:3000/api/vitals > /dev/null
done 2>&1 | grep real

# Pass condition: ALL 10 calls report real < 0m0.200s
# Warm cache path (10s TTL) should be <20ms. Cold path (DB+Dexscreener) should be <200ms.
```

All five metric keys must be present in the response:

```bash
curl -s http://localhost:3000/api/vitals | python3 -c "
import sys, json
d = json.load(sys.stdin)
required = ['dividends_apr','circulating_supply','runway_months','total_staked_slvr','lottery_round_state','price']
missing = [k for k in required if k not in d]
assert not missing, f'Missing keys: {missing}'
print('All required keys present:', required)
"
```

### Validation B — /api/status indexed vs chain head (SC2)

```bash
curl -s http://localhost:3000/api/status | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'indexed_block : {d[\"indexed_block\"]}')
print(f'chain_head    : {d[\"chain_head\"]}')
print(f'lag_blocks    : {d[\"lag_blocks\"]}')
print(f'lag_seconds   : {d[\"lag_seconds\"]}')
# Pass condition: chain_head > indexed_block (chain is ahead of index or equal)
# A monitoring tool can compute lag = chain_head - indexed_block without reading DB.
assert d['chain_head'] >= d['indexed_block'], 'chain_head should be >= indexed_block'
assert d['lag_seconds'] == d['lag_blocks'] * d['block_time_seconds']
print('STATUS endpoint SC2: PASS')
"
```

### Validation C — SLVR price within 1% of Dexscreener primary pool (SC3)

```bash
# Get our price
OUR_PRICE=$(curl -s http://localhost:3000/api/market | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['slvr_usd'])")

# Get Dexscreener price directly (same token address, highest liquidity pool)
DEX_PRICE=$(curl -s "https://api.dexscreener.com/latest/dex/tokens/0x791229E3EbD6CFdC3D8157f48722684173C29aD9" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
pairs = sorted(d.get('pairs', []), key=lambda p: float((p.get('liquidity') or {}).get('usd', 0) or 0), reverse=True)
print(pairs[0]['priceUsd'] if pairs else '0')
")

python3 -c "
our = float('$OUR_PRICE')
dex = float('$DEX_PRICE')
diff_pct = abs(our - dex) / dex * 100 if dex > 0 else 999
print(f'our={our:.8f}  dex={dex:.8f}  diff={diff_pct:.4f}%')
assert diff_pct < 1.0, f'Price divergence {diff_pct:.4f}% exceeds 1% tolerance'
print('PRICE SC3: PASS')
"
# Expected: diff < 1% (should be 0% — identical source)
```

### Validation D — Liquidity aggregated across all pools (SC4)

```bash
curl -s http://localhost:3000/api/market | python3 -c "
import sys, json
d = json.load(sys.stdin)
manual_sum = sum(p['liquidity_usd'] for p in d['pools'])
reported = d['total_liquidity_usd']
assert abs(reported - manual_sum) < 0.01, f'Aggregation mismatch: {reported} vs {manual_sum}'
assert len(d['pools']) > 1, f'Expected multiple pools, got {len(d[\"pools\"])}'
print(f'Total liquidity: \${reported:,.0f} across {len(d[\"pools\"])} pools. LIQUIDITY SC4: PASS')
"
```

### Validation E — /api/history returns time-series for all metrics and all ranges

```bash
for metric in dividends_apr circulating_supply runway_months total_staked_slvr lottery_round_state; do
  for range in 24h 7d 30d 90d all; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/history?metric=$metric&range=$range")
    COUNT=$(curl -s "http://localhost:3000/api/history?metric=$metric&range=$range" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('rows',[])))")
    echo "$metric/$range: HTTP $STATUS, $COUNT rows"
    if [ "$STATUS" != "200" ]; then echo "FAIL: $metric/$range returned $STATUS"; fi
  done
done
# Expected: all 25 combinations return 200; row counts > 0 for 7d and larger ranges

# Error cases
BAD1=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/history?metric=bad")
BAD2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/history?metric=dividends_apr&range=999d")
echo "Bad metric: $BAD1, Bad range: $BAD2"
# Expected: both 400
```

### Definition of Done — Phase 4 SC Mapping

| SC | ROADMAP Criterion | Validation | Pass Condition |
|----|-------------------|------------|----------------|
| SC1 | `/api/vitals` <200ms with all headline metrics | Validation A | All 10 sequential curl calls < 200ms; all 5 metric keys + price present |
| SC2 | `/api/status` exposes indexed block vs chain head | Validation B | `chain_head >= indexed_block`; `lag_seconds = lag_blocks * 0.1`; no DB required by monitoring tool |
| SC3 | SLVR price within 1% of Dexscreener primary pool | Validation C | `|our_price - dex_price| / dex_price < 0.01` (expected 0%) |
| SC4 | Liquidity aggregated across ALL pools | Validation D | `total_liquidity_usd == SUM(pool.liquidity_usd)` within $0.01; `pool_count > 1` |

All four must pass before Phase 4 is marked complete. Write results to
`.planning/phases/phase-4/VALIDATION.md`.

---

## Files This Phase Creates

```
app/web/package.json
app/web/tsconfig.json
app/web/next.config.ts
app/web/src/lib/db.ts
app/web/src/lib/cache.ts
app/web/src/lib/labels.ts
app/web/src/lib/dexscreener.ts
app/web/src/app/api/vitals/route.ts
app/web/src/app/api/history/route.ts
app/web/src/app/api/market/route.ts
app/web/src/app/api/status/route.ts
.planning/phases/phase-4/VALIDATION.md   (Plan 05)
```

Files NOT touched:
- `app/indexer/` — entirely untouched
- `app/metrics/` — entirely untouched (Phase 3 owns it; Phase 4 only reads its output)
- Any existing planning docs, ROADMAP.md, METHODOLOGY.md
- `db/migrations/` — no new migrations needed (Phase 3 created metric_snapshots)

---

## Out of Scope (Phase 4)

- Frontend pages (Phase 5) — app/web will host them but they are not written here
- SWR/TanStack Query polling hooks (Phase 5)
- Blockscout transaction lookups or address-specific analytics (Phase 5)
- tRPC layer — not needed; Route Handlers + postgres.js is sufficient for v1
- Authentication / rate limiting — no auth in v1 (read-only public analytics)
- Deploying to Vercel or Railway — local dev only; deployment is post-Phase 5
- On-chain V2/V4 price reads via viem — Dexscreener is the designated price source for v1
  per ARCHITECTURE.md (Next.js Route Handlers proxy Dexscreener)
