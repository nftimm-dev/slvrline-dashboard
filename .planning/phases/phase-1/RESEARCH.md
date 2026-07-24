# Phase 1: Indexer Foundation - Research (Contract Ground Truth)

**Researched:** 2026-07-24
**Domain:** SLVR protocol contract ground truth on Robinhood Chain (EVM id 4663) — derived from ACTUAL verified Solidity source on Blockscout + live RPC + Goldsky subgraph cross-check
**Confidence:** HIGH (all seven core contracts are fully verified; every claim below is grounded in quoted source and confirmed by live `eth_call` / `eth_getLogs`)

> Method: Every contract in this doc was fetched via `GET https://robinhoodchain.blockscout.com/api/v2/smart-contracts/<addr>` and read from `source_code` / `additional_sources`. State values were confirmed by `eth_call` against `https://rpc.mainnet.chain.robinhood.com`. Round history was mapped via `eth_getLogs`. Cross-checks use the Goldsky subgraph `slvr-robinhood/1.7.0`. Raw ABIs saved to `.planning/phases/phase-1/abis/`.

---

## 0. TL;DR for the planner

- **All 7 target contracts are VERIFIED** (SLVR token, GridLottery V1+V2, Hub, veNFT, veStaking, LP staking). No fallbacks needed.
- **SLVR:** 18 decimals, `MAX_SUPPLY = 500_000e18` (both confirmed on-chain). Burns emit `TokensBurned`. **Mints have NO dedicated event** — emissions = `Transfer` where `from == 0x0`. Tax = 2%/2% (decrease-only), event `TaxCollected`.
- **Dividends = the "refining fee" mechanic, and it lives in the GRID LOTTERY contract, NOT the Hub.** It is a classic scaled-index (MasterChef/ORE-style) accumulator. When a miner claims, a **10% refining fee** (`REFINING_FEE_BPS = 1000`) is skimmed off their SLVR reward and redistributed to all *other* miners who still hold *unclaimed* rewards, by bumping a global `minerIndex`. Events: `MinerIndexUpdated`, `RefiningFeeApplied`.
- **Dividends APR formula (authoritative, index-delta method):**
  `APR = (minerIndex(now) − minerIndex(now − W)) / WAD × (SECONDS_PER_YEAR / W)`
  where `WAD = 1e18`, `W = 7 days`. This is exact because `minerIndex` *is* the cumulative dividend paid per 1 unclaimed SLVR.
- **THE MIGRATION IS NOT A CLEAN SEQUENTIAL HANDOFF.** V1 (`0x284Eb4…`) resolved rounds **0 → 13,122**. V2 (`0xB0Cc99…`) resolved rounds **12,370 → 14,224 (ongoing)**. **740 round numbers (12,370–13,122) were resolved on BOTH contracts in parallel.** The split must be **round-number based at 12,500** (V1 canonical for round < 12,500, V2 canonical for round ≥ 12,500), NOT a pure `endBlock`/`startBlock` block cut — a block cut alone double-counts or drops ~740 rounds. See §3.
- **Deployment blocks:** SLVR token `5,574,774`; GridLottery V1 `5,649,104`; GridLottery V2 `16,764,101`; Hub `5,574,804`. Chain head at research time: `18,429,500`.

---

## 1. SLVR Token — `0x791229E3EbD6CFdC3D8157f48722684173C29aD9`

**Verified.** `name: SlvrToken`, compiler `v0.8.33`, OpenZeppelin ERC20 + ERC20Burnable + AccessControl + Ownable2Step. ABI: `abis/SlvrToken.json`. Deployed at **block 5,574,774** (2026-07-09 22:25:23 UTC), creator `0x11111972…` (deployer/admin wallet).

### 1a. Decimals + cap (CONFIRMED on-chain)
```solidity
uint256 public constant MAX_SUPPLY = 500_000e18; // 500,000 SLVR
```
- `decimals()` → **18** (OZ default, not overridden). `eth_call` confirmed.
- `MAX_SUPPLY()` → `500000000000000000000000` (= 500,000e18). `eth_call` confirmed.
- Live `totalSupply()` at head → `6404319890076564182262` ≈ **6,404.32 SLVR**. (Cross-check: subgraph `totalSlvrMinted 16,940.96 − totalBurnedSlvr 10,538.87 = 6,402.09 ≈ 6,404` — matches within recent-block drift. The circular emission model means totalSupply is far below the cap because burns are large.)

