# SLVRline Dividends APR Methodology

**Requirement:** DIV-01  
**Researched:** 2026-07-24  
**Updated:** 2026-07-25 (V1/V2 per-contract routing, windowed headline)  
**Status:** Formula exact. V2 "early" headline matures to standard 7-day on ~2026-07-29.

---

## APR Formula and Contract Routing

### Core Formula

```
APR = ( minerIndex(t, contract) − minerIndex(t − W, contract) ) / 1e18 × ( 31,536,000 / W )
```

Where `W = min(604800, age_of_active_contract_at_t)` (capped to 7 days, but clamped to the contract's own age so we never sample before the accumulator started).

**Variable definitions:**

| Symbol | Value | Source |
|--------|-------|--------|
| `minerIndex(t, contract)` | `eth_call` selector `0x9806b4d2` on the active contract at block `t` | Archival `eth_call`; confirmed exact match with `MinerIndexUpdated` events |
| `minerIndex(t − W, contract)` | Same call at the block closest to `t − W`, clamped to contract deploy block | Archival `eth_call` |
| `W` | `min(604800, contract_age_seconds_at_t)` — 7-day cap, shrinks to actual contract age while < 7d | Computed per-sample |
| `WAD` | `1e18` = `1_000_000_000_000_000_000n` | Normalization constant |
| `31,536,000` | Seconds per year (365 days) | Annualization constant |

**Window label:** "Dividends APR (7-day)" when W = 7d; "Dividends APR (N-day, early)" when W < 7d.

---

## 2. What minerIndex Represents

`minerIndex` is the **global cumulative refining fee per 1 unclaimed SLVR**, WAD-scaled (1e18 = 1.0). It is implemented as a MasterChef/ORE-style scaled accumulator inside the Grid Lottery contract's `_processClaimWithRefining` function.

Because `minerIndex` represents cumulative dividends paid *per unit of unclaimed SLVR*, the delta `Δindex / WAD` is the **exact fractional return** earned by a continuously-unclaimed miner over any window. No separate denominator snapshot is needed — the normalization is already baked into the index construction.

Contract state variables (public getters, confirmed by `eth_call`):

```solidity
uint256 public minerIndex;      // cumulative refining fees per 1e18 unclaimed SLVR (WAD-scaled)
uint256 public totalUnclaimed;  // total unclaimed SLVR across all miners (the dividend base)
uint256 public totalRefined;    // total refined SLVR owed but not yet paid out
uint16  public constant REFINING_FEE_BPS = 1_000; // 10%
```

Confirmed selectors: `minerIndex()` = `0x9806b4d2`, `totalUnclaimed()` = `0xc96f14b8`, `totalRefined()` = `0x9ff953a0`.

---

## 3. What Funds Dividends

Dividends are funded by the **10% refining fee** inside the Grid Lottery contract — NOT by Hub emissions, buy/sell tax, or veSLVR staker ETH.

The funding mechanism step-by-step:

1. When a round resolves, the SLVR reward for winners becomes "unclaimed": `totalUnclaimed += round.slvrForWinners` (in `_finalizeRoundWithWinners`).
2. When **any miner claims** their SLVR reward, a 10% refining fee is skimmed off their reward: `refiningFee = slvrReward × REFINING_FEE_BPS / 10000` (`MathLib.calculateFee`).
3. That fee is **redistributed to all OTHER still-unclaimed miners** by bumping the global index: `indexIncrement = refiningFee × WAD / totalUnclaimed`, then `minerIndex += indexIncrement` and `totalRefined += refiningFee`.
4. This emits `MinerIndexUpdated(newIndex, totalUnclaimed, totalRefined)` and `RefiningFeeApplied(account, rewardsSlvr, fee, newIndex, totalUnclaimed)`.
5. Each unclaimed miner accrues dividends proportional to their unclaimed balance since their last checkpoint: `refinedDelta = unclaimed × (minerIndex − indexSnapshot) / WAD`.

**Source contracts:**
- Grid Lottery V2 (live): `0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71`
- Grid Lottery V1 (historical, ended block 17,440,150): `0x284Eb4016305Fa7FbC162Fb68F27227271001c7f`

---

## 4. Numerator and Denominator

**Numerator:** `minerIndex(now) − minerIndex(now − 7d)`  
The per-unit accumulation over the 7-day window. Drawn directly from the `dividend_index_update` table.

**Denominator:** Implicitly 1 unclaimed SLVR.  
The index is already normalized per unit by WAD (i.e. it represents earnings *per 1e18 raw SLVR units*), so no separate denominator snapshot is required. This is the key advantage of the index-delta method over flow-based methods.

**Annualization:** Multiply the 7-day fractional return by `31,536,000 / 604,800 ≈ 52.18` (the number of 7-day periods in a year):
```
APR = (Δindex / 1e18) × 52.18
```

---

## 5. Worked Numeric Example (2026-07-24)

Data confirmed by both `eth_call` and Goldsky subgraph (exact match):

| Item | Value |
|------|-------|
| `minerIndex(now)` | `1,789,282,914,952,366,881` (WAD: ~1.789) |
| `minerIndex(7d ago)` | `1,553,721,446,508,952,???` (earliest `MinerIndexUpdated` in 7-day window) |
| Δindex (approx) | `235,561,468,443,414,???` |
| Period return (Δindex / 1e18) | ≈ **23.56%** over 7 days |
| **APR ≈ 23.56% × 52.18 ≈ 1,229%** (7-day annualized) | |

Live denominator context at time of research:
- `totalUnclaimed ≈ 495.03 SLVR`
- `totalRefined ≈ 160.49 SLVR`

---

## 6. Cross-Check Method (Flow Method)

As a sanity check (upper bound, not the headline):

```
APR_flow ≈ ( SUM(dividend_fee_applied.fee) over W ) / avg(totalUnclaimed) × ( 31,536,000 / W )
```

**SQL:**
```sql
SELECT
  SUM(fee) AS total_fee_7d,
  AVG(total_unclaimed) AS avg_unclaimed
FROM dividend_fee_applied
WHERE contract_address = LOWER('0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71')
  AND block_time >= EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days');
```

Using research-time data: `Σ fee (7d) ≈ 564.4 SLVR` → annualized ≈ 29,443 SLVR/yr over a ~495 SLVR pool ≈ **5,948%**.

The flow method produces a higher number because it ignores pool churn (miners who claimed during the window reduce `totalUnclaimed`, making the denominator smaller mid-window). **Report the index-delta ~1,229% as authoritative; the flow number is an upper bound / cross-check only.**

---

## 7. Caveat: Early/High/Volatile Magnitude

> **WARNING: The APR formula is mechanically exact, but current figures reflect early/volatile protocol conditions. Do not present them as steady-state yields.**

**V2 headline (as of 2026-07-25):** ~32,000% over a 2-day window. This is elevated because:
- V2's minerIndex accumulator reset to 0 at block 16,764,101 (2026-07-22). It has only ~3 days of data.
- The current window is W = min(7d, ~3d) = ~2d. Annualizing 2 days of data over a 365-day year amplifies any variation.
- `totalUnclaimed` is still a small pool (~495 SLVR); each claim event creates large per-unit swings.

**V2 headline maturity:** The 7-day standard window becomes available ~2026-07-29. Until then `dataStatus = "early"` and `window_days < 7`. The UI should display:
> "Dividends APR (~32,456%, 2-day window) — Early data, V2 contract age 3 days. Matures to standard 7-day figure on ~2026-07-29."

**V1 historical figures (~5,000–10,000%):** These are 7-day rolling figures from V1's accumulator over 2026-07-17 to 2026-07-22. They reflect genuine V1 dividend yield during V1's active period. High yield reflects the small early pool size.

**Factors that will normalize APR over time:**
- `totalUnclaimed` grows as more rounds resolve and miners enter
- Refining fee rate (10%) is fixed, but per-claimer index impact shrinks as the pool grows
- Protocol is ~16 days old; elevated yield on small early pools is expected

---

## 8. V1 vs V2 Index Continuity — Active-Contract Routing

GridLotteryV1 and GridLotteryV2 maintain **separate, independent** `minerIndex` accumulators. Mixing them is invalid — they represent refining fee accumulation relative to each contract's own zero-point.

**Known accumulator values (on-chain facts):**

| Contract | Deploy block | V1 index @ V2 deploy | V1 index today (~2026-07-25) | V2 index @ deploy | V2 index today |
|---|---|---|---|---|---|
| V1 `0x284Eb4016305…` | 5,574,774 | 2.2014 | 2.262 | — | — |
| V2 `0xB0Cc994Ce4E8…` | 16,764,101 | — | — | 0 (reset) | ~1.797 |

**Routing rule used in `computeHistoricalAprForBlock` and `computeDividendsApr`:**

| Sample block | Active contract | Window start clamped to |
|---|---|---|
| block < 16,764,101 | GridLotteryV1 | max(V1 deploy, block − 7d) |
| block >= 16,764,101 | GridLotteryV2 | max(V2 deploy block 16,764,101, block − 7d) |

**Headline APR (live):**
- Always uses V2.
- `W = min(604800, seconds since V2 deploy at sample time)`.
- `dataStatus = "early"` while W < 604800; `"ok"` once V2 has >= 7 days of data (~2026-07-29).
- UI label: "Dividends APR (2d window, early)" → "Dividends APR (7-day)" after maturity.

**Historical chart (16-day backfill):**
- V1 era (2026-07-09 → 2026-07-22): honest V1 7-day rolling APR, ramping from "early" to "ok" as V1 accumulates history. Yields approximately 5,000–10,000% in the 7d-ok range.
- V2 era (2026-07-22 → now): V2 accumulator from zero; early window ramps from 0.d to 2d currently. V2 yields currently ~32,000–166,000% (highly volatile, tiny early window).
- The chart will show a visible reset/ramp at block 16,764,101 — this is correct and expected, not a data error. Display a migration annotation there.

**Do not concatenate V1 and V2 index values.** The delta APR within each contract is meaningful; the cross-contract delta is not.

---

## 9. What This Formula Does NOT Include

| Revenue type | Source | Included in Dividends APR? |
|---|---|---|
| Protocol emissions (new SLVR minted per round = 1 SLVR base) | Hub → lottery winners | No — goes to round winners, not dividend recipients |
| veSLVR staker ETH rewards | Hub `StakersPaid` events | No — ETH routing to veSLVR lockers, separate mechanic |
| Buy/sell tax (2%/2%) | Token `TaxCollected` → ETH jackpot | No — routes to ETH jackpot, not SLVR dividends |
| Jackpot prizes (ETH) | Grid Lottery jackpot pool | No — separate ETH payout to winners |

The dividends APR measures **only** the SLVR yield earned by miners who hold unclaimed SLVR in the Grid Lottery via the refining fee redistribution mechanic.

---

## 10. Data Sources

| Source | Query | Confidence |
|--------|-------|------------|
| `dividend_index_update` table (V2) | `SELECT new_index ORDER BY block_number DESC LIMIT 1` for `minerIndex(t)` | HIGH — event-indexed, immutable |
| `dividend_index_update` table (V2) | `SELECT new_index WHERE block_time >= t-W ORDER BY block_number ASC LIMIT 1` for `minerIndex(t-W)` | HIGH |
| `eth_call` `0x9806b4d2` on V2 | Live `minerIndex()` — confirmed exact match with indexed event value | HIGH |
| Goldsky subgraph `minerIndexUpdateds[0].newIndex` | Cross-check — confirmed exact match: `1789282914952366881` | HIGH |

The Goldsky subgraph has **no pre-computed APR or dividend yield field** — `ProtocolStat` tracks minting/burn/tax/rounds but not dividends. SLVRline's `dividend_index_update` table is the authoritative source.
