/**
 * lpStakingApy.ts — APR for staking Uniswap V4 SLVR/ETH LP positions.
 *
 * Mechanism (reverse-engineered from on-chain, contracts unverified for lpRewards):
 *   - The SLVR/ETH V4 pool uses the SlvrHook (0x64c6…), which takes a 2% sell-side
 *     tax and routes a share as SLVR into the lpRewards distributor (0x9cfE…).
 *   - Users stake their V4 position NFTs into lpRewards (it holds the NFTs).
 *   - lpRewards distributes the incoming SLVR to stakers pro-rata by liquidity.
 *
 * APR = (annual SLVR rewards, valued in ETH) / (staked-position value in ETH).
 *   - Numerator: trailing-24h SLVR sent hook→lpRewards, annualized, ÷ price.
 *   - Denominator: EXACT value of every staked position — enumerate the NFTs
 *     lpRewards holds, read each (liquidity, tickLower, tickUpper), and compute
 *     token amounts at the current sqrtPrice (Uniswap V4 liquidity math). This
 *     matters: the positions are concentrated, so a full-range approximation
 *     overvalues them ~2.6× and understates the APR.
 *
 * NOTE: inherently a trailing, VOLUME-DEPENDENT estimate — the reward stream is a
 * share of sell-tax volume, and the pool is young. Treat as an estimate.
 */
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { RPC_PRIMARY } from "../constants";

const client = createPublicClient({ transport: http(RPC_PRIMARY) });

const POOL_ID = "0x2944d4ea031cfb316572a7b0a4afe912a5757dec0d6be757afff4cae0a110ef1" as const;
const HOOK = "0x64c6103255CcC638FeBE3619AeB52d2b59d6a0Cc" as const;
const LP_REWARDS = "0x9cfE35a013feEE244F2e7dd3AD1D0Db67671b301" as const;
const POSITION_MANAGER = "0x58daec3116aae6d93017baaea7749052e8a04fa7" as const;
const STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as const;
const SLVR = "0x791229E3EbD6CFdC3D8157f48722684173C29aD9" as const;
const POOL_CREATION_BLOCK = 20959201n; // Initialize of the hooked SLVR/ETH pool
const BLOCKS_PER_DAY = 864000n; // 100ms blocks

const Q96 = 2 ** 96;
// V4 full-range aligns to ±887220 at tickSpacing 60; treat near-min/max as full-range.
const FULL_RANGE_MIN_TICK = -880000;
const FULL_RANGE_MAX_TICK = 880000;

const SV_ABI = parseAbi([
  "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32) view returns (uint128)",
]);
const LPR_ABI = parseAbi(["function totalStakedLiquidity() view returns (uint256)"]);
const PM_ABI = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function getPositionLiquidity(uint256) view returns (uint128)",
  "function positionInfo(uint256) view returns (uint256)",
]);
const ERC721_XFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);
const ERC20_XFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

/** getLogs with recursive subdivide on RPC range/timeout errors. */
async function safeLogs<T>(params: {
  address: `0x${string}`;
  event: T;
  args: Record<string, unknown>;
  from: bigint;
  to: bigint;
}): Promise<Array<{ args: Record<string, bigint | string> }>> {
  const scan = async (a: bigint, b: bigint): Promise<Array<{ args: Record<string, bigint | string> }>> => {
    try {
      // @ts-expect-error viem event typing is loose here on purpose
      return await client.getLogs({ address: params.address, event: params.event, args: params.args, fromBlock: a, toBlock: b });
    } catch (e) {
      if (b > a) {
        const mid = (a + b) / 2n;
        const [l, r] = await Promise.all([scan(a, mid), scan(mid + 1n, b)]);
        return [...l, ...r];
      }
      return [];
    }
  };
  return scan(params.from, params.to);
}

/** Uniswap V4/V3 token amounts (wei) for liquidity L in [tickLower,tickUpper] at sqrtP. */
function amountsForLiquidity(L: number, tickLower: number, tickUpper: number, sqrtP: number): [number, number] {
  const sqrtA = Math.sqrt(Math.pow(1.0001, tickLower)) * Q96;
  const sqrtB = Math.sqrt(Math.pow(1.0001, tickUpper)) * Q96;
  let amount0 = 0; // token0 = ETH (native)
  let amount1 = 0; // token1 = SLVR
  if (sqrtP <= sqrtA) {
    amount0 = (L * (sqrtB - sqrtA)) / (sqrtA * sqrtB) * Q96;
  } else if (sqrtP < sqrtB) {
    amount0 = (L * (sqrtB - sqrtP)) / (sqrtP * sqrtB) * Q96;
    amount1 = (L * (sqrtP - sqrtA)) / Q96;
  } else {
    amount1 = (L * (sqrtB - sqrtA)) / Q96;
  }
  return [amount0, amount1];
}

export interface LpStakingApyResult {
  aprPercent: number;
  /** APR for the concentrated-position cohort (higher — more liquidity per $). */
  concentratedApr: number;
  /** APR for the full-range cohort (lower — less liquidity per $). */
  fullRangeApr: number;
  concentratedValueEth: number;
  fullRangeValueEth: number;
  concentratedPositions: number;
  fullRangePositions: number;
  stakedValueEth: number;
  stakedSlvr: number;
  stakedEth: number;
  rewardSlvrPerDay: number;
  positionCount: number;
  stakedLiquidity: string;
  poolLiquidity: string;
  stakedPctOfPool: number;
  slvrPerEth: number;
}

/**
 * Compute the current LP-staking APR. Returns null if the mechanism looks
 * inactive (no staked value or no pool price) — e.g. before the pool exists.
 */
