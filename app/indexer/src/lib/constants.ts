export const CHAIN_ID = 4663 as const;
export const MIGRATION_ROUND = 12_500n;                          // bigint for comparison with event.args.roundId
export const V1_ADDRESS = "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f" as const;
export const V2_ADDRESS = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" as const;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// --- Phase 2 additions ---

// veSLVR Vote Escrow NFT
export const VESLVR_NFT_ADDRESS    = "0xd9b8FBD61033145c5496132153CE675756313B71" as const;
// veSLVR Staking
export const VESLVR_STAKING_ADDRESS = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200" as const;
// LP Staking
export const LP_STAKING_ADDRESS    = "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA" as const;
// SLVR Hub
export const HUB_ADDRESS           = "0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f" as const;
// SLVR/WETH V2 Pair
export const V2_PAIR_ADDRESS       = "0xe365b92239097Ed3322131411DbE15a5c4068eff" as const;
// Uniswap V4 PoolManager
export const V4_POOL_MANAGER       = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;

// V4 SLVR pool IDs (bytes32, NOT addresses)
export const V4_SLVR_ETH_POOL_ID  = "0xb7d8f0dc9cd5f756a792e3fb8e5422d40a0ac1ededd735479f3689e883d023b3" as const;
export const V4_SLVR_USDG_POOL_ID = "0xd3d9204b35522f142d7283eaffac9dddd2319fe27d5d808a6f201acfa7776f6a" as const;