### 1b. Burn mechanism
All burn paths converge on one event:
```solidity
event TokensBurned(address indexed account, uint256 amount, uint256 newTotalSupply);
```
- `burn(uint256)` / `burnFrom(address,uint256)` — override OZ `ERC20Burnable`, assert `totalSupply` dropped by exactly `value`, emit `TokensBurned`.
- **Transfers to `0x0` or `0x…dEaD` are redirected to a real burn** (not parked): `transfer`/`transferFrom` call `_burnToDead()` which `_burn`s and emits the same `TokensBurned`. This is deliberate ("reopens mint headroom for the circular emission model").
- **Indexing rule:** cumulative burns = `SUM(TokensBurned.amount)`. Do NOT also count `Transfer`-to-dead separately — a dead/zero transfer emits `Transfer(from, 0x0, value)` *and* `TokensBurned`; the ERC20 `_burn` emits `Transfer(from, address(0), value)`. Count burns from `TokensBurned` OR from `Transfer where to == 0x0`, **never both**.

### 1c. Emission / mint path (feeds emissions + supply)
```solidity
bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) { ... }
```
- **Who mints:** the holder of `MINTER_ROLE`. In production that is the **SLVR Hub** (`0x55FC0d…`) — the lottery calls `ISlvrHub(hub).mintReward(address(this), slvrPerRound)` and the Hub is the sole minter (see §2, §4).
- **Mint math:** `mint(to, amount)` mints `amount` to `to`, **plus 8% to team vesting, plus 4% to growth fund** → total minted = `amount × 1.12`. Constants: `TEAM_ALLOCATION_BPS = 800`, `GROWTH_FUND_ALLOCATION_BPS = 400`.
- **⚠️ There is NO `Mint`/`RewardMinted` event on the token.** Every `_mint` only emits the standard `Transfer(0x0, recipient, value)`. **Emissions must be indexed as `Transfer` logs where `from == address(0)`.** (The Hub emits its own `RewardMinted` — see §4 — which is a cleaner per-game emission signal, but the token-level ground truth for "how much SLVR was created" is `Transfer` from zero.)
- Genesis seed: `initialMint(to)` / `initialMint(to, amount)` — one-time, owner-only, `INITIAL_SUPPLY = 10_000e18` default (or a caller-chosen smaller seed). Also carves 8%/4% to team/growth. One-time `initialMintDone` guard.

### 1d. Buy/sell tax + routing
```solidity
uint16 public constant LAUNCH_TAX_BPS = 200; // 2% buy / 2% sell — all-time max, DECREASE-ONLY
uint16 public buyTaxBps;  // live: 200
uint16 public sellTaxBps; // live: 200
event TaxCollected(address indexed from, uint256 amount, uint16 taxRateBps, bool isBuy);
```
- Live `buyTaxBps` = `sellTaxBps` = **200** (2%). `setBuyTax`/`setSellTax` revert on any increase — tax can only ever go down.
- **Trigger:** tax applies only on transfers to/from a *taxed pool* (`isTaxedPool[addr]`, plus the legacy `uniswapV2Pair`). `isBuy = pool is `from`; `isSell = pool is `to`. Minting, burning, and tax-exempt addresses are never taxed.
- **Routing:** collected SLVR tax accrues in the token contract (`accumulatedTax`). On sells it "swaps back" SLVR→ETH (via the configured V2 router **or** a pluggable `taxHandler`), then deposits the ETH into the **jackpot** via `addEthToJackpot()` on `jackpotRecipient` (the lottery). Events along that path: `SwapbackExecuted(slvrSwapped, ethReceived)`, `EthDepositedToJackpot(amount)`, `TaxRoutedToHandler(handler, amount)`. So **tax ultimately funds the ETH jackpot, not SLVR dividends.**
- Cross-check: subgraph `ProtocolStat.totalTaxCollected` aggregates `TaxCollected`. Phase 3 can validate against `SUM(TaxCollected.amount)`.

### 1e. Exact SLVR event signatures (for Phase 1 indexing)
| Event | topic0 | Use |
|-------|--------|-----|
| `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` | transfers; **emissions = from==0x0**; **burns = to==0x0** |
| `TokensBurned(address,uint256,uint256)` | `0xccbea4088a3b7ae9ca2d15fab9a9742a4075b4d7247768a1eecea917565aba00` | canonical burns (amount, newTotalSupply) |
| `TaxCollected(address,uint256,uint16,bool)` | `0x4534afcfa5b652fe0fe6450082e0859d5cf4e88a7a48083c7a2d8f73c83caef0` | tax revenue, buy vs sell |

`getCirculatingSupply()` exists on-chain (= totalSupply − teamVesting balance − growthFund balance) — useful as a reference/cross-check for Phase 3's circulating-supply metric, but SLVRline should compute its own per METHODOLOGY.

---

## 2. Grid Lottery (mining game) — round lifecycle, bets, winners, per-round emission

Both contracts are the **same source** (`name: SlvrGridLottery`, identical event set, identical `REFINING_FEE_BPS = 1000` confirmed on both). ABIs: `abis/GridLotteryV2.json`, `abis/GridLotteryV1.json` (identical event surface).

