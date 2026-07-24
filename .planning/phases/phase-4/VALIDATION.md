# Phase 4 — API Layer Validation

**Date:** 2026-07-25
**Validated by:** Phase 4 executor (automated)
**Build:** next build — PASS (tsc + all pages compiled)

---

## Build Results

```
next build output:
Route (app)                               Size     First Load JS
┌ ○ /                                    138 B         100 kB
├ ƒ /api/history                         138 B         100 kB
├ ƒ /api/market                          138 B         100 kB
├ ƒ /api/status                          138 B         100 kB
└ ƒ /api/vitals                          138 B         100 kB
tsc --noEmit: PASS (0 errors)
```

---

## SC1: /api/vitals <200ms with all headline metrics — PASS

### Latency (10 sequential calls, warm cache)

| Call | Latency |
|------|---------|
| 1 | 27ms |
| 2 | 25ms |
| 3 | 22ms |
| 4 | 43ms |
| 5 | 27ms |
| 6 | 21ms |
| 7 | 21ms |
| 8 | 22ms |
| 9 | 22ms |
| 10 | 21ms |

**All 10 calls under 50ms (target <200ms). PASS.**

Cache strategy: 10s TTL in-process for DB result; 60s TTL for Dexscreener price.

### /api/vitals Response (real values)

```json
{
  "dividends_apr":      { "value": 32452.36, "unit": "percent" },
  "circulating_supply": { "value": 6296.21,  "value2": 6385.37, "value3": 500000, "unit": "slvr" },
  "runway_months":      { "value": 77.30,    "value2": 493614.63, "value3": 6385.37, "unit": "months" },
  "total_staked_slvr":  { "value": 5042.44,  "value2": 894.78, "value3": 4147.67, "unit": "slvr" },
  "lottery_round_state":{ "value": 14309,    "value2": 30.09, "value3": 1.80, "unit": "round" },
  "price": {
    "slvr_usd": 89.89,
    "slvr_eth": 0.04834,
    "eth_usd": 1859.53,
    "cached_at": "2026-07-24T22:39:06Z",
    "cache_ttl_seconds": 60
  }
}
```

All 6 required keys present: dividends_apr, circulating_supply, runway_months,
total_staked_slvr, lottery_round_state, price. **PASS.**

---

## SC2: /api/status exposes indexed block vs chain head — PASS

```json
{
  "indexed_block": 18505712,
  "chain_head":    18514736,
  "lag_blocks":    9024,
  "lag_seconds":   902.4,
  "block_time_seconds": 0.1,
  "chain_id": 4663,
  "rpc_url": "https://rpc.mainnet.chain.robinhood.com"
}
```

- chain_head (18514736) >= indexed_block (18505712): PASS
- lag_seconds == lag_blocks * block_time_seconds: 9024 * 0.1 = 902.4: PASS
- No DB access required by monitoring tool to compute lag: PASS

**SC2: PASS**

---

## SC3: SLVR price within 1% of Dexscreener primary pool — PASS

```
our=89.8900  dex=89.8900  diff=0.0000%
```

Same source (Dexscreener API), same parsing logic. Difference: 0%. Tolerance: <1%.

**SC3: PASS**

---

## SC4: Liquidity aggregated across ALL pools — PASS

```
Total liquidity: $92,487.26 across 16 pools
sum(pool.liquidity_usd) == total_liquidity_usd within $0.01: PASS
pool_count (16) > 1: PASS
```

All 16 Dexscreener pairs included including V2, V4 (bytes32 pair IDs), and swaphood pools.

**SC4: PASS**

---

## /api/history Validation (all 25 combinations) — PASS

| Metric | 24h | 7d | 30d | 90d | all |
|--------|-----|----|-----|-----|-----|
| dividends_apr | 200 (13 rows) | 200 (85 rows) | 200 (182 rows) | 200 (182 rows) | 200 (182 rows) |
| circulating_supply | 200 (15 rows) | 200 (87 rows) | 200 (212 rows) | 200 (212 rows) | 200 (212 rows) |
| runway_months | 200 (15 rows) | 200 (87 rows) | 200 (211 rows) | 200 (211 rows) | 200 (211 rows) |
| total_staked_slvr | 200 (3 rows) | 200 (3 rows) | 200 (44 rows) | 200 (44 rows) | 200 (44 rows) |
| lottery_round_state | 200 (15 rows) | 200 (87 rows) | 200 (211 rows) | 200 (211 rows) | 200 (211 rows) |

Error handling:
- GET /api/history?metric=bad → 400 `{"error":"metric must be one of: ..."}`
- GET /api/history?metric=dividends_apr&range=999d → 400 `{"error":"range must be one of: ..."}`

**All 25 combinations return 200; error cases return 400. PASS.**

---

## /api/market Output

```json
{
  "slvr_usd": 89.89,
  "slvr_eth": 0.04834,
  "eth_usd": 1859.53,
  "total_liquidity_usd": 92487.26,
  "pool_count": 16,
  "primary_pool": "0xe365b92239097Ed3322131411DbE15a5c4068eff",
  "pools": [...16 pools...],
  "cached_at": "2026-07-24T22:39:06Z",
  "cache_ttl_seconds": 60
}
```

---

## Deviation: ETH Price API Shape

**Rule 1 — Bug fix during implementation.**

The plan's dexscreener.ts was written expecting `slvr.fun/api/price/eth` to return
`{ "price": "2530.12" }` (string format per plan spec). The actual response is:
`{ "priceUsd": 1859.27, "updatedAt": "...", "source": "coingecko" }`.

Fix: `fetchEthPrice()` now reads `data.priceUsd ?? data.price` — handles both shapes.
No impact on API contract; callers see correct ETH price either way.

---

## Summary

| SC | Criterion | Result |
|----|-----------|--------|
| SC1 | /api/vitals <200ms, all 5 metric keys + price | PASS (all calls 21-43ms) |
| SC2 | /api/status indexed vs chain head | PASS |
| SC3 | SLVR price within 1% of Dexscreener | PASS (0.00% diff) |
| SC4 | Liquidity aggregated across all pools | PASS (16 pools, $92,487) |
