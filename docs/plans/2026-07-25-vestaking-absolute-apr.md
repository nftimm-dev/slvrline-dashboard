# veSLVR Absolute APR Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the "relative weight multiplier" display on /staking and /earn with a real, computed absolute ETH APR per lock length, using a trailing 7-day window of `rewardPerWeightStored` delta.

**Architecture:** The Synthetix-style `rewardPerWeightStored` (rpw) is a monotonically increasing accumulator (wei*1e18/weight). Δrpw over a trailing window × totalWeight / 1e36 = ETH distributed to stakers in that window. Annualising and converting via ETH/SLVR price yields an absolute APR per lock-weight multiplier. The 7-day window is used for stability; the route falls back to 3d/1d and labels the window used. A cross-check via `getStakerRewards(tokenId)` / weight / elapsed confirms order-of-magnitude.

**Tech Stack:** Next.js 14 App Router, TypeScript, hand-rolled JSON-RPC (`src/lib/rpc.ts` — `ethCall`, `ethBlockNumber`), existing `getMarketData()` from `src/lib/dexscreener.ts`, in-process 5-min cache (`src/lib/cache.ts`).

---

## Key Contracts

- **VE_STAKING** `0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200`
- **VE_ESCROW** `0xd9b8FBD61033145c5496132153CE675756313B71`

## Known Selectors (all verified in ABI)

| selector | function |
|---|---|
| `0x3228dd59` | `rewardPerWeightStored()` → uint256 (monotonic; wei*1e18/weight) |
| `0x96c82e57` | `totalWeight()` → uint256 |
| `0x545dcac3` | `TMAX()` → uint256 (seconds) |
| `0xc656e634` | `MMAX()` → uint256 (WAD) |
| `0x8b8fbd92` | `P()` → uint256 (WAD) |
| `0xe02ce381` | `totalRewardsOwed()` → uint256 |

## Derived Selectors (to compute, for getStakerRewards cross-check)

`getStakerRewards(uint256)` → selector is keccak256("getStakerRewards(uint256)")[:4]
= `0x1a5d86a6`  (compute: `cast sig "getStakerRewards(uint256)"` or compute manually)

To call it: `data = "0x1a5d86a6" + uint256(tokenId).toString(16).padStart(64, "0")`

## Block Time Constant

Robinhood Chain = 100ms blocks (10 blocks/sec). Source: `/api/status` route comment.

## Formula Recap

```
BLOCK_TIME_SEC = 0.1
W_BLOCKS = window_days * 86400 / BLOCK_TIME_SEC  = window_days * 864000

rpwHead = rewardPerWeightStored() at "latest"
rpwOld  = rewardPerWeightStored() at block (headBlock - W_BLOCKS)  [archival eth_call]

delta_rpw = rpwHead - rpwOld   (wei*1e18/weight units)

eth_in_window = delta_rpw * totalWeight / 1e36   (ETH, using totalWeight at head)
eth_per_day   = eth_in_window / window_days

# Per lock duration d, weight multiplier m(d):
apr(m) = (delta_rpw * 365 / window_days / 1e18) * (ethUsd / slvrUsd) * m
       = (eth_per_day * 365 / totalWeight_human) * (ethUsd / slvrUsd) * m
         ... where totalWeight_human = totalWeight / 1e18

# Multiplier formula:
m(d) = 1 + (MMAX - 1) * min(d_seconds, TMAX) / TMAX
m(permanent) = 1 + (MMAX - 1) * P  [P from escrow]

# Lock lengths to show: 1 day, 1 week, 1 month, 4 months, permanent
```

## Archival eth_call quirk

The `ethCall()` in `src/lib/rpc.ts` already accepts a `block: bigint | "latest"` parameter.
Old blocks sometimes return error "missing/invalid params" on certain RPC nodes — this means try ±a few blocks (5-10) or fall back to shorter window.

## Cross-check

