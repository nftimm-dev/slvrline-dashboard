# Stack Research

**Domain:** Read-only EVM analytics platform (self-hosted indexer + analytics dashboard)
**Project:** SLVRline — SLVR protocol analytics on Robinhood Chain (EVM chain ID 4663)
**Researched:** 2026-07-24
**Confidence:** HIGH (core stack), MEDIUM (hosting cost estimates), LOW (Envio RPC-fallback performance on obscure chains)

---

## Summary Recommendation

**Ponder (indexer) + PostgreSQL (datastore) + Ponder SQL-over-HTTP / tRPC (API) + Next.js 15 + Tailwind CSS v4 + shadcn/ui (frontend) + TradingView lightweight-charts + ECharts (charting) + viem (chain reads).**

Ponder is the primary indexer recommendation. It is TypeScript-native, supports any EVM chain by supplying a plain `id` + `rpc` pair, has built-in reorg handling, built-in GraphQL and SQL-over-HTTP APIs, and writes directly to Postgres. It is self-hosted and has no cloud dependency. Current release is 0.17.1 (July 20, 2025).

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Ponder** | 0.17.1 | EVM event indexer + API server | TypeScript-native; any EVM via `id + rpc`; built-in reorg rollback; built-in GraphQL + SQL-over-HTTP; writes to Postgres; no proprietary data layer dependency; Robinhood Chain (4663) is supported as-is |
| **PostgreSQL** | 16 | Persistent store for indexed events + computed metric snapshots | Ponder's native target; supports both relational event tables and time-series metric tables; standard tooling (pg_dump, logical replication, Drizzle/Prisma); TimescaleDB not needed at SLVRline's data volume |
| **Next.js** | 15 (App Router) | Frontend framework | Server Components + Route Handlers cover both SSR pages and API proxy routes in one deploy; first-class Vercel support; officially pairs with Tailwind v4 + shadcn/ui; strong ecosystem |
| **Tailwind CSS** | v4 | Styling | v4 drops config file; @theme inline directive; fully supported by shadcn/ui as of 2025; current default for new Next.js 15 projects |
| **shadcn/ui** | latest | UI component library | Copy-to-own-codebase model; unstyled + Tailwind; covers all dashboard primitives (tables, cards, badges, tooltips); dark mode built-in; does NOT lock you into a component SDK |
| **viem** | 2.35.0+ | Chain reads, multicall, contract decoding | Type-safe; `defineChain` supports any EVM chain via custom `id` + `rpcUrls`; built-in multicall3 batching; Ponder 0.17 requires viem ≥2.35.0; Uniswap V4 StateView reads work via `getContract` pattern |

### Charting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **TradingView lightweight-charts** | 5.2.0 | Price / volume OHLC charts, area charts | Any chart that needs financial-grade performance: SLVR/ETH price, volume histograms, liquidity-over-time; 12 KB gzipped, canvas-based, handles large data sets |
| **Apache ECharts** (via `echarts-for-react`) | latest | Multi-series line/area charts, bar charts, pie/donut | APR-over-time, supply/emissions/burns stacked area, staking totals, lottery round activity; more expressive than Recharts for analytics dashboards; handles large time-series well |

**Why not Recharts:** Recharts is SVG-based and becomes slow above ~5,000 data points per series; does not have candlestick/OHLC; fine for small datasets but undersized for a protocol analytics dashboard with deep history. Use ECharts + lightweight-charts instead.

**Why not Nivo:** Beautiful but very heavy bundle; slower render; no OHLC. Avoid for this project.

### API Layer

| Layer | Purpose | Approach |
|-------|---------|---------|
| **Ponder SQL-over-HTTP** (`@ponder/client`) | Query indexed event data from frontend | Auto-generated from `ponder.schema.ts`; type-safe; zero manual API code; live-query guarantee (updates only when result changes) |
| **Next.js Route Handlers** | Proxy / aggregate external APIs | Dexscreener API (CORS bypass); slvr.fun price/round-state endpoints; Uniswap V4 StateView reads (via viem); computed metrics not in Ponder (e.g. Dividends APR formula) |
| **tRPC v11** (optional, add in Phase 2+) | End-to-end type-safe RPC when frontend needs complex derived logic | If computed metrics grow complex enough to warrant a typed procedure layer between Next.js Route Handlers and React components; not needed for v1 if Route Handlers + Ponder SQL-over-HTTP suffice |

