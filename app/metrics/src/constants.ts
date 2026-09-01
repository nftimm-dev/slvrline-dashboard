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

// Grid Mining (contract selectors/vars keep the LOTTERY_ name — internal only)
export const LOTTERY_V1 = "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f" as const;
export const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" as const;
export const LOTTERY_V3 = "0xa1e5213505772B195FD7AE3b4a6b27B58Cf72A3D" as const;
// Permanent miner-state vault introduced with the round-33,500 generation.
// Dividends and unrefined balances live here rather than in LOTTERY_V3, so this
// address survives future lottery upgrades.
export const MINER_VAULT = "0x2070b4B0c57EaF070CF86cD8321a6054f3D25260" as const;
// Block when V2 was deployed; V2's minerIndex accumulator started fresh here
export const LOTTERY_V2_DEPLOY_BLOCK = 16_764_101n;
export const MINER_VAULT_DEPLOY_BLOCK = 35_594_698n;
export const LOTTERY_V3_DEPLOY_BLOCK = 35_599_521n;

// Vote Escrow NFT (soulbound — all locks live here)
export const VOTE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71" as const;

// LP Staking contract (stakes SLVR/WETH V2 LP tokens)
export const LP_STAKING = "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA" as const;

// Hub
export const SLVR_HUB = "0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f" as const;

// --- Buyback-and-burn -------------------------------------------------------
// Keeper EOA fires the executor every ~80-90s; the executor swaps mining-revenue
// ETH → SLVR on the V4 pool and forwards it to the graveyard, emitting BuybackBurned.
export const BUYBACK_KEEPER = "0x7a58D6f46E92b02618EdB4f5ff3b72f7E64077Ad" as const;
export const BUYBACK_EXECUTOR = "0xacdd8E9bad637798dBdb23a59cfa314743668bA4" as const;
// SlvrGraveyard — an intentionally-empty, unrecoverable contract. Buyback SLVR is
// parked here permanently. It is NOT the 0x0/dead burn (which the token redirects into
// a real totalSupply burn); graveyard SLVR stays in totalSupply() but is out of
// circulation, so we subtract it from circulating supply.
export const SLVR_GRAVEYARD = "0xF32Fc533511783b2707A08eEA22A9f4E59996100" as const;
// BuybackBurned(uint256 ethIn, uint256 tokensBurned) — both non-indexed (in data).
export const BUYBACK_BURNED_TOPIC0 =
  "0xc65a4c73cfd820dccb7079db9e52bb2c09dfd56f9221e7d815e201b726b5c39d" as const;
// First BuybackBurned event (executor was created earlier at 34,773,725 but buybacks
// began here). Scan start for the event history.
export const DEPLOY_BLOCK_BUYBACK = 35_769_560n;

// --- Growth Fund buyback (accumulation, NOT burn) ---------------------------
// A separate EOA that buys SLVR on the V4 pool (~every 5 min) and HOLDS it — the
// Growth Fund accumulating SLVR (buy pressure). Tracked via Transfer(SLVR → wallet);
// it never sells, so cumulative bought == balanceOf.
export const GROWTH_FUND_BUYER = "0xec8c0A41F4F8ff291E111DB988D266BBF3F4eE3a" as const;
// First buy ~block 33,052,748 (2026-08-10); scan a little earlier to be safe.
export const DEPLOY_BLOCK_GROWTHFUND = 32_000_000n;

// Round-based canonical splits.
export const MIGRATION_ROUND = 12_500n;
export const MINER_VAULT_MIGRATION_ROUND = 33_500n;

// Deployment blocks
export const DEPLOY_BLOCK_TOKEN = 5_574_774n;
export const DEPLOY_BLOCK_LOTTERY_V2 = 16_764_101n;
export const DEPLOY_BLOCK_LOTTERY_V3 = 35_599_521n;

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