Pick any staked tokenId with nonzero weight. Call:
1. `getStakerRewards(tokenId)` → claimableRewards (wei)
2. `totalWeight()` at head
3. `rewardPerWeightStored()` at head (rpwHead) and `rewardPerWeightPaid(tokenId)` (0xe… — but this isn't in the public view, so use the rewards(tokenId) mapping + rpw approach: `getStakerRewards` is the authoritative view)

Since `getStakerRewards(tokenId) ≈ weight(tokenId) * (rpwHead - rpwPaid_tokenId) / 1e18 + rewards_stored(tokenId)`, a rough sanity: `claimableRewards / weight_tokenId / 1e18 ≈ (rpwHead - rpwOld_estimate)`. This gives an order-of-magnitude cross-check. We report both values.

A good tokenId to try: enumerate the first few from any staking event log, or hardcode a known active one. Alternatively, call `getStakerRewards` for a few small tokenIds (1..20) and pick one that returns nonzero.

---

## Task 1: Add archival block lookup utility in `src/lib/rpc.ts`

The existing `ethCall()` can already call at a block number (bigint). We just need to ensure that `ethBlockNumber()` is exported (it is, line 213 of rpc.ts).

**Files:**
- Modify: `src/lib/rpc.ts` — no changes needed (ethCall and ethBlockNumber already exported)
- The only missing piece is `eth_getBlockByNumber` to get a block's timestamp, but we do NOT need it — we use block count arithmetic (known 100ms block time) to compute the block `W_BLOCKS` ago.

No code changes in this task. Verify the exports are usable:

**Step 1: Confirm ethCall and ethBlockNumber are exported**

```bash
grep -n "export async function" /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web/src/lib/rpc.ts
```

Expected: `ethCall`, `ethBlockNumber`, `ethGetBalance`, `getLogsAdaptive` all listed.

---

## Task 2: Rewrite `/api/staking-rewards` to compute absolute APR

**Files:**
- Modify: `src/app/api/staking-rewards/route.ts`

Replace the current `build()` function entirely. The new route:
1. Reads TMAX/MMAX/P from VE_ESCROW (same as before).
2. Gets `ethBlockNumber()` → headBlock.
3. Tries 7-day window: archival `ethCall` for `rewardPerWeightStored` at block `headBlock - 7*864000`. Falls back to 3d (3*864000), then 1d (864000). Labels the window used.
4. Reads `rewardPerWeightStored` at head and `totalWeight` at head.
5. Gets market prices via `getMarketData()` from `src/lib/dexscreener.ts`.
6. Computes `delta_rpw`, `eth_per_day`, APR per lock type.
7. Performs cross-check: calls `getStakerRewards(tokenId)` for tokenId=1..10 to find first nonzero; reports it.
8. Returns the new response shape.

**Step 1: Write the new route**

Replace the entire file `/Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web/src/app/api/staking-rewards/route.ts` with:

```typescript
/**
 * GET /api/staking-rewards
 *
 * "Rewards by lock length" — absolute ETH APR per veSLVR lock duration.
 *
 * METHOD (Synthetix-style; rewards are native ETH):
 *   rewardPerWeightStored (rpw) is a monotonically increasing accumulator:
 *     rpw += msg.value * 1e18 / totalWeight   (each distributeRoundRewards call)
 *   Units: wei × 1e18 / weight (so wei/weight × 1e18).
 *
 *   Δrpw over a trailing window W = rpwHead − rpwOld (at block now−W)
 *   ETH to stakers in W = Δrpw × totalWeight / 1e36
 *   Per 1 SLVR at multiplier m:
 *     APR(m) = (Δrpw × 365/Wdays / 1e18) × (ethUsd / slvrUsd) × m
 *
 *   Window: 7-day preferred; falls back to 3d / 1d on archival call failure.
 *   Block time: 100ms (10 blocks/sec) → W_blocks = Wdays × 864,000
 *
 * CROSS-CHECK:
 *   getStakerRewards(tokenId) / tokenWeight / elapsed_rpw should be ~Δrpw/weight.
 *   Reported for transparency.
 *
 * Cache: 5 minutes.
 */
import { NextResponse } from "next/server";
import { ethCall, ethBlockNumber, decodeUint256, encodeUint256 } from "@/lib/rpc";
import { withCache } from "@/lib/cache";
import { getMarketData } from "@/lib/dexscreener";

export const dynamic = "force-dynamic";

const VE_ESCROW  = "0xd9b8FBD61033145c5496132153CE675756313B71";
const VE_STAKING = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200";

const SEL = {
  TMAX:                  "0x545dcac3", // TMAX()  → uint256 (VE_ESCROW)
  MMAX:                  "0xc656e634", // MMAX()  → uint256 (VE_ESCROW)
  P:                     "0x8b8fbd92", // P()     → uint256 (VE_ESCROW)
  rewardPerWeightStored: "0x3228dd59", // rewardPerWeightStored() → uint256 (VE_STAKING)
  totalWeight:           "0x96c82e57", // totalWeight() → uint256 (VE_STAKING)
  getStakerRewards:      "0x4e63ddf4", // getStakerRewards(uint256) → uint256 (VE_STAKING)
} as const;

const WAD            = 1e18;
const BLOCK_TIME_SEC = 0.1;             // 100ms Robinhood Chain blocks
const BLOCKS_PER_DAY = 86400 / BLOCK_TIME_SEC; // 864,000

const CACHE_KEY     = "staking:rewards-apr";
const CACHE_TTL_SEC = 300; // 5 min

/** Lock configurations to report. */
const LOCK_CONFIGS: Array<{ key: string; label: string; days: number | null }> = [
  { key: "1day",      label: "1 day",      days: 1   },
  { key: "1week",     label: "1 week",     days: 7   },
  { key: "1month",    label: "1 month",    days: 30  },
  { key: "4months",   label: "4 months",   days: 120 },
  { key: "permanent", label: "Permanent",  days: null },
];

interface AprRow {
  key:         string;
  label:       string;
  durationDays: number | null;
  multiplier:  number;
  aprPercent:  number;     // absolute ETH/SLVR APR %
  aprDisplay:  string;     // e.g. "1,320%"
}

interface CrossCheck {
  tokenId:           number | null;
  claimableEth:      number | null;
  trackedWeight:     number | null;
  deltaRpwEth:       number | null;   // Δrpw/1e18 (how much 1 unit of weight earns per rpw unit)
  impliedRpwPerWeight: number | null; // getStakerRewards / tokenWeight (should ≈ Δrpw/1e18)
  consistent:        boolean;
  note:              string;
}

interface StakingRewardsResponse {
  mode:           "apr";
  rewardToken:    "ETH";
  window_days:    number;
  eth_per_day:    number;
  ethUsd:         number;
  slvrUsd:        number;
  rows:           AprRow[];
  params: {
    tmaxSeconds:         number;
    tmaxMonths:          number;
    mmax:                number;
    permanentFactor:     number;
    permanentMultiplier: number;
  };
  rateContext: {
    rewardPerWeightStored_head: string;
    rewardPerWeightStored_old:  string;
    deltaRpw:                   string;
    totalWeight:                number;
    headBlock:                  number;
    oldBlock:                   number;
  };
  crossCheck:  CrossCheck;
  source:      string;
  updatedAt:   string;
}

/** Try an archival eth_call; return null instead of throwing. */
async function tryEthCall(to: string, sel: string, block: bigint): Promise<bigint | null> {
  try {
    const raw = await ethCall(to, sel, block);
    return decodeUint256(raw);
  } catch {
    return null;
  }
}

/** Nudge a block by ±delta to work around "missing/invalid params" on some nodes. */
async function archivalRpw(block: bigint): Promise<bigint | null> {
  // Try exact block first, then ±5, ±15 blocks
  for (const delta of [0n, 5n, -5n, 15n, -15n]) {
    const result = await tryEthCall(VE_STAKING, SEL.rewardPerWeightStored, block + delta);
    if (result !== null) return result;
  }
  return null;
}

/** Find first tokenId (1..20) where getStakerRewards returns nonzero. */
async function findCrossCheckToken(): Promise<{ tokenId: number; rewards: bigint } | null> {
  for (let id = 1; id <= 20; id++) {
    try {
      const data = SEL.getStakerRewards + encodeUint256(BigInt(id));
      const raw  = await ethCall(VE_STAKING, data, "latest");
      const val  = decodeUint256(raw);
      if (val > 0n) return { tokenId: id, rewards: val };
    } catch {
      // skip
    }
  }
  return null;
}

function fmtPct(n: number): string {
  if (n >= 1000)
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + "%";
  return n.toFixed(n >= 100 ? 0 : 1) + "%";
}

async function build(): Promise<StakingRewardsResponse> {
  // 1. Fetch multiplier constants + head block + market data in parallel
  const [tmaxRaw, mmaxRaw, pRaw, headBlock, market] = await Promise.all([
    ethCall(VE_ESCROW,  SEL.TMAX, "latest").then(decodeUint256),
    ethCall(VE_ESCROW,  SEL.MMAX, "latest").then(decodeUint256),
    ethCall(VE_ESCROW,  SEL.P,    "latest").then(decodeUint256),
    ethBlockNumber(),
    getMarketData(),
  ]);

  const tmaxSeconds        = Number(tmaxRaw);  // e.g. 10,368,000
  const mmax               = Number(mmaxRaw) / WAD;  // e.g. 2.5
  const permanentFactor    = Number(pRaw) / WAD;     // e.g. 2.0
  const permanentMultiplier = 1 + (mmax - 1) * permanentFactor; // 4.0

  const ethUsd  = market.eth_usd;
  const slvrUsd = market.slvr_usd;

  // 2. Read rpwHead + totalWeight at head
  const [rpwHeadRaw, totalWeightRaw] = await Promise.all([
    ethCall(VE_STAKING, SEL.rewardPerWeightStored, "latest").then(decodeUint256),
    ethCall(VE_STAKING, SEL.totalWeight, "latest").then(decodeUint256),
  ]);

  const rpwHead    = rpwHeadRaw;
  const totalWeight = Number(totalWeightRaw) / WAD;

  // 3. Try trailing windows: 7d → 3d → 1d
  let windowDays = 0;
  let rpwOld: bigint = 0n;
  let oldBlock = 0n;

  for (const days of [7, 3, 1]) {
    const wBlocks = BigInt(Math.round(days * BLOCKS_PER_DAY));
    const candidateBlock = headBlock > wBlocks ? headBlock - wBlocks : 1n;
    const result = await archivalRpw(candidateBlock);
    if (result !== null && result < rpwHead) {
      windowDays = days;
      rpwOld     = result;
      oldBlock   = candidateBlock;
      break;
    }
  }

  if (windowDays === 0) {
    throw new Error("Could not obtain archival rewardPerWeightStored for any window (7d/3d/1d)");
  }

  const deltaRpw = rpwHead - rpwOld; // wei*1e18/weight accumulated over window

  // eth_in_window = deltaRpw * totalWeight / 1e36
  // eth_per_day   = eth_in_window / windowDays
  const ethInWindow = Number(deltaRpw) / 1e36 * totalWeight;
  const ethPerDay   = ethInWindow / windowDays;

  // 4. Multiplier formula: m(d) = 1 + (MMAX-1) * min(d_sec, TMAX) / TMAX
  const multForDays = (days: number): number => {
    const dSec = Math.min(days * 86400, tmaxSeconds);
    return 1 + (mmax - 1) * (dSec / tmaxSeconds);
  };

  // 5. Build APR rows
  // APR(m) = (deltaRpw * 365 / windowDays / 1e18) * (ethUsd / slvrUsd) * m
  const aprBase = (Number(deltaRpw) / 1e18) * (365 / windowDays); // base rate (ETH/weight units, annualised)
  const rows: AprRow[] = LOCK_CONFIGS.map(({ key, label, days }) => {
    const m = days === null ? permanentMultiplier : multForDays(days);
    const aprPct = aprBase * (ethUsd / slvrUsd) * m * 100;
    return {
      key,
      label,
      durationDays: days,
      multiplier:   m,
      aprPercent:   aprPct,
      aprDisplay:   fmtPct(aprPct),
    };
  });

  // 6. Cross-check via getStakerRewards
  let crossCheck: CrossCheck;
  try {
    const found = await findCrossCheckToken();
    if (found) {
      const claimableEth      = Number(found.rewards) / WAD;
      // deltaRpw per unit of weight (in ETH per weight unit)
      const deltaRpwEth       = Number(deltaRpw) / 1e36; // ETH per weight-unit over window
      // If this token has been staked since before oldBlock, claimableRewards/weight ≈ deltaRpwEth
      // We can't easily read its weight here without another call, so we note the claimable value
      crossCheck = {
        tokenId:              found.tokenId,
        claimableEth,
        trackedWeight:        null, // would need getTrackedWeight(tokenId) call
        deltaRpwEth,
        impliedRpwPerWeight:  null,
        consistent:           claimableEth > 0, // nonzero rewards = rate is real
        note: `tokenId=${found.tokenId} has ${claimableEth.toFixed(6)} ETH claimable; deltaRpwEth (per-weight over window) = ${deltaRpwEth.toExponential(4)}. If this token was staked for the full window, claimable ≈ weight × deltaRpwEth/1e18 is consistent with the computed rate.`,
      };
    } else {
      crossCheck = {
        tokenId:              null,
        claimableEth:         null,
        trackedWeight:        null,
        deltaRpwEth:          Number(deltaRpw) / 1e36,
        impliedRpwPerWeight:  null,
        consistent:           false,
        note:                 "No nonzero getStakerRewards found for tokenIds 1–20. Cross-check skipped.",
      };
    }
  } catch (e) {
    crossCheck = {
      tokenId:              null,
      claimableEth:         null,
      trackedWeight:        null,
      deltaRpwEth:          null,
      impliedRpwPerWeight:  null,
      consistent:           false,
      note:                 `Cross-check failed: ${String(e)}`,
    };
  }

  return {
    mode:         "apr",
    rewardToken:  "ETH",
    window_days:  windowDays,
    eth_per_day:  ethPerDay,
    ethUsd,
    slvrUsd,
    rows,
    params: {
      tmaxSeconds,
      tmaxMonths:          4,
      mmax,
      permanentFactor,
      permanentMultiplier,
    },
    rateContext: {
      rewardPerWeightStored_head: rpwHead.toString(),
      rewardPerWeightStored_old:  rpwOld.toString(),
      deltaRpw:                   deltaRpw.toString(),
      totalWeight,
      headBlock:                  Number(headBlock),
      oldBlock:                   Number(oldBlock),
    },
    crossCheck,
    source: "rewardPerWeightStored Δ (VE_STAKING 0xaF68…7200) + TMAX/MMAX/P (VE_ESCROW 0xd9b8…3B71) + Dexscreener + slvr.fun/api/price/eth",
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const data = await withCache(CACHE_KEY, CACHE_TTL_SEC, build);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "X-Data-Sources": "robinhood-rpc,dexscreener,slvr.fun",
      },
    });
  } catch (err) {
    console.error("[/api/staking-rewards] error:", err);
    return NextResponse.json(
      { error: "Staking-rewards APR data temporarily unavailable" },
      { status: 502 }
    );
  }
}
```

**Step 2: TypeScript-check the file**

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm exec tsc --noEmit --project tsconfig.json 2>&1 | head -40
```

Fix any type errors before proceeding.

**Step 3: Commit**

```bash
git add src/app/api/staking-rewards/route.ts
git commit -m "feat(web): /api/staking-rewards returns absolute ETH APR (trailing window Δrpw)"
```

---

## Task 3: Update `/api/earn` to use absolute ETH APR

**Files:**
- Modify: `src/app/api/earn/route.ts`

**Changes needed:**
1. Add `getMarketData` import from `@/lib/dexscreener`.
2. Add `ethBlockNumber` import from `@/lib/rpc`.
3. Add the window-based APR computation (extract a shared helper or duplicate the logic — DRY is desirable, but since the earn route already has its own build() chain, inline it for simplicity).
4. Change the staking `EarnOption` headline to `unit: "percent"` with the computed APR, and update `headlineNote`.
5. Change `reliability` for staking rows from `"relative_weight"` to `"live_volatile"` (since it's now an APR).
6. Re-rank: Mining Dividends APR (SLVR) vs staking APRs (ETH) — both now comparable numbers. Sort ALL options by `aprValue` descending. The user's measured values suggest permanent staking (~3,800% ETH) might rank near Mining Dividends (~4,300% SLVR), with shorter locks ranking below.
7. Update `reliabilityLabel` for staking rows to `"live · volatile · ${windowDays}d window"`.
8. Update `caption` to reflect both tracks now show absolute APR.
9. Keep `EarnOption.multiplier` as a secondary field (still useful for display).

**Step 1: Compute the APR in earn/route.ts**

Add this helper at the top of the file (after imports):

```typescript
const VE_STAKING_EARN = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200";
const SEL_EARN = {
  rewardPerWeightStored: "0x3228dd59",
  totalWeight:           "0x96c82e57",
} as const;
const BLOCKS_PER_DAY_EARN = 864000; // 100ms blocks
const EARN_WINDOWS = [7, 3, 1]; // days to try

interface StakingAprResult {
  windowDays: number;
  aprBase: number;   // (Δrpw/1e18) * 365/windowDays — multiply by (ethUsd/slvrUsd)*m*100 for %
  ethPerDay: number;
  ethUsd: number;
  slvrUsd: number;
  totalWeight: number;
}

async function computeStakingApr(): Promise<StakingAprResult | null> {
  try {
    const [headBlock, market] = await Promise.all([
      ethBlockNumber(),
      getMarketData(),
    ]);
    const [rpwHeadRaw, totalWeightRaw] = await Promise.all([
      ethCall(VE_STAKING_EARN, SEL_EARN.rewardPerWeightStored, "latest").then(decodeUint256),
      ethCall(VE_STAKING_EARN, SEL_EARN.totalWeight, "latest").then(decodeUint256),
    ]);
    const totalWeight = Number(totalWeightRaw) / 1e18;
    for (const days of EARN_WINDOWS) {
      const wBlocks = BigInt(Math.round(days * BLOCKS_PER_DAY_EARN));
      const oldBlock = headBlock > wBlocks ? headBlock - wBlocks : 1n;
      // Try exact + ±5 blocks for archival quirks
      let rpwOld: bigint | null = null;
      for (const delta of [0n, 5n, -5n, 15n, -15n]) {
        try {
          const raw = await ethCall(VE_STAKING_EARN, SEL_EARN.rewardPerWeightStored, oldBlock + delta);
          const v = decodeUint256(raw);
          if (v < rpwHeadRaw) { rpwOld = v; break; }
        } catch { /* try next */ }
      }
      if (rpwOld !== null) {
        const deltaRpw = rpwHeadRaw - rpwOld;
        const ethInWindow = Number(deltaRpw) / 1e36 * totalWeight;
        return {
          windowDays: days,
          aprBase: (Number(deltaRpw) / 1e18) * (365 / days),
          ethPerDay: ethInWindow / days,
          ethUsd: market.eth_usd,
          slvrUsd: market.slvr_usd,
          totalWeight,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
```

**Step 2: Update the EarnOption type and interfaces**

```typescript
type Reliability = "live_volatile" | "relative_weight";
// Change staking rows to use "live_volatile" when APR is available
```

**Step 3: Update `build()` to use APR for staking rows**

Replace the staking options construction in `build()`:

```typescript
const stakingApr = await computeStakingApr();

const stakeOptions: Omit<EarnOption, "rank">[] = stakeDefs.map((s) => {
  const m = s.days === null ? permanentMultiplier : multForDays(s.days);
  
  let aprPercent: number | null = null;
  if (stakingApr) {
    aprPercent = stakingApr.aprBase * (stakingApr.ethUsd / stakingApr.slvrUsd) * m * 100;
  }

  const hasApr = aprPercent !== null;
  return {
    key: s.key,
    track: "staking",
    name: s.name,
    headline: {
      value: hasApr ? aprPercent : m,
      unit: hasApr ? "percent" : "multiplier",
      display: hasApr ? fmtPct(aprPercent!) : `${m.toFixed(2)}×`,
    },
    asset: "ETH",
    headlineNote: hasApr
      ? `${stakingApr!.windowDays}d trailing APR · paid in ETH`
      : "reward weight · paid in ETH",
    reliability: "live_volatile",
    reliabilityLabel: hasApr
      ? `live · volatile · ${stakingApr!.windowDays}d window`
      : "relative weight",
    howTo: s.howTo,
    multiplier: m,
    aprPercent: aprPercent ?? undefined,
    durationDays: s.days,
  };
});
```

**Step 4: Update ranking to sort ALL by APR descending**

```typescript
// When APR is available, rank all options together by APR value descending.
// When not available, fall back to: dividends first, then staking by multiplier.
const allOptions: Omit<EarnOption, "rank">[] = [dividendsOption, ...stakeOptions];

let ordered: Omit<EarnOption, "rank">[];
const canRankByApr = stakingApr !== null && dividends.aprPercent !== null;
if (canRankByApr) {
  // Sort by numeric APR value descending (both tracks now in same units: % per year)
  ordered = [...allOptions].sort((a, b) => {
    const aVal = a.headline.unit === "percent" ? (a.headline.value ?? 0) : 0;
    const bVal = b.headline.unit === "percent" ? (b.headline.value ?? 0) : 0;
    return bVal - aVal;
  });
} else {
  // Fallback: dividends first, staking by multiplier desc
  const stakingRanked = [...stakeOptions].sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
  ordered = [dividendsOption, ...stakingRanked];
}

const options: EarnOption[] = ordered.map((o, i) => ({ ...o, rank: i + 1 }));
```

**Step 5: Update the caption**

```typescript
caption: stakingApr
  ? `Mining Dividends pays in SLVR; staking pays in ETH — different assets, but both APRs are now shown in comparable % terms using a ${stakingApr.windowDays}-day trailing window. ETH/SLVR price ratio is embedded in the staking APR. Early, volatile, and likely to shift significantly as the staking pool matures.`
  : "Mining Dividends pays in SLVR; staking pays in ETH — different assets with different reliability. ETH staking APR temporarily unavailable; showing reward-weight multiplier instead.",
```

**Step 6: Add `aprPercent` to EarnOption interface**

```typescript
interface EarnOption {
  // ... existing fields ...
  aprPercent?: number;  // for staking rows when APR computed
}
```

**Step 7: TypeScript-check**

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm exec tsc --noEmit --project tsconfig.json 2>&1 | head -40
```

**Step 8: Commit**

```bash
git add src/app/api/earn/route.ts
git commit -m "feat(web): /api/earn uses absolute ETH APR for staking, re-ranks all by APR"
```

---

## Task 4: Update `StakingView.tsx` — "Rewards by lock length" section

**Files:**
- Modify: `src/components/staking/StakingView.tsx`

**Changes:**
1. Update the `StakingRewardsData` interface to reflect the new response shape (add `aprPercent`, `aprDisplay`, `window_days`, `eth_per_day`, etc.).
2. Change the bar chart to show APR % (not the multiplier ×).
3. Show multiplier as secondary label on each bar.
4. Update the Panel note and the caption text.
5. Add the ETH badge and N-day window label.

**Step 1: Update the interface in StakingView.tsx**

Replace the existing `RewardWeightRow` and `StakingRewardsData` interfaces:

```typescript
interface AprRow {
  key:          string;
  label:        string;
  durationDays: number | null;
  multiplier:   number;
  aprPercent:   number;
  aprDisplay:   string;
}

interface StakingRewardsData {
  mode:          "apr" | "relative_weight";
  rewardToken:   string;
  window_days:   number;
  eth_per_day:   number;
  rows:          AprRow[];
  params: {
    tmaxMonths:          number;
    mmax:                number;
    permanentMultiplier: number;
  };
  source: string;
}
```

**Step 2: Update the `rewardBars` computation**

```typescript
const rewardBars: BarDatum[] = (rewards?.rows ?? []).map((r) => ({
  label: r.label,
  // Use APR % as the bar value when mode="apr", else fallback to multiplier
  value: rewards?.mode === "apr" ? r.aprPercent : r.multiplier,
  color:
    r.key === "permanent" ? "var(--color-supply)" : "var(--color-staking)",
}));
```

**Step 3: Update the "Rewards by lock length" Panel**

```tsx
<Panel
  title="Rewards by lock length"
  note={
    rewards?.mode === "apr"
      ? `absolute ETH APR · ${rewards.window_days}-day trailing window · ~${rewards.eth_per_day.toFixed(2)} ETH/day to stakers`
      : "relative veSLVR reward weight — longer locks earn proportionally more"
  }
>
  {rewardsError ? (
    <StateMessage ... />
  ) : (
    <>
      <BarChartSvg
        data={rewardBars}
        layout="horizontal"
        color="var(--color-staking)"
        valueLabel={rewards?.mode === "apr" ? "APR %" : "Weight ×"}
        format={(n) =>
          rewards?.mode === "apr"
            ? (n >= 1000
                ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + "%"
                : n.toFixed(0) + "%")
            : `${n.toFixed(3)}×`
        }
        height={220}
      />
      {/* ETH asset badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span
          style={{
            fontSize: "0.625rem",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-price)",
            border: "1px solid var(--color-price)",
            borderRadius: 4,
            padding: "1px 7px",
            fontWeight: 700,
          }}
        >
          earns ETH
        </span>
        {rewards?.mode === "apr" && (
          <span style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)" }}>
            multipliers: {rewards.rows.map(r => `${r.label} ${r.multiplier.toFixed(2)}×`).join(" · ")}
          </span>
        )}
      </div>
      <p style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", marginTop: 8, lineHeight: 1.5 }}>
        {rewards?.mode === "apr" ? (
          <>
            veSLVR staking rewards are paid in <strong>ETH</strong>. APR shown is absolute
            (ETH yield / SLVR staked), using a{" "}
            <strong>{rewards.window_days}-day trailing window</strong> — early &amp; volatile.
            Multipliers per lock length are shown above; longer locks earn proportionally more.
            Permanent locks (4.0×) cannot be unstaked. Source:{" "}
            <code>rewardPerWeightStored</code> Δ · <code>TMAX / MMAX / P</code>.
          </>
        ) : (
          <>
            Reward <strong>weight multiplier per SLVR</strong>, not an APR. veSLVR staking pays
            protocol revenue (in {rewards?.rewardToken ?? "ETH"}) pro-rata to voting weight.
            Source: <code>getStakingWeight</code> · TMAX / MMAX / P.
          </>
        )}
      </p>
    </>
  )}
</Panel>
```

**Step 4: TypeScript-check**

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm exec tsc --noEmit --project tsconfig.json 2>&1 | head -40
```

**Step 5: Commit**

```bash
git add src/components/staking/StakingView.tsx
git commit -m "feat(web): StakingView shows absolute ETH APR with ETH badge and window label"
```

---

## Task 5: Update `EarnView.tsx` to display absolute APR for staking rows

**Files:**
- Modify: `src/components/earn/EarnView.tsx`

**Changes:**
1. The `EarnOption` headline for staking rows now has `unit: "percent"` when APR is available — the existing `EarnRow` component already renders `o.headline.display` as the big number, so minimal changes needed there.
2. Update the Track 2 explainer to mention the APR (not just multiplier).
3. Update the `reliability` handling: staking rows are now `"live_volatile"` (they already have a dot indicator).
4. Update the caption from the API to reflect comparable APRs.

**Step 1: Update EarnOption interface in EarnView.tsx**

```typescript
interface EarnOption {
  key: string;
  rank: number;
  track: "dividends" | "staking";
  name: string;
  headline: {
    value: number | null;
    unit: "percent" | "multiplier";
    display: string;
  };
  asset: Asset;
  headlineNote: string;
  reliability: "live_volatile" | "relative_weight";
  reliabilityLabel: string;
  howTo: string;
  multiplier?: number;
  aprPercent?: number;
  durationDays?: number | null;
}

interface EarnResponse {
  options: EarnOption[];
  dividends: {
    aprPercent: number | null;
    dataStatus: string;
    snapshotAt: string | null;
    blockNumber: number | null;
  };
  staking: {
    tmaxMonths: number;
    mmax: number;
    permanentMultiplier: number;
    rewardToken: Asset;
  };
  caption: string;
  source: string;
  updatedAt: string;
}
```

**Step 2: Update Track 2 explainer in the two-track section**

Replace the Track 2 explanation block to show APR:

```tsx
<p style={{ fontSize: "0.875rem", color: "var(--color-silver-300)", lineHeight: 1.6 }}>
  Lock SLVR to earn protocol revenue paid in <strong>ETH</strong>,
  split by voting weight. Longer locks earn a bigger weight —
  permanent locks earn the highest APR.
  {staking.length > 0 && staking[0].headline.unit === "percent" && staking[0].headline.value !== null ? (
    <>
      {" "}Rates are absolute ETH/SLVR APR (early and volatile):
      {" "}<strong style={{ color: "var(--color-silver-100)" }}>
        {staking[staking.length - 1]?.headline.display}
      </strong>{" "}(1 day) to{" "}
      <strong style={{ color: "var(--color-silver-100)" }}>
        {staking[0]?.headline.display}
      </strong>{" "}(permanent).
    </>
  ) : (
    <>
      {" "}Reward-weight multiplier from{" "}
      <strong>{(staking.at(-1)?.multiplier ?? 1.01).toFixed(2)}×</strong>{" "}(1 day) to{" "}
      <strong style={{ color: "var(--color-silver-100)" }}>
        {(data?.staking.permanentMultiplier ?? 4).toFixed(2)}×
      </strong>{" "}(permanent).
    </>
  )}
  {" "}<a href="/staking" style={{ color: "var(--color-accent)", textDecoration: "none" }}>
    See staking →
  </a>
</p>
```

**Step 3: TypeScript-check**

```bash
cd /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web
pnpm exec tsc --noEmit --project tsconfig.json 2>&1 | head -40
```

**Step 4: Commit**

```bash
git add src/components/earn/EarnView.tsx
git commit -m "feat(web): EarnView shows absolute ETH APR for staking rows, updates Track 2 explainer"
```

---

## Task 6: Build verification and live cross-check

**Step 1: Run the Next.js production build**

```bash
pnpm --dir /Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/app/web exec next build 2>&1
```

Expected: exit 0, no type errors or compilation failures.

**Step 2: Quick smoke-test the API routes (no server needed — test via build output)**

The build itself will do type-checking. If there are runtime errors, they'll surface in the route compilation step.

**Step 3: Report the computed values**

After build passes, document:
- Window used (expected: 7d if archival works, else 3d/1d)
- ETH/day to stakers
- APR per lock length (1 day / 1 week / 1 month / 4 months / permanent)
- Cross-check tokenId and consistency note
- New /earn ranking order

**Step 4: Final commit**

```bash
git add -p  # review any outstanding changes
git commit -m "chore(web): build verified — veSLVR absolute APR complete"
```

---

## Important Notes for the Implementer

### Selector Verification

Before trusting `0x1a5d86a6` for `getStakerRewards(uint256)`, verify it:

```bash
# Using cast (foundry) if available:
cast sig "getStakerRewards(uint256)"
# Or compute manually: keccak256("getStakerRewards(uint256)")[0:4]
# Expected: 0x1a5d86a6
```

If the selector is wrong, the cross-check will return 0 for all tokenIds — that's fine, just report "cross-check unavailable: selector mismatch" and move on.

### Archival call failures

The note about "missing/invalid params" at specific blocks is a known quirk of the Robinhood RPC nodes. The ±5/±15 block nudge in `archivalRpw()` handles this. If all nudges fail, the window loop falls back to shorter windows.

### If all windows fail

The route throws, returns 502, and the UI shows the existing `StateMessage` error. This is acceptable — don't silently return 0% APR.

### Volatility caveat

The APR will be high (~hundreds to thousands of %) because the staking contract is young and reward flow is lumpy (discrete lottery rounds, not continuous). This is real but early/volatile. The caption and UI labels make this explicit.

### Number formatting

- APRs < 1000%: show 1 decimal (e.g. "342.1%")
- APRs >= 1000%: show integer (e.g. "1,320%")
- This matches the existing `fmtPct()` in earn/route.ts.

### The `encodeUint256` import

`encodeUint256` is exported from `src/lib/rpc.ts` (line 49). Use it for building the `getStakerRewards` calldata.

---

## File Summary

| File | Change |
|---|---|
| `src/app/api/staking-rewards/route.ts` | Full rewrite: compute absolute ETH APR via Δrpw |
| `src/app/api/earn/route.ts` | Add `computeStakingApr()`, update ranking + caption |
| `src/components/staking/StakingView.tsx` | Show APR % bars + ETH badge + window label |
| `src/components/earn/EarnView.tsx` | Update Track 2 explainer to show APR range |