- **CURRENT (V2):** `0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71` — deployed **block 16,764,101** (2026-07-22 21:53:52 UTC). `startBlock = 16764101`.
- **PREVIOUS (V1):** `0x284Eb4016305Fa7FbC162Fb68F27227271001c7f` — deployed **block 5,649,104** (2026-07-10 00:29:31 UTC). `startBlock = 5649104`.

### 2a. Round lifecycle (open → bet → request randomness → resolve → claim)
```
BetPlaced ──► RandomnessRequested ──► RoundResolved ──► Claimed (per winner)
```
- **Bet:** `BetPlaced(uint256 indexed roundId, address indexed beneficiary, uint256 total, uint8[] squares)`. `total` = ETH wagered this bet; `squares` = grid tiles bet on. Min bet `minBetPerSquare = 1e13` per square; new miners pay a one-time `ACCOUNT_DEPOSIT = 0.0001e18` (`AccountOpened`).
- **Randomness:** `RandomnessRequested(uint256 indexed roundId, bytes32 randomnessId)` (drand via `0x1F3B0992…`); `RandomnessReRequested` on timeout (`RESOLUTION_TIMEOUT = 5 minutes`).
- **Resolve:** `RoundResolved(uint256 indexed roundId, uint8 winningSquare, bool jackpotHit, bool singleMinerRound, address indexed singleMinerWinner, uint256 winnerTotal, uint256 potForWinners, uint256 slvrForWinners, uint256 totalUnclaimedSlvr)`. This is the round's terminal state and the primary per-round record.
- **Claim:** `Claimed(uint256 indexed roundId, address indexed user, uint256 nativeOut, uint256 slvrOut, uint256 refinedOut, uint256 refiningFee)`. `nativeOut` = ETH won; `slvrOut` = SLVR reward paid; `refinedOut` = dividends (refined) paid; `refiningFee` = the 10% skim taken from this claim (which funds others). `roundId == 0` is used for `withdrawUnrefinedSlvr()` (a claim of leftover SLVR not tied to a specific round).

### 2b. Per-round SLVR emission (source-quoted)
```solidity
// SlvrGridLottery._calculateRoundValues()
uint256 actualSlvrForRound;
if (hub != address(0)) {
    try ISlvrHub(hub).mintReward(address(this), slvrPerRound) returns (uint256 minted) {
        actualSlvrForRound = minted;
    } catch { actualSlvrForRound = 0; }
}
```
- `slvrPerRound` (public getter) = **`1e18` (1 SLVR) confirmed on-chain**. The Hub is the sole minter and applies the protocol cap centrally; it returns the amount actually minted (0 if capped/skipped). So **per-round base emission = 1 SLVR**, distributed to winners as `slvrForWinners` (after carry-pool rollover), plus 8%/4% team/growth minted alongside by the token (see §1c). `SlvrPerRoundUpdated(oldValue,newValue)` fires if the owner changes it.
- **ETH fee split per round:** `protocolFeeBps = 1000` (10% of wager) confirmed; of the wager, **2% fixed → jackpot**, **remainder of the protocol fee → stakers** (default 8%), rest of pot → winners. Team's 8% is supply-inflation-based (in `mint`), not volume-based.

### 2c. Exact lottery event signatures Ponder must index (Phase 1)
| Event | topic0 | Notes |
|-------|--------|-------|
| `BetPlaced(uint256,address,uint256,uint8[])` | `0xd60a2fc8819207eb21f78d0ae6d3c0a97cc7a3e76eb20e4d8c3049023f9da306` | roundId & beneficiary indexed; `total`,`squares` in data |
| `RoundResolved(uint256,uint8,bool,bool,address,uint256,uint256,uint256,uint256)` | `0xbd5f709c4d668036bf18781186ef1055cac09f63fafae1e01b7acbef650bd178` | roundId & singleMinerWinner indexed |
| `Claimed(uint256,address,uint256,uint256,uint256,uint256)` | `0xd1ff7a7bda4280bb8e279cdc1f14935f20b17cc34db07bfa73deb41eef33c511` | roundId & user indexed |
| `MinerIndexUpdated(uint256,uint256,uint256)` | `0x08107be1027cfaca34bd76124434d29ec69c5d5c31e3e516306c4153911b966e` | **DIVIDENDS** — (newIndex, totalUnclaimed, totalRefined), all in data |
| `RefiningFeeApplied(address,uint256,uint256,uint256,uint256)` | `0x12862cac451be3f21f3927fa2b14997d415877c689c6739a3f9853ec8f5b5d7f` | **DIVIDENDS** — account indexed; (rewardsSlvr, fee, newIndex, totalUnclaimed) in data |
| `RandomnessRequested(uint256,bytes32)` | `0x587602b661da57eff43c58d2ebb4b7c66d08862f786faf29f390136b3309a128` | roundId indexed (optional for P1 charts) |
| `AccountOpened(address,uint256)` | `0xf2148403699fd875364cc4d0b6b58e2f749274318e8e27362c32bba57fed1201` | new miner accounts (optional) |

---

