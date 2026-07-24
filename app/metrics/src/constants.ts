// Chain
export const CHAIN_ID = 4663 as const;
// Share the indexer's RPC env var; fall back to the public endpoint
export const RPC_URL = process.env.PONDER_RPC_URL_4663 ?? "https://rpc.mainnet.chain.robinhood.com";
export const WAD = 1_000_000_000_000_000_000n; // 1e18

// SLVR Token — 0x791229E3EbD6CFdC3D8157f48722684173C29aD9
export const SLVR_TOKEN = "0x791229E3EbD6CFdC3D8157f48722684173C29aD9" as const;
export const SLVR_CAP = 500_000n * WAD; // 500,000 SLVR in raw units

// Grid Lottery
export const LOTTERY_V1 = "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f" as const;
export const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" as const;
// Block when V2 was deployed; V2's minerIndex accumulator started fresh here
export const LOTTERY_V2_DEPLOY_BLOCK = 16_764_101n;

// Round-based canonical split: rounds < 12500 → V1 canonical, >= 12500 → V2 canonical
export const MIGRATION_ROUND = 12_500n;

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

// APR window: 7-day rolling
export const APR_WINDOW_SECONDS = 604_800; // 7 days
export const SECONDS_PER_YEAR = 31_536_000;

// Snapshot cron intervals (ms)
export const VITALS_INTERVAL_MS = 60_000;   // 60 seconds
export const HISTORY_INTERVAL_MS = 600_000; // 10 minutes