export async function computeLpStakingApy(atBlock?: bigint): Promise<LpStakingApyResult | null> {
  const head = atBlock ?? (await client.getBlockNumber());
  if (head < POOL_CREATION_BLOCK) return null; // pool did not exist yet
  const at = { blockNumber: head } as const;

  const [slot0, poolLiqRaw, stakedLiqRaw] = await Promise.all([
    client.readContract({ address: STATE_VIEW, abi: SV_ABI, functionName: "getSlot0", args: [POOL_ID], ...at }),
    client.readContract({ address: STATE_VIEW, abi: SV_ABI, functionName: "getLiquidity", args: [POOL_ID], ...at }),
    client.readContract({ address: LP_REWARDS, abi: LPR_ABI, functionName: "totalStakedLiquidity", ...at }),
  ]);
  const sp = Number(slot0[0]);
  const slvrPerEth = (sp / Q96) ** 2;
  if (!(slvrPerEth > 0)) return null;

  // Enumerate NFTs sent to lpRewards up to `head`, keep those it owned AT `head`, value each.
  const xfers = await safeLogs({ address: POSITION_MANAGER, event: ERC721_XFER, args: { to: LP_REWARDS }, from: POOL_CREATION_BLOCK, to: head });
  const ids = [...new Set(xfers.map((l) => l.args.tokenId as bigint))];
  let stakedEth = 0;
  let stakedSlvr = 0;
  let count = 0;
  // Split by range type (concentrated vs full-range).
  let concL = 0, concVal = 0, concN = 0;
  let fullL = 0, fullVal = 0, fullN = 0;
  for (const id of ids) {
    let owner: string;
    try {
      owner = (await client.readContract({ address: POSITION_MANAGER, abi: PM_ABI, functionName: "ownerOf", args: [id], ...at })) as string;
    } catch {
      continue; // not minted yet / burned at this block
    }
    if (owner.toLowerCase() !== LP_REWARDS.toLowerCase()) continue;
    count++;
    const [L, info] = await Promise.all([
      client.readContract({ address: POSITION_MANAGER, abi: PM_ABI, functionName: "getPositionLiquidity", args: [id], ...at }),
      client.readContract({ address: POSITION_MANAGER, abi: PM_ABI, functionName: "positionInfo", args: [id], ...at }),
    ]);
    const tickLower = Number(BigInt.asIntN(24, ((info as bigint) >> 8n) & 0xffffffn));
    const tickUpper = Number(BigInt.asIntN(24, ((info as bigint) >> 32n) & 0xffffffn));
    const Ln = Number(L);
    const [a0, a1] = amountsForLiquidity(Ln, tickLower, tickUpper, sp);
    const posValueEth = a0 / 1e18 + (a1 / 1e18) / slvrPerEth;
    stakedEth += a0 / 1e18;
    stakedSlvr += a1 / 1e18;
    if (tickLower <= FULL_RANGE_MIN_TICK && tickUpper >= FULL_RANGE_MAX_TICK) {
      fullL += Ln; fullVal += posValueEth; fullN++;
    } else {
      concL += Ln; concVal += posValueEth; concN++;
    }
  }
  const stakedValueEth = stakedEth + stakedSlvr / slvrPerEth;
  if (!(stakedValueEth > 0)) return null;

  // Trailing-24h SLVR routed hook -> lpRewards. Clamp the window to the pool's
  // life and annualize by the ACTUAL window duration, so young/early samples
  // (window shorter than 24h) aren't understated.
  const from = head - BLOCKS_PER_DAY > POOL_CREATION_BLOCK ? head - BLOCKS_PER_DAY : POOL_CREATION_BLOCK;
  const inflows = await safeLogs({ address: SLVR, event: ERC20_XFER, args: { from: HOOK, to: LP_REWARDS }, from, to: head });
  let rewardWei = 0n;
  for (const l of inflows) rewardWei += l.args.value as bigint;
  const windowDays = Math.max(Number(head - from) / Number(BLOCKS_PER_DAY), 1 / 24); // >= ~1h floor
  const rewardSlvrPerDay = Number(rewardWei) / 1e18 / windowDays;

  const annualEth = (rewardSlvrPerDay * 365) / slvrPerEth;
  const aprPercent = (annualEth / stakedValueEth) * 100;

  // Rewards are per unit of liquidity, so each cohort's reward share ∝ its L,
  // but its APR is against its own capital value. Concentrated packs more L per
  // dollar → higher APR; full-range spreads thin → lower APR.
  const totalL = concL + fullL;
  const rewardPerL = totalL > 0 ? rewardSlvrPerDay / totalL : 0;
  const cohortApr = (cL: number, cVal: number): number =>
    cVal > 0 ? ((rewardPerL * cL * 365) / slvrPerEth / cVal) * 100 : 0;

  return {
    aprPercent,
    concentratedApr: cohortApr(concL, concVal),
    fullRangeApr: cohortApr(fullL, fullVal),
    concentratedValueEth: concVal,
    fullRangeValueEth: fullVal,
    concentratedPositions: concN,
    fullRangePositions: fullN,
    stakedValueEth,
    stakedSlvr,
    stakedEth,
    rewardSlvrPerDay,
    positionCount: count,
    stakedLiquidity: (stakedLiqRaw as bigint).toString(),
    poolLiquidity: (poolLiqRaw as bigint).toString(),
    stakedPctOfPool: (Number(stakedLiqRaw) / Number(poolLiqRaw)) * 100,
    slvrPerEth,
  };
}