## 3. Round-12,500 migration — the actual block/round boundary (**correctness-critical**)

**The PROJECT.md assumption of a clean split at round 12,500 is only half-true, and a naive `endBlock`/`startBlock` block cut is WRONG.** Empirical `eth_getLogs` over `RoundResolved` on both contracts (full history to head):

| Contract | Rounds resolved (RoundResolved) | Count |
|----------|--------------------------------|-------|
| V1 `0x284Eb4…` | **0 → 13,122** | 12,234 |
| V2 `0xB0Cc99…` | **12,370 → 14,224 (ongoing)** | 1,842 |
| **OVERLAP (same round # on both)** | **12,370 → 13,122** | **740 rounds** |

The two contracts ran **in parallel** for ~19 hours during the migration. In the overlap window many rounds resolved on both within seconds of each other (some in the *exact same block*, e.g. round 13,122 resolved at block 17,440,150 on both). V1 then stopped at round 13,122 (block 17,440,150, 2026-07-23 16:43:31 UTC); V2 continued alone.

**The configured cutover (2026-07-23 01:09:24 UTC) lines up with V2 resolving round 12,500:**
- V2 round **12,500** resolved at **block 16,881,792**, timestamp 2026-07-23 01:10:32 UTC — **68 s** after the configured cutover. (Found via `eth_getLogs` RoundResolved on V2, matching `roundId==12500`. Cross-checked against subgraph `round(id:"12500").createdAtBlock = 16,881,121`, also on V2.)

### How to split so rounds are neither missed nor double-counted
**Do NOT split purely by block.** A block cut at ~16,881,792 would still capture V1's parallel rounds 12,500–13,122 (V1 kept emitting them after that block) → double-count; and would drop V2's early rounds 12,370–12,499 (V2 emitted them *before* that block) if V2's startBlock were set that high → gap.

**Correct approach — index BOTH contracts in full, attribute canonically by round number:**
1. In `ponder.config.ts`, register `GridLotteryV1` with `startBlock: 5649104` and `GridLotteryV2` with `startBlock: 16764101`. **Both run to head** (no `endBlock`, or `endBlock` on V1 = its last-activity block `17,440,150` purely as an optimization — but you still need V2 from 16,764,101, so both ranges overlap in blocks; that's fine because attribution is by round number, not block).
2. Store `contract_address` on every row (composite PK `(chain_id, contract_address, tx_hash, log_index)` — no clash even for same-block same-round events, because `log_index` differs and the address differs).
3. Define a **canonical round view**: `MIGRATION_ROUND = 12500`. A round is canonical from **V1 if `roundId < 12500`**, from **V2 if `roundId >= 12500`**. Everything outside its canonical contract in the overlap window is retained as raw audit data but excluded from round aggregates.
4. **Validation query (Phase-1 success criterion #1):** the required check "zero round numbers appear in canonical rounds from both contracts" passes by construction with the round-number rule. But ALSO assert the raw overlap is understood: expect exactly **740** round numbers present on both raw contracts (12,370–13,122) — this is the known parallel window, not corruption.

> **Cross-check caveat for the subgraph:** the Goldsky subgraph keys `Round` by bare `roundId` (`id = "12500"`), so it *merges* parallel V1/V2 rounds into one entity (last-write-wins). SLVRline's `(chain_id, address, roundId)` keying is strictly more faithful. When cross-validating round counts against the subgraph, compare against **distinct canonical round numbers**, not raw event counts. Subgraph `totalRounds = 14,229` ≈ V2 max round (14,224) + a few — i.e. it counts the *deduped* logical sequence, which matches our canonical view (V1 for <12,500 ∪ V2 for ≥12,500).

**Confidence: HIGH.** Boundary block/round found concretely via `eth_getLogs` + timestamp confirmation, not bounded/estimated.

---

## 4. SLVR Hub — `0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f` + the DIVIDENDS mechanic (KEY DELIVERABLE)

**Verified.** `name: SlvrHub`. ABI: `abis/SlvrHub.json`. Deployed **block 5,574,804**. The Hub holds `MINTER_ROLE` and is the shared multi-game emission engine.

### 4a. What the Hub actually does (and does NOT do)
The Hub is the **SLVR emission + staker-payout engine**, not the dividends engine. Its events:
| Hub event | Meaning |
|-----------|---------|
| `RewardMinted(uint256 indexed gameId, address indexed to, uint256 amount)` | Hub minted `amount` SLVR to a game (the per-round emission). Cleaner per-game emission signal than token `Transfer`-from-zero. |
| `EmissionRateChanged(uint256 ratePerSec)` | Hub's SLVR emission rate (per second). Drives **mining runway** (Phase 3). |
| `EmissionSkipped(uint256 indexed gameId, uint256 requested)` | Emission skipped (e.g. cap reached). |
| `StakersPaid(uint256 indexed gameId, uint256 seq, uint256 amount)` / `StakersDeferred` | ETH paid to veSLVR stakers. |
| `JackpotFed` / `JackpotRolled` / `JackpotChanged` | Jackpot funding/roll. |
| `TargetSupplyChanged` / `MaxAccrualSecondsChanged` | Emission cap params. |

**Crucial correction to prior research:** the Dividends ("yield to miners who have not claimed") is **NOT** in the Hub. It is the **refining-fee mechanic inside the Grid Lottery** (§2, §4b). The Hub funds *emissions* (new SLVR to winners) and *staker* ETH rewards (to veSLVR lockers) — neither is the "dividends" headline metric.

### 4b. The DIVIDENDS mechanic — precise mechanics from source
This is a **scaled reward-index accumulator** ("ORE-style", per the code's own comments), identical in spirit to MasterChef `accRewardPerShare`. State (all public getters, in the Grid Lottery contract):
```solidity
uint256 public minerIndex;      // cumulative refining fees per 1e18 unclaimed SLVR (WAD-scaled)
uint256 public totalUnclaimed;  // total unclaimed SLVR across all miners (the dividend base)
uint256 public totalRefined;    // total refined SLVR owed but not yet paid out
uint16  public constant REFINING_FEE_BPS = 1_000; // 10%
```

**Who funds dividends & how (source-quoted from `_processClaimWithRefining`, `ClaimLib`, `MathLib`):**
1. A miner's SLVR reward becomes "unclaimed" at round resolution: `totalUnclaimed += r.slvrForWinners` (in `_finalizeRoundWithWinners`).
2. When *any* miner claims, a **10% refining fee** is skimmed off *their* SLVR reward:
   `refiningFee = slvrReward × REFINING_FEE_BPS / 10000` (`MathLib.calculateFee`).
3. That fee is **redistributed to all OTHER still-unclaimed miners** by bumping the global index:
   `indexIncrement = refiningFee × WAD / totalUnclaimed` (`MathLib.calculateIndexIncrement`), then `minerIndex += indexIncrement; totalRefined += refiningFee;` and it emits `MinerIndexUpdated` + `RefiningFeeApplied`.
4. Each unclaimed miner accrues dividends proportional to their unclaimed balance since they last checkpointed:
   `refinedDelta = unclaimed × (minerIndex − indexSnapshot) / WAD` (`MathLib.calculateRefinedDelta`).
5. On claim, the miner receives `slvrReward + refinedAccrued − refiningFee` (`ClaimLib.calculateTotalPayout`). Permanent-lock claims can `bypassFee` (no skim) — that's the only exception, and only authorized permanent-lock contracts may use it.

**So "dividends paid to miners who have not claimed, funded by other miners" = the refining fees skimmed from claimers, streamed pro-rata to the unclaimed pool via `minerIndex`.** Exactly matches PROJECT.md. The `minerIndex` is literally *cumulative dividends paid per 1 unclaimed SLVR* — this is the key to a clean APR.

**Exact events/fields to track for dividends:**
- `MinerIndexUpdated(newIndex, totalUnclaimed, totalRefined)` — the index time series + live dividend base.
- `RefiningFeeApplied(account, rewardsSlvr, fee, newIndex, totalUnclaimed)` — per-event dividend *funding* amount (`fee`).
- Live getters `minerIndex()`, `totalUnclaimed()`, `totalRefined()` for exact current state (confirmed selectors: `0x9806b4d2`, `0xc96f14b8`, `0x9ff953a0`).

### 4c. Dividends APR formula (DERIVE — this is the deliverable)

**Primary (authoritative) — index-delta method:**
Because `minerIndex` is the cumulative dividend paid per 1 unclaimed SLVR (WAD-scaled), the fractional return earned by a continuously-unclaimed miner over window `W` is exactly `Δindex/WAD`. Annualize:

```
APR = ( minerIndex(t) − minerIndex(t − W) ) / 1e18 × ( 31_536_000 / W )
```
- `minerIndex(t)`: read live via `eth_call` (`0x9806b4d2`) or subgraph `minerIndexUpdateds(orderBy:blockNumber desc)[0].newIndex`.
- `minerIndex(t − W)`: earliest `MinerIndexUpdated.newIndex` with `timestamp ≥ t − W`.
- `W = 604_800` (7 days). Label the headline **"Dividends APR (7-day)"**.
- Each variable maps to on-chain events: numerator = Δ of `MinerIndexUpdated.newIndex`; window from event `timestamp`s.

**Equivalent (sanity) — flow-over-base method:**
```
APR ≈ ( Σ RefiningFeeApplied.fee over W ) / totalUnclaimed_avg × ( 31_536_000 / W )
```
Numerator = sum of dividend *funding* (`fee`) over the window; denominator = the unclaimed pool it was distributed across. This double-counts churn if you use a point-in-time `totalUnclaimed`, so the **index-delta method is preferred** — it is inherently per-unit-staked and needs no separate denominator snapshot.

**Worked numeric example (real data, 2026-07-24, 7-day window ending block ~18,430,130):**
- `minerIndex(now)` = `1.789282914952366881` (WAD `1789282914952366881`) — confirmed by BOTH `eth_call` and subgraph, exact match.
- `minerIndex(7d ago)` = `1.553721446508952…` (earliest `MinerIndexUpdated` with ts ≥ now−7d).
- Δindex = `0.2356` over 7.00 days → **period return = +23.56% on unclaimed SLVR**.
- **APR = 0.2356 × (31,536,000 / 604,800) ≈ 1,228%** (7-day annualized).
- Live denominator context: `totalUnclaimed ≈ 495.03 SLVR`, `totalRefined ≈ 160.49 SLVR` (both `eth_call`-confirmed).
- Flow method for comparison: `Σ fee (7d) ≈ 564.4 SLVR` → annualized ≈ 29,443 SLVR/yr over a ~495 SLVR pool ≈ 5,948% (higher because it ignores pool churn). **Report the index-delta ~1,228% as authoritative; the flow number is an upper bound.**

**Cross-check vs subgraph:** the subgraph has NO pre-computed APR/dividend field (`ProtocolStat` tracks minting/burn/tax/rounds but not dividends), so there is no single subgraph number to match against. The valid cross-check is that our inputs are exact: subgraph `minerIndexUpdateds[0].newIndex == eth_call minerIndex()` (both `1789282914952366881`) and subgraph `refiningFeeApplieds.fee` sums feed the flow method. **Ballpark confidence: MEDIUM-HIGH on the formula (mechanically exact), LOW-MEDIUM on the *level* only because the protocol is ~15 days old — the window is short and the yield is genuinely volatile and very high. Treat magnitude as real but early; suppress/annotate the headline until ≥7 full days of V2 data and re-validate in Phase 3.**

**APR pitfalls this formula avoids (per PITFALLS §6):** numerator is the *refining fee funded by other miners* (not total emissions); denominator is *unclaimed SLVR* (via the index, not total staked); window is 7-day rolling (not a 24 h spike). All three failure modes are structurally avoided.

---

## 5. veSLVR Vote-Escrow NFT — `0xd9b8FBD61033145c5496132153CE675756313B71` (Phase 2, noted)

**Verified.** `name: SlvrVoteEscrow`, ERC-721, **soulbound** (non-transferable). ABI: `abis/SlvrVoteEscrow.json`. Deployed **block 5,574,784**.

**Lock storage:**
```solidity
struct Lock { uint256 amount; uint256 lockStart; uint256 lockEnd; bool permanent; bool isMaxTime; }
mapping(uint256 => Lock) public locks;                 // per tokenId
mapping(address => uint256) public userPermanentLockId;// user's permanent lock (0 = none)
uint256 public constant TMAX = 4 * 30 days;            // 4-month max lock
```
- **Permanent lock encoding:** `lockEnd == 0 && permanent == true` (a **`permanent` bool flag**, NOT a `type(uint256).max` sentinel). One permanent lock per user max.
- **⚠️ Permanent locks BURN the underlying SLVR** ("Actually burn the tokens to reduce total supply"). So permanently-locked SLVR is *removed from `totalSupply()`*, whereas time-locked SLVR sits in the veNFT contract's `balanceOf`. This materially affects circulating-supply and "permanently locked" metrics.
- **No aggregate `supply()` getter** — total locked must be derived by summing `locks[tokenId].amount` (from events) or reading `locks()`/`getLock()` per tokenId. (Contrast with the Phase-2 success criterion referencing `supply()` — that getter does NOT exist here; use event sums or per-token `locks()` reads, reconciled against the veNFT `balanceOf(SLVR)` for time-locked portion.)

**Events to index (Phase 2):**
`LockCreated(tokenId, user, amount, duration, permanent)` · `LockIncreased(tokenId, addedAmount, newLockEnd)` · `LockExtended(tokenId, newLockEnd)` · `LockWithdrawn(tokenId, user, amount)` · `LockConvertedToPermanent(tokenId, permanentTokenId, amount)` · `Transfer` (mint/burn of the NFT).
- **Total staked (veSLVR):** `Σ amount` over active locks (LockCreated + LockIncreased − LockWithdrawn), or per-token `locks()`.
- **Total permanently-locked:** `Σ amount` where `locks[tokenId].permanent == true` (filter `LockCreated.permanent == true` + `LockConvertedToPermanent` + permanent `LockIncreased`).

## 6. veSLVR staking — `0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200` (Phase 2, noted)

**Verified.** `name: SlvrVoteEscrowStaking`. ABI: `abis/SlvrVoteEscrowStaking.json`. Deployed **block 5,574,808**. Stakes **veNFTs** (not raw SLVR) and distributes **ETH** protocol revenue (from the Hub's `StakersPaid`).
- Events: `Staked(tokenId, user, weight)` · `Unstaked(tokenId, user, weight)` · `Checkpoint(tokenId, oldWeight, newWeight)` · `RewardDistributed(amount)` · `RewardClaimed(tokenId, user, amount)` · `PendingRewardsClaimed` · `RewardsSettledOnBurn`.
- "SLVR staked in veStaking" requires resolving staked `tokenId`s → `locks[tokenId].amount` on the veNFT (one hop). Do not sum `weight` (weight = amount × time-multiplier, not SLVR).

## 7. LP staking — `0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA` (Phase 2, noted)

**Verified.** `name: SlvrLiquidityStaking`. ABI: `abis/SlvrLiquidityStaking.json`. Deployed **block 5,574,869**. Stakes the **SLVR/WETH V2 LP token**; pays **ETH** rewards.
- `uint256 public totalStaked;` — **clean on-chain getter for total LP staked** (also `totalWeight`). Reconcile event sums against `totalStaked()` (canonical).
- Events: `Deposit(user, amount)` · `Withdraw(user, amount, fee)` · `RewardClaimed(user, amount)` · `RewardDeposited(depositor, amount)` · `RewardRateUpdated(newRate, periodFinish)`.
- **SLVR/WETH V2 pair** `0xe365b92239097Ed3322131411DbE15a5c4068eff` (`name: UniswapV2Pair`, deployed **block 5,574,866**) is the staked LP token's underlying; standard V2 `getReserves()` / `Sync` / `Swap` for price & liquidity (Phase 2).

> Phases 2–3 will extend indexing to §5–7 plus V4 pools and the Hub. This doc documents their event/storage shapes for planning but does not fully design them.

---

## Concrete Ponder indexing plan — PHASE 1 SCOPE ONLY

**Scope:** SLVR token + BOTH Grid Lottery contracts (V1 + V2). Chain id `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`.

### Contracts / blocks
| Ponder name | Address | startBlock | endBlock | Rationale |
|-------------|---------|-----------|----------|-----------|
| `SlvrToken` | `0x791229…C29aD9` | `5574774` | — (head) | transfers/emissions/burns/tax |
| `GridLotteryV1` | `0x284Eb4…001c7f` | `5649104` | `17440150` (opt.) | genesis→round 13,122; canonical for round < 12,500 |
| `GridLotteryV2` | `0xB0Cc99…1e0c71` | `16764101` | — (head) | round 12,370→ongoing; canonical for round ≥ 12,500 |

- V1 `endBlock 17440150` is a safe optimization (its last-ever RoundResolved), NOT the migration boundary. **Attribution is by round number (MIGRATION_ROUND = 12,500), not block.** Both contracts' block ranges overlap — that's expected and fine.
- Empirically tune `eth_getLogs` range: `eth_getLogs` succeeded at 1,000,000-block windows against this RPC during research, but honor PITFALLS' guidance to start conservative (~500 blocks) for the production backfill and widen if stable.

### Events to handle (Phase 1)
- **SlvrToken:** `Transfer` (→ transfers table; derive emissions where `from==0x0`, burns where `to==0x0`), `TokensBurned` (→ burns table), `TaxCollected` (→ tax table).
- **GridLottery V1+V2 (shared handlers, keyed by contract address):** `BetPlaced`, `RoundResolved`, `Claimed`, `MinerIndexUpdated`, `RefiningFeeApplied`. (Optional: `RandomnessRequested`, `AccountOpened`.)

### Proposed table / column shapes
All amounts **`NUMERIC`/bigint** (never float). All event rows keyed by **`(chain_id, contract_address, tx_hash, log_index)`**.

```
token_transfer(chain_id, contract_address, tx_hash, log_index,
               block_number BIGINT, block_time TIMESTAMPTZ,
               from_addr, to_addr, value NUMERIC,
               is_mint BOOL /* from==0x0 */, is_burn BOOL /* to==0x0 */)
  PK (chain_id, contract_address, tx_hash, log_index)

token_burn(chain_id, contract_address, tx_hash, log_index,
           block_number, block_time, account, amount NUMERIC, new_total_supply NUMERIC)
  PK (chain_id, contract_address, tx_hash, log_index)

token_tax(chain_id, contract_address, tx_hash, log_index,
          block_number, block_time, from_addr, amount NUMERIC, tax_rate_bps INT, is_buy BOOL)
  PK (chain_id, contract_address, tx_hash, log_index)

lottery_bet(chain_id, contract_address, tx_hash, log_index,
            block_number, block_time, round_id NUMERIC, beneficiary,
            total NUMERIC, squares INT[] /* uint8[] */)
  PK (chain_id, contract_address, tx_hash, log_index)

lottery_round(chain_id, contract_address, round_id NUMERIC,
              resolved_tx_hash, resolved_log_index, block_number, block_time,
              winning_square INT, jackpot_hit BOOL, single_miner_round BOOL,
              single_miner_winner, winner_total NUMERIC, pot_for_winners NUMERIC,
              slvr_for_winners NUMERIC, total_unclaimed_slvr NUMERIC,
              is_canonical BOOL /* address matches round-number rule */)
  PK (chain_id, contract_address, round_id)

lottery_claim(chain_id, contract_address, tx_hash, log_index,
              block_number, block_time, round_id NUMERIC, user,
              native_out NUMERIC, slvr_out NUMERIC, refined_out NUMERIC, refining_fee NUMERIC)
  PK (chain_id, contract_address, tx_hash, log_index)

dividend_index_update(chain_id, contract_address, tx_hash, log_index,
                      block_number, block_time,
                      new_index NUMERIC /* WAD */, total_unclaimed NUMERIC, total_refined NUMERIC)
  PK (chain_id, contract_address, tx_hash, log_index)   -- feeds Dividends APR (index-delta)

dividend_fee_applied(chain_id, contract_address, tx_hash, log_index,
                     block_number, block_time, account,
                     rewards_slvr NUMERIC, fee NUMERIC, new_index NUMERIC, total_unclaimed NUMERIC)
  PK (chain_id, contract_address, tx_hash, log_index)   -- feeds flow-method cross-check
```

- **Canonical round view:** `MIGRATION_ROUND = 12500`. Mark `lottery_round.is_canonical = (round_id < 12500 AND contract=V1) OR (round_id >= 12500 AND contract=V2)`. All round aggregates filter `is_canonical = true`. Raw rows retained for audit.
- **Idempotency:** `INSERT … ON CONFLICT DO NOTHING` on every PK. Double-backfill → identical counts (Ponder-native).
- **Dividends APR (Phase 3, but inputs land in Phase 1):** compute from `dividend_index_update` via the index-delta formula in §4c.

---

## Open Questions / LOW-confidence items

1. **APR *level* (not formula):** the formula is mechanically exact, but the protocol is ~15 days old and V2 only ~2 days old at research time. The 7-day window currently spans mostly V1 index history. Re-validate the magnitude in Phase 3 once ≥7 full days of V2 `MinerIndexUpdated` exist; consider a "data pending / early" annotation on the headline until then. (Confidence: formula HIGH, level LOW-MEDIUM.)
2. **`minerIndex` continuity across the migration:** V2 started its `minerIndex` fresh (V2 round 12,370 onward). For a continuous historical APR chart spanning the migration, decide whether to (a) use V2's index exclusively from round 12,500 (recommended — matches canonical rounds), or (b) stitch V1+V2 index series. For the *live* headline, use V2's live `minerIndex` only. (Flagged for Phase 3.)
3. **Emission double-source:** per-round emission is visible as both token `Transfer`-from-zero AND Hub `RewardMinted`. Phase 2/3 should pick ONE canonical source (recommend token `Transfer`-from-zero for total supply-created, since it also captures the 8%/4% team/growth mints and genesis) and treat Hub `RewardMinted` as the per-game attribution. Do not sum both.

## Sources
### Primary (HIGH — verified source + live chain)
- Blockscout verified source for all 7 contracts: `GET https://robinhoodchain.blockscout.com/api/v2/smart-contracts/<addr>` — SlvrToken, SlvrGridLottery (V1+V2), SlvrHub, SlvrVoteEscrow, SlvrVoteEscrowStaking, SlvrLiquidityStaking. Key libs read: `ClaimLib`, `MathLib`, `RewardStateLib`, `FeeDistributionLib`. ABIs saved to `.planning/phases/phase-1/abis/`.
- Live RPC `https://rpc.mainnet.chain.robinhood.com`: `eth_call` (decimals=18, MAX_SUPPLY=500000e18, totalSupply, buy/sellTaxBps=200, minerIndex/totalUnclaimed/totalRefined/slvrPerRound/REFINING_FEE_BPS on both lottery contracts), `eth_getLogs` (full RoundResolved history both contracts → migration mapping), `eth_getBlockByNumber` (timestamps), `eth_getTransactionReceipt` (creation blocks).
### Secondary (cross-check)
- Goldsky subgraph `slvr-robinhood/1.7.0` — schema introspection + `protocolStats`, `minerIndexUpdateds`, `refiningFeeApplieds`, `rounds`. Confirmed `minerIndex` exact match with `eth_call`; confirmed subgraph merges parallel rounds by bare `roundId` (last-write-wins).

## Metadata
- Standard stack / events / blocks: **HIGH** — all verified + live-confirmed.
- Migration boundary: **HIGH** — concrete block/round found, not bounded.
- Dividends APR formula: **HIGH** (mechanics/derivation) / **LOW-MEDIUM** (magnitude, due to ~15-day protocol age).
- Research date: 2026-07-24. Chain head at research: block 18,429,500. Valid until: ~7 days (fast-moving young protocol; re-confirm APR level in Phase 3).
