/**
 * Contract and wallet registry.
 * Source: .planning/PROJECT.md
 * getLabel(address) → human-readable name or null
 * getBlockscoutUrl(address) → Blockscout explorer URL
 */

const CHAIN_ID = 4663;
const BLOCKSCOUT_BASE = "https://robinhoodchain.blockscout.com";

// Production contracts
const CONTRACT_LABELS: Record<string, string> = {
  // Core token
  "0x791229e3ebd6cfdc3d8157f48722684173c29ad9": "SLVR Token",

  // Grid Mining / game
  "0xb0cc994ce4e8fb106da9eb36e26fdd8c5f1e0c71": "Grid Mining",
  "0x284eb4016305fa7fbc162fb68f27227271001c7f": "Grid Mining (Legacy)",
  "0x8c756b6738bdd687c3376c748c63419be0412fdd": "Genesis Game",

  // Automation
  "0x5fd69ee67472495cdc0be784898647782e073ff5": "AutoCommit V3",
  "0x314c8d5755468224ac60c36fb5494f0d7d5abb3b": "AutoCommit V2",
  "0x1399115fcf2a9c41e5080547a9214156a4bf8a45": "AutoCommit V1",

  // Claim / locker
  "0x83f84c5d431a986a1ab209f902b954b5d3550d8c": "ClaimLocker V2",
  "0x2fd3be762eb9d8ee293dd923d8809dbd3d653dd7": "ClaimLocker V1",

  // Multi-claim
  "0x9f34a8561f97e388d4a1589c1d046c61d6915323": "MultiClaim",
  "0x32783f1301147f6fb45c049a9546819655f81415": "MultiClaim V1",

  // Protocol
  "0x1f3b0992fabcf77d4df7baa416b9185e464d58f3": "Drand Provider",
  "0x24b723e2da172961f60cd6a4699654c89d4ac6cd": "Jackpot",
  "0x3942cda122ef303f47d4509a6be57736e323cee4": "Game Registry",
  "0x55fc0daab486e46fbf1d60787420c0311d9dd57f": "SLVR Hub",
  "0xd9b8fbd61033145c5496132153ce675756313b71": "Vote Escrow NFT",
  "0xaf68598ebd245dc3cb92ff16e9ba1814dd137200": "veSLVR Staking",
  "0x7d888f4ca88fc3578aefc45c82482bd66415dfea": "LP Staking",
  "0xfafcbd4d09c096eb06aa2256c7a65ceab2db39f5": "Team Vesting",
  "0x1a1633fdb2f19082099a6ad6c3d4f1ec6bce9729": "Growth Fund",
  "0x4ba36b684350471c6fa03f4ebdef9120496db45f": "veSLVR Metadata",
  "0x85b10820f5b7ef2bbf9f5b59da64860dd6bfb9f0": "Liquidity Zap",
  "0xf9d2540662f48f21364b98240574384fe88e8f2f": "Jackpot Insurance",

  // DEX
  "0xe365b92239097ed3322131411dbe15a5c4068eff": "SLVR/WETH V2 Pair",
  "0x89e5db8b5aa49aa85ac63f691524311aeb649eba": "Uniswap V2 Router",
  "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f": "Uniswap V2 Factory",
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73": "WETH",
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG",
  "0xca11bde05977b3631167028862be2a173976ca11": "Multicall3",
  "0x8366a39cc670b4001a1121b8f6a443a643e40951": "Uniswap V4 PoolManager",
  "0x58daec3116aae6d93017baaea7749052e8a04fa7": "Uniswap V4 PositionManager",
  "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b": "Uniswap V4 StateView",
  "0x8dc178efb8111bb0973dd9d722ebeff267c98f94": "Uniswap V4 Quoter",

  // Key wallets
  "0x11111972fe1b7e52d36609bcaf8702c65b025b46": "Protocol Deployer",
  "0x4444479b89b684e79392924b3a70be03733190de": "Growth Recipient",

  // Buyback-and-burn
  "0x7a58d6f46e92b02618edb4f5ff3b72f7e64077ad": "Buyback Keeper",
  "0xacdd8e9bad637798dbdb23a59cfa314743668ba4": "Buyback Executor",
  "0xf32fc533511783b2707a08eea22a9f4e59996100": "SLVR Graveyard",
  // Growth Fund flywheel
  "0xec8c0a41f4f8ff291e111db988d266bbf3f4ee3a": "Growth Fund Buyer",
};

/**
 * Returns a human-readable label for a known contract/wallet address.
 * Address comparison is case-insensitive.
 */
export function getLabel(address: string): string | null {
  return CONTRACT_LABELS[address.toLowerCase()] ?? null;
}

/**
 * Returns the Blockscout explorer URL for an address.
 */
export function getBlockscoutUrl(
  address: string,
  type: "address" | "token" = "address"
): string {
  return `${BLOCKSCOUT_BASE}/${type}/${address}`;
}

export const CHAIN = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: BLOCKSCOUT_BASE,
} as const;

export const SLVR_TOKEN_ADDRESS = "0x791229E3EbD6CFdC3D8157f48722684173C29aD9";
export const SLVR_MAX_SUPPLY = 500_000;
