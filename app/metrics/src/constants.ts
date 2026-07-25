// Chain
export const CHAIN_ID = 4663 as const;

// Primary and secondary RPCs — both archive nodes (verified eth_call at historical blocks works)
export const RPC_PRIMARY = "https://rpc.mainnet.chain.robinhood.com";
export const RPC_SECONDARY = "https://slvr.fun/api/rpc";
// Keep backward compat for old imports
export const RPC_URL = process.env.PONDER_RPC_URL_4663 ?? RPC_PRIMARY;

export const WAD = 1_000_000_000_000_000_000n; // 1e18

// SLVR Token — 0x791229E3EbD6CFdC3D8157f48722684173C29aD9
export const SLVR_TOKEN = "0x791229E3EbD6CFdC3D8157f48722684173C29aD9" as const;
export const SLVR_CAP = 500_000n * WAD; // 500,000 SLVR in raw units

// Grid Lottery
export const LOTTERY_V1 = "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f" as const;
export const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" as const;
// Block when V2 was deployed; V2's minerIndex accumulator started fresh here
export const LOTTERY_V2_DEPLOY_BLOCK = 16_764_101n;

// Vote Escrow NFT (soulbound — all locks live here)
export const VOTE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71" as const;

// LP Staking contract (stakes SLVR/WETH V2 LP tokens)
export const LP_STAKING = "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA" as const;

// Hub
export const SLVR_HUB = "0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f" as const;

// Round-based canonical split: rounds < 12500 → V1 canonical, >= 12500 → V2 canonical
export const MIGRATION_ROUND = 12_500n;

// Deployment blocks
export const DEPLOY_BLOCK_TOKEN = 5_574_774n;
export const DEPLOY_BLOCK_LOTTERY_V2 = 16_764_101n;

// Circulating supply exclusions — non-circulating SLVR wallets
// These addresses hold SLVR that is not freely tradable/circulating
export const EXCLUDED_ADDRESSES = [
  { address: "0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5", label: "Team Vesting" },
  { address: "0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729", label: "Growth Fund" },
  { address: "0x4444479B89b684e79392924B3A70BE03733190dE", label: "Growth Recipient" },
] as const;

// Audit-only (NOT subtracted from circulating supply; logged to metadata for transparency)
export const AUDIT_ADDRESSES = [
  { address: "0x11111972FE1b7e52D36609bCaF8702c65b025B46", label: "Protocol Deployer" },
] as const;

// APR window: 7-day rolling (kept for reference; not used in active APR computation)
export const APR_WINDOW_SECONDS = 604_800; // 7 days
// APR trailing window: 24-hour rolling (replaces the 7d launch-anchored window)
export const APR_TRAIL_SECONDS = 86_400; // 24 hours
export const SECONDS_PER_YEAR = 31_536_000;

// 30d window for emission rate
export const EMISSION_WINDOW_SECONDS = 30 * 24 * 3600;

// Snapshot cron intervals (ms)
export const VITALS_INTERVAL_MS = 60_000;   // 60 seconds
export const HISTORY_INTERVAL_MS = 600_000; // 10 minutes

// Historical backfill cadence in seconds (2h = ~72000 blocks at 100ms/block)
export const BACKFILL_STEP_SECONDS = 2 * 3600; // 2 hours

// Approx blocks per second (Robinhood Chain: ~100ms block time = 10 blocks/sec)
export const APPROX_BLOCKS_PER_SEC = 10;