**v1 recommendation:** skip tRPC. Use Ponder SQL-over-HTTP for indexed data + Next.js Route Handlers for external API proxying. Add tRPC only if the API layer grows beyond simple proxy routes.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ponder/client` | matches ponder 0.17.x | Type-safe SQL-over-HTTP queries from frontend | All queries against Ponder's Postgres tables |
| `drizzle-orm` + `drizzle-kit` | latest | ORM for any supplemental Postgres tables outside Ponder's schema (e.g. metric snapshots cron-written separately) | Only if you write a separate metric-snapshot cron service that writes to Postgres tables Ponder doesn't own |
| `@tanstack/react-query` | 5.x | Async state / caching in React components | Wrap all data fetching hooks; pairs with Ponder SQL-over-HTTP client; provides stale-while-revalidate for headline vitals |
| `swr` | 2.x | Alternative to React Query for simpler polling | Acceptable alternative; React Query preferred for finer cache control |
| `lightweight-charts-react-wrapper` | latest | React bindings for TradingView charts | Declarative wrapper; avoids manual imperative chart lifecycle management |
| `echarts-for-react` | latest | React bindings for ECharts | Standard pattern for ECharts in React |
| `zod` | 3.x | Runtime schema validation for API inputs | Validate Route Handler query params and external API response shapes |
| `date-fns` | 3.x | Date arithmetic for chart axis labels, runway calculations | Lightweight; tree-shakeable; no Moment.js |
| `numbro` or `Intl.NumberFormat` | — | Number formatting (token amounts, APR %, large supply numbers) | `Intl.NumberFormat` is zero-dependency and sufficient; numbro only if you need locale-aware crypto formatting |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript | 5.4.0+ | Type safety end-to-end | Required by Ponder 0.17; use strict mode |
| Node.js | 22+ | Runtime | Ponder 0.17 minimum is Node 22 |
| Bun | 1.x (optional) | Faster local dev / test runner | Ponder 0.16+ officially supports Bun; use if team prefers it |
| ESLint + Prettier | latest | Linting / formatting | Standard |
| Docker Compose | — | Local dev: run Ponder + Postgres together | Ponder provides a Docker image; Postgres via official image |
| pnpm | 9.x | Package manager | Workspace-friendly; faster than npm |

---

## EVM Indexer Decision: Ponder as Primary, Envio as Fast-Backfill Option

### Why Ponder is the primary recommendation

Robinhood Chain (ID `4663`) is NOT in any indexer's pre-integrated chain list. Every framework falls back to standard RPC for unknown chains. Ponder's RPC-based path is its primary (and only) path, so there is no degraded mode — it works the same on any EVM chain.

**Verified Ponder capabilities for Robinhood Chain:**
- Chain config is `{ id: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com" }` — that is the entire chain setup. No other registration needed.
- Chain IDs up to `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) are supported. 4663 is well within range.
- Reorg handling: built-in. Block hash chain comparison detects reorgs; shadow tables (`_reorg__<table>`) store pre-block state; automatic rollback on reorg event.
- Backfill: parallel `eth_getLogs` batching with configurable block range (`ethGetLogsBlockRange`) to tune for slow/rate-limited RPCs.
- Live head-following: polling-based (configurable `pollingInterval`), WebSocket optional.
- Output: Postgres (user-supplied); GraphQL API auto-generated; SQL-over-HTTP client (`@ponder/client`) with type inference from `ponder.schema.ts`.
- Computed/derived metrics: TypeScript indexing functions have full access to `context.client` (viem public client for the chain), enabling on-the-fly contract reads inside event handlers.
- Version: 0.17.1 (July 20, 2025); requires Node 22, TypeScript 5.4, viem ≥2.35.0.

**Weaknesses to know:**
- Backfill speed is RPC-bound. For Robinhood Chain, expect speed to vary with RPC quality. The slvr.fun RPC proxy (`https://slvr.fun/api/rpc`) can supplement the main RPC if rate limits are hit (configure multiple RPC URLs in array form).
- No hosted service — you run it yourself. This is fine given the project's self-hosted intent.
- Benchmarks show Ponder is 157x slower than Envio's HyperSync path in a Uniswap V2 Factory test. BUT: Envio's speed advantage requires HyperSync, which Robinhood Chain does not have. On a plain RPC chain, Envio falls back to standard RPC and the speed gap largely disappears.

### Indexer alternatives considered

| Indexer | Custom Chain via RPC | Language | Reorg Handling | Verdict |
|---------|---------------------|----------|----------------|---------|
| **Ponder 0.17** | YES — any EVM, `id + rpc` | TypeScript | Built-in (shadow tables + rollback) | **RECOMMENDED** |
| **Envio HyperIndex** | YES — RPC fallback for non-HyperSync chains | TypeScript / ReScript | Automatic | Strong fallback; 157x faster on HyperSync chains, but Robinhood Chain lacks HyperSync so advantage is nil; more complex ops story |
| **Self-hosted Graph Node** | YES — EVM JSON-RPC is sufficient | AssemblyScript (subgraph handlers) | Built-in | AssemblyScript is a hard DX tax; Docker stack is heavier (graph-node + IPFS + Postgres); benefits only if reusing existing Goldsky subgraph schema |
| **rindexer** | YES — YAML config, `chain_id + rpc` | Rust (no-code YAML or Rust SDK) | Not documented | Early/experimental; no confirmed reorg handling; Rust operational complexity without clear benefit for this TypeScript project |
| **Subsquid (SQD)** | YES — 100+ chains + RPC fallback | TypeScript (Squid SDK) | Built-in | More complex processor model; requires SQD network or self-hosted archive; overkill for a single-chain analytics project |

**Decision:** Use Ponder. It is the simplest self-hosted TypeScript indexer for a single custom EVM chain.

---

## Database Decision: PostgreSQL (plain, no TimescaleDB)

**Use plain PostgreSQL 16.** Do not use TimescaleDB.

**Rationale:**
- Ponder writes to Postgres natively. Adding a TimescaleDB extension introduces an unnecessary dependency.
- SLVRline's time-series data (APR snapshots, supply snapshots, round summaries) will have at most thousands to tens-of-thousands of rows per metric over the project lifetime. This is far below the threshold where TimescaleDB's hypertable partitioning provides measurable benefit.
- TimescaleDB's advantages (20x insert throughput, 450x time-ordering query speed) materialize for IoT-scale workloads with millions of rows per table. Protocol analytics at SLVR's current scale does not reach that threshold.
- Postgres has native `timestamp` columns, `BETWEEN` time range filters, `DATE_TRUNC`, and window functions — sufficient for all SLVRline queries.
- If query performance degrades at scale, add a `BRIN` index on timestamp columns before reaching for TimescaleDB.

**Postgres schema structure:**
- Ponder owns its schema (e.g., `slvrline_indexer`) with event tables.
- A separate `metrics` schema holds cron-computed snapshots (APR-over-time, supply-over-time) written by a lightweight Node.js cron service or Ponder API handler.
- Direct SQL from Next.js Route Handlers or via Ponder SQL-over-HTTP.

---

## Chain Access / Web3 Libraries

**Use viem exclusively. Do not use ethers.js.**

```typescript
import { createPublicClient, http, defineChain, getContract } from 'viem'

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://robinhoodchain.blockscout.com',
      apiUrl: 'https://robinhoodchain.blockscout.com/api/v2',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      // blockCreated: verify from Blockscout explorer
    },
  },
})

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
  batch: { multicall: true }, // automatic multicall3 batching
})
```

**Uniswap V2 price reads:** Call `getReserves()` on the SLVR/WETH pair (`0xe365b92239097Ed3322131411DbE15a5c4068eff`) via viem `readContract`. Price = `reserve1 / reserve0` (adjusted for 18 decimals on both sides). Batch with multicall.

**Uniswap V4 pool reads:** Use the StateView contract (`0xf3334192d15450cdd385c8b70e03f9a6bd9e673b`) via viem `getContract`. Pool ID is `bytes32` (`0xb7d8f0...`). Call `getSlot0(poolId)` to get `sqrtPriceX96` → convert to price. Official Uniswap V4 docs confirm this pattern for frontends and analytics.

**Multicall3** at `0xcA11bde05977b3631167028862bE2a173976CA11` is deployed on Robinhood Chain (confirmed in PROJECT.md). Configure in `defineChain.contracts.multicall3` for automatic batching.

**Dexscreener:** Fetch `https://api.dexscreener.com/latest/dex/tokens/0x791229...` from a Next.js Route Handler (server-side) to bypass CORS. Cache response with `next: { revalidate: 60 }` in fetch options.

---

## Frontend Architecture

**Next.js 15 App Router + Tailwind v4 + shadcn/ui:**

```
/app
  /layout.tsx          ← root layout, global Tailwind, ThemeProvider (dark mode)
  /page.tsx            ← main dashboard: vitals strip + charts
  /api
    /metrics/route.ts  ← proxy/compute: Dexscreener, slvr.fun endpoints, APR calc
    /health/route.ts   ← indexer health check
  /(dashboard)
    /supply/page.tsx   ← supply analytics detail
    /staking/page.tsx  ← staking analytics detail
    /lottery/page.tsx  ← lottery round activity
/components
  /vitals-strip        ← headline stat cards
  /charts              ← chart components (lightweight-charts wrappers, echarts wrappers)
  /ui                  ← shadcn/ui components
/lib
  /chain.ts            ← viem client + defineChain
  /ponder-client.ts    ← @ponder/client setup
  /dexscreener.ts      ← Dexscreener fetch helpers
```

**Theme:** Silver/dark-first aesthetic. Tailwind v4 with custom CSS variables (`--color-silver-*`). shadcn/ui dark mode via `class="dark"` on `<html>`. No component library locks — all components owned by the project.

---

## Hosting / Deployment

**Recommended split-deploy architecture:**

| Service | Host | Rationale |
|---------|------|-----------|
| **Ponder indexer** | Railway or Fly.io (single container) | Persistent process; needs stable long-running container; Railway $5/mo hobby or ~$20-50/mo pro depending on memory; Fly.io similar pricing with more control |
| **PostgreSQL** | Railway Postgres add-on OR Supabase (self-managed) | Railway Postgres is the lowest-friction option when co-locating with Ponder; Supabase adds a managed GUI for free tier inspection |
| **Next.js frontend** | Vercel | Free tier covers static + SSR; Route Handlers run as serverless functions; zero-config CI/CD from git; optimal for Next.js |

**Alternative full self-hosted:** Single Fly.io app with Docker Compose — Ponder container + Postgres volume. More control, slightly more ops work.

**Do NOT deploy Ponder on Vercel/Lambda.** Ponder is a long-running stateful process; serverless cold starts will break the sync loop.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **ethers.js** | Heavier bundle; weaker TypeScript types; Ponder itself uses viem internally | viem |
| **TimescaleDB** | Unnecessary complexity at SLVR's data volume; same Postgres underneath | Plain PostgreSQL 16 with BRIN indexes on timestamp columns |
| **AssemblyScript / The Graph Node (self-hosted)** | AssemblyScript is a DX penalty for a TypeScript team; Graph Node requires IPFS sidecar; no benefit over Ponder for this use case | Ponder |
| **Recharts** | SVG-based; slow above 5k data points; no OHLC/candlestick | TradingView lightweight-charts + Apache ECharts |
| **Nivo** | Very heavy bundle; slow render; no OHLC | TradingView lightweight-charts + Apache ECharts |
| **rindexer** | Early/experimental; reorg handling unconfirmed in docs; Rust ops overhead with no TypeScript benefit | Ponder |
| **Goldsky (cloud subgraph only)** | Already exists (Goldsky subgraph is a reference feed); building on it creates dependency on the protocol team's infra — exactly what SLVRline is designed to avoid | Ponder (own indexer) |
| **tRPC in v1** | Adds a layer of abstraction before the API shape is known; Ponder SQL-over-HTTP + Route Handlers is sufficient for v1 | Next.js Route Handlers + Ponder SQL-over-HTTP |
| **Webpack / CRA / Vite standalone** | Next.js App Router covers SSR, API routes, and static generation in one; no need for a separate SPA bundler | Next.js 15 |

---

## Alternatives Considered

| Category | Recommended | Alternative | When Alternative Makes Sense |
|----------|-------------|-------------|------------------------------|
| Indexer | Ponder 0.17 | Envio HyperIndex | If Robinhood Chain ever gets HyperSync support (157x faster backfill); or if initial full-history backfill is taking days and RPC rate limits can't be resolved |
| Indexer | Ponder 0.17 | Self-hosted Graph Node | If the team decides to reuse/migrate the existing Goldsky subgraph schema directly; requires IPFS + AssemblyScript knowledge |
| Database | PostgreSQL 16 | TimescaleDB | If metric snapshots grow beyond 1M rows per table and time-range queries become slow (unlikely for v1-v2 scope) |
| Charting (price) | lightweight-charts 5.2 | TradingView Advanced Charts (paid) | If full professional charting (drawing tools, multi-timeframe, etc.) becomes a roadmap item |
| Charting (analytics) | Apache ECharts | Recharts | If the team wants simpler React integration at the cost of performance; only viable for datasets under 5k points |
| Frontend | Next.js 15 | Remix | If SSR + API routes in one framework but with a different routing model is preferred; no meaningful difference for this project |
| Hosting (indexer) | Railway | Fly.io | Fly.io gives more control over regions and Docker config; Railway is lower-friction for getting started |
| API layer | Ponder SQL-over-HTTP | GraphQL (Ponder auto-generated) | GraphQL is also auto-generated by Ponder and works fine; SQL-over-HTTP preferred because it avoids GraphQL client overhead on the frontend and is type-safe from schema |

---

## Installation

```bash
# Initialize Ponder project (run in /indexer)
npx create-ponder@latest --from-etherscan ... # or manual init

# Core Ponder dependencies
npm install ponder @ponder/client viem

# Frontend (Next.js project in /frontend or /web)
npx create-next-app@latest --typescript --tailwind --eslint --app

# shadcn/ui (run in frontend directory)
npx shadcn@latest init

# Charts
npm install lightweight-charts lightweight-charts-react-wrapper
npm install echarts echarts-for-react

# Data fetching / state
npm install @tanstack/react-query

# Utilities
npm install zod date-fns

# Dev dependencies
npm install -D typescript@latest drizzle-kit drizzle-orm
```

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| ponder | 0.17.1 | Node.js ≥22, TypeScript ≥5.4, viem ≥2.35.0 | July 20 2025 release |
| viem | ≥2.35.0 | TypeScript ≥5.0 | Ponder 0.17 hard-requires this minimum |
| Next.js | 15.x | React 19, TypeScript 5.x, Tailwind v4 | App Router; shadcn/ui fully supports |
| Tailwind CSS | v4 | shadcn/ui (as of 2025), Next.js 15 | Drops `tailwind.config.ts`; uses `@theme` directive |
| shadcn/ui | latest (CLI) | Tailwind v4, React 19 | All components updated for v4 as of 2025 |
| lightweight-charts | 5.2.0 | React (via wrapper), TypeScript | Published April 2026; 12 KB gzipped |
| echarts | latest | echarts-for-react (React wrapper) | Apache-licensed |
| @tanstack/react-query | 5.x | React 18/19 | Stable v5 API |

---

## Sources

- Ponder official docs (chain configuration): https://ponder.sh/docs/config/chains — HIGH confidence
- Ponder GitHub releases: https://github.com/ponder-sh/ponder/releases — HIGH confidence (verified 0.17.1 July 20 2025)
- Ponder Context7 docs (`/ponder-sh/ponder`): reorg handling, GraphQL API, SQL-over-HTTP — HIGH confidence
- viem Context7 docs (`/wevm/viem`): `defineChain`, multicall, custom chain pattern — HIGH confidence
- Uniswap V4 StateView official docs: https://docs.uniswap.org/contracts/v4/guides/state-view — HIGH confidence
- Envio supported networks + RPC fallback: https://docs.envio.dev/docs/HyperIndex/supported-networks — MEDIUM confidence (Robinhood Chain not listed; RPC fallback confirmed but performance unverified on this chain)
- Indexer benchmark (Sentio May 2025): cited in https://docs.envio.dev/blog/best-blockchain-indexers-2026 — MEDIUM confidence (benchmark is Envio-published)
- rindexer documentation: https://rindexer.xyz/docs/introduction/what-is-rindexer — MEDIUM confidence (reorg handling not documented)
- Lightweight-charts npm: https://www.npmjs.com/package/lightweight-charts (v5.2.0) — HIGH confidence
- Next.js 15 + shadcn/ui + Tailwind v4: https://ui.shadcn.com/docs/tailwind-v4 — HIGH confidence
- Railway vs Fly.io pricing: https://northflank.com/blog/railway-vs-flyio — MEDIUM confidence (pricing accurate as of 2026)
- TimescaleDB vs PostgreSQL: https://pgbench.com/comparisons/postgres-vs-timescaledb/ — MEDIUM confidence

---

## Confidence Notes

| Area | Confidence | Reason |
|------|------------|--------|
| Ponder for Robinhood Chain | HIGH | Chain ID 4663 is within supported range; `id + rpc` config is the documented pattern; reorg handling verified in source code via Context7 |
| viem custom chain | HIGH | `defineChain` pattern confirmed in official docs; Multicall3 address confirmed in PROJECT.md |
| PostgreSQL over TimescaleDB | HIGH | Scale argument is sound at SLVRline's data volume; Ponder's native Postgres integration makes any extension unnecessary |
| TradingView lightweight-charts | HIGH | Version 5.2.0 confirmed on npm; purpose-built for financial charts |
| Next.js 15 + shadcn/ui + Tailwind v4 | HIGH | Official shadcn/ui Tailwind v4 support page confirms all components updated |
| Envio as fallback indexer | MEDIUM | RPC fallback confirmed but Robinhood Chain lacks HyperSync, so backfill performance on this specific chain is unverified |
| Railway/Fly.io hosting costs | MEDIUM | Pricing accurate as of research date but platform pricing changes frequently |
| Dividends APR formula | LOW | Formula must be derived from Grid Lottery contract ABI and subgraph schema; not researchable from ecosystem docs — requires phase-specific contract research |

---

*Stack research for: SLVRline — EVM analytics platform (Robinhood Chain, chain ID 4663)*
*Researched: 2026-07-24*
