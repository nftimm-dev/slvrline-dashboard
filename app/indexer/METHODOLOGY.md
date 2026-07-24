# SLVRline Dividends APR Methodology

**Requirement:** DIV-01  
**Researched:** 2026-07-24  
**Status:** Formula exact. Magnitude subject to Phase 3 re-validation (see caveat, §7).

---

## 1. Dividends APR Formula (Primary — index-delta method)

```
APR = ( minerIndex(t) − minerIndex(t − W) ) / 1e18 × ( 31,536,000 / W )
```

**Variable definitions:**

| Symbol | Value | Source |
|--------|-------|--------|
| `minerIndex(t)` | Most recent `MinerIndexUpdated.newIndex` from `dividend_index_update` table (V2 contract) or live `eth_call` selector `0x9806b4d2` | `dividend_index_update WHERE contract_address = '0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71' ORDER BY block_number DESC LIMIT 1` |
| `minerIndex(t − W)` | Earliest `MinerIndexUpdated.newIndex` with `block_time >= t − W` | `dividend_index_update WHERE contract_address = V2_ADDRESS AND block_time >= (t - W) ORDER BY block_number ASC LIMIT 1` |
| `W` | `604,800` seconds (7 days) | Annualization window |
| `WAD` | `1e18` = `1_000_000_000_000_000_000n` (BigInt) | Ponder schema column type: `bigint()` |
| `31,536,000` | Seconds per year (365 days) | Annualization constant |

**Window label:** "Dividends APR (7-day)"

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

## 7. Caveat: Early/High Magnitude

> **WARNING: The APR formula is mechanically exact, but the current level (>1,000%) reflects early/volatile protocol conditions. Do not present this as a steady-state yield.**

The protocol was deployed approximately 15 days before this methodology was written (SLVR token deployed block 5,574,774, 2026-07-09). Grid Lottery V2 was deployed only ~2 days before research (block 16,764,101, 2026-07-22).

The 7-day window at the time of first computation spans mostly V1 history. **Re-validate magnitude in Phase 3** once at least 7 full days of V2 `MinerIndexUpdated` data have accumulated.

Display with an annotation such as:

> "Dividends APR (7-day): ~1,229% — Early data — magnitude to be re-validated (Phase 3)."

Factors that will cause the APR to normalize over time:
- `totalUnclaimed` grows as more rounds resolve and more miners enter
- The refining fee rate is fixed at 10%, but the per-claimer impact diminishes as the pool grows
- The protocol is ~15 days old at research time; yield on young protocols with small pools is inherently elevated

---

## 8. V1 vs V2 Index Continuity

V2 started its `minerIndex` accumulator fresh (from 0) at deployment block 16,764,101. The two accumulators are independent.

**For the live headline APR:** Use V2's index exclusively:
```sql
SELECT new_index FROM dividend_index_update
WHERE contract_address = LOWER('0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71')
ORDER BY block_number DESC LIMIT 1;
```

**For a historical chart spanning the migration:** Treat V1 and V2 as separate accumulators. Display a discontinuity annotation at:
- Round 12,500 (canonical migration boundary)
- Block ~16,881,792 (V2 round 12,500 resolved, 2026-07-23 01:10:32 UTC)

Do not stitch V1 + V2 index values — they represent independent accumulators and cannot be added or concatenated.

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
